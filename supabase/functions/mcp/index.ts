// Qlip MCP server — lets AI agents (Claude, Codex, etc.) read and write the
// vault. Speaks MCP over Streamable HTTP, statelessly: each POST carries JSON-RPC
// and gets a single JSON response (no server-initiated SSE). Auth is a personal
// API key (`Authorization: Bearer rv_...`, see _shared/apiKeys.ts); every query
// is scoped to that key's user, so an agent can only ever touch its owner's data.
//
// Deployed with JWT verification OFF — it does its own API-key auth.

import { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { serviceClient } from '../_shared/db.ts';
import { canonicalizeUrl, detectSourceType, inferItemKind, validatePublicUrl } from '../_shared/canonical.ts';
import { enqueue } from '../_shared/queue.ts';
import { resolveApiKey } from '../_shared/apiKeys.ts';
import { assertOwnedFolder, assertOwnedItem, INVALID_PARAMS, OwnershipError } from '../_shared/ownership.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, mcp-session-id, mcp-protocol-version',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};
const PROTOCOL_VERSION = '2025-06-18';
const LIST_COLS =
  'id, url, title, summary, tags, topic, source_type, item_kind, status, saved_via, read_status, is_starred, created_at';

// ---- tool definitions (advertised via tools/list) -----------------------------

const TOOLS = [
  {
    name: 'save_link',
    description: 'Save one URL (or a batch) to the vault. It is parsed and AI-enriched (title, summary, tags) automatically. Optionally file it into a folder/category.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'A single URL to save' },
        urls: { type: 'array', items: { type: 'string' }, description: 'Up to 100 URLs to save at once' },
        folder_id: { type: 'string', description: 'Folder (category) id to file the link(s) into' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Optional tags' },
        destination: { type: 'string', enum: ['auto', 'bookmark', 'content'], description: 'Default auto: domains go to Bookmarks; articles, social posts, PDFs and e-books go to Reading.' },
      },
    },
  },
  {
    name: 'save_note',
    description: 'Save agent-generated text as a note in the vault. It is AI-enriched and embedded like any item.',
    inputSchema: {
      type: 'object',
      required: ['text'],
      properties: {
        text: { type: 'string', description: 'The note body' },
        title: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        folder_id: { type: 'string', description: 'Folder (category) id to file the note into' },
      },
    },
  },
  {
    name: 'search',
    description: 'Full-text search the vault. Returns matching items (title, summary, tags, topic).',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 50 },
      },
    },
  },
  {
    name: 'list_items',
    description: 'List vault items with optional filters (kind, source_type, saved_via, read_status, topic, is_starred, tags, folder_id) and paging.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['bookmark', 'content'] },
        source_type: { type: 'string' },
        saved_via: { type: 'string' },
        read_status: { type: 'string', enum: ['unread', 'reading', 'read'] },
        topic: { type: 'string' },
        is_starred: { type: 'boolean' },
        tags: { type: 'array', items: { type: 'string' } },
        folder_id: { type: 'string' },
        sort: { type: 'string', enum: ['date_desc', 'date_asc', 'title_asc'] },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
        offset: { type: 'integer', minimum: 0 },
      },
    },
  },
  {
    name: 'get_item',
    description: 'Get one item by id, including summary and key points. Set include_content to also return the full extracted text.',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string' },
        include_content: { type: 'boolean' },
      },
    },
  },
  {
    name: 'update_item',
    description: "Update an item's read_status, is_starred, title, tags, or folder (pass folder_id: null to unfile).",
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string' },
        read_status: { type: 'string', enum: ['unread', 'reading', 'read'] },
        is_starred: { type: 'boolean' },
        title: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        folder_id: { type: ['string', 'null'] },
      },
    },
  },
  {
    name: 'delete_item',
    description: 'Delete an item permanently. Requires confirm: true.',
    inputSchema: {
      type: 'object',
      required: ['id', 'confirm'],
      properties: {
        id: { type: 'string' },
        confirm: { type: 'boolean', const: true },
      },
    },
  },
  {
    name: 'list_folders',
    description: 'List all folders (categories), with their tree structure.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'create_folder',
    description: 'Create a new folder (category). Optionally nest it under a parent (max depth 3).',
    inputSchema: {
      type: 'object',
      required: ['name'],
      properties: {
        name: { type: 'string' },
        parent_id: { type: 'string' },
        color: { type: 'string' },
        icon: { type: 'string' },
      },
    },
  },
  {
    name: 'get_daily_picks',
    description: "Get today's resurfaced picks — items you read more than two weeks ago.",
    inputSchema: { type: 'object', properties: {} },
  },
];

// ---- tool implementations -----------------------------------------------------

type Args = Record<string, unknown>;
type Handler = (db: SupabaseClient, userId: string, args: Args) => Promise<unknown>;

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

async function saveOne(
  db: SupabaseClient,
  userId: string,
  rawUrl: string,
  folderId: string | undefined,
  tags: string[],
  destination: 'auto' | 'bookmark' | 'content',
) {
  const check = validatePublicUrl(rawUrl.trim());
  if (!check.ok) return { url: rawUrl, error: check.reason };
  const canonical = canonicalizeUrl(rawUrl.trim());
  const { data: existing } = await db
    .from('content_items')
    .select('id, title, status')
    .eq('user_id', userId)
    .eq('canonical_url', canonical)
    .maybeSingle();
  if (existing) return { ...existing, url: rawUrl, duplicate: true };

  const sourceType = detectSourceType(rawUrl.trim());
  const kindOverride = destination === 'auto' ? inferItemKind(rawUrl.trim(), sourceType) : destination;

  const { data: item, error } = await db
    .from('content_items')
    .insert({
      user_id: userId,
      url: rawUrl.trim(),
      canonical_url: canonical,
      source_type: sourceType,
      kind_override: kindOverride,
      status: 'pending',
      saved_via: 'mcp',
      tags: tags.slice(0, 10),
    })
    .select('id, url, title, status')
    .single();
  if (error || !item) return { url: rawUrl, error: error?.message ?? 'insert failed' };

  let folderWarning: string | undefined;
  if (folderId) {
    const { error: folderError } = await db.from('item_folders').insert({
      item_id: item.id,
      folder_id: folderId,
      user_id: userId,
      assignment_source: 'user',
    });
    if (folderError) folderWarning = 'Saved, but it could not be filed into the folder.';
  }
  await enqueue(db, { user_id: userId, item_id: item.id, job_type: 'parse' });
  return { ...item, duplicate: false, ...(folderWarning ? { warning: folderWarning } : {}) };
}

export const HANDLERS: Record<string, Handler> = {
  async save_link(db, userId, args) {
    const single = str(args.url);
    const many = strArr(args.urls);
    const urls = many.length ? many : single ? [single] : [];
    if (urls.length === 0) throw new Error('Provide `url` or `urls`.');
    if (urls.length > 100) throw new Error('Max 100 URLs per call.');
    const folderId = str(args.folder_id);
    if (folderId) await assertOwnedFolder(db, userId, folderId);
    const tags = strArr(args.tags);
    const destination = ['bookmark', 'content'].includes(str(args.destination) ?? '')
      ? str(args.destination) as 'bookmark' | 'content'
      : 'auto';
    const results = [];
    for (const u of urls) results.push(await saveOne(db, userId, String(u), folderId, tags, destination));
    return single && !many.length ? results[0] : { saved: results };
  },

  async save_note(db, userId, args) {
    const text = str(args.text);
    if (!text) throw new Error('`text` is required.');
    // Verify the folder first so a rejected call writes nothing.
    const folderId = str(args.folder_id);
    if (folderId) await assertOwnedFolder(db, userId, folderId);
    const noteUrl = `note://${crypto.randomUUID()}`;
    const enrichable = text.length >= 200;
    const { data: item, error } = await db
      .from('content_items')
      .insert({
        user_id: userId,
        url: noteUrl,
        canonical_url: noteUrl,
        source_type: 'other',
        status: enrichable ? 'enriching' : 'ready',
        saved_via: 'mcp',
        title: str(args.title) ?? null,
        content_text: text,
        word_count: text.split(/\s+/).length,
        tags: strArr(args.tags).slice(0, 10),
        raw_metadata: { kind: 'note' },
      })
      .select('id, title, status')
      .single();
    if (error || !item) throw new Error(error?.message ?? 'insert failed');
    let folderWarning: string | undefined;
    if (folderId) {
      const { error: folderError } = await db.from('item_folders').insert({ item_id: item.id, folder_id: folderId, user_id: userId });
      if (folderError) folderWarning = 'Saved, but it could not be filed into the folder.';
    }
    await enqueue(db, { user_id: userId, item_id: item.id, job_type: enrichable ? 'enrich' : 'embed' });
    return { ...item, note_url: noteUrl, ...(folderWarning ? { warning: folderWarning } : {}) };
  },

  async search(db, userId, args) {
    const q = str(args.query);
    if (!q) throw new Error('`query` is required.');
    const limit = Math.min(Math.max(Number(args.limit ?? 10), 1), 50);
    const { data, error } = await db
      .from('content_items')
      .select(LIST_COLS)
      .eq('user_id', userId)
      .textSearch('search_tsv', q, { type: 'websearch', config: 'english' })
      .limit(limit);
    if (error) throw new Error(error.message);
    return { results: data ?? [], count: data?.length ?? 0 };
  },

  async list_items(db, userId, args) {
    const folderId = str(args.folder_id);
    let query = folderId
      ? db.from('content_items').select(`${LIST_COLS}, item_folders!inner(folder_id)`).eq('item_folders.folder_id', folderId)
      : db.from('content_items').select(LIST_COLS);
    query = query.eq('user_id', userId);
    if (str(args.kind)) query = query.eq('item_kind', str(args.kind)!);
    if (str(args.source_type)) query = query.eq('source_type', str(args.source_type)!);
    if (str(args.saved_via)) query = query.eq('saved_via', str(args.saved_via)!);
    if (str(args.read_status)) query = query.eq('read_status', str(args.read_status)!);
    if (str(args.topic)) query = query.eq('topic', str(args.topic)!);
    if (typeof args.is_starred === 'boolean') query = query.eq('is_starred', args.is_starred);
    if (strArr(args.tags).length) query = query.overlaps('tags', strArr(args.tags));

    const [col, asc] = args.sort === 'title_asc' ? ['title', true] : args.sort === 'date_asc' ? ['created_at', true] : ['created_at', false];
    const limit = Math.min(Math.max(Number(args.limit ?? 25), 1), 100);
    const offset = Math.max(Number(args.offset ?? 0), 0);
    query = query.order(col as string, { ascending: asc as boolean }).range(offset, offset + limit - 1);

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return { items: data ?? [], count: data?.length ?? 0 };
  },

  async get_item(db, userId, args) {
    const id = str(args.id);
    if (!id) throw new Error('`id` is required.');
    const cols = `${LIST_COLS}, description, summary, key_points, language, published_at${args.include_content ? ', content_text' : ''}`;
    const { data, error } = await db.from('content_items').select(cols).eq('id', id).eq('user_id', userId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error('Item not found.');
    if (args.include_content && typeof (data as unknown as Record<string, unknown>).content_text === 'string') {
      const d = data as unknown as Record<string, unknown>;
      d.content_text = (d.content_text as string).slice(0, 50000);
    }
    return data;
  },

  async update_item(db, userId, args) {
    const id = str(args.id);
    if (!id) throw new Error('`id` is required.');
    // Validate every ID before the first write so a rejected call changes nothing.
    await assertOwnedItem(db, userId, id);
    const targetFolderId = 'folder_id' in args ? str(args.folder_id) : undefined;
    if (targetFolderId) await assertOwnedFolder(db, userId, targetFolderId);
    const patch: Record<string, unknown> = {};
    if (str(args.read_status)) patch.read_status = str(args.read_status);
    if (typeof args.is_starred === 'boolean') patch.is_starred = args.is_starred;
    if (str(args.title)) patch.title = str(args.title);
    if (Array.isArray(args.tags)) patch.tags = strArr(args.tags).slice(0, 10);

    if (Object.keys(patch).length) {
      const { error } = await db.from('content_items').update(patch).eq('id', id).eq('user_id', userId);
      if (error) throw new Error(error.message);
    }
    // folder_id present (even null) means "set folder": clear then optionally add.
    if ('folder_id' in args) {
      await db.from('item_folders').delete().eq('item_id', id).eq('user_id', userId);
      if (targetFolderId) {
        const { error: folderError } = await db.from('item_folders').insert({
          item_id: id,
          folder_id: targetFolderId,
          user_id: userId,
          assignment_source: 'user',
        });
        if (folderError) throw new Error(`Could not file the item: ${folderError.message}`);
      }
    }
    return { id, updated: true };
  },

  async delete_item(db, userId, args) {
    const id = str(args.id);
    if (!id) throw new Error('`id` is required.');
    if (args.confirm !== true) throw new Error('Refusing to delete without `confirm: true`.');
    const { data, error } = await db.from('content_items').delete().eq('id', id).eq('user_id', userId).select('id');
    if (error) throw new Error(error.message);
    return { id, deleted: (data?.length ?? 0) > 0 };
  },

  async list_folders(db, userId) {
    const { data, error } = await db
      .from('folders')
      .select('id, name, parent_id, color, icon, position')
      .eq('user_id', userId)
      .order('position', { ascending: true });
    if (error) throw new Error(error.message);
    return { folders: data ?? [] };
  },

  async create_folder(db, userId, args) {
    const name = str(args.name);
    if (!name) throw new Error('`name` is required.');
    const parentId = str(args.parent_id);
    if (parentId) await assertOwnedFolder(db, userId, parentId);
    const { data, error } = await db
      .from('folders')
      .insert({ user_id: userId, name, parent_id: parentId ?? null, color: str(args.color) ?? null, icon: str(args.icon) ?? null })
      .select('id, name, parent_id, color, icon')
      .single();
    if (error) throw new Error(error.message);
    return data;
  },

  async get_daily_picks(db, userId) {
    const { data, error } = await db
      .from('content_items')
      .select(`${LIST_COLS}, daily_picks!inner(item_id)`)
      .eq('user_id', userId)
      .limit(5);
    if (error) throw new Error(error.message);
    return { picks: data ?? [] };
  },
};

// ---- JSON-RPC plumbing --------------------------------------------------------

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}
const rpcResult = (id: unknown, result: unknown) => ({ jsonrpc: '2.0', id, result });
const rpcError = (id: unknown, code: number, message: string) => ({ jsonrpc: '2.0', id, error: { code, message } });

export async function handleMessage(db: SupabaseClient, userId: string | null, msg: Record<string, unknown>) {
  const id = msg.id ?? null;
  const method = msg.method as string;
  const params = (msg.params as Record<string, unknown>) ?? {};
  const isNotification = msg.id === undefined || msg.id === null;

  if (!userId) return isNotification ? null : rpcError(id, -32001, 'Unauthorized: send a valid Qlip API key as `Authorization: Bearer rv_...`');

  switch (method) {
    case 'initialize':
      return rpcResult(id, {
        protocolVersion: (params.protocolVersion as string) ?? PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: 'qlip', version: '1.0.0' },
      });
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return null;
    case 'ping':
      return rpcResult(id, {});
    case 'tools/list':
      return rpcResult(id, { tools: TOOLS });
    case 'tools/call': {
      const name = params.name as string;
      const handler = HANDLERS[name];
      if (!handler) return rpcError(id, -32602, `Unknown tool: ${name}`);
      try {
        const result = await handler(db, userId, (params.arguments as Args) ?? {});
        return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
      } catch (e) {
        // A rejected ID is an invalid argument: report it as a JSON-RPC error.
        if (e instanceof OwnershipError) return rpcError(id, INVALID_PARAMS, e.message);
        // Other tool errors are reported in-band so the model can see and recover.
        return rpcResult(id, { content: [{ type: 'text', text: `Error: ${(e as Error).message}` }], isError: true });
      }
    }
    default:
      return isNotification ? null : rpcError(id, -32601, `Method not found: ${method}`);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  // Stateless server: no server-initiated SSE stream, so GET is not supported.
  if (req.method === 'GET') return new Response('Method Not Allowed', { status: 405, headers: CORS });
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: CORS });

  const db = serviceClient();
  const auth = await resolveApiKey(db, req.headers.get('Authorization'));

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(rpcError(null, -32700, 'Parse error'), 400);
  }

  const batch = Array.isArray(body);
  const messages = (batch ? body : [body]) as Record<string, unknown>[];
  const responses = [];
  for (const msg of messages) {
    const res = await handleMessage(db, auth?.userId ?? null, msg);
    if (res) responses.push(res);
  }
  if (responses.length === 0) return new Response(null, { status: 202, headers: CORS });
  return json(batch ? responses : responses[0]);
});
