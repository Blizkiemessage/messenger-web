import { useEffect, useState } from 'react';
import { type User } from '../../types';
import { avatarLetter, formatBirthDate } from '../../utils/format';
import { getUserById } from '../../api/users';

interface Props {
  userId: string;
  onClose: () => void;
  onStartChat?: (u: User) => void;
}

export function UserProfileModal({ userId, onClose, onStartChat }: Props) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getUserById(userId)
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, [userId]);

  return (
    <div className="modalOverlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="profileViewCard">
        <button className="pvCloseBtn" onClick={onClose}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
        {loading ? (
          <div className="pvLoading">Загрузка…</div>
        ) : !user ? (
          <div className="pvLoading">Пользователь не найден</div>
        ) : (
          <>
            <div className="pvHeader">
              <div className="pvAvatarWrap">
                {user.avatar_url
                  ? <img src={user.avatar_url} alt="" className="pvAvatarImg" />
                  : <div className="pvAvatarFallback">{avatarLetter(user.display_name || user.username || '')}</div>
                }
              </div>
              <div className="pvName">{user.display_name || user.username}</div>
              {user.username && <div className="pvUsername">@{user.username}</div>}
            </div>
            <div className="pvBody">
              {user.bio && (
                <div className="pvField">
                  <div className="pvFieldLabel">О себе</div>
                  <div className="pvFieldValue">{user.bio}</div>
                </div>
              )}
              {user.birth_date && (
                <div className="pvField">
                  <div className="pvFieldLabel">Дата рождения</div>
                  <div className="pvFieldValue">{formatBirthDate(user.birth_date)}</div>
                </div>
              )}
              {!user.bio && !user.birth_date && <div className="pvEmpty">Профиль пуст</div>}
            </div>
            {onStartChat && (
              <div className="pvFooter">
                <button className="pvChatBtn" onClick={() => { onStartChat(user); onClose(); }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                  </svg>
                  Написать сообщение
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
