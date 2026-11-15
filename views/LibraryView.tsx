import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { api } from '../services/api';
import { ContentItem, FilterState, Folder, ItemKind, SmartCollection } from '../types';
import FilterBar from '../components/FilterBar';
import ItemCard from '../components/ItemCard';
import ReaderSplit from '../components/ReaderSplit';

export type LibraryMode = 'inbox' | 'library' | 'folder' | 'collection';

/** Filters live in the URL so they survive refresh/back and are shareable. */
const filterFromParams = (sp: URLSearchParams): FilterState => {
  const csv = (k: string) => sp.get(k)?.split(',').filter(Boolean);
  const f: FilterState = {};
  const type = csv('type'); if (type?.length) f.source_type = type as FilterState['source_type'];
  const status = csv('status'); if (status?.length) f.read_status = status as FilterState['read_status'];
  const tags = csv('tags'); if (tags?.length) f.tags = tags;
  const topic = sp.get('topic'); if (topic) f.topic = topic;
  if (sp.get('starred') === '1') f.is_starred = true;
  const sort = sp.get('sort'); if (sort) f.sort = sort as FilterState['sort'];
  return f;
};

const paramsFromFilter = (f: FilterState): Record<string, string> => {
  const p: Record<string, string> = {};
  if (f.source_type?.length) p.type = f.source_type.join(',');
  if (f.read_status?.length) p.status = f.read_status.join(',');
  if (f.tags?.length) p.tags = f.tags.join(',');
  if (f.topic) p.topic = f.topic;
  if (f.is_starred) p.starred = '1';
  if (f.sort) p.sort = f.sort;
  return p;
};

interface LibraryViewProps {
  mode: LibraryMode;
  searchQuery: string;
  folders: Folder[];
  smartCollections: SmartCollection[];
  onSmartCollectionsChanged: () => void;
}

const LibraryView: React.FC<LibraryViewProps> = ({ mode, searchQuery, folders, smartCollections, onSmartCollectionsChanged }) => {
  const { folderId, collectionId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const [items, setItems] = useState<ContentItem[]>([]);
  const filter = useMemo(() => filterFromParams(searchParams), [searchParams]);

  // The Reading/Bookmarks/Mobile tab is orthogonal to the facet filters, so it
  // rides in its own `kind` param. Absent = "content" (the Library's default —
  // articles, videos and social posts). "mobile" is a saved_via view (links
  // from the Linkat phone app), not a kind, so it applies no kind filter.
  const kindParam = searchParams.get('kind');
  const kindTab: 'content' | 'bookmark' | 'mobile' =
    kindParam === 'bookmark' ? 'bookmark' : kindParam === 'mobile' ? 'mobile' : 'content';
  const effectiveKind: ItemKind | undefined =
    kindTab === 'bookmark' ? 'bookmark' : kindTab === 'content' ? 'content' : undefined;

  const setFilter = (f: FilterState) => {
    const p = paramsFromFilter(f);
    if (kindParam) p.kind = kindParam;
    setSearchParams(p, { replace: true });
  };
  const setKindTab = (tab: 'content' | 'bookmark' | 'mobile') => {
    const p = paramsFromFilter(filter);
    if (tab !== 'content') p.kind = tab; // 'content' is the default → keep the URL clean
    setSearchParams(p, { replace: true });
  };
  const [viewMode, setViewMode] = useState<'grid' | 'list' | 'reader'>(() =>
    (localStorage.getItem('library-view') as 'grid' | 'list' | 'reader') || 'grid');

  const changeViewMode = (m: 'grid' | 'list' | 'reader') => {
    setViewMode(m);
    localStorage.setItem('library-view', m);
  };
  const [loading, setLoading] = useState(true);

  const activeCollection = mode === 'collection' ? smartCollections.find(c => c.id === collectionId) : undefined;
  const activeFolder = mode === 'folder' ? folders.find(f => f.id === folderId) : undefined;

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      try {
        let data: ContentItem[];
        if (searchQuery.trim()) {
          const searchFilter = mode === 'collection' ? (activeCollection?.query ?? {}) : filter;
          data = await api.items.search(searchQuery.trim(), searchFilter);
        } else if (mode === 'folder' && folderId) {
          data = await api.items.fetchByFolder(folderId);
        } else if (mode === 'collection') {
          data = await api.items.fetchByFilter(activeCollection?.query ?? {});
        } else if (mode === 'inbox') {
          data = await api.items.fetchByFilter({ sort: 'date_desc' });
        } else {
          // Phone captures have their own tab, so each Library view stays
          // mutually exclusive: Mobile contains phone saves; Reading and
          // Bookmarks contain everything else.
          const base: FilterState = { ...filter, kind: effectiveKind };
          if (kindTab === 'mobile') base.saved_via = ['mobile', 'extension'];
          data = await api.items.fetchByFilter(base);
          if (kindTab !== 'mobile') {
            data = data.filter((item) => item.saved_via !== 'mobile' && item.saved_via !== 'extension');
          }
        }
        if (!cancelled) setItems(data);
      } catch (err) {
        console.error('Failed to load library items:', err);
        if (!cancelled) setItems([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [mode, folderId, collectionId, filter, effectiveKind, kindTab, searchQuery, activeCollection]);

  const availableTags = useMemo(() => {
    const set = new Set<string>();
    items.forEach(i => i.tags?.forEach(t => set.add(t)));
    return Array.from(set).sort();
  }, [items]);

  const availableTopics = useMemo(() => {
    const set = new Set<string>();
    items.forEach(i => i.topic && set.add(i.topic));
    return Array.from(set).sort();
  }, [items]);

  const handleToggleStar = async (id: string) => {
    const item = items.find(i => i.id === id);
    if (!item) return;
    const next = !item.is_starred;
    setItems(prev => prev.map(i => i.id === id ? { ...i, is_starred: next } : i));
    try {
      await api.items.setStarred(id, next);
    } catch (e: any) {
      alert(e.message);
      setItems(prev => prev.map(i => i.id === id ? { ...i, is_starred: !next } : i));
    }
  };

  const READ_CYCLE: Record<ContentItem['read_status'], ContentItem['read_status']> = {
    unread: 'reading', reading: 'read', read: 'unread',
  };

  const handleCycleReadStatus = async (id: string) => {
    const item = items.find(i => i.id === id);
    if (!item) return;
    const next = READ_CYCLE[item.read_status];
    setItems(prev => prev.map(i => i.id === id ? { ...i, read_status: next } : i));
    try {
      await api.items.setReadStatus(id, next);
    } catch (e: any) {
      alert(e.message);
      setItems(prev => prev.map(i => i.id === id ? { ...i, read_status: item.read_status } : i));
    }
  };

  /** Folders act as categories; bookmark cards move between them via dropdown. */
  const handleChangeFolder = async (itemId: string, folderId: string) => {
    const item = items.find(i => i.id === itemId);
    if (!item) return;
    const prevFolders = item.item_folders;
    setItems(prev => prev.map(i => i.id === itemId
      ? { ...i, item_folders: folderId ? [{ folder_id: folderId }] : [] }
      : i));
    try {
      await api.items.setFolder(itemId, folderId || null);
    } catch (e: any) {
      alert(e.message);
      setItems(prev => prev.map(i => i.id === itemId ? { ...i, item_folders: prevFolders } : i));
    }
  };

  /** Re-run the parse pipeline for an item whose fetch failed or missed data. */
  const handleRetry = async (id: string) => {
    setItems(prev => prev.map(i => i.id === id ? { ...i, status: 'pending' as const } : i));
    try {
      await api.items.retry(id);
    } catch (e: any) {
      alert(`Re-fetch failed: ${e.message}`);
    }
  };

  const handleSaveAsSmartCollection = async (name: string) => {
    try {
      await api.smartCollections.create(name, filter);
      onSmartCollectionsChanged();
    } catch (e: any) {
      alert(e.message);
    }
  };

  const title = mode === 'inbox' ? 'Inbox'
    : mode === 'library' ? (kindTab === 'bookmark' ? 'Bookmarks' : kindTab === 'mobile' ? 'From your phone' : 'Library')
    : mode === 'folder' ? (activeFolder?.name ?? 'Folder')
    : (activeCollection?.name ?? 'Collection');

  const KIND_TABS: { key: 'content' | 'bookmark' | 'mobile'; label: string; icon: string; hint: string }[] = [
    { key: 'content', label: 'Reading', icon: 'fa-book-open', hint: 'Articles, videos & social posts' },
    { key: 'bookmark', label: 'Bookmarks', icon: 'fa-bookmark', hint: 'Plain website links' },
    { key: 'mobile', label: 'Mobile', icon: 'fa-mobile-screen', hint: 'Links saved from the Qlip phone app' },
  ];

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between gap-6">
        <div>
          <div className="flex items-center gap-2 text-zinc-500 text-[10px] font-black uppercase tracking-[0.2em] mb-2">
            <div className="w-1.5 h-1.5 bg-neon-accent rounded-full"></div>
            {searchQuery.trim() ? `Search results for "${searchQuery.trim()}"` : `${items.length} item${items.length === 1 ? '' : 's'}`}
          </div>
          <h1 className="text-4xl font-black tracking-tighter leading-none">{title}</h1>
        </div>
        <div className="flex items-center bg-[#0D1B2B] border border-white/[0.04] rounded-full p-1 shadow-xl shrink-0">
          <button onClick={() => changeViewMode('grid')} className={`w-9 h-9 rounded-full flex items-center justify-center transition-all ${viewMode === 'grid' ? 'bg-white/10 text-white' : 'text-zinc-600 hover:text-zinc-400'}`} title="Grid view">
            <i className="fa-solid fa-grip text-xs"></i>
          </button>
          <button onClick={() => changeViewMode('list')} className={`w-9 h-9 rounded-full flex items-center justify-center transition-all ${viewMode === 'list' ? 'bg-white/10 text-white' : 'text-zinc-600 hover:text-zinc-400'}`} title="List view">
            <i className="fa-solid fa-list text-xs"></i>
          </button>
          <button onClick={() => changeViewMode('reader')} className={`w-9 h-9 rounded-full flex items-center justify-center transition-all ${viewMode === 'reader' ? 'bg-white/10 text-white' : 'text-zinc-600 hover:text-zinc-400'}`} title="Reader view — split pane with article + metadata">
            <i className="fa-solid fa-book-open text-xs"></i>
          </button>
        </div>
      </div>

      {mode === 'library' && !searchQuery.trim() && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center bg-[#0D1B2B] border border-white/[0.05] rounded-2xl p-1 shadow-xl">
            {KIND_TABS.map(t => {
              const active = kindTab === t.key;
              return (
                <button
                  key={t.key}
                  onClick={() => setKindTab(t.key)}
                  title={t.hint}
                  aria-pressed={active}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl text-[11px] font-black uppercase tracking-widest transition-all ${
                    active ? 'text-black shadow-lg' : 'text-zinc-500 hover:text-zinc-200'
                  }`}
                  style={active ? { background: 'var(--grad)' } : undefined}
                >
                  <i className={`fa-solid ${t.icon} text-[11px]`}></i>
                  {t.label}
                </button>
              );
            })}
          </div>
          <span className="text-[10px] font-bold text-zinc-600 hidden sm:block">
            {KIND_TABS.find(t => t.key === kindTab)?.hint}
          </span>
        </div>
      )}

      {(mode === 'library' || mode === 'inbox') && !searchQuery.trim() && (
        <FilterBar
          filter={filter}
          onChange={setFilter}
          availableTags={availableTags}
          availableTopics={availableTopics}
          onSaveAsSmartCollection={handleSaveAsSmartCollection}
        />
      )}

      {loading ? (
        <div className="py-24 flex justify-center">
          <div className="w-10 h-10 border-4 border-neon-accent/10 border-t-neon-accent rounded-full animate-spin"></div>
        </div>
      ) : items.length === 0 ? (
        (() => {
          // System collections explain how they fill instead of a generic "nothing here".
          const SYSTEM_EMPTY: Record<string, { icon: string; title: string; hint: string }> = {
            resurface: { icon: 'fa-rotate', title: 'Nothing resurfaced yet', hint: 'Every night Qlip picks up to 5 items you finished reading more than two weeks ago. Read a few articles and picks appear tomorrow morning.' },
            mobile: { icon: 'fa-mobile-screen', title: 'No phone saves yet', hint: 'Share any link to the Qlip app on your phone — it lands here and on the Vault Hub.' },
            social: { icon: 'fa-comment-dots', title: 'No social posts yet', hint: 'Save a tweet, Instagram reel, TikTok, or Reddit thread and it collects here.' },
            queue: { icon: 'fa-book-open', title: 'Reading queue is clear', hint: 'Anything marked Unread or Reading waits for you here.' },
            starred: { icon: 'fa-star', title: 'No starred items', hint: 'Tap the star on any card to keep it within reach.' },
          };
          const sys = mode === 'collection' ? (activeCollection?.query as FilterState | undefined)?.system : undefined;
          const LIBRARY_EMPTY = mode === 'library'
            ? kindTab === 'bookmark'
              ? { icon: 'fa-bookmark', title: 'No bookmarks here', hint: 'Plain website links you save land in your Vault Hub and show up here.' }
              : kindTab === 'mobile'
                ? { icon: 'fa-mobile-screen', title: 'No phone saves yet', hint: 'Share any link to the Qlip app on your phone — it lands here and on the Vault Hub.' }
                : kindTab === 'content'
                  ? { icon: 'fa-book-open', title: 'No readable content yet', hint: 'Save an article, video, PDF or social post — once the AI pipeline extracts the text, it appears here.' }
                  : undefined
            : undefined;
          const empty = (sys && SYSTEM_EMPTY[sys]) || LIBRARY_EMPTY || {
            icon: 'fa-box-open',
            title: 'Nothing here yet',
            hint: 'Save a URL and the AI pipeline will parse, summarize and tag it.',
          };
          return (
            <div className="col-span-full py-24 text-center space-y-4">
              <i className={`fa-solid ${empty.icon} text-4xl text-zinc-800`}></i>
              <div className="space-y-1 max-w-md mx-auto">
                <p className="text-zinc-500 font-black uppercase tracking-widest text-xs">{empty.title}</p>
                <p className="text-zinc-700 text-[10px] font-bold leading-relaxed">{empty.hint}</p>
              </div>
            </div>
          );
        })()
      ) : viewMode === 'reader' ? (
        <ReaderSplit items={items} onToggleStar={handleToggleStar} onCycleReadStatus={handleCycleReadStatus} />
      ) : (
        <div className={viewMode === 'grid' ? 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-8' : 'space-y-3'}>
          {items.map(item => (
            <ItemCard key={item.id} item={item} viewMode={viewMode} onToggleStar={handleToggleStar} onCycleReadStatus={handleCycleReadStatus} onRetry={handleRetry} folders={folders} onChangeFolder={handleChangeFolder} />
          ))}
        </div>
      )}
    </div>
  );
};

export default LibraryView;
