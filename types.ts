export type ItemStatus = 'pending' | 'parsing' | 'enriching' | 'ready' | 'degraded' | 'failed';

export type SourceType =
  | 'article' | 'youtube' | 'reel' | 'tweet' | 'pdf' | 'reddit' | 'podcast' | 'other';

/**
 * The two conceptual buckets a saved link falls into:
 *   'bookmark' — a plain website link with no readable body (lives in Vault Hub)
 *   'content'  — an article / social post / video / pdf (lives in Library)
 * Computed server-side as a generated column on content_items.
 */
export type ItemKind = 'bookmark' | 'content';
export type SaveDestination = 'auto' | ItemKind;

/** Which client saved the item (web app, Qlip mobile, extension, bulk import, MCP). */
export type SavedVia = 'web' | 'mobile' | 'extension' | 'import' | 'mcp';

/** A personal API key for the MCP server (agents read/write the vault). */
export interface ApiKey {
  id: string;
  name: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

/** Row shape of the content_items table (fields the UI needs). */
export interface ContentItem {
  id: string;
  url: string;
  title: string | null;
  description: string | null;
  content_text?: string | null;
  published_at?: string | null;
  summary: string | null;
  key_points: string[] | null;
  tags: string[];
  topic: string | null;
  content_type_label?: string | null;
  source_type: SourceType;
  item_kind?: ItemKind;
  status: ItemStatus;
  saved_via: SavedVia;
  site_name: string | null;
  thumbnail_url: string | null;
  favicon_url: string | null;
  is_pinned: boolean;
  pin_position: number | null;
  is_starred: boolean;
  read_status: 'unread' | 'reading' | 'read';
  section: string | null;
  created_at: string;
  raw_metadata?: {
    enriched_by?: string;
    ai?: Record<string, unknown>;
    parser?: Record<string, unknown>;
    processing?: Record<string, unknown>;
    [key: string]: unknown;
  } | null;
  item_folders?: { folder_id: string; assignment_source?: 'ai' | 'user' }[];
}

/** Row shape of the folders table (tree via parent_id, max depth 3). */
export interface Folder {
  id: string;
  name: string;
  color: string | null;
  icon: string | null;
  parent_id: string | null;
  position: number;
}

/** Row shape of the smart_collections table. */
export interface SmartCollection {
  id: string;
  name: string;
  icon: string | null;
  position: number;
  is_system: boolean;
  query: FilterState;
}

/** Filter descriptor — same jsonb shape stored in smart_collections.query. */
export interface FilterState {
  kind?: ItemKind;
  source_type?: SourceType[];
  saved_via?: SavedVia[];
  read_status?: ('unread' | 'reading' | 'read')[];
  tags?: string[];
  topic?: string;
  is_starred?: boolean;
  sort?: 'date_desc' | 'date_asc' | 'title_asc';
  /** Present only on seeded system collections; not user-editable. */
  system?: string;
}

/** UI card shape (adapter over ContentItem, kept for existing components). */
export interface Link {
  id: string;
  url: string;
  title: string;
  description: string;
  categoryId: string;
  section?: string;
  createdAt: number;
  user_id?: string;
  favicon?: string;
  isPinned?: boolean;
  pinPosition?: number | null;
  isStarred?: boolean;
  readStatus?: 'unread' | 'reading' | 'read';
  status?: ItemStatus;
  summary?: string | null;
  tags?: string[];
  thumbnailUrl?: string | null;
  sourceType?: SourceType;
  savedVia?: SavedVia;
  kind?: ItemKind;
  topic?: string | null;
}

export interface Category {
  id: string;
  name: string;
  color: string;
  icon: string;
  user_id?: string;
}

export interface UserProfile {
  id: string;
  email?: string;
}

export type AppTheme = 'default' | 'professional' | 'funny';
