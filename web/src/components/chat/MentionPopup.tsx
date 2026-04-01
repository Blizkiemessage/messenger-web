import { type User } from '../../types';
import { Avatar } from '../ui/Avatar';

interface Props {
  members: User[];
  filter: string;
  activeIdx: number;
  onSelect: (username: string) => void;
}

export function MentionPopup({ members, filter, activeIdx, onSelect }: Props) {
  const filtered = members
    .filter(m => {
      if (!m.username) return false;
      const q = filter.toLowerCase();
      return (m.username ?? '').toLowerCase().includes(q)
          || (m.display_name ?? '').toLowerCase().includes(q);
    })
    .slice(0, 8);

  if (filtered.length === 0) return null;

  return (
    <div className="mentionPopup">
      {filtered.map((m, i) => (
        <div
          key={m.id}
          className={`mentionPopupItem${i === activeIdx ? ' mentionPopupItemActive' : ''}`}
          onMouseDown={e => { e.preventDefault(); onSelect(m.username!); }}
        >
          <Avatar user={m} size={30} radius={8} />
          <div>
            <div className="mentionPopupName">{m.display_name || m.username}</div>
            {m.display_name && <div className="mentionPopupUser">@{m.username}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}
