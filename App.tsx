
import React, { useState, useEffect, useMemo, useRef, lazy, Suspense } from 'react';
import { Routes, Route, Navigate, NavLink, useLocation } from 'react-router-dom';
import { Category, Link, AppTheme, Folder, SmartCollection, SaveDestination } from './types';
import LinkCard from './components/LinkCard';
import AddLinkModal from './components/AddLinkModal';
import ImportModal from './components/ImportModal';
import ProgressModal from './components/ProgressModal';
import DeleteConfirmationModal from './components/DeleteConfirmationModal';
import AuthView from './components/AuthView';
import FolderSidebar from './components/FolderSidebar';
import type { LibraryMode } from './views/LibraryView';
import { ParsedBookmark } from './services/bookmarkService';
import { supabase } from './services/supabase';
import { api, toLink, type HomeStats } from './services/api';
import { Reveal, CountUp, spotlight, CursorGlow, Starfield } from './components/magic';
import { Session, AuthChangeEvent } from '@supabase/supabase-js';

const SettingsView = lazy(() => import('./components/SettingsView'));
const LibraryView = lazy(() => import('./views/LibraryView'));
const ReaderView = lazy(() => import('./views/ReaderView'));

/** Compact relative time for list rows: 5m, 3h, 2d. */
const timeAgo = (ts: number): string => {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
};

interface LibraryLayoutProps {
  folders: Folder[];
  smartCollections: SmartCollection[];
  onDeleteSmartCollection: (id: string) => void;
  children: React.ReactNode;
}

/** Module-level (not defined inside App) so it keeps a stable component identity across
 * App's frequent re-renders (e.g. the once-a-second clock tick) — otherwise React would
 * remount this subtree on every tick and the child view's data fetch would never finish. */
const LibraryLayout: React.FC<LibraryLayoutProps> = ({ folders, smartCollections, onDeleteSmartCollection, children }) => (
  <div className="lg:flex gap-8 items-start">
    {/* Full sidebar on desktop */}
    <div className="hidden lg:block">
      <FolderSidebar folders={folders} smartCollections={smartCollections} onDeleteSmartCollection={onDeleteSmartCollection} />
    </div>
    {/* Collections + folders collapse into a chip scroller on mobile */}
    <div className="lg:hidden -mx-6 px-6 mb-6 flex gap-2 overflow-x-auto no-scrollbar">
      {smartCollections.map(c => (
        <NavLink
          key={`chip-${c.id}`}
          to={`/collection/${c.id}`}
          className={({ isActive }) => `whitespace-nowrap px-4 py-2.5 rounded-full border text-[10px] font-black uppercase tracking-widest transition-all ${isActive ? 'text-black border-transparent' : 'text-zinc-400 border-white/[0.06] bg-white/[0.03]'}`}
          style={({ isActive }) => isActive ? { background: 'var(--grad)' } : undefined}
        >
          {c.icon ? `${c.icon} ` : ''}{c.name}
        </NavLink>
      ))}
      {folders.filter(f => !f.parent_id).map(f => (
        <NavLink
          key={`chip-${f.id}`}
          to={`/folder/${f.id}`}
          className={({ isActive }) => `whitespace-nowrap px-4 py-2.5 rounded-full border text-[10px] font-black uppercase tracking-widest transition-all ${isActive ? 'text-black border-transparent' : 'text-zinc-400 border-white/[0.06] bg-white/[0.03]'}`}
          style={({ isActive }) => isActive ? { background: 'var(--grad)' } : undefined}
        >
          {f.name}
        </NavLink>
      ))}
    </div>
    <div className="flex-grow min-w-0">{children}</div>
  </div>
);

const App: React.FC = () => {
  const location = useLocation();
  const [session, setSession] = useState<Session | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [theme, setTheme] = useState<AppTheme>(() => {
    const saved = localStorage.getItem('bento-theme');
    return (saved as AppTheme) || 'default';
  });

  const [links, setLinks] = useState<Link[]>([]);
  const [isVaultLoading, setIsVaultLoading] = useState(true);
  const [homeStats, setHomeStats] = useState<HomeStats | null>(null);
  const [homeSearchResults, setHomeSearchResults] = useState<Link[]>([]);
  const [dailyPicks, setDailyPicks] = useState<Link[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [smartCollections, setSmartCollections] = useState<SmartCollection[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [draggedPinnedId, setDraggedPinnedId] = useState<string | null>(null);
  // User-arranged order of the home briefing sections — persisted per device.
  const HOME_SECTIONS_DEFAULT = ['phone', 'continue', 'picks', 'fresh', 'bookmarked'] as const;
  const [homeSectionOrder, setHomeSectionOrder] = useState<string[]>(() => {
    try {
      const saved: string[] = JSON.parse(localStorage.getItem('home-section-order') || '[]');
      // Keep only known keys, append any new sections added since the save.
      const valid = saved.filter(k => (HOME_SECTIONS_DEFAULT as readonly string[]).includes(k));
      return [...valid, ...HOME_SECTIONS_DEFAULT.filter(k => !valid.includes(k))];
    } catch { return [...HOME_SECTIONS_DEFAULT]; }
  });
  const [currentTime, setCurrentTime] = useState(new Date());
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement>(null);

  const [deleteTarget, setDeleteTarget] = useState<{ type: 'link' | 'category', id: string, name: string } | null>(null);
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0, active: false });

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setIsAuthLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (isAuthLoading || !session) return;
    fetchVaultData();
    let structureRefreshTimer: number | undefined;
    const refreshSharedStructure = () => {
      window.clearTimeout(structureRefreshTimer);
      structureRefreshTimer = window.setTimeout(() => { void fetchVaultData(); }, 1200);
    };

    const upsertRemoteItem = async (id: string) => {
      const item = await api.items.fetchOne(id);
      if (!item) return;
      const link = toLink(item);
      setLinks(prev => {
        const index = prev.findIndex(existing => existing.id === link.id);
        if (index < 0) return [link, ...prev];
        return prev.map(existing => existing.id === link.id ? link : existing);
      });
    };

    // Sync items created, edited, processed, or deleted from another Qlip
    // client. In particular, INSERT keeps a web vault open on desktop in sync
    // with a link saved from the phone.
    const unsubscribe = api.items.subscribeToChanges((updated, eventType) => {
      refreshSharedStructure();
      if (eventType === 'DELETE') {
        setLinks(prev => prev.filter(link => link.id !== updated.id));
        return;
      }

      if (eventType === 'INSERT') {
        void upsertRemoteItem(updated.id).catch(() => { /* next refresh recovers */ });
        return;
      }

      setLinks(prev => prev.map(link => {
        if (link.id !== updated.id) return link;
        return {
          ...link,
          title: (updated.title as string) ?? link.title,
          description: (updated.summary as string) ?? (updated.description as string) ?? link.description,
          status: (updated.status as Link['status']) ?? link.status,
          summary: (updated.summary as string) ?? link.summary,
          tags: (updated.tags as string[]) ?? link.tags,
          topic: (updated.topic as string) ?? link.topic,
          favicon: (updated.favicon_url as string) ?? link.favicon,
          thumbnailUrl: (updated.thumbnail_url as string) ?? link.thumbnailUrl,
          kind: (updated.item_kind as Link['kind']) ?? link.kind,
          savedVia: (updated.saved_via as Link['savedVia']) ?? link.savedVia,
          readStatus: (updated.read_status as Link['readStatus']) ?? link.readStatus,
          isStarred: (updated.is_starred as boolean) ?? link.isStarred,
          isPinned: (updated.is_pinned as boolean) ?? link.isPinned,
          pinPosition: updated.pin_position === null
            ? null
            : (updated.pin_position as number | undefined) ?? link.pinPosition,
        };
      }));
    });
    const unsubscribeStructure = api.items.subscribeToStructureChanges(refreshSharedStructure);
    return () => {
      unsubscribe();
      unsubscribeStructure();
      window.clearTimeout(structureRefreshTimer);
    };
  }, [session?.user.id, isAuthLoading]);

  const fetchVaultData = async () => {
    try {
      const [home, folderTree, collections] = await Promise.all([
        api.items.fetchHome(),
        api.folders.fetchTree(),
        api.smartCollections.fetchAll(),
      ]);
      setCategories(folderTree.map(folder => ({ id: folder.id, name: folder.name, color: folder.color || 'bg-zinc-100', icon: folder.icon || 'fa-folder' })));
      setFolders(folderTree);
      setSmartCollections(collections);
      setLinks(home.items.map(toLink));
      setHomeStats(home.stats);
    } catch (err) {
      console.error("Failed to fetch vault data:", err);
    } finally {
      setIsVaultLoading(false);
    }
    // Today's Picks (nightly Resurface set) — non-critical, loads after the main data.
    try {
      const picks = await api.items.fetchByFilter({ system: 'resurface' } as any);
      setDailyPicks(picks.map(toLink));
    } catch {
      setDailyPicks([]);
    }
  };

  const refreshFolders = async () => {
    try {
      setFolders(await api.folders.fetchTree());
    } catch (err) {
      console.error("Failed to refresh folders:", err);
    }
  };

  const refreshSmartCollections = async () => {
    try {
      setSmartCollections(await api.smartCollections.fetchAll());
    } catch (err) {
      console.error("Failed to refresh smart collections:", err);
    }
  };

  const handleDeleteSmartCollection = async (id: string) => {
    try {
      await api.smartCollections.delete(id);
      setSmartCollections(prev => prev.filter(c => c.id !== id));
    } catch (e: any) {
      alert(e.message);
    }
  };

  useEffect(() => {
    localStorage.setItem('bento-theme', theme);
    document.body.className = `theme-${theme}`;
  }, [theme]);

  useEffect(() => {
    // Clock shows HH:MM — a 30s tick is plenty and avoids re-rendering the app every second.
    const timer = setInterval(() => setCurrentTime(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  // Close the account menu on outside click / Escape.
  useEffect(() => {
    if (!accountMenuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (accountMenuRef.current && !accountMenuRef.current.contains(e.target as Node)) {
        setAccountMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setAccountMenuOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [accountMenuOpen]);

  const addLink = async (url: string, folderId?: string, destination: SaveDestination = 'auto') => {
    const result = await api.items.save(url, folderId, destination);
    if (result.duplicate) {
      throw new Error('Already saved — this URL is in your vault.');
    }
    const item = await api.items.fetchOne(result.id);
    if (item) setLinks(prev => [toLink(item), ...prev]);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  const handleUpdateLink = async (id: string, updates: Partial<Link>) => {
    setLinks(prev => prev.map(l => l.id === id ? { ...l, ...updates } : l));
    try {
      await api.items.update(id, {
        ...(updates.title !== undefined ? { title: updates.title } : {}),
        ...(updates.description !== undefined ? { description: updates.description } : {}),
        ...(updates.isPinned !== undefined ? { is_pinned: updates.isPinned } : {}),
      });
    } catch (e: any) {
      alert(`Update sync failed: ${e.message}`);
      fetchVaultData();
    }
  };

  const handleAddCategory = async (name: string, color: string, icon: string) => {
    try {
      const created = await api.folders.create(name, color, icon);
      setCategories(prev => [...prev, created]);
      refreshFolders();
    } catch (e: any) {
      alert(e.message);
    }
  };

  const handleUpdateCategory = async (id: string, name: string, color: string, icon: string) => {
    try {
      await api.folders.update(id, { name, color, icon });
      setCategories(prev => prev.map(c => c.id === id ? { id, name, color, icon } : c));
      refreshFolders();
    } catch (e: any) {
      alert(e.message);
    }
  };

  const confirmDeleteCategory = (id: string) => {
    const cat = categories.find(c => c.id === id);
    if (cat) setDeleteTarget({ type: 'category', id, name: cat.name });
  };

  const executeDeleteCategory = async (id: string) => {
    try {
      await api.folders.delete(id);
      setCategories(prev => prev.filter(c => c.id !== id));
      // Items in the folder become unfiled (assignments cascade server-side)
      setLinks(prev => prev.map(l => l.categoryId === id ? { ...l, categoryId: '' } : l));
      refreshFolders();
    } catch (e: any) {
      alert(`Failed to delete folder: ${e.message}`);
    }
  };

  const handleReorderCategories = (startIndex: number, endIndex: number) => {
    setCategories(prev => {
      const newCats = [...prev];
      const [removed] = newCats.splice(startIndex, 1);
      newCats.splice(endIndex, 0, removed);
      return newCats;
    });
  };

  const handleImport = async (parsedBookmarks: ParsedBookmark[], mode: 'add' | 'replace') => {
    const uniqueInput = Array.from(new Map(parsedBookmarks.map(item => [item.url.toLowerCase(), item])).values());
    if (uniqueInput.length === 0) return;

    if (mode === 'replace') {
      try {
        await api.items.deleteAll();
        setLinks([]);
      } catch (e: any) {
        alert(`Failed to clear vault: ${e.message}`);
        return;
      }
    }

    const urls = uniqueInput.map(b => b.url);
    const BATCH = 100;
    const totalBatches = Math.ceil(urls.length / BATCH);
    setImportProgress({ current: 0, total: urls.length, active: true });

    let imported = 0;
    for (let i = 0; i < totalBatches; i++) {
      const slice = urls.slice(i * BATCH, (i + 1) * BATCH);
      try {
        const results = await api.items.saveBatch(slice);
        imported += results.filter(r => !r.error && !r.duplicate).length;
      } catch (e) {
        console.error(`Import batch ${i + 1}/${totalBatches} failed:`, e);
      }
      setImportProgress(prev => ({ ...prev, current: Math.min((i + 1) * BATCH, urls.length) }));
    }

    setImportProgress({ current: 0, total: 0, active: false });
    await fetchVaultData();
    if (imported < urls.length) {
      console.info(`Import: ${imported} new, ${urls.length - imported} duplicates/errors skipped.`);
    }
  };

  const confirmDeleteLink = (id: string) => {
    const link = links.find(l => l.id === id);
    if (link) setDeleteTarget({ type: 'link', id, name: link.title });
  };

  const executeDeleteLink = async (id: string) => {
    try {
      await api.items.delete(id);
      setLinks(prev => prev.filter(l => l.id !== id));
    } catch (e: any) {
      alert(`Delete failed: ${e.message}`);
    }
  };

  const togglePin = async (id: string) => {
    const item = links.find(l => l.id === id);
    if (!item) return;
    const next = !item.isPinned;
    const nextPosition = next
      ? Math.max(-1, ...links.filter(link => link.isPinned).map(link => link.pinPosition ?? -1)) + 1
      : null;
    setLinks(prev => prev.map(l => l.id === id ? { ...l, isPinned: next, pinPosition: nextPosition } : l));
    try {
      await api.items.update(id, { is_pinned: next, pin_position: nextPosition });
    } catch (e: any) {
      alert(e.message);
      setLinks(prev => prev.map(l => l.id === id ? { ...l, isPinned: !next, pinPosition: item.pinPosition } : l));
    }
  };

  const toggleStarLink = async (id: string) => {
    const item = links.find(l => l.id === id);
    if (!item) return;
    const next = !item.isStarred;
    setLinks(prev => prev.map(l => l.id === id ? { ...l, isStarred: next } : l));
    try {
      await api.items.setStarred(id, next);
    } catch (e: any) {
      alert(e.message);
      setLinks(prev => prev.map(l => l.id === id ? { ...l, isStarred: !next } : l));
    }
  };

  const READ_CYCLE: Record<string, 'unread' | 'reading' | 'read'> = {
    unread: 'reading', reading: 'read', read: 'unread',
  };

  const cycleReadStatusLink = async (id: string) => {
    const item = links.find(l => l.id === id);
    if (!item) return;
    const prevStatus = item.readStatus ?? 'unread';
    const next = READ_CYCLE[prevStatus];
    setLinks(prev => prev.map(l => l.id === id ? { ...l, readStatus: next } : l));
    try {
      await api.items.setReadStatus(id, next);
    } catch (e: any) {
      alert(e.message);
      setLinks(prev => prev.map(l => l.id === id ? { ...l, readStatus: prevStatus } : l));
    }
  };

  const handleCategoryChange = async (linkId: string, categoryId: string) => {
    setLinks(prev => prev.map(l => l.id === linkId ? { ...l, categoryId } : l));
    try {
      await api.items.setFolder(linkId, categoryId || null);
    } catch (e: any) {
      alert(e.message);
      fetchVaultData();
    }
  };

  const handlePinnedDragStart = (id: string) => {
    setDraggedPinnedId(id);
  };

  const handlePinnedDrop = async (targetId: string) => {
    if (!draggedPinnedId || draggedPinnedId === targetId) { setDraggedPinnedId(null); return; }
    // Reorder within the pinned set and persist to Postgres so every client
    // renders the same Priority Vault.
    const currentIds = pinnedLinks.map(l => l.id);
    const from = currentIds.indexOf(draggedPinnedId);
    const to = currentIds.indexOf(targetId);
    if (from === -1 || to === -1) { setDraggedPinnedId(null); return; }
    const next = [...currentIds];
    next.splice(from, 1);
    next.splice(to, 0, draggedPinnedId);
    const positions = new Map(next.map((id, index) => [id, index]));
    setLinks(prev => prev.map(link => positions.has(link.id) ? { ...link, pinPosition: positions.get(link.id)! } : link));
    setDraggedPinnedId(null);
    try {
      await api.items.setPinnedOrder(next);
    } catch (error: any) {
      alert(error.message);
      fetchVaultData();
    }
  };

  /** Re-run the parse pipeline for a card whose fetch failed or missed data. */
  const handleRetryLink = async (id: string) => {
    setLinks(prev => prev.map(l => l.id === id ? { ...l, status: 'pending' } : l));
    try {
      await api.items.retry(id);
      // Realtime subscription streams pending -> parsing -> enriching -> ready from here.
    } catch (e: any) {
      alert(`Re-fetch failed: ${e.message}`);
      fetchVaultData();
    }
  };

  /** Nudge a home briefing section up or down; persisted per device. */
  const moveHomeSection = (key: string, dir: -1 | 1) => {
    setHomeSectionOrder(prev => {
      const idx = prev.indexOf(key);
      const swap = idx + dir;
      if (idx === -1 || swap < 0 || swap >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[swap]] = [next[swap], next[idx]];
      localStorage.setItem('home-section-order', JSON.stringify(next));
      return next;
    });
  };

  // Vault Hub is the home for BOOKMARKS — plain website links you saved to
  // reference. Articles, social posts and videos are "content" and live in the
  // Library. `item_kind` is computed server-side.
  // Origin never changes destination: a domain saved on iPhone is still a
  // Bookmark and may also appear in the From your phone section.
  const vaultLinks = useMemo<Link[]>(
    () => links.filter(l => l.kind === 'bookmark'),
    [links]
  );

  // Readable/watchable content — the Library's material. Surfaced on the home
  // only as bridges (continue reading, latest) that deep-link into /library.
  const libraryLinks = useMemo<Link[]>(() => links.filter(l => l.kind === 'content'), [links]);

  // Everything saved from the native app or its share extension gets its own
  // home section and opens Qlip's reader when enriched content is available.
  const phoneLinks = useMemo<Link[]>(
    () => links.filter(l => l.savedVia === 'mobile' || l.savedVia === 'extension').slice(0, 8),
    [links]
  );

  const pinnedLinks = useMemo<Link[]>(() => {
    return links
      .filter(l => l.isPinned)
      .sort((a, b) => (a.pinPosition ?? Infinity) - (b.pinPosition ?? Infinity) || b.createdAt - a.createdAt);
  }, [links]);

  const processingLinks = useMemo<Link[]>(
    () => links.filter(l => l.status === 'pending' || l.status === 'parsing' || l.status === 'enriching'),
    [links]
  );

  // Home is a daily briefing: capped, purposeful sections. The full archive lives in /library.
  // Smart global search: spans the whole vault (bookmarks + content), matching
  // title, url, summary, topic and tags — so you can search by topic or any word.
  useEffect(() => {
    let cancelled = false;
    setHomeSearchResults([]);
    if (!session || location.pathname !== '/' || !searchQuery.trim()) return;
    const timer = window.setTimeout(() => {
      api.items.searchHome(searchQuery.trim()).then(items => {
        if (!cancelled) setHomeSearchResults(items.map(toLink));
      }).catch(error => console.error('Home search failed:', error));
    }, 250);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [searchQuery, session?.user.id, location.pathname]);
  const searchMatches = homeSearchResults;

  // Search results grouped into source sections (Articles, Videos, Reels, …).
  const SOURCE_LABELS: Record<string, string> = {
    article: 'Articles', youtube: 'Videos', reel: 'Reels', tweet: 'Posts',
    reddit: 'Reddit', pdf: 'PDFs', podcast: 'Podcasts', other: 'Other',
    bookmark: 'Bookmarks',
  };
  const searchGroups = useMemo(() => {
    const by = new Map<string, Link[]>();
    for (const link of searchMatches) {
      const key = link.kind === 'bookmark' ? 'bookmark' : (link.sourceType ?? 'other');
      (by.get(key) ?? by.set(key, []).get(key)!).push(link);
    }
    const order = ['article','youtube','reel','tweet','reddit','pdf','podcast','other','bookmark'];
    return [...by.entries()].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));
  }, [searchMatches]);

  // Phone captures have a dedicated surface, so the Reading queue stays free
  // of items already represented in "From your phone".
  const continueReading = useMemo<Link[]>(
    () => libraryLinks.filter(l => l.readStatus === 'reading' && l.savedVia !== 'mobile' && l.savedVia !== 'extension').slice(0, 6),
    [libraryLinks]
  );

  const latestContent = useMemo<Link[]>(() => libraryLinks.slice(0, 6), [libraryLinks]);

  // Phone saves have their own section, so keep them out of Recently bookmarked.
  const recentlySaved = useMemo<Link[]>(
    () => vaultLinks.filter(l => l.savedVia !== 'mobile' && l.savedVia !== 'extension').slice(0, 12),
    [vaultLinks]
  );

  const queueCollectionId = useMemo(
    () => smartCollections.find(c => c.query?.system === 'queue')?.id,
    [smartCollections]
  );

  const resurfaceCollectionId = useMemo(
    () => smartCollections.find(c => c.query?.system === 'resurface')?.id,
    [smartCollections]
  );

  const stats = useMemo(() => homeStats ?? ({
    total: vaultLinks.length,
    // "AI enriched: 0" read as broken (legacy items are intentionally unenriched) —
    // unread + this-week are actionable numbers instead.
    unread: vaultLinks.filter(l => (l.readStatus ?? 'unread') === 'unread').length,
    thisWeek: vaultLinks.filter(l => Date.now() - l.createdAt < 7 * 86_400_000).length,
    library: libraryLinks.length,
    processing: processingLinks.length,
  }), [homeStats, links, vaultLinks, libraryLinks, processingLinks]);

  const greeting = useMemo(() => {
    const h = currentTime.getHours();
    if (h < 5) return 'Working late';
    if (h < 12) return 'Good morning';
    if (h < 18) return 'Good afternoon';
    return 'Good evening';
  }, [currentTime]);

  const accountName = useMemo(() => {
    const local = (session?.user?.email ?? 'User').split('@')[0];
    return local.charAt(0).toUpperCase() + local.slice(1);
  }, [session]);
  const accountInitials = useMemo(() => {
    const local = (session?.user?.email ?? 'U').split('@')[0];
    const parts = local.split(/[._-]+/).filter(Boolean);
    return ((parts[0]?.[0] ?? 'U') + (parts[1]?.[0] ?? '')).toUpperCase();
  }, [session]);

  const formattedTime = currentTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
  const formattedDate = currentTime.toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  const renderLibrary = (mode: LibraryMode) => (
    <LibraryView
      mode={mode}
      searchQuery={searchQuery}
      folders={folders}
      smartCollections={smartCollections}
      onSmartCollectionsChanged={refreshSmartCollections}
    />
  );

  if (isAuthLoading) {
    return (
      <div className="min-h-screen bg-[#0A1320] flex items-center justify-center">
        <div className="flex flex-col items-center gap-6">
          <div className="w-16 h-16 border-4 border-neon-accent/10 border-t-neon-accent rounded-full animate-spin"></div>
          <span className="text-[10px] font-black uppercase tracking-[0.4em] text-zinc-500 animate-pulse">Initializing Vault Protocol</span>
        </div>
      </div>
    );
  }

  if (!session) return <><Starfield /><AuthView /></>;

  return (
    <div className="min-h-screen selection:bg-neon-accent selection:text-black">
      {theme === 'default' && <><Starfield /><CursorGlow /></>}
      <ProgressModal current={importProgress.current} total={importProgress.total} isComplete={!importProgress.active} />

      {deleteTarget && (
        <DeleteConfirmationModal
          isOpen={!!deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onConfirm={() => {
            if (!deleteTarget) return;
            if (deleteTarget.type === 'link') executeDeleteLink(deleteTarget.id);
            else executeDeleteCategory(deleteTarget.id);
          }}
          title={`Delete ${deleteTarget.type === 'link' ? 'Resource' : 'Folder'}`}
          message={deleteTarget.type === 'link' ? `Delete "${deleteTarget.name}" permanently?` : `Delete folder "${deleteTarget.name}"? Items will become unfiled.`}
        />
      )}

      <nav className="h-20 flex items-center justify-between px-6 lg:px-12 sticky top-0 bg-[#0A1320]/75 backdrop-blur-xl z-40 border-b border-white/[0.04]">
        <div className="flex items-center gap-12">
          <NavLink to="/" className="flex items-center gap-3 group cursor-pointer">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center rotate-3 group-hover:rotate-0 transition-transform duration-300 shadow-lg" style={{ background: 'linear-gradient(135deg,#7CB342,#A8CF38)' }}>
              <span className="text-[#0A1320] font-black text-lg leading-none tracking-tighter">Q</span>
            </div>
            <span className="hidden sm:inline font-extrabold text-xl tracking-tighter">Qlip</span>
          </NavLink>
          <div className="hidden lg:flex items-center bg-[#0D1B2B] border border-white/[0.04] rounded-full p-1.5 shadow-xl">
            <NavLink to="/" end className={({ isActive }) => `px-6 py-2 rounded-full text-[11px] font-black uppercase tracking-wider transition-all ${isActive ? 'bg-neon-accent text-black' : 'text-zinc-500 hover:text-white'}`}>Vault Hub</NavLink>
            <NavLink to="/library" className={({ isActive }) => `px-6 py-2 rounded-full text-[11px] font-black uppercase tracking-wider transition-all ${isActive ? 'bg-neon-accent text-black' : 'text-zinc-500 hover:text-white'}`}>Library</NavLink>
          </div>
        </div>

        <div className="flex items-center gap-3 md:gap-8 flex-1 justify-end min-w-0">
          <div className="relative flex-1 max-w-[16rem] md:flex-none md:w-64 xl:w-80 group min-w-0">
            <i className="fa-solid fa-magnifying-glass absolute left-5 top-1/2 -translate-y-1/2 text-zinc-600 text-[10px] group-focus-within:text-neon-accent"></i>
            <input type="text" placeholder="GLOBAL SEARCH..." className="w-full bg-white/5 border border-white/5 rounded-full py-3 pl-12 pr-5 focus:outline-none focus:ring-1 focus:ring-neon-accent transition-all text-[10px] font-bold uppercase tracking-widest placeholder:text-zinc-600" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
          </div>

          <div className="flex items-center gap-4">
            <div className="relative" ref={accountMenuRef}>
              <button
                onClick={() => setAccountMenuOpen(o => !o)}
                className="relative w-10 h-10 rounded-full grid place-items-center cursor-pointer group/av"
                aria-haspopup="menu"
                aria-expanded={accountMenuOpen}
                aria-label="Account menu"
              >
                {/* Gradient ring — solid when open, faint until hovered */}
                <span
                  className="absolute inset-0 rounded-full transition-opacity duration-300"
                  style={{ background: 'var(--grad)', opacity: accountMenuOpen ? 1 : 0 }}
                ></span>
                <span className="absolute inset-0 rounded-full border border-white/10 opacity-100 group-hover/av:opacity-0 transition-opacity"></span>
                <span className="relative w-[30px] h-[30px] rounded-full overflow-hidden bg-[#16283F] grid place-items-center">
                  <span className="text-[11px] font-black text-zinc-200 uppercase tracking-tight">{accountInitials}</span>
                </span>
                {/* Live status dot */}
                <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-[#0A1320] grid place-items-center">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                </span>
              </button>

              {accountMenuOpen && (
                <div
                  role="menu"
                  className="fixed top-[88px] right-4 lg:right-12 w-72 bento-card p-0 overflow-hidden shadow-2xl z-50 animate-in fade-in slide-in-from-top-2 duration-200"
                >
                  {/* Profile header — monogram tile + email + synced status */}
                  <div className="relative p-4 flex items-center gap-3 border-b border-white/[0.06] bg-white/[0.02]">
                    <div className="w-11 h-11 rounded-2xl grid place-items-center text-black font-black text-base shrink-0 shadow-lg" style={{ background: 'var(--grad)' }}>
                      {accountInitials}
                    </div>
                    <div className="min-w-0">
                      <p className="text-[13px] font-bold text-white truncate leading-tight">{accountName}</p>
                      <p className="text-[11px] text-zinc-500 truncate">{session?.user?.email}</p>
                      <div className="flex items-center gap-1.5 mt-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                        <span className="text-[9px] font-black uppercase tracking-widest text-emerald-400/80">Cloud synced</span>
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="p-2">
                    <NavLink
                      to="/settings"
                      role="menuitem"
                      onClick={() => setAccountMenuOpen(false)}
                      className="group/item flex items-center gap-3 px-2.5 py-2.5 rounded-xl hover:bg-white/[0.04] transition-colors"
                    >
                      <span className="w-8 h-8 rounded-lg bg-white/[0.04] border border-white/[0.06] grid place-items-center text-zinc-400 group-hover/item:text-[color:var(--lime)] group-hover/item:border-[color:var(--lime)]/30 transition-colors">
                        <i className="fa-solid fa-sliders text-xs"></i>
                      </span>
                      <span className="flex-grow min-w-0">
                        <span className="block text-xs font-bold text-zinc-200">Configuration</span>
                        <span className="block text-[10px] text-zinc-600">Theme, folders &amp; categories</span>
                      </span>
                      <i className="fa-solid fa-chevron-right text-[9px] text-zinc-700 -translate-x-1 opacity-0 group-hover/item:translate-x-0 group-hover/item:opacity-100 transition-all"></i>
                    </NavLink>
                  </div>

                  <div className="px-2 pb-2">
                    <div className="h-px bg-white/[0.05] mx-2 mb-2"></div>
                    <button
                      role="menuitem"
                      onClick={() => { setAccountMenuOpen(false); handleLogout(); }}
                      className="group/item w-full flex items-center gap-3 px-2.5 py-2.5 rounded-xl hover:bg-red-500/[0.08] transition-colors"
                    >
                      <span className="w-8 h-8 rounded-lg bg-white/[0.04] border border-white/[0.06] grid place-items-center text-zinc-400 group-hover/item:text-red-400 group-hover/item:border-red-500/30 transition-colors">
                        <i className="fa-solid fa-arrow-right-from-bracket text-xs"></i>
                      </span>
                      <span className="text-xs font-bold text-zinc-300 group-hover/item:text-red-400 transition-colors">Sign out</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-[1600px] mx-auto p-6 lg:p-12 space-y-12 pb-32 lg:pb-24">
        <Suspense fallback={<div role="status" className="py-20 text-center text-zinc-400">Loading…</div>}>
        <Routes>
          <Route path="/" element={
            <>
            <Reveal>
              <div className="flex flex-col md:flex-row items-end justify-between gap-6">
                <div>
                  <span className="eyebrow mb-4">{session.user.email}</span>
                  <h1 className="text-6xl font-black tracking-tighter leading-none">
                    Vault <span className="grad-text">Dashboard</span>
                  </h1>
                </div>
                <div className="flex gap-4">
                  <button onClick={() => setIsImportModalOpen(true)} className="bento-card border border-white/10 text-white px-6 py-4 rounded-[1.5rem] font-black text-xs uppercase tracking-widest hover:bg-white/5 transition-all">Bulk Sync</button>
                  <button onClick={() => setIsModalOpen(true)} className="text-black px-8 py-4 rounded-[1.5rem] font-black text-xs uppercase tracking-widest transition-all shadow-2xl hover:brightness-110" style={{ background: 'var(--grad)' }}>Create entry</button>
                </div>
              </div>
            </Reveal>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
              <Reveal className="lg:col-span-8">
              <div className="bento-card spot p-0 flex flex-col lg:flex-row group overflow-hidden relative shadow-2xl lg:min-h-[400px] h-full" onMouseMove={spotlight}>
                <div className="w-full lg:w-[44%] p-8 lg:p-12 flex flex-col justify-between gap-8 z-10 border-b lg:border-b-0 lg:border-r border-white/5">
                  <div className="space-y-3">
                    <span className="eyebrow">System Pulse</span>
                    <h2 className="text-4xl xl:text-5xl font-black tracking-tight leading-[1.05] font-display">
                      {greeting}<span className="grad-text">.</span>
                    </h2>
                    <p className="text-[11px] font-black uppercase tracking-[0.25em] text-zinc-500 font-mono-data">
                      {formattedDate} <span className="text-zinc-700">·</span> <span style={{ color: 'var(--lime)' }}>{formattedTime}</span>
                    </p>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <NavLink to="/library?kind=bookmark" className="group/stat rounded-2xl bg-white/[0.03] border border-white/[0.05] px-3 py-2.5 hover:border-white/15 transition-colors">
                      <CountUp value={stats.total} className="text-xl xl:text-2xl font-black grad-text font-display block" />
                      <span className="text-[10px] font-black text-zinc-500 uppercase tracking-wider whitespace-nowrap group-hover/stat:text-zinc-300 transition-colors">Bookmarks</span>
                    </NavLink>
                    <NavLink to="/library" className="group/stat rounded-2xl bg-white/[0.03] border border-white/[0.05] px-3 py-2.5 hover:border-white/15 transition-colors">
                      <CountUp value={stats.library} className="text-xl xl:text-2xl font-black text-white font-display block" />
                      <span className="text-[10px] font-black text-zinc-500 uppercase tracking-wider whitespace-nowrap group-hover/stat:text-zinc-300 transition-colors">Library</span>
                    </NavLink>
                    <NavLink to={queueCollectionId ? `/collection/${queueCollectionId}` : '/library'} className="group/stat rounded-2xl bg-white/[0.03] border border-white/[0.05] px-3 py-2.5 hover:border-white/15 transition-colors">
                      <CountUp value={stats.unread} className="text-xl xl:text-2xl font-black text-zinc-400 font-display block" />
                      <span className="text-[10px] font-black text-zinc-500 uppercase tracking-wider whitespace-nowrap group-hover/stat:text-zinc-300 transition-colors">Unread</span>
                    </NavLink>
                  </div>
                </div>
                <div className="w-full lg:w-[56%] relative bg-[#0D1B2B]/50 p-6 lg:p-8 flex flex-col min-h-[300px]">
                  <div className="flex items-center justify-between mb-6">
                    <div>
                      <span className="eyebrow">AI Pipeline</span>
                      <p className="text-[10px] font-bold text-zinc-600 mt-1">New captures</p>
                    </div>
                    {stats.processing > 0 ? (
                      <span className="px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest flex items-center gap-2 border" style={{ color: 'var(--lime)', borderColor: 'rgba(168,207,56,.3)', background: 'rgba(168,207,56,.08)' }}>
                        <i className="fa-solid fa-spinner fa-spin text-[10px]"></i>
                        {stats.processing} processing
                      </span>
                    ) : null}
                  </div>
                  <div className="flex-grow overflow-y-auto no-scrollbar space-y-3 max-h-[430px]">
                    {processingLinks.length > 0 && (
                      <>
                        <div className="flex items-center gap-2 px-1 pt-1">
                          <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: 'var(--lime)' }}></span>
                          <span className="text-[9px] font-black uppercase tracking-[0.2em] text-zinc-500">Live queue</span>
                        </div>
                        {processingLinks.slice(0, 4).map(link => (
                        <div key={`pipe-${link.id}`} className="flex items-center gap-3 p-3 bg-white/[0.02] border border-white/[0.05] rounded-xl">
                          <div className="w-8 h-8 rounded-lg border border-white/[0.08] bg-[#0A1320] grid place-items-center shrink-0">
                            <i className={`fa-solid fa-sparkles text-xs`} style={{ color: 'var(--lime)' }}></i>
                          </div>
                          <div className="min-w-0 flex-grow">
                            <p className="text-[11px] font-bold text-zinc-300 truncate">{link.title}</p>
                            <div className="flex items-center gap-1.5 mt-1" aria-label={`Pipeline status: ${link.status}`}>
                              {['pending', 'parsing', 'enriching'].map((stage, index) => {
                                const current = link.status === 'pending' ? 0 : link.status === 'parsing' ? 1 : 2;
                                return <span key={stage} className="h-1 flex-1 rounded-full" style={{ background: index <= current ? 'var(--lime)' : 'rgba(255,255,255,.08)', opacity: index < current ? .55 : 1 }} />;
                              })}
                            </div>
                            <p className="text-[9px] font-black uppercase tracking-widest text-zinc-600 mt-1">{link.status === 'pending' ? 'Queued' : link.status === 'parsing' ? 'Reading content' : 'AI analysis'} · Capture</p>
                          </div>
                          <i className="fa-solid fa-spinner fa-spin text-[10px] shrink-0" style={{ color: 'var(--lime)' }}></i>
                        </div>
                        ))}
                      </>
                    )}
                    {processingLinks.length === 0 && (
                      <div className="h-full flex flex-col items-center justify-center text-center space-y-3 opacity-40">
                        <i className="fa-solid fa-sparkles text-2xl text-zinc-600"></i>
                        <p className="text-[10px] font-black text-zinc-600 uppercase tracking-widest">Nothing processing</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              </Reveal>

              {/* Priority Vault Card - Grid Style */}
              <Reveal className="lg:col-span-4" delay={120}>
              <div className="bento-card spot p-8 flex flex-col shadow-2xl min-h-[400px] h-full" onMouseMove={spotlight}>
                <div className="flex items-center justify-between mb-8">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl border border-white/10 flex items-center justify-center text-black" style={{ background: 'var(--grad)' }}>
                      <i className="fa-solid fa-thumbtack text-xs"></i>
                    </div>
                    <span className="eyebrow">Priority Vault</span>
                  </div>
                  <span className="px-3 py-1 bg-white/5 rounded-full text-[10px] font-black text-zinc-600 uppercase tracking-widest">
                    {pinnedLinks.length} Items
                  </span>
                </div>

                <div className="flex-grow overflow-y-auto pr-2 no-scrollbar grid grid-cols-3 gap-4 content-start">
                  {pinnedLinks.length > 0 ? (
                    pinnedLinks.map(link => {
                      const tile = <>
                        <div className="w-[34px] h-[34px] rounded-xl bg-[#0A1320] border border-white/10 flex items-center justify-center overflow-hidden shrink-0 shadow-lg mb-2">
                          <img
                            src={link.favicon || `https://www.google.com/s2/favicons?sz=64&domain=${link.url}`}
                            alt=""
                            className="w-5 h-5 object-contain"
                            onError={(e) => (e.currentTarget.src = `https://ui-avatars.com/api/?name=${link.title}&background=0D1B2B&color=fff`)}
                          />
                        </div>
                        <p className="text-[10px] font-black text-zinc-400 truncate w-full uppercase tracking-tighter leading-tight">
                          {link.title}
                        </p>
                      </>;
                      const sharedProps = {
                        draggable: true,
                        onDragStart: () => handlePinnedDragStart(link.id),
                        onDragOver: (event: React.DragEvent) => event.preventDefault(),
                        onDrop: () => handlePinnedDrop(link.id),
                        className: 'group relative flex flex-col items-center justify-center p-3 bg-white/[0.02] rounded-2xl border border-white/[0.05] hover:bg-white/[0.05] hover:border-white/10 transition-all cursor-pointer text-center min-h-[80px]',
                      };
                      return link.kind === 'content' || link.savedVia === 'mobile' || link.savedVia === 'extension' ? (
                        <NavLink key={`pinned-mini-${link.id}`} to={`/item/${link.id}`} {...sharedProps}>{tile}</NavLink>
                      ) : (
                        <a key={`pinned-mini-${link.id}`} href={link.url} target="_blank" rel="noopener noreferrer" {...sharedProps}>{tile}</a>
                      );
                    })
                  ) : (
                    <div className="col-span-full h-full flex flex-col items-center justify-center text-center p-6 space-y-4 opacity-20">
                      <div className="w-12 h-12 rounded-full border border-dashed border-zinc-700 flex items-center justify-center">
                        <i className="fa-solid fa-plus text-zinc-700"></i>
                      </div>
                      <p className="text-[10px] font-black text-zinc-600 uppercase tracking-widest">Empty</p>
                    </div>
                  )}
                </div>

              </div>
              </Reveal>
            </div>

            {isVaultLoading ? (
              /* Skeletons — never claim "empty" while the vault is still loading */
              <div className="space-y-10">
                <div className="skeleton h-6 w-48"></div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-8">
                  {Array.from({ length: 8 }, (_, i) => (
                    <div key={`sk-${i}`} className="skeleton h-56 rounded-[1.25rem]"></div>
                  ))}
                </div>
              </div>
            ) : searchQuery.trim() ? (
              /* Search takes over the briefing */
              <div className="space-y-8">
                <div className="flex items-center gap-4">
                  <h2 className="text-xl font-black uppercase tracking-[0.3em] text-zinc-100 font-display">Search results</h2>
                  <div className="h-px flex-grow bg-white/5"></div>
                  <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest bg-white/5 px-3 py-1 rounded-full">{searchMatches.length} matches</span>
                </div>
                {searchMatches.length > 0 ? (
                  <div className="space-y-10">
                    {searchGroups.map(([key, groupLinks]) => (
                      <div key={key} className="space-y-4">
                        <div className="flex items-center gap-3">
                          <h3 className="text-[11px] font-black uppercase tracking-[0.25em] text-neon-accent">{SOURCE_LABELS[key] ?? key}</h3>
                          <span className="text-[10px] text-zinc-600 font-black">{groupLinks.length}</span>
                          <div className="h-px flex-grow bg-white/5"></div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-8">
                          {groupLinks.map(link => (
                            <LinkCard key={link.id} link={link} category={categories.find(c => c.id === link.categoryId)} categories={categories} onDelete={confirmDeleteLink} onTogglePin={togglePin} onToggleStar={toggleStarLink} onCycleReadStatus={cycleReadStatusLink} onUpdateLink={handleUpdateLink} onChangeCategory={handleCategoryChange} onRetry={handleRetryLink} />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="py-16 text-center space-y-3">
                    <i className="fa-solid fa-magnifying-glass text-3xl text-zinc-800"></i>
                    <p className="text-zinc-500 font-black uppercase tracking-widest text-xs">No matches in your vault</p>
                    <p className="text-zinc-700 text-[10px] font-bold">Try the Library search — it also looks inside article text.</p>
                  </div>
                )}
              </div>
            ) : stats.total === 0 ? (
              <div className="py-24 text-center space-y-4">
                <i className="fa-solid fa-box-open text-4xl text-zinc-800"></i>
                <div className="space-y-1">
                  <p className="text-zinc-500 font-black uppercase tracking-widest text-xs">No bookmarks yet</p>
                  <p className="text-zinc-700 text-[10px] font-bold">Save a website link and it lands here. Articles, videos and posts go to your Library.</p>
                </div>
              </div>
            ) : (
              /* The daily briefing: capped sections, user-reorderable (chevrons persist to localStorage) */
              <div className="space-y-14">
                {homeSectionOrder.map(sectionKey => {
                  // Hover-revealed up/down nudge controls shared by every section header.
                  const reorderControls = (
                    <span className="hover-reveal flex items-center gap-0.5 opacity-0 group-hover/sec:opacity-100 transition-opacity shrink-0">
                      <button onClick={() => moveHomeSection(sectionKey, -1)} className="w-7 h-7 grid place-items-center rounded-full text-zinc-600 hover:text-white hover:bg-white/5 transition-all" title="Move section up" aria-label="Move section up">
                        <i className="fa-solid fa-chevron-up text-[9px]"></i>
                      </button>
                      <button onClick={() => moveHomeSection(sectionKey, 1)} className="w-7 h-7 grid place-items-center rounded-full text-zinc-600 hover:text-white hover:bg-white/5 transition-all" title="Move section down" aria-label="Move section down">
                        <i className="fa-solid fa-chevron-down text-[9px]"></i>
                      </button>
                    </span>
                  );

                  switch (sectionKey) {
                    case 'phone': return phoneLinks.length > 0 && (
                      <Reveal key="sec-phone">
                        <section className="space-y-6 group/sec">
                          <div className="flex items-center gap-4">
                            <span className="eyebrow">From your phone</span>
                            {reorderControls}
                            <div className="h-px flex-grow bg-white/5"></div>
                            <NavLink to="/library?kind=mobile" className="text-[10px] font-black text-zinc-500 uppercase tracking-widest hover:text-white transition-colors">
                              View all <i className="fa-solid fa-arrow-right ml-1"></i>
                            </NavLink>
                          </div>
                          <div className="flex gap-4 overflow-x-auto no-scrollbar pb-2">
                            {phoneLinks.map(link => (
                              <NavLink
                                key={`phone-${link.id}`}
                                to={`/item/${link.id}`}
                                className="bento-card spot shrink-0 w-64 p-5 hover:border-white/10 transition-all group/phone"
                                onMouseMove={spotlight}
                              >
                                <div className="flex items-center gap-3 mb-3">
                                  <div className="w-9 h-9 rounded-xl bg-[#0A1320] border border-white/10 flex items-center justify-center overflow-hidden shrink-0">
                                    <img
                                      src={link.thumbnailUrl || link.favicon || `https://www.google.com/s2/favicons?sz=64&domain=${link.url}`}
                                      alt=""
                                      className={link.thumbnailUrl ? 'w-full h-full object-cover' : 'w-5 h-5 object-contain'}
                                      onError={(e) => (e.currentTarget.src = `https://ui-avatars.com/api/?name=${link.title}&background=0D1B2B&color=fff`)}
                                    />
                                  </div>
                                  <span className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-sky-300/80">
                                    <i className="fa-solid fa-mobile-screen text-[10px]"></i>{timeAgo(link.createdAt)} ago
                                  </span>
                                </div>
                                <p className="text-xs font-bold text-zinc-300 leading-snug line-clamp-2 group-hover/phone:text-[#A8CF38] transition-colors">{link.title}</p>
                              </NavLink>
                            ))}
                          </div>
                        </section>
                      </Reveal>
                    );

                    case 'continue': return continueReading.length > 0 && (
                      <Reveal key="sec-continue">
                        <section className="space-y-6 group/sec">
                          <div className="flex items-center gap-4">
                            <span className="eyebrow">Continue reading</span>
                            {reorderControls}
                            <div className="h-px flex-grow bg-white/5"></div>
                            {queueCollectionId && (
                              <NavLink to={`/collection/${queueCollectionId}`} className="text-[10px] font-black text-zinc-500 uppercase tracking-widest hover:text-white transition-colors">
                                Reading queue <i className="fa-solid fa-arrow-right ml-1"></i>
                              </NavLink>
                            )}
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                            {continueReading.map(link => (
                              <LinkCard key={link.id} link={link} category={categories.find(c => c.id === link.categoryId)} categories={categories} onDelete={confirmDeleteLink} onTogglePin={togglePin} onToggleStar={toggleStarLink} onCycleReadStatus={cycleReadStatusLink} onUpdateLink={handleUpdateLink} onChangeCategory={handleCategoryChange} onRetry={handleRetryLink} />
                            ))}
                          </div>
                        </section>
                      </Reveal>
                    );

                    case 'picks': return dailyPicks.length > 0 && (
                      <Reveal key="sec-picks">
                        <section className="space-y-6 group/sec">
                          <div className="flex items-center gap-4">
                            <span className="eyebrow">Today's picks — worth a re-read</span>
                            {reorderControls}
                            <div className="h-px flex-grow bg-white/5"></div>
                            {resurfaceCollectionId && (
                              <NavLink to={`/collection/${resurfaceCollectionId}`} className="text-[10px] font-black text-zinc-500 uppercase tracking-widest hover:text-white transition-colors">
                                View all <i className="fa-solid fa-arrow-right ml-1"></i>
                              </NavLink>
                            )}
                          </div>
                          <div className="flex gap-4 overflow-x-auto no-scrollbar pb-2">
                            {dailyPicks.slice(0, 5).map(link => (
                              <NavLink
                                key={`pick-${link.id}`}
                                to={`/item/${link.id}`}
                                className="bento-card spot shrink-0 w-72 p-5 hover:border-white/10 transition-all group/pick"
                                onMouseMove={spotlight}
                              >
                                <div className="flex items-center gap-3 mb-3">
                                  <div className="w-9 h-9 rounded-xl bg-[#0A1320] border border-white/10 flex items-center justify-center overflow-hidden shrink-0">
                                    <img
                                      src={link.favicon || `https://www.google.com/s2/favicons?sz=64&domain=${link.url}`}
                                      alt=""
                                      className="w-5 h-5 object-contain"
                                      onError={(e) => (e.currentTarget.src = `https://ui-avatars.com/api/?name=${link.title}&background=0D1B2B&color=fff`)}
                                    />
                                  </div>
                                  <span className="text-[10px] font-black uppercase tracking-widest text-zinc-600 font-mono-data">{timeAgo(link.createdAt)} old</span>
                                </div>
                                <p className="text-xs font-bold text-zinc-300 leading-snug line-clamp-2 group-hover/pick:text-white transition-colors">{link.title}</p>
                              </NavLink>
                            ))}
                          </div>
                        </section>
                      </Reveal>
                    );

                    case 'fresh': return latestContent.length > 0 && (
                      <Reveal key="sec-fresh">
                        <section className="space-y-6 group/sec">
                          <div className="flex items-center gap-4">
                            <span className="eyebrow">Fresh in your Library</span>
                            {reorderControls}
                            <div className="h-px flex-grow bg-white/5"></div>
                            <NavLink to="/library" className="text-[10px] font-black text-zinc-500 uppercase tracking-widest hover:text-white transition-colors">
                              Open Library {stats.library.toLocaleString()} <i className="fa-solid fa-arrow-right ml-1"></i>
                            </NavLink>
                          </div>
                          <p className="-mt-3 text-[11px] font-bold text-zinc-600 max-w-xl">Articles, videos and social posts — the readable stuff, summarized and searchable.</p>
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                            {latestContent.map(link => (
                              <LinkCard key={link.id} link={link} category={categories.find(c => c.id === link.categoryId)} categories={categories} onDelete={confirmDeleteLink} onTogglePin={togglePin} onToggleStar={toggleStarLink} onCycleReadStatus={cycleReadStatusLink} onUpdateLink={handleUpdateLink} onChangeCategory={handleCategoryChange} onRetry={handleRetryLink} />
                            ))}
                          </div>
                        </section>
                      </Reveal>
                    );

                    case 'bookmarked': return (
                      <Reveal key="sec-bookmarked">
                        <section className="space-y-6 group/sec">
                          <div className="flex items-center gap-4">
                            <span className="eyebrow">Recently bookmarked</span>
                            {reorderControls}
                            <div className="h-px flex-grow bg-white/5"></div>
                            <NavLink to="/library?kind=bookmark" className="text-[10px] font-black text-zinc-500 uppercase tracking-widest hover:text-white transition-colors">
                              View all {stats.total.toLocaleString()} <i className="fa-solid fa-arrow-right ml-1"></i>
                            </NavLink>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-8">
                            {recentlySaved.map(link => (
                              <LinkCard key={link.id} link={link} category={categories.find(c => c.id === link.categoryId)} categories={categories} onDelete={confirmDeleteLink} onTogglePin={togglePin} onToggleStar={toggleStarLink} onCycleReadStatus={cycleReadStatusLink} onUpdateLink={handleUpdateLink} onChangeCategory={handleCategoryChange} onRetry={handleRetryLink} />
                            ))}
                          </div>
                        </section>
                      </Reveal>
                    );

                    default: return null;
                  }
                })}
              </div>
            )}
          </>
          } />
          <Route path="/inbox" element={<LibraryLayout folders={folders} smartCollections={smartCollections} onDeleteSmartCollection={handleDeleteSmartCollection}>{renderLibrary('inbox')}</LibraryLayout>} />
          <Route path="/library" element={<LibraryLayout folders={folders} smartCollections={smartCollections} onDeleteSmartCollection={handleDeleteSmartCollection}>{renderLibrary('library')}</LibraryLayout>} />
          <Route path="/folder/:folderId" element={<LibraryLayout folders={folders} smartCollections={smartCollections} onDeleteSmartCollection={handleDeleteSmartCollection}>{renderLibrary('folder')}</LibraryLayout>} />
          <Route path="/collection/:collectionId" element={<LibraryLayout folders={folders} smartCollections={smartCollections} onDeleteSmartCollection={handleDeleteSmartCollection}>{renderLibrary('collection')}</LibraryLayout>} />
          <Route path="/item/:id" element={<ReaderView />} />
          <Route path="/settings" element={<SettingsView categories={categories} currentTheme={theme} onThemeChange={setTheme} onAddCategory={handleAddCategory} onUpdateCategory={handleUpdateCategory} onDeleteCategory={confirmDeleteCategory} onReorderCategories={handleReorderCategories} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </Suspense>
      </main>

      {/* Mobile bottom navigation — the pill nav above is desktop-only */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-[#0A1320]/85 backdrop-blur-xl border-t border-white/[0.06]" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="grid grid-cols-3">
          {([
            { to: '/', end: true, icon: 'fa-vault', label: 'Vault' },
            { to: '/library', end: false, icon: 'fa-book-open', label: 'Library' },
            { to: '/settings', end: false, icon: 'fa-sliders', label: 'Settings' },
          ] as const).map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => `flex flex-col items-center justify-center gap-1 py-3 min-h-[56px] transition-colors ${isActive ? '' : 'text-zinc-500 hover:text-zinc-300'}`}
              style={({ isActive }) => isActive ? { color: 'var(--lime)' } : undefined}
            >
              <i className={`fa-solid ${item.icon} text-base`}></i>
              <span className="text-[10px] font-black uppercase tracking-widest">{item.label}</span>
            </NavLink>
          ))}
        </div>
      </nav>

      <AddLinkModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} categories={categories} onAdd={addLink} />
      <ImportModal isOpen={isImportModalOpen} onClose={() => setIsImportModalOpen(false)} onImport={handleImport} existingCount={stats.total + stats.library} />
    </div>
  );
};

export default App;
