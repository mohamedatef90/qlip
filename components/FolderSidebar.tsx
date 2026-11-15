import React, { useMemo, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { Folder, SmartCollection } from '../types';

interface FolderSidebarProps {
  folders: Folder[];
  smartCollections: SmartCollection[];
  onDeleteSmartCollection: (id: string) => void;
}

interface FolderNode extends Folder {
  children: FolderNode[];
}

function buildTree(folders: Folder[]): FolderNode[] {
  const byId = new Map<string, FolderNode>(folders.map(f => [f.id, { ...f, children: [] }]));
  const roots: FolderNode[] = [];
  byId.forEach(node => {
    if (node.parent_id && byId.has(node.parent_id)) {
      byId.get(node.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  });
  return roots;
}

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-3 px-4 py-2.5 rounded-xl text-[11px] font-bold uppercase tracking-wider transition-all truncate ${
    isActive ? 'bg-neon-accent text-black' : 'text-zinc-500 hover:text-white hover:bg-white/5'
  }`;

const FolderRow: React.FC<{ node: FolderNode; depth: number }> = ({ node, depth }) => {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = node.children.length > 0;
  return (
    <div>
      <div className="flex items-center" style={{ paddingLeft: depth * 14 }}>
        {hasChildren ? (
          <button
            onClick={() => setExpanded(e => !e)}
            className="w-5 h-5 flex items-center justify-center text-zinc-600 hover:text-white shrink-0"
          >
            <i className={`fa-solid fa-chevron-right text-[10px] transition-transform ${expanded ? 'rotate-90' : ''}`}></i>
          </button>
        ) : (
          <span className="w-5 shrink-0" />
        )}
        <NavLink to={`/folder/${node.id}`} className={(p) => navLinkClass(p) + ' flex-grow'} style={{ minWidth: 0 }}>
          <i className={`fa-solid ${node.icon || 'fa-folder'} text-[10px] shrink-0`}></i>
          <span className="truncate">{node.name}</span>
        </NavLink>
      </div>
      {expanded && hasChildren && (
        <div className="mt-1 space-y-1">
          {node.children.map(child => <FolderRow key={child.id} node={child} depth={depth + 1} />)}
        </div>
      )}
    </div>
  );
};

const FolderSidebar: React.FC<FolderSidebarProps> = ({ folders, smartCollections, onDeleteSmartCollection }) => {
  const [collapsed, setCollapsed] = useState(false);

  const tree = useMemo(() => buildTree(folders), [folders]);
  const systemInbox = useMemo(() => smartCollections.find(c => c.query?.system === 'inbox'), [smartCollections]);
  const otherSystemCollections = useMemo(
    () => smartCollections.filter(c => c.is_system && c.query?.system !== 'inbox'),
    [smartCollections]
  );
  const userCollections = useMemo(() => smartCollections.filter(c => !c.is_system), [smartCollections]);

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        className="w-10 h-10 shrink-0 rounded-xl bg-[#0D1B2B] border border-white/[0.04] text-zinc-500 hover:text-white flex items-center justify-center self-start"
        title="Expand sidebar"
      >
        <i className="fa-solid fa-bars text-xs"></i>
      </button>
    );
  }

  return (
    <aside className="w-64 shrink-0 space-y-8">
      <div className="flex items-center justify-between px-1">
        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-600">Navigate</span>
        <button
          onClick={() => setCollapsed(true)}
          className="w-7 h-7 rounded-full text-zinc-600 hover:text-white hover:bg-white/5 flex items-center justify-center"
          title="Collapse sidebar"
        >
          <i className="fa-solid fa-angles-left text-[10px]"></i>
        </button>
      </div>

      <div className="space-y-1">
        {systemInbox && (
          <NavLink to="/inbox" className={navLinkClass}>
            <span>{systemInbox.icon}</span>
            <span className="truncate">{systemInbox.name}</span>
          </NavLink>
        )}
        <NavLink to="/library" className={navLinkClass}>
          <i className="fa-solid fa-layer-group text-[10px]"></i>
          <span>Library</span>
        </NavLink>
        {otherSystemCollections.map(c => (
          <NavLink key={c.id} to={`/collection/${c.id}`} className={navLinkClass}>
            <span>{c.icon}</span>
            <span className="truncate">{c.name}</span>
          </NavLink>
        ))}
      </div>

      <div className="space-y-3">
        <p className="px-4 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-700">Folders</p>
        <div className="space-y-1">
          {tree.length > 0 ? (
            tree.map(node => <FolderRow key={node.id} node={node} depth={0} />)
          ) : (
            <p className="px-4 text-[10px] text-zinc-700 font-bold">No folders yet</p>
          )}
        </div>
      </div>

      {userCollections.length > 0 && (
        <div className="space-y-3">
          <p className="px-4 text-[10px] font-black uppercase tracking-[0.2em] text-zinc-700">Smart Collections</p>
          <div className="space-y-1">
            {userCollections.map(c => (
              <div key={c.id} className="group flex items-center">
                <NavLink to={`/collection/${c.id}`} className={(p) => navLinkClass(p) + ' flex-grow'}>
                  <span>{c.icon || '🔎'}</span>
                  <span className="truncate">{c.name}</span>
                </NavLink>
                <button
                  onClick={() => onDeleteSmartCollection(c.id)}
                  className="hover-reveal w-8 h-8 shrink-0 text-zinc-700 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                  title="Delete smart collection"
                >
                  <i className="fa-solid fa-xmark text-[10px]"></i>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
};

export default FolderSidebar;
