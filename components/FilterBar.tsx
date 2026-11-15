import React, { useEffect, useRef, useState } from 'react';
import { FilterState, SourceType } from '../types';

interface FilterBarProps {
  filter: FilterState;
  onChange: (filter: FilterState) => void;
  availableTags: string[];
  availableTopics: string[];
  onSaveAsSmartCollection: (name: string) => void;
}

const SOURCE_TYPES: SourceType[] = ['article', 'youtube', 'reel', 'tweet', 'pdf', 'reddit', 'podcast', 'other'];
const READ_STATUSES: NonNullable<FilterState['read_status']> = ['unread', 'reading', 'read'];
const SORTS: { value: NonNullable<FilterState['sort']>; label: string }[] = [
  { value: 'date_desc', label: 'Newest' },
  { value: 'date_asc', label: 'Oldest' },
  { value: 'title_asc', label: 'Title A-Z' },
];

function toggleInArray<T>(arr: T[] | undefined, value: T): T[] | undefined {
  const next = arr?.includes(value) ? arr.filter(v => v !== value) : [...(arr ?? []), value];
  return next.length ? next : undefined;
}

/** Multi-select dropdown: button with active count, checkbox-style option panel. */
const MultiDropdown: React.FC<{
  label: string;
  icon: string;
  options: string[];
  selected: string[];
  onToggle: (value: string) => void;
  extra?: React.ReactNode; // e.g. the Starred toggle appended to the Status panel
  extraActive?: boolean;
}> = ({ label, icon, options, selected, onToggle, extra, extraActive }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const activeCount = selected.length + (extraActive ? 1 : 0);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`flex items-center gap-2 px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-widest transition-all whitespace-nowrap border ${
          activeCount > 0
            ? 'bg-neon-accent/10 border-neon-accent/40 text-neon-accent'
            : 'bg-white/5 border-white/5 text-zinc-400 hover:text-white hover:bg-white/10'
        }`}
      >
        <i className={`fa-solid ${icon} text-[10px]`}></i>
        {label}
        {activeCount > 0 && (
          <span className="min-w-[16px] h-4 px-1 rounded-full bg-neon-accent text-black grid place-items-center text-[9px] font-black">{activeCount}</span>
        )}
        <i className={`fa-solid fa-chevron-down text-[8px] transition-transform ${open ? 'rotate-180' : ''}`}></i>
      </button>

      {open && (
        <div role="listbox" className="absolute left-0 top-full mt-2 z-30 min-w-[190px] bg-[#0D1B2B] border border-white/10 rounded-2xl p-1.5 shadow-2xl animate-in fade-in slide-in-from-top-1 duration-150">
          {options.map(opt => {
            const active = selected.includes(opt);
            return (
              <button
                key={opt}
                role="option"
                aria-selected={active}
                onClick={() => onToggle(opt)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-[11px] font-bold capitalize transition-colors text-left ${
                  active ? 'text-neon-accent bg-neon-accent/[0.07]' : 'text-zinc-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <span className={`w-4 h-4 rounded-md border grid place-items-center shrink-0 ${active ? 'bg-neon-accent border-neon-accent' : 'border-zinc-600'}`}>
                  {active && <i className="fa-solid fa-check text-[8px] text-black"></i>}
                </span>
                {opt}
              </button>
            );
          })}
          {extra}
        </div>
      )}
    </div>
  );
};

const FilterBar: React.FC<FilterBarProps> = ({ filter, onChange, availableTags, availableTopics, onSaveAsSmartCollection }) => {
  const [savingName, setSavingName] = useState<string | null>(null);

  const hasActiveFilters = !!(
    filter.source_type?.length || filter.read_status?.length || filter.tags?.length ||
    filter.topic || filter.is_starred
  );

  const submitSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!savingName?.trim()) return;
    onSaveAsSmartCollection(savingName.trim());
    setSavingName(null);
  };

  const selectClass =
    'bg-white/5 border border-white/5 rounded-full px-4 py-2 text-[10px] font-black uppercase tracking-widest text-zinc-400 focus:outline-none cursor-pointer';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <MultiDropdown
          label="Type"
          icon="fa-shapes"
          options={SOURCE_TYPES}
          selected={filter.source_type ?? []}
          onToggle={(type) => onChange({ ...filter, source_type: toggleInArray(filter.source_type, type as SourceType) })}
        />

        <MultiDropdown
          label="Status"
          icon="fa-circle-half-stroke"
          options={READ_STATUSES}
          selected={filter.read_status ?? []}
          onToggle={(status) => onChange({ ...filter, read_status: toggleInArray(filter.read_status, status as 'unread' | 'reading' | 'read') })}
          extraActive={!!filter.is_starred}
          extra={
            <>
              <div className="h-px bg-white/[0.06] mx-2 my-1"></div>
              <button
                role="option"
                aria-selected={!!filter.is_starred}
                onClick={() => onChange({ ...filter, is_starred: !filter.is_starred || undefined })}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-[11px] font-bold transition-colors text-left ${
                  filter.is_starred ? 'text-neon-accent bg-neon-accent/[0.07]' : 'text-zinc-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <span className={`w-4 h-4 rounded-md border grid place-items-center shrink-0 ${filter.is_starred ? 'bg-neon-accent border-neon-accent' : 'border-zinc-600'}`}>
                  {filter.is_starred && <i className="fa-solid fa-check text-[8px] text-black"></i>}
                </span>
                <i className="fa-solid fa-star text-[10px]"></i>Starred only
              </button>
            </>
          }
        />

        {availableTopics.length > 0 && (
          <select
            value={filter.topic || ''}
            onChange={(e) => onChange({ ...filter, topic: e.target.value || undefined })}
            className={selectClass}
            aria-label="Filter by topic"
          >
            <option value="">All topics</option>
            {availableTopics.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        )}

        <div className="ml-auto flex items-center gap-3">
          <select
            value={filter.sort || 'date_desc'}
            onChange={(e) => onChange({ ...filter, sort: e.target.value as FilterState['sort'] })}
            className={selectClass}
            aria-label="Sort order"
          >
            {SORTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>

          {hasActiveFilters && (
            savingName === null ? (
              <button
                onClick={() => setSavingName('')}
                className="px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-widest bg-white/5 text-zinc-400 hover:text-white hover:bg-white/10 transition-all whitespace-nowrap"
              >
                <i className="fa-solid fa-bookmark mr-1.5 text-[10px]"></i>Save as Smart Collection
              </button>
            ) : (
              <form onSubmit={submitSave} className="flex items-center gap-2">
                <input
                  autoFocus
                  value={savingName}
                  onChange={(e) => setSavingName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Escape' && setSavingName(null)}
                  placeholder="Collection name"
                  className="bg-white/5 border border-white/10 rounded-full px-4 py-2 text-[10px] font-bold text-white focus:outline-none focus:ring-1 focus:ring-neon-accent w-40"
                />
                <button type="submit" className="px-3 py-2 rounded-full bg-neon-accent text-black text-[10px] font-black uppercase">Save</button>
                <button type="button" onClick={() => setSavingName(null)} className="px-3 py-2 text-zinc-600 hover:text-white text-[10px] font-black uppercase">Cancel</button>
              </form>
            )
          )}
        </div>
      </div>

      {/* Tags stay as inline chips (fast multi-toggle, good scannability) */}
      {availableTags.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {availableTags.slice(0, 24).map(tag => (
            <button key={tag} onClick={() => onChange({ ...filter, tags: toggleInArray(filter.tags, tag) })}
              className={`px-3 py-1 rounded-full text-[10px] font-bold lowercase tracking-wide transition-all ${
                filter.tags?.includes(tag) ? 'bg-neon-accent text-black' : 'bg-white/[0.04] text-zinc-500 hover:text-white'
              }`}>
              #{tag}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default FilterBar;
