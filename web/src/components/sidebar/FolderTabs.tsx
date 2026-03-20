type ChatFilter = 'all' | 'groups' | 'direct';

interface Props {
  filter: ChatFilter;
  onFilterChange: (f: ChatFilter) => void;
  onNewGroup: () => void;
}

export function FolderTabs({ filter, onFilterChange, onNewGroup }: Props) {
  return (
    <div className="folderTabs">
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
    </div>
  );
}
