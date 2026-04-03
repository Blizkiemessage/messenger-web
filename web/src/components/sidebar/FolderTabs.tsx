import { useRef } from 'react';

type ChatFilter = 'all' | 'groups' | 'direct';

interface Props {
  filter: ChatFilter;
  onFilterChange: (f: ChatFilter) => void;
  onNewGroup: () => void;
  onSavedMessages: () => void;
}

export function FolderTabs({ filter, onFilterChange, onNewGroup, onSavedMessages }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef({ active: false, startX: 0, scrollLeft: 0 });

  const onMouseDown = (e: React.MouseEvent) => {
    const el = ref.current;
    if (!el) return;
    drag.current = { active: true, startX: e.pageX - el.offsetLeft, scrollLeft: el.scrollLeft };
    el.classList.add('dragging');
  };

  const onMouseMove = (e: React.MouseEvent) => {
    if (!drag.current.active) return;
    const el = ref.current;
    if (!el) return;
    e.preventDefault();
    el.scrollLeft = drag.current.scrollLeft - (e.pageX - el.offsetLeft - drag.current.startX);
  };

  const stopDrag = () => {
    drag.current.active = false;
    ref.current?.classList.remove('dragging');
  };

  return (
    <div
      ref={ref}
      className="folderTabs"
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={stopDrag}
      onMouseLeave={stopDrag}
    >
      {(['all', 'direct', 'groups'] as const).map(f => (
        <button
          key={f}
          className={`folderTab${filter === f ? ' active' : ''}`}
          onClick={() => onFilterChange(f)}
        >
          {f === 'all' ? 'Общее' : f === 'direct' ? 'Личные' : 'Группы'}
        </button>
      ))}
      <button className="newGroupBtn" onClick={onNewGroup}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <line x1="12" y1="5" x2="12" y2="19"/>
          <line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
        <span>Группа</span>
      </button>
      <button className="newGroupBtn savedBtn" onClick={onSavedMessages} title="Сохранённые сообщения">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
        </svg>
        <span>Заметки</span>
      </button>
    </div>
  );
}
