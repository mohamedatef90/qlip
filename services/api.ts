// Data layer for the RefVault backend: content_items/folders tables + Edge Functions.
// Replaces the old hybrid localStorage/Supabase `db` object.

import { supabase } from './supabase';
import { ContentItem, Link, Category, Folder, SmartCollection, FilterState, ApiKey, SaveDestination } from '../types';

const ITEM_COLUMNS =
  'id, url, title, description, summary, key_points, tags, topic, content_type_label, source_type, item_kind, status, saved_via, ' +
  'site_name, thumbnail_url, favicon_url, is_pinned, pin_position, is_starred, read_status, section, ' +
  'published_at, created_at, raw_metadata, item_folders(folder_id, assignment_source)';

const ITEM_COLUMNS_FULL = ITEM_COLUMNS + ', content_text';
// The home cards do not consume reader metadata or key points.
const HOME_COLUMNS = ITEM_COLUMNS.replace('key_points, ', '').replace('raw_metadata, ', '');
const ITEM_PAGE_SIZE = 1000;

export interface HomeStats {
  total: number;
  unread: number;
  thisWeek: number;
  library: number;
  processing: number;
}

export interface SaveItemResult {
  id: string;
  url: string;
  title: string | null;
  status: string;
  duplicate: boolean;
  error?: string;
  message?: string;
}

/** Map a content_items row onto the legacy Link card shape. */
export function toLink(item: ContentItem): Link {
  return {
    id: item.id,
    url: item.url,
    title: item.title || item.url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 80),
    description: item.summary || item.description || '',
    categoryId: item.item_folders?.[0]?.folder_id ?? '',
    section: item.section || undefined,
    createdAt: Date.parse(item.created_at),
    isPinned: item.is_pinned,
    pinPosition: item.pin_position,
    isStarred: item.is_starred,
    readStatus: item.read_status,
    status: item.status,
    summary: item.summary,
    tags: item.tags,
    thumbnailUrl: item.thumbnail_url,
    favicon: item.favicon_url || undefined,
    sourceType: item.source_type,
    savedVia: item.saved_via,
    kind: item.item_kind ?? (item.source_type === 'article' && !item.summary ? 'bookmark' : 'content'),
    topic: item.topic,
  };
}

/** functions.invoke throws FunctionsHttpError on non-2xx; surface the server's JSON message. */
async function invokeFn<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    let message = error.message;
    try {
      const details = await (error as any).context?.json?.();
      if (details?.message || details?.error) message = details.message || details.error;
    } catch { /* keep the generic message */ }
    throw new Error(message);
  }
  if ((data as any)?.error) throw new Error((data as any).message || (data as any).error);
  return data as T;
}

export const api = {
  items: {
    /** Keyword search stays fast and covers the archive beyond the home preview. */
    async searchHome(q: string): Promise<ContentItem[]> {
      const { data, error } = await supabase.from('content_items')
        .select(HOME_COLUMNS)
        .textSearch('search_tsv', q, { type: 'websearch', config: 'simple' })
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw new Error(`Search failed: ${error.message}`);
      return (data ?? []) as unknown as ContentItem[];
    },

    /** Load the daily briefing, without downloading the whole archive. */
    async fetchHome(): Promise<{ items: ContentItem[]; stats: HomeStats }> {
      const rows = () => supabase.from('content_items').select(HOME_COLUMNS)
        .order('created_at', { ascending: false }).order('id', { ascending: false });
      const count = () => supabase.from('content_items').select('id', { count: 'exact', head: true });
      const processing = ['pending', 'parsing', 'enriching'];
      const results = await Promise.all([
        rows().eq('item_kind', 'bookmark').not('saved_via', 'in', '(mobile,extension)').limit(12),
        rows().eq('item_kind', 'content').limit(6),
        rows().eq('item_kind', 'content').eq('read_status', 'reading')
          .not('saved_via', 'in', '(mobile,extension)').limit(6),
        rows().in('saved_via', ['mobile', 'extension']).limit(8),
        rows().eq('is_pinned', true).limit(1000),
        rows().in('status', processing).limit(50),
        count().eq('item_kind', 'bookmark'),
        count().eq('item_kind', 'bookmark').eq('read_status', 'unread'),
        count().eq('item_kind', 'bookmark').gte('created_at', new Date(Date.now() - 7 * 86_400_000).toISOString()),
        count().eq('item_kind', 'content'),
        count().in('status', processing),
      ]);
      const error = results.find(result => result.error)?.error;
      if (error) throw new Error(`Failed to load home: ${error.message}`);
      const byId = new Map<string, ContentItem>();
      for (const result of results.slice(0, 6)) {
        for (const item of (result.data ?? []) as unknown as ContentItem[]) byId.set(item.id, item);
      }
      return {
        items: [...byId.values()].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id.localeCompare(a.id)),
        stats: {
          total: results[6].count ?? 0, unread: results[7].count ?? 0,
          thisWeek: results[8].count ?? 0, library: results[9].count ?? 0,
          processing: results[10].count ?? 0,
        },
      };
    },

    async fetchAll(): Promise<ContentItem[]> {
      const items: ContentItem[] = [];
      for (let from = 0; ; from += ITEM_PAGE_SIZE) {
        const { data, error } = await supabase
          .from('content_items')
          .select(ITEM_COLUMNS)
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .range(from, from + ITEM_PAGE_SIZE - 1);
        if (error) throw new Error(`Failed to load items: ${error.message}`);
        const page = (data ?? []) as unknown as ContentItem[];
        items.push(...page);
        if (page.length < ITEM_PAGE_SIZE) break;
      }
      return items;
    },

    async fetchOne(id: string): Promise<ContentItem | null> {
      const { data, error } = await supabase
        .from('content_items')
        .select(ITEM_COLUMNS_FULL)
        .eq('id', id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data as unknown as ContentItem | null;
    },

    /** Apply a FilterState (the same shape stored in smart_collections.query) as a direct query. */
    async fetchByFilter(filter: FilterState): Promise<ContentItem[]> {
      // Resurface system collection: only items in the nightly daily_picks set.
      const columns = filter.system === 'resurface'
        ? ITEM_COLUMNS + ', daily_picks!inner(item_id)'
        : ITEM_COLUMNS;
      const [sortCol, sortDir] = filter.sort === 'title_asc'
        ? ['title', true] as const
        : filter.sort === 'date_asc'
          ? ['created_at', true] as const
          : ['created_at', false] as const;
      const items: ContentItem[] = [];
      for (let from = 0; ; from += ITEM_PAGE_SIZE) {
        let query = supabase.from('content_items').select(columns);
        if (filter.kind) query = query.eq('item_kind', filter.kind);
        if (filter.source_type?.length) query = query.in('source_type', filter.source_type);
        if (filter.saved_via?.length) query = query.in('saved_via', filter.saved_via);
        if (filter.read_status?.length) query = query.in('read_status', filter.read_status);
        if (filter.topic) query = query.eq('topic', filter.topic);
        if (filter.is_starred) query = query.eq('is_starred', true);
        if (filter.tags?.length) query = query.overlaps('tags', filter.tags);
        const { data, error } = await query
          .order(sortCol, { ascending: sortDir })
          .order('id', { ascending: sortDir })
          .range(from, from + ITEM_PAGE_SIZE - 1);
        if (error) throw new Error(`Failed to load items: ${error.message}`);
        const page = (data ?? []) as unknown as ContentItem[];
        items.push(...page);
        if (page.length < ITEM_PAGE_SIZE) break;
      }
      return items;
    },

    async fetchByFolder(folderId: string): Promise<ContentItem[]> {
      const items: ContentItem[] = [];
      for (let from = 0; ; from += ITEM_PAGE_SIZE) {
        const { data, error } = await supabase
          .from('content_items')
          .select(ITEM_COLUMNS.replace(', item_folders(folder_id, assignment_source)', '') + ', item_folders!inner(folder_id, assignment_source)')
          .eq('item_folders.folder_id', folderId)
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .range(from, from + ITEM_PAGE_SIZE - 1);
        if (error) throw new Error(`Failed to load folder items: ${error.message}`);
        const page = (data ?? []) as unknown as ContentItem[];
        items.push(...page);
        if (page.length < ITEM_PAGE_SIZE) break;
      }
      return items;
    },

    /** Hybrid semantic + keyword search, with direct FTS as a resilient fallback. */
    async search(q: string, filters: FilterState = {}): Promise<ContentItem[]> {
      try {
        const hybrid = await invokeFn<{ results: Array<{ id: string }> }>('semantic-search', {
          query: q,
          limit: 50,
        });
        const ids = hybrid.results.map((row) => row.id);
        if (ids.length) {
          const { data, error } = await supabase
            .from('content_items')
            .select(ITEM_COLUMNS)
            .in('id', ids);
          if (error) throw error;
          const byId = new Map(((data ?? []) as unknown as ContentItem[]).map((item) => [item.id, item]));
          const ranked = ids.map((id) => byId.get(id)).filter((item): item is ContentItem => !!item);
          // The edge function is deliberately filter-agnostic; preserve the
          // Library facets locally over the small ranked candidate set.
          return ranked.filter((item) =>
            (!filters.kind || item.item_kind === filters.kind) &&
            (!filters.source_type?.length || filters.source_type.includes(item.source_type)) &&
            (!filters.saved_via?.length || filters.saved_via.includes(item.saved_via)) &&
            (!filters.read_status?.length || filters.read_status.includes(item.read_status)) &&
            (!filters.topic || item.topic === filters.topic) &&
            (!filters.is_starred || item.is_starred) &&
            (!filters.tags?.length || filters.tags.some((tag) => item.tags.includes(tag)))
          );
        }
      } catch (error) {
        console.warn('Hybrid search unavailable; using keyword search:', error);
      }
      const { data, error } = await supabase.rpc('search_items', { q, filters });
      if (error) throw new Error(`Search failed: ${error.message}`);
      return (data ?? []) as unknown as ContentItem[];
    },

    async setReadStatus(id: string, readStatus: 'unread' | 'reading' | 'read') {
      const { error } = await supabase.from('content_items').update({ read_status: readStatus }).eq('id', id);
      if (error) throw new Error(`Update failed: ${error.message}`);
    },

    async setStarred(id: string, isStarred: boolean) {
      const { error } = await supabase.from('content_items').update({ is_starred: isStarred }).eq('id', id);
      if (error) throw new Error(`Update failed: ${error.message}`);
    },

    /**
     * Save a manually added web URL as a bookmark by default. The backend still
     * extracts metadata and an AI summary, but a website the user captures from
     * the web belongs in Bookmarks unless they explicitly choose Reading.
     */
    async save(url: string, folderId?: string, destination: SaveDestination = 'auto'): Promise<SaveItemResult> {
      const { data, error } = await supabase.functions.invoke('save-item', {
        body: { url, folder_id: folderId || undefined, destination },
      });
      if (error) throw new Error(`Save failed: ${error.message}`);
      if (data?.error) throw new Error(data.message || data.error);
      return data as SaveItemResult;
    },

    /** Batch save (bookmark import). Max 100 URLs per call. */
    async saveBatch(urls: string[]): Promise<SaveItemResult[]> {
      const { data, error } = await supabase.functions.invoke('save-item', {
        body: { urls, destination: 'bookmark' },
      });
      if (error) throw new Error(`Import failed: ${error.message}`);
      return (data?.items ?? []) as SaveItemResult[];
    },

    async update(id: string, updates: Partial<Pick<ContentItem,
      'title' | 'description' | 'is_pinned' | 'pin_position' | 'is_starred' | 'read_status' | 'tags' | 'section'>>) {
      const { error } = await supabase.from('content_items').update(updates).eq('id', id);
      if (error) throw new Error(`Update failed: ${error.message}`);
    },

    async delete(id: string) {
      const { error } = await supabase.from('content_items').delete().eq('id', id);
      if (error) throw new Error(`Delete failed: ${error.message}`);
    },

    /** Re-enqueue the parse pipeline for an item whose fetch failed or missed data. */
    async retry(id: string): Promise<void> {
      await invokeFn('save-item', { retry_item_id: id });
    },

    async deleteAll() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not signed in');
      const { error } = await supabase.from('content_items').delete().eq('user_id', user.id);
      if (error) throw new Error(`Delete failed: ${error.message}`);
    },

    /** Move an item to a single folder (Phase 1 UI keeps one-folder semantics). */
    async setFolder(itemId: string, folderId: string | null) {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not signed in');
      const { error: delError } = await supabase.from('item_folders').delete().eq('item_id', itemId);
      if (delError) throw new Error(delError.message);
      if (folderId) {
        const { error } = await supabase
          .from('item_folders')
          .insert({ item_id: itemId, folder_id: folderId, user_id: user.id, assignment_source: 'user' });
        if (error) throw new Error(error.message);
      }
    },

    /** Persist Priority Vault order so every client sees the same arrangement. */
    async setPinnedOrder(itemIds: string[]) {
      const updates = itemIds.map((id, pin_position) =>
        supabase.from('content_items').update({ is_pinned: true, pin_position }).eq('id', id)
      );
      const results = await Promise.all(updates);
      const failure = results.find((result) => result.error)?.error;
      if (failure) throw new Error(`Priority Vault update failed: ${failure.message}`);
    },

    /**
     * Subscribe to every vault-item change, not only AI pipeline updates.
     * A phone can create an item while the web vault is already open, so the
     * web client must receive INSERT and DELETE events as well as UPDATE.
     */
    subscribeToChanges(
      onChange: (
        item: Partial<ContentItem> & { id: string },
        eventType: 'INSERT' | 'UPDATE' | 'DELETE',
      ) => void,
    ) {
      const channel = supabase
        .channel('content-items-changes')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'content_items' },
          (payload) => {
            const record = (payload.eventType === 'DELETE' ? payload.old : payload.new) as Partial<ContentItem> & { id: string };
            onChange(record, payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE');
          },
        )
        .subscribe();
      return () => { supabase.removeChannel(channel); };
    },

    /** Changes to folders, assignments, and daily picks affect several
     * derived screens, so the consumer performs one coalesced vault refresh. */
    subscribeToStructureChanges(onChange: () => void) {
      const channel = supabase
        .channel('vault-structure-changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'folders' }, onChange)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'item_folders' }, onChange)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'daily_picks' }, onChange)
        .subscribe();
      return () => { supabase.removeChannel(channel); };
    },
  },

  folders: {
    async fetchAll(): Promise<Category[]> {
      const { data, error } = await supabase
        .from('folders')
        .select('id, name, color, icon, position')
        .order('position', { ascending: true });
      if (error) throw new Error(`Failed to load folders: ${error.message}`);
      return (data ?? []).map((f: any) => ({
        id: f.id,
        name: f.name,
        color: f.color || 'bg-zinc-100',
        icon: f.icon || 'fa-folder',
      }));
    },

    /** Full tree shape (parent_id) for FolderSidebar, max depth 3. */
    async fetchTree(): Promise<Folder[]> {
      const { data, error } = await supabase
        .from('folders')
        .select('id, name, color, icon, parent_id, position')
        .order('position', { ascending: true });
      if (error) throw new Error(`Failed to load folders: ${error.message}`);
      return (data ?? []) as Folder[];
    },

    async create(name: string, color: string, icon: string, parentId?: string | null): Promise<Category> {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not signed in');
      const { data, error } = await supabase
        .from('folders')
        .insert({ user_id: user.id, name, color, icon, parent_id: parentId ?? null })
        .select('id, name, color, icon')
        .single();
      if (error) throw new Error(`Create folder failed: ${error.message}`);
      return data as Category;
    },

    async update(id: string, updates: { name?: string; color?: string; icon?: string }) {
      const { error } = await supabase.from('folders').update(updates).eq('id', id);
      if (error) throw new Error(`Update folder failed: ${error.message}`);
    },

    async delete(id: string) {
      // Items are unassigned (item_folders rows cascade), never deleted.
      const { error } = await supabase.from('folders').delete().eq('id', id);
      if (error) throw new Error(`Delete folder failed: ${error.message}`);
    },
  },

  smartCollections: {
    async fetchAll(): Promise<SmartCollection[]> {
      const { data, error } = await supabase
        .from('smart_collections')
        .select('id, name, icon, position, is_system, query')
        .order('position', { ascending: true });
      if (error) throw new Error(`Failed to load smart collections: ${error.message}`);
      return (data ?? []) as unknown as SmartCollection[];
    },

    async fetchOne(id: string): Promise<SmartCollection | null> {
      const { data, error } = await supabase
        .from('smart_collections')
        .select('id, name, icon, position, is_system, query')
        .eq('id', id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data as unknown as SmartCollection | null;
    },

    async create(name: string, query: FilterState, icon?: string): Promise<SmartCollection> {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not signed in');
      const { data, error } = await supabase
        .from('smart_collections')
        .insert({ user_id: user.id, name, query, icon: icon || '🔎', is_system: false })
        .select('id, name, icon, position, is_system, query')
        .single();
      if (error) throw new Error(`Create smart collection failed: ${error.message}`);
      return data as unknown as SmartCollection;
    },

    async delete(id: string) {
      const { error } = await supabase.from('smart_collections').delete().eq('id', id);
      if (error) throw new Error(`Delete smart collection failed: ${error.message}`);
    },
  },

  tts: {
    /** Returns a 24h signed URL for the item's audio; generates it on first call. */
    async generate(itemId: string, mode: 'summary' | 'full'): Promise<{ url: string; cached: boolean }> {
      return await invokeFn('tts-generate', { item_id: itemId, mode });
    },
  },

  /** AI translation of an item's title/summary/key points/body (cached server-side). */
  async translate(itemId: string, lang = 'ar'): Promise<{
    title: string | null; summary: string | null; key_points: string[]; body: string | null; lang: string; cached: boolean;
  }> {
    return await invokeFn('translate', { item_id: itemId, target_lang: lang });
  },

  /** Personal API keys for the MCP server (agents read/write the vault). */
  apiKeys: {
    async list(): Promise<ApiKey[]> {
      // Explicit columns: `*` would fail — key_hash is revoked from select.
      const { data, error } = await supabase
        .from('api_keys')
        .select('id, name, key_prefix, created_at, last_used_at, revoked_at')
        .order('created_at', { ascending: false });
      if (error) throw new Error(`Failed to load API keys: ${error.message}`);
      return (data ?? []) as ApiKey[];
    },
    /** Mint a key — the plaintext is returned exactly once and never stored. */
    async create(name: string): Promise<string> {
      const { data, error } = await supabase.rpc('create_api_key', { key_name: name });
      if (error) throw new Error(`Create key failed: ${error.message}`);
      return data as string;
    },
    async revoke(id: string) {
      const { error } = await supabase.from('api_keys').update({ revoked_at: new Date().toISOString() }).eq('id', id);
      if (error) throw new Error(`Revoke failed: ${error.message}`);
    },
    async remove(id: string) {
      const { error } = await supabase.from('api_keys').delete().eq('id', id);
      if (error) throw new Error(`Delete failed: ${error.message}`);
    },
  },
};
