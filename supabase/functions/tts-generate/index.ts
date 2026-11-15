// On-demand TTS (user JWT). POST {item_id, mode: "summary"|"full"}:
//   - cached: if content_items.tts_<mode>_path exists, return a fresh 24h signed
//     URL immediately (no Gemini call);
//   - else synthesize with Gemini TTS chunk-by-chunk at sentence boundaries,
//     concatenate the PCM into one WAV, upload to the private tts-audio bucket
//     at {user_id}/{item_id}/{mode}.wav, save the path, return a signed URL.
// Summary mode is the first-class path and runs under a hard 30s budget; full
// mode caps input at the first 10k chars. Every served URL bumps
// tts_last_accessed_at, which drives the weekly cleanup below.
//
// Worker mode (x-worker-secret, called by the refvault-tts-cleanup cron):
// POST {action:"cleanup"} deletes tts-audio objects for items whose audio
// hasn't been requested in >30 days and nulls their path columns. Deleting via
// the Storage API (not SQL on storage.objects) removes the real underlying files.

import { corsHeaders, corsResponse } from '../_shared/cors.ts';
import { serviceClient, getUser, getSecret } from '../_shared/db.ts';
import { synthesizeSpeech } from '../_shared/gemini.ts';

const BUCKET = 'tts-audio';
const SIGNED_URL_TTL_S = 24 * 60 * 60;
const SUMMARY_BUDGET_MS = 30_000;
const FULL_BUDGET_MS = 120_000;
const FULL_MAX_CHARS = 10_000;
const CHUNK_TARGET_CHARS = 2_000; // ~500 tokens
const VOICE = 'Kore';
const CLEANUP_AGE_DAYS = 30;

/** Split at sentence boundaries and pack into ~CHUNK_TARGET_CHARS chunks. */
function chunkText(text: string): string[] {
  const sentences = text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?؟।。])\s+/u)
    .map((s) => s.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let current = '';
  for (const sentence of sentences) {
    if (current && current.length + sentence.length + 1 > CHUNK_TARGET_CHARS) {
      chunks.push(current);
      current = sentence;
    } else {
      current = current ? `${current} ${sentence}` : sentence;
    }
    // Pathological single "sentence" longer than the target: hard-split.
    while (current.length > CHUNK_TARGET_CHARS * 1.5) {
      chunks.push(current.slice(0, CHUNK_TARGET_CHARS));
      current = current.slice(CHUNK_TARGET_CHARS);
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

/** Wrap raw 16-bit LE mono PCM in a WAV container. */
function pcmToWav(pcm: Uint8Array, sampleRate: number): Uint8Array {
  const header = new ArrayBuffer(44);
  const v = new DataView(header);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i));
  };
  const byteRate = sampleRate * 2; // mono, 16-bit
  writeStr(0, 'RIFF');
  v.setUint32(4, 36 + pcm.byteLength, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  v.setUint32(16, 16, true);       // PCM chunk size
  v.setUint16(20, 1, true);        // PCM format
  v.setUint16(22, 1, true);        // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, byteRate, true);
  v.setUint16(32, 2, true);        // block align
  v.setUint16(34, 16, true);       // bits per sample
  writeStr(36, 'data');
  v.setUint32(40, pcm.byteLength, true);

  const out = new Uint8Array(44 + pcm.byteLength);
  out.set(new Uint8Array(header), 0);
  out.set(pcm, 44);
  return out;
}

async function cleanupStaleAudio(): Promise<{ items: number; objects: number }> {
  const db = serviceClient();
  const cutoff = new Date(Date.now() - CLEANUP_AGE_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data: stale, error } = await db
    .from('content_items')
    .select('id, user_id, tts_summary_path, tts_full_path')
    .lt('tts_last_accessed_at', cutoff)
    .or('tts_summary_path.not.is.null,tts_full_path.not.is.null')
    .limit(500);
  if (error) throw new Error(`stale query failed: ${error.message}`);

  const paths = (stale ?? []).flatMap((row) =>
    [row.tts_summary_path, row.tts_full_path].filter(Boolean) as string[]);

  for (let i = 0; i < paths.length; i += 100) {
    const { error: rmErr } = await db.storage.from(BUCKET).remove(paths.slice(i, i + 100));
    if (rmErr) console.error('storage remove failed:', rmErr.message);
  }

  if ((stale ?? []).length > 0) {
    const ids = (stale ?? []).map((r) => r.id);
    await db.from('content_items')
      .update({ tts_summary_path: null, tts_full_path: null })
      .in('id', ids);
  }

  return { items: (stale ?? []).length, objects: paths.length };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return corsResponse({ error: 'Method not allowed' }, 405);

  const db = serviceClient();

  // Cron cleanup path (anon Bearer + worker secret, like job-worker).
  const expected = await getSecret(db, 'WORKER_SECRET');
  if (expected && req.headers.get('x-worker-secret') === expected) {
    try {
      const r = await cleanupStaleAudio();
      console.log(`tts cleanup: ${JSON.stringify(r)}`);
      return corsResponse({ ok: true, ...r });
    } catch (e) {
      console.error('tts cleanup failed:', (e as Error).message);
      return corsResponse({ error: 'CLEANUP_FAILED', message: (e as Error).message }, 500);
    }
  }

  const user = await getUser(req);
  if (!user) return corsResponse({ error: 'UNAUTHORIZED' }, 401);

  let body: { item_id?: string; mode?: string };
  try {
    body = await req.json();
  } catch {
    return corsResponse({ error: 'INVALID_REQUEST', message: 'Body must be JSON' }, 400);
  }
  const mode = body.mode === 'full' ? 'full' : body.mode === 'summary' ? 'summary' : null;
  if (!body.item_id || !mode) {
    return corsResponse({ error: 'INVALID_REQUEST', message: 'item_id and mode ("summary"|"full") required' }, 400);
  }

  const { data: item, error: itemErr } = await db
    .from('content_items')
    .select('id, user_id, title, summary, content_text, tts_summary_path, tts_full_path')
    .eq('id', body.item_id)
    .eq('user_id', user.id)
    .maybeSingle();
  if (itemErr) return corsResponse({ error: 'INTERNAL_ERROR', message: itemErr.message }, 500);
  if (!item) return corsResponse({ error: 'NOT_FOUND' }, 404);

  const pathColumn = mode === 'summary' ? 'tts_summary_path' : 'tts_full_path';
  const existingPath = item[pathColumn] as string | null;

  const sign = async (path: string, cached: boolean) => {
    const { data: signed, error: signErr } = await db.storage
      .from(BUCKET)
      .createSignedUrl(path, SIGNED_URL_TTL_S);
    if (signErr || !signed?.signedUrl) {
      return corsResponse({ error: 'SIGN_FAILED', message: signErr?.message }, 500);
    }
    await db.from('content_items')
      .update({ tts_last_accessed_at: new Date().toISOString() })
      .eq('id', item.id);
    return corsResponse({ url: signed.signedUrl, mode, cached, expires_in: SIGNED_URL_TTL_S });
  };

  // Cache hit — no Gemini call.
  if (existingPath) return await sign(existingPath, true);

  // Build the input text.
  let ttsText: string | null;
  if (mode === 'summary') {
    ttsText = item.summary
      ? (item.title ? `${item.title}. ${item.summary}` : item.summary)
      : null;
  } else {
    ttsText = item.content_text ? item.content_text.slice(0, FULL_MAX_CHARS) : null;
  }
  if (!ttsText || ttsText.trim().length < 10) {
    return corsResponse({
      error: 'NO_TEXT',
      message: mode === 'summary'
        ? 'This item has no AI summary yet — wait for enrichment to finish.'
        : 'This item has no extracted full text.',
    }, 422);
  }

  const geminiKey = await getSecret(db, 'GEMINI_API_KEY');
  if (!geminiKey) return corsResponse({ error: 'CONFIG_ERROR', message: 'GEMINI_API_KEY missing from Vault' }, 500);

  const budgetMs = mode === 'summary' ? SUMMARY_BUDGET_MS : FULL_BUDGET_MS;
  const started = Date.now();
  const chunks = chunkText(ttsText);

  const pcmParts: Uint8Array[] = [];
  let sampleRate = 24000;
  for (const chunk of chunks) {
    const remaining = budgetMs - (Date.now() - started);
    if (remaining < 3_000) {
      return corsResponse({
        error: 'TTS_TIMEOUT',
        message: `Generation exceeded the ${budgetMs / 1000}s budget (${pcmParts.length}/${chunks.length} chunks done). Try again.`,
      }, 504);
    }
    let result: { pcm: Uint8Array; sampleRate: number };
    try {
      result = await synthesizeSpeech(geminiKey, chunk, VOICE, remaining);
    } catch (e) {
      // Short/odd chunks occasionally come back with finishReason OTHER and no
      // audio; a single retry usually succeeds.
      if (!(e as Error).message.includes('no audio')) throw e;
      result = await synthesizeSpeech(geminiKey, chunk, VOICE, budgetMs - (Date.now() - started));
    }
    sampleRate = result.sampleRate;
    pcmParts.push(result.pcm);
  }

  const totalBytes = pcmParts.reduce((s, p) => s + p.byteLength, 0);
  const pcm = new Uint8Array(totalBytes);
  let offset = 0;
  for (const part of pcmParts) {
    pcm.set(part, offset);
    offset += part.byteLength;
  }
  const wav = pcmToWav(pcm, sampleRate);

  const path = `${user.id}/${item.id}/${mode}.wav`;
  const { error: upErr } = await db.storage.from(BUCKET).upload(path, wav, {
    contentType: 'audio/wav',
    upsert: true,
  });
  if (upErr) return corsResponse({ error: 'UPLOAD_FAILED', message: upErr.message }, 500);

  const { error: saveErr } = await db.from('content_items')
    .update({ [pathColumn]: path })
    .eq('id', item.id);
  if (saveErr) console.error('path save failed:', saveErr.message);

  return await sign(path, false);
});
