// Cron-invoked worker: claims queued jobs and runs the parse -> enrich pipeline.
// Invoked every minute by pg_cron via pg_net with the anon key as Bearer token
// plus an x-worker-secret header checked against Vault.

import { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { serviceClient, getSecret } from '../_shared/db.ts';
import { Job, completeJob, failJob, enqueue } from '../_shared/queue.ts';
import { parseArticle } from '../_shared/parsers/article.ts';
import { parseYouTube } from '../_shared/parsers/youtube.ts';
import { parseTweet } from '../_shared/parsers/tweet.ts';
import { parsePdf } from '../_shared/parsers/pdf.ts';
import { parseReel } from '../_shared/parsers/reel.ts';
import { parseReddit } from '../_shared/parsers/reddit.ts';
import { parseFacebook, isFacebookContentUrl } from '../_shared/parsers/facebook.ts';
import { ParsedContent } from '../_shared/parsers/types.ts';
import { embedText } from '../_shared/gemini.ts';
import { enrich, resolveContentTypeLabel, LlmProvider, ProviderConfig } from '../_shared/llm.ts';
import { categoryLabel, pickCategoryFolder } from '../_shared/category.ts';

// Claim one job at a time. Claiming five before a slow model call caused the
// other four to sit locked until reclaim_stuck_jobs(), producing false timeouts.
const BATCH_SIZE = 1;
const TIME_BUDGET_MS = 105_000;
const MIN_ENRICH_CHARS = 200;

type ExtractionQuality = 'full' | 'partial' | 'metadata_only';

function extractionQuality(content: string, meta: Record<string, unknown>): ExtractionQuality {
  if (content.trim().length < MIN_ENRICH_CHARS) return 'metadata_only';
  if (content.trim().length < 2_000 || meta.parse_error) return 'partial';
  return 'full';
}

/**
 * Facebook may return an author envelope for a private, deleted, or otherwise
 * unavailable post. It is a valid save, but not a complete readable result.
 * Keep short genuine captions "ready"; only mark the item degraded when we
 * did not receive any readable source text at all.
 */
function isFacebookWithoutReadableText(
  url: string,
  parsed: Pick<ParsedContent, 'content_text' | 'description'>,
): boolean {
  if (!isFacebookContentUrl(url)) return false;
  return !Boolean(parsed.content_text?.trim() || parsed.description?.trim());
}

async function parseBySourceType(
  db: SupabaseClient,
  item: { url: string; source_type: string },
  geminiKey: string | null,
): Promise<ParsedContent> {
  // Facebook has no source_type of its own (URL 400s the generic parser), so it
  // dispatches by URL — but only for real post/reel/video links, not FB tool pages.
  if (isFacebookContentUrl(item.url)) {
    return await parseFacebook(item.url, {
      apifyToken: await getSecret(db, 'APIFY_TOKEN'),
      geminiKey,
    });
  }
  switch (item.source_type) {
    case 'youtube':
      return await parseYouTube(item.url, geminiKey);
    case 'tweet':
      return await parseTweet(item.url);
    case 'reddit':
      return await parseReddit(item.url, {
        clientId: await getSecret(db, 'REDDIT_CLIENT_ID'),
        clientSecret: await getSecret(db, 'REDDIT_CLIENT_SECRET'),
      });
    case 'pdf':
      return await parsePdf(item.url, geminiKey);
    case 'reel':
      return await parseReel(item.url, {
        apifyToken: await getSecret(db, 'APIFY_TOKEN'),
        scraperApiKey: await getSecret(db, 'SCRAPER_API_KEY'),
        geminiKey,
      });
    default:
      return await parseArticle(item.url);
  }
}

async function handleParse(db: SupabaseClient, job: Job, geminiKey: string | null) {
  const { data: item, error } = await db
    .from('content_items')
    .select('id, user_id, url, source_type, title, status, thumbnail_url, raw_metadata')
    .eq('id', job.item_id!)
    .single();
  if (error || !item) throw new Error(`item ${job.item_id} not found`);

  await db.from('content_items').update({ status: 'parsing' }).eq('id', item.id);

  let parsed: ParsedContent;
  const parseStarted = Date.now();
  let fallback: 'article' | 'metadata_stub' | null = null;
  let primaryError: string | null = null;
  try {
    parsed = await parseBySourceType(db, item, geminiKey);
  } catch (e) {
    primaryError = (e as Error).message;
    // Specialized endpoints are brittle — degrade to plain OG metadata.
    console.warn(`${item.source_type} parser failed for ${item.url}, falling back to OG:`, (e as Error).message);
    try {
      parsed = await parseArticle(item.url);
      fallback = 'article';
    } catch (e2) {
      // Page unreachable (bot-blocked, login-walled, dead): keep a metadata
      // stub so the item still gets an AI title + summary from the URL alone
      // instead of dying as 'failed' with an empty card.
      const host = (() => { try { return new URL(item.url).hostname; } catch { return null; } })();
      console.warn(`OG fallback also failed for ${item.url}:`, (e2 as Error).message);
      parsed = {
        title: null,
        description: null,
        author: null,
        site_name: host?.replace(/^www\./, '') ?? null,
        thumbnail_url: null,
        favicon_url: host ? `https://www.google.com/s2/favicons?domain=${host}&sz=64` : null,
        published_at: null,
        content_text: null,
        word_count: null,
        raw_metadata: { parse_error: (e2 as Error).message },
      };
      fallback = 'metadata_stub';
    }
  }

  const previousMeta = (item.raw_metadata as Record<string, unknown>) ?? {};
  const parsedMeta = parsed.raw_metadata ?? {};
  const parsedContent = parsed.content_text ?? parsed.description ?? '';
  const quality = extractionQuality(parsedContent, parsedMeta);
  const facebookWithoutReadableText = isFacebookWithoutReadableText(item.url, parsed);
  const parserMeta = {
    name: isFacebookContentUrl(item.url) ? 'facebook' : item.source_type,
    fallback,
    primary_error: primaryError,
    extraction_quality: quality,
    readable_source_text: !facebookWithoutReadableText,
    content_chars: parsedContent.length,
    duration_ms: Date.now() - parseStarted,
    completed_at: new Date().toISOString(),
  };
  await db.from('content_items').update({
    title: parsed.title ?? item.title,
    description: parsed.description,
    author: parsed.author,
    site_name: parsed.site_name,
    // A retry that gets rate-limited must not erase the last known thumbnail.
    thumbnail_url: parsed.thumbnail_url ?? item.thumbnail_url,
    favicon_url: parsed.favicon_url,
    published_at: parsed.published_at,
    content_text: parsed.content_text,
    word_count: parsed.word_count,
    duration_seconds: parsed.duration_seconds ?? null,
    // Preserve RSS/import provenance while adding parser output. The old worker
    // replaced raw_metadata wholesale, losing useful source context.
    raw_metadata: {
      ...previousMeta,
      ...parsedMeta,
      parser: parserMeta,
      processing: {
        ...((previousMeta.processing as Record<string, unknown>) ?? {}),
        parse: { status: 'done', completed_at: parserMeta.completed_at },
      },
    },
    status: 'enriching',
  }).eq('id', item.id);

  // Every item gets enriched — metadata-only bookmarks and un-scrapable social
  // links included (the LLM writes an AI title + summary from URL/title/snippet).
  await enqueue(db, { user_id: item.user_id, item_id: item.id, job_type: 'enrich' });
}

/**
 * Put an automatically-classified Bookmark into the closest existing folder.
 * If no folder matches the AI topic, create one. A row marked `user` is a hard
 * stop: once the user moves the item, later retries/enrichment never override
 * their choice.
 */
async function autoCategorizeBookmark(
  db: SupabaseClient,
  item: { id: string; user_id: string; item_kind: string | null },
  topic: string,
  tags: string[],
) {
  if (item.item_kind !== 'bookmark' || !topic.trim()) return;

  const { data: assignments } = await db
    .from('item_folders')
    .select('folder_id, assignment_source')
    .eq('item_id', item.id);
  if ((assignments ?? []).some((row) => row.assignment_source === 'user')) return;

  const { data: folders, error: foldersError } = await db
    .from('folders')
    .select('id, name, position')
    .eq('user_id', item.user_id)
    .order('position', { ascending: true });
  if (foldersError) throw new Error(`folder lookup failed: ${foldersError.message}`);

  let folder = pickCategoryFolder(folders ?? [], topic, tags);

  if (!folder) {
    const { data: created, error: createError } = await db
      .from('folders')
      .insert({
        user_id: item.user_id,
        name: categoryLabel(topic),
        color: 'bg-lime-400',
        icon: 'fa-folder',
        position: folders?.length ?? 0,
      })
      .select('id, name, position')
      .single();
    if (createError || !created) {
      throw new Error(`AI folder create failed: ${createError?.message ?? 'unknown'}`);
    }
    folder = created;
  }

  await db.from('item_folders').delete().eq('item_id', item.id).eq('assignment_source', 'ai');
  const { error: assignError } = await db.from('item_folders').insert({
    item_id: item.id,
    folder_id: folder.id,
    user_id: item.user_id,
    assignment_source: 'ai',
  });
  if (assignError && assignError.code !== '23505') {
    throw new Error(`AI folder assignment failed: ${assignError.message}`);
  }
}

async function handleEnrich(db: SupabaseClient, job: Job, llm: ProviderConfig) {
  const { data: item, error } = await db
    .from('content_items')
    .select('id, user_id, url, title, description, source_type, item_kind, content_text, tags, raw_metadata')
    .eq('id', job.item_id!)
    .single();
  if (error || !item) throw new Error(`item ${job.item_id} not found`);

  // Thin/metadata-only items enrich from whatever the parser got (description,
  // scraps of text); llm.ts detects the thin case and describes the destination.
  const content = item.content_text && item.content_text.length >= MIN_ENRICH_CHARS
    ? item.content_text
    : [item.description, item.content_text].filter(Boolean).join('\n\n');

  const meta = (item.raw_metadata as Record<string, unknown>) ?? {};
  const parser = (meta.parser as Record<string, unknown>) ?? {};
  const quality = (parser.extraction_quality as ExtractionQuality | undefined)
    ?? extractionQuality(content, meta);
  const facebookWithoutReadableText = isFacebookContentUrl(item.url) &&
    parser.readable_source_text === false;

  const enrichInput = {
    title: item.title,
    url: item.url,
    sourceType: item.source_type,
    content,
    extractionQuality: quality,
  };
  const result = await enrich(llm, enrichInput);

  const userTags: string[] = item.tags ?? [];
  const mergedTags = [...new Set([...userTags, ...result.tags])].slice(0, 10);

  // Titles: keep an authoritative parsed title (article/RSS/PDF/YouTube page
  // titles are good). For social posts the parsed "title" is just a caption
  // fragment (or a fallback), so prefer the AI's clean suggested_title.
  const isSocial =
    item.source_type === 'reel' ||
    item.source_type === 'tweet' ||
    item.source_type === 'reddit' ||
    isFacebookContentUrl(item.url);
  const hasRealTitle = !!item.title?.trim() && !/^https?:\/\//i.test(item.title.trim());
  const useAiTitle = (!hasRealTitle || isSocial) && !!result.suggested_title;

  const { error: updateError } = await db.from('content_items').update({
    title: useAiTitle ? result.suggested_title : (item.title || result.suggested_title),
    summary: result.summary,
    key_points: result.key_points,
    topic: result.topic_category,
    tags: mergedTags,
    language: result.language,
    content_type_label: resolveContentTypeLabel(enrichInput, result.content_type_label),
    // Which provider actually produced this (e.g. 'nvidia:z-ai/glm-5.2' or
    // 'gemini:fallback') — verifiable via SQL instead of ephemeral logs.
    raw_metadata: {
      ...meta,
      enriched_by: result.enriched_by,
      ai: result.ai,
      processing: {
        ...((meta.processing as Record<string, unknown>) ?? {}),
        enrich: { status: 'done', completed_at: result.ai.enriched_at },
      },
    },
    // Do not claim that Facebook analysis completed when the source only gave
    // us a page identity (the common result for private/deleted share links).
    // The link remains saved, with retry available if it becomes public later.
    status: facebookWithoutReadableText ? 'degraded' : 'ready',
  }).eq('id', item.id);
  if (updateError) throw new Error(`enrichment write failed: ${updateError.message}`);

  await autoCategorizeBookmark(db, item, result.topic_category, mergedTags);

  await enqueue(db, { user_id: item.user_id, item_id: item.id, job_type: 'embed' });
}

async function handleEmbed(db: SupabaseClient, job: Job, geminiKey: string) {
  const { data: item, error } = await db
    .from('content_items')
    .select('id, title, summary, content_text, raw_metadata')
    .eq('id', job.item_id!)
    .single();
  if (error || !item) throw new Error(`item ${job.item_id} not found`);

  const text = [item.title, item.summary, item.content_text?.slice(0, 2000)]
    .filter(Boolean)
    .join('\n');
  if (!text.trim()) {
    const meta = (item.raw_metadata as Record<string, unknown>) ?? {};
    await db.from('content_items').update({
      raw_metadata: {
        ...meta,
        processing: {
          ...((meta.processing as Record<string, unknown>) ?? {}),
          embed: { status: 'skipped', reason: 'empty_input', completed_at: new Date().toISOString() },
        },
      },
    }).eq('id', item.id);
    return;
  }

  const vector = await embedText(geminiKey, text, 'RETRIEVAL_DOCUMENT');
  const { error: upErr } = await db
    .from('content_items')
    .update({
      embedding: JSON.stringify(vector),
      raw_metadata: {
        ...(((item.raw_metadata as Record<string, unknown>) ?? {})),
        processing: {
          ...((((item.raw_metadata as Record<string, unknown>) ?? {}).processing as Record<string, unknown>) ?? {}),
          embed: { status: 'done', model: 'gemini-embedding-001', completed_at: new Date().toISOString() },
        },
      },
    })
    .eq('id', item.id);
  if (upErr) throw new Error(`embedding write failed: ${upErr.message}`);
}

async function markItemForFailedJob(db: SupabaseClient, job: Job, message: string) {
  if (!job.item_id) return;
  const { data: item } = await db.from('content_items')
    .select('raw_metadata')
    .eq('id', job.item_id)
    .maybeSingle();
  const meta = (item?.raw_metadata as Record<string, unknown>) ?? {};
  const processing = (meta.processing as Record<string, unknown>) ?? {};
  const update: Record<string, unknown> = {
    raw_metadata: {
      ...meta,
      processing: {
        ...processing,
        [job.job_type]: {
          status: 'failed',
          error: message.slice(0, 500),
          attempts: job.attempts,
          failed_at: new Date().toISOString(),
        },
      },
    },
  };
  // A failed embed must not demote an already-ready item — FTS remains usable,
  // but the explicit embed error lets every client explain semantic-search loss.
  if (job.job_type !== 'embed') {
    update.status = job.job_type === 'parse' ? 'failed' : 'degraded';
  }
  await db.from('content_items').update(update).eq('id', job.item_id);
}

async function processJobs(): Promise<{ processed: number; failed: number }> {
  const db = serviceClient();
  const started = Date.now();
  let processed = 0;
  let failed = 0;

  // Stuck jobs are reclaimed by the `refvault-reclaim-stuck-jobs` cron job (every 10 minutes),
  // not on every tick: the worker is only invoked when a job is due.

  const geminiKey = await getSecret(db, 'GEMINI_API_KEY');
  // Enrichment provider is pluggable (Vault LLM_PROVIDER); embeddings/TTS stay Gemini.
  // Production: nvidia (z-ai/glm-5.2), with automatic Gemini fallback inside enrich().
  const llm: ProviderConfig = {
    provider: ((await getSecret(db, 'LLM_PROVIDER')) as LlmProvider) || 'gemini',
    geminiKey,
    anthropicKey: await getSecret(db, 'ANTHROPIC_API_KEY'),
    openaiKey: await getSecret(db, 'OPENAI_API_KEY'),
    nvidiaKey: await getSecret(db, 'NVIDIA_API_KEY'),
    model: await getSecret(db, 'LLM_MODEL'),
    fastModel: await getSecret(db, 'LLM_MODEL_FAST'),
  };

  while (Date.now() - started < TIME_BUDGET_MS) {
    const { data: jobs, error } = await db.rpc('claim_jobs', { n: BATCH_SIZE });
    if (error) {
      console.error('claim_jobs failed:', error.message);
      break;
    }
    if (!jobs || jobs.length === 0) break;

    for (const job of jobs as Job[]) {
      try {
        switch (job.job_type) {
          case 'parse':
            await handleParse(db, job, geminiKey);
            break;
          case 'enrich':
            await handleEnrich(db, job, llm);
            break;
          case 'embed':
            if (!geminiKey) throw new Error('GEMINI_API_KEY missing from Vault');
            await handleEmbed(db, job, geminiKey);
            break;
          default:
            throw new Error(`No handler for job_type ${job.job_type} yet`);
        }
        await completeJob(db, job.id);
        processed++;
      } catch (e) {
        const message = (e as Error).message;
        const terminal = await failJob(db, job, message);
        if (terminal) await markItemForFailedJob(db, job, message);
        failed++;
        console.error(`job ${job.id} (${job.job_type}) failed:`, (e as Error).message);
      }
    }
  }

  return { processed, failed };
}

Deno.serve(async (req: Request) => {
  const db = serviceClient();
  const expected = await getSecret(db, 'WORKER_SECRET');
  if (!expected || req.headers.get('x-worker-secret') !== expected) {
    return new Response(JSON.stringify({ error: 'FORBIDDEN' }), { status: 403 });
  }

  // Respond immediately; keep processing in the background so the pg_net
  // caller's short timeout doesn't kill the run.
  EdgeRuntime.waitUntil(
    processJobs().then((r) => console.log(`worker done: ${JSON.stringify(r)}`)),
  );

  return new Response(JSON.stringify({ accepted: true }), {
    status: 202,
    headers: { 'Content-Type': 'application/json' },
  });
});
