import { useRef, useState, useEffect } from 'react';
import { type ChatFolder } from '../../types';

interface Props {
  activeFilter: string;
  folders: ChatFolder[];
  onFilterChange: (f: string) => void;
  onNewGroup: () => void;
  onSavedMessages: () => void;
  onCreateFolder: () => void;
  onEditFolder: (folder: ChatFolder) => void;
}

const BUILT_IN = [
  { id: 'all',    label: 'Все' },
  { id: 'direct', label: 'Личные' },
  { id: 'groups', label: 'Группы' },
] as const;

export function FolderTabs({
  activeFilter, folders, onFilterChange, onNewGroup, onSavedMessages, onCreateFolder, onEditFolder,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const drag = useRef({ active: false, startX: 0, scrollLeft: 0 });
  const [showActions, setShowActions] = useState(false);
  const actionsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showActions) return;
    function handleOutside(e: MouseEvent) {
      if (actionsRef.current && !actionsRef.current.contains(e.target as Node)) {
        setShowActions(false);
      }
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [showActions]);

  const onMouseDown = (e: React.MouseEvent) => {
    const el = scrollRef.current;
    if (!el) return;
    drag.current = { active: true, startX: e.pageX - el.offsetLeft, scrollLeft: el.scrollLeft };
    el.classList.add('dragging');
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (!drag.current.active) return;
    const el = scrollRef.current;
    if (!el) return;
    e.preventDefault();
    el.scrollLeft = drag.current.scrollLeft - (e.pageX - el.offsetLeft - drag.current.startX);
  };
  const stopDrag = () => {
    drag.current.active = false;
    scrollRef.current?.classList.remove('dragging');
  };

  const toggleActions = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowActions(v => !v);
  };

  return (
    <div className="folderTabsWrap">
      {/* Scrollable tabs */}
      <div
        ref={scrollRef}
        className="folderTabsScroll"
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={stopDrag}
        onMouseLeave={stopDrag}
      >
        {/* Built-in filters */}
        {BUILT_IN.map(({ id, label }) => (
          <button
            key={id}
            className={`folderTab${activeFilter === id ? ' active' : ''}`}
            onClick={() => onFilterChange(id)}
          >
            {label}
          </button>
        ))}

        {/* Custom folders */}
        {folders.map(folder => {
          const fKey = `folder:${folder.id}`;
          return (
            <button
              key={folder.id}
              className={`folderTab folderTabCustom${activeFilter === fKey ? ' active' : ''}`}
              onClick={() => onFilterChange(fKey)}
              onContextMenu={e => { e.preventDefault(); onEditFolder(folder); }}
              title={folder.name}
            >
              <span className="folderTabEmoji">{folder.emoji}</span>
              <span className="folderTabName">{folder.name}</span>
            </button>
          );
        })}

        {/* Add folder button */}
        <button className="folderAddBtn" onClick={onCreateFolder} title="Создать папку">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19"/>
            <line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
        </button>
      </div>

      {/* Actions button (compose) */}
      <div className="folderTabsAside" ref={actionsRef}>
        <button
          className={`sidebarComposeBtn${showActions ? ' active' : ''}`}
          onClick={toggleActions}
          title="Действия"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </button>

        {showActions && (
          <div className="sidebarComposeMenu">
            <button
              className="sidebarComposeItem"
              onClick={() => { setShowActions(false); onNewGroup(); }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                <circle cx="9" cy="7" r="4"/>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>
              </svg>
              Новая группа
            </button>
            <button
              className="sidebarComposeItem"
              onClick={() => { setShowActions(false); onSavedMessages(); }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
              </svg>
              Сохранённые
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
