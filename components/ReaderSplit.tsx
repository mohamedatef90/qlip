// Readwise-Reader-style split pane for the Library: compact article list on the
// left, full article + metadata rail on the right. j/k moves the selection.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { api } from '../services/api';
import { ContentItem } from '../types';

interface ReaderSplitProps {
  items: ContentItem[];
  onToggleStar: (id: string) => void;
  onCycleReadStatus: (id: string) => void;
}

const timeAgo = (iso: string): string => {
  const s = Math.max(1, Math.floor((Date.now() - Date.parse(iso)) / 1000));
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
};

const SOURCE_LABEL: Record<string, string> = {
  article: 'Article', youtube: 'YouTube', reel: 'Reel', tweet: 'Tweet',
  pdf: 'PDF', reddit: 'Reddit', podcast: 'Podcast', other: 'Link',
};

const READ_LABEL = { unread: 'Unread', reading: 'Reading', read: 'Read' } as const;

const ReaderSplit: React.FC<ReaderSplitProps> = ({ items, onToggleStar, onCycleReadStatus }) => {
  const [selectedId, setSelectedId] = useState<string | null>(items[0]?.id ?? null);
  const [detail, setDetail] = useState<ContentItem | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  // Keep a valid selection when the item set changes (filters, refresh).
  useEffect(() => {
    if (items.length === 0) { setSelectedId(null); return; }
    if (!selectedId || !items.some(i => i.id === selectedId)) setSelectedId(items[0].id);
  }, [items]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch the full row (content_text) for the selected item.
  useEffect(() => {
    if (!selectedId) { setDetail(null); return; }
    let cancelled = false;
    setDetailLoading(true);
    api.items.fetchOne(selectedId)
      .then(d => { if (!cancelled) setDetail(d); })
      .catch(() => { if (!cancelled) setDetail(null); })
      .finally(() => { if (!cancelled) setDetailLoading(false); });
    return () => { cancelled = true; };
  }, [selectedId]);

  // j / k keyboard navigation (skipped while typing in an input).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
      if (e.key !== 'j' && e.key !== 'k') return;
      e.preventDefault();
      const idx = items.findIndex(i => i.id === selectedId);
      const next = e.key === 'j' ? Math.min(idx + 1, items.length - 1) : Math.max(idx - 1, 0);
      if (next !== idx && items[next]) {
        setSelectedId(items[next].id);
        listRef.current?.querySelector(`[data-item="${items[next].id}"]`)
          ?.scrollIntoView({ block: 'nearest' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [items, selectedId]);

  const selected = useMemo(
    () => items.find(i => i.id === selectedId) ?? null,
    [items, selectedId]
  );

  const words = detail?.content_text ? detail.content_text.trim().split(/\s+/).length : null;
  const readMins = words ? Math.max(1, Math.round(words / 238)) : null;
  const paragraphs = useMemo(
    () => (detail?.content_text ?? '').split(/\n{2,}|\r\n{2,}/).map(p => p.trim()).filter(Boolean),
    [detail?.content_text]
  );

  if (items.length === 0) return null;

  return (
    <div className="bento-card overflow-hidden flex h-[calc(100vh-16rem)] min-h-[480px]">
      {/* List pane */}
      <div ref={listRef} className="w-80 shrink-0 border-r border-white/5 overflow-y-auto no-scrollbar">
        {items.map(item => {
          const active = item.id === selectedId;
          return (
            <button
              key={item.id}
              data-item={item.id}
              onClick={() => setSelectedId(item.id)}
              className={`w-full text-left px-5 py-4 border-b border-white/[0.03] transition-colors ${active ? 'bg-white/[0.06]' : 'hover:bg-white/[0.03]'}`}
            >
              <div className="flex items-start gap-3">
                {item.read_status === 'unread' && (
                  <span className="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0" style={{ background: 'var(--grad)' }}></span>
                )}
                <div className="min-w-0">
                  <p className={`text-xs font-bold leading-snug line-clamp-2 ${active ? 'text-white' : 'text-zinc-300'}`}>
                    {item.title || item.url}
                  </p>
                  <div className="flex items-center gap-2 mt-1.5 text-[10px] font-black uppercase tracking-widest text-zinc-600">
                    <img
                      src={item.favicon_url || `https://www.google.com/s2/favicons?sz=32&domain=${item.url}`}
                      alt="" className="w-3 h-3 rounded-sm"
                      onError={(e) => (e.currentTarget.style.display = 'none')}
                    />
                    <span className="truncate">{item.site_name || SOURCE_LABEL[item.source_type]}</span>
                    <span>·</span>
                    <span>{timeAgo(item.created_at)}</span>
                    {item.is_starred && <i className="fa-solid fa-star text-[8px]" style={{ color: 'var(--lime)' }}></i>}
                  </div>
                </div>
              </div>
            </button>
          );
        })}
        <p className="px-5 py-4 text-[10px] font-black uppercase tracking-widest text-zinc-700 text-center">
          j / k to navigate
        </p>
      </div>

      {/* Detail pane */}
      <div className="flex-grow overflow-y-auto min-w-0">
        {!selected ? null : (
          <div className="max-w-2xl mx-auto px-10 py-10 space-y-8">
            {/* Metadata header */}
            <div className="space-y-4">
              <div className="flex items-center gap-2 flex-wrap text-[10px] font-black uppercase tracking-widest text-zinc-500">
                <span className="px-2.5 py-1 rounded-full border border-white/10 bg-white/[0.03]">{SOURCE_LABEL[selected.source_type]}</span>
                {selected.topic && <span className="px-2.5 py-1 rounded-full border" style={{ color: 'var(--lime)', borderColor: 'rgba(168,207,56,.3)', background: 'rgba(168,207,56,.06)' }}>{selected.topic}</span>}
                {selected.site_name && <span>{selected.site_name}</span>}
                {detail?.published_at && <span>· {new Date(detail.published_at).toLocaleDateString()}</span>}
                {readMins && <span>· {readMins} min read</span>}
                {words && <span>· {words.toLocaleString()} words</span>}
              </div>
              <h2 className="text-3xl font-black tracking-tight leading-tight">{selected.title || selected.url}</h2>
              <div className="flex items-center gap-3">
                <button onClick={() => onCycleReadStatus(selected.id)} className="px-4 py-2 rounded-full border border-white/10 bg-white/[0.03] text-[10px] font-black uppercase tracking-widest text-zinc-400 hover:text-white transition-colors">
                  <i className={`fa-solid ${selected.read_status === 'read' ? 'fa-circle-check' : selected.read_status === 'reading' ? 'fa-book-open' : 'fa-circle'} mr-2`}></i>
                  {READ_LABEL[selected.read_status]}
                </button>
                <button onClick={() => onToggleStar(selected.id)} className={`px-4 py-2 rounded-full border text-[10px] font-black uppercase tracking-widest transition-colors ${selected.is_starred ? 'border-transparent text-black' : 'border-white/10 bg-white/[0.03] text-zinc-400 hover:text-white'}`} style={selected.is_starred ? { background: 'var(--grad)' } : undefined}>
                  <i className={`fa-${selected.is_starred ? 'solid' : 'regular'} fa-star mr-2`}></i>
                  {selected.is_starred ? 'Starred' : 'Star'}
                </button>
                <NavLink to={`/item/${selected.id}`} className="px-4 py-2 rounded-full border border-white/10 bg-white/[0.03] text-[10px] font-black uppercase tracking-widest text-zinc-400 hover:text-white transition-colors">
                  <i className="fa-solid fa-book-open-reader mr-2"></i>Full reader
                </NavLink>
                <a href={selected.url} target="_blank" rel="noopener noreferrer" className="px-4 py-2 rounded-full border border-white/10 bg-white/[0.03] text-[10px] font-black uppercase tracking-widest text-zinc-400 hover:text-white transition-colors">
                  <i className="fa-solid fa-arrow-up-right-from-square mr-2"></i>Original
                </a>
              </div>
              {(selected.tags?.length ?? 0) > 0 && (
                <div className="flex items-center gap-2 flex-wrap">
                  {selected.tags.map(t => (
                    <span key={t} className="px-2.5 py-1 rounded-full bg-white/[0.04] border border-white/[0.06] text-[10px] font-bold text-zinc-500">#{t}</span>
                  ))}
                </div>
              )}
            </div>

            {/* AI summary + key points */}
            {(selected.summary || (selected.key_points?.length ?? 0) > 0) && (
              <div className="rounded-2xl border border-white/[0.06] bg-[#0D1B2B]/60 p-6 space-y-4">
                {selected.summary && (
                  <div>
                    <p className="eyebrow mb-3">AI Summary</p>
                    <p className="text-sm text-zinc-300 leading-relaxed">{selected.summary}</p>
                  </div>
                )}
                {(selected.key_points?.length ?? 0) > 0 && (
                  <ul className="space-y-2">
                    {selected.key_points!.map((kp, i) => (
                      <li key={i} className="flex items-start gap-3 text-sm text-zinc-400 leading-relaxed">
                        <span className="mt-2 w-1.5 h-1.5 rounded-full shrink-0" style={{ background: 'var(--grad)' }}></span>
                        {kp}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {/* Content */}
            {detailLoading ? (
              <div className="py-16 flex justify-center">
                <div className="w-8 h-8 border-4 border-neon-accent/10 border-t-neon-accent rounded-full animate-spin"></div>
              </div>
            ) : paragraphs.length > 0 ? (
              <div className="space-y-5 pb-16">
                {paragraphs.map((p, i) => (
                  <p key={i} className="text-[15px] leading-[1.8] text-[#C5D2E2]">{p}</p>
                ))}
              </div>
            ) : (
              <p className="text-xs text-zinc-600 font-bold uppercase tracking-widest py-8">
                No extracted text — open the original link above.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default ReaderSplit;
