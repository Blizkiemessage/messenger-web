/**
 * UserProfileModal — redesigned to match the sidebar popup aesthetic.
 */
import { useEffect, useState } from 'react';
import { type User } from '../../types';
import { avatarLetter, formatBirthDate } from '../../utils/format';
import { resolveUrl } from '../ui/Avatar';
import { getUserById } from '../../api/users';

interface Props {
  userId: string;
  onClose: () => void;
  onStartChat?: (u: User) => void;
}

export function UserProfileModal({ userId, onClose, onStartChat }: Props) {
  const [user,    setUser]    = useState<User | null>(null);
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
      <div className="upCard">
        {/* Close */}
        <button className="upCloseBtn" onClick={onClose}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>

        {loading ? (
          <div className="upLoading">Загрузка…</div>
        ) : !user ? (
          <div className="upLoading">Пользователь не найден</div>
        ) : (
          <>
            {/* Header */}
            <div className="upHeader">
              <div className="upAvatarRing">
                <div className="upAvatar">
                  {resolveUrl(user.avatar_url)
                    ? <img src={resolveUrl(user.avatar_url)!} alt="" className="upAvatarImg" />
                    : <span className="upAvatarLetter">{avatarLetter(user.display_name || user.username || '')}</span>
                  }
                </div>
              </div>
              <div className="upName">{user.display_name || user.username}</div>
              {user.username && <div className="upUsername">@{user.username}</div>}
            </div>

            {/* Info rows */}
            {(user.email || user.bio || user.birth_date) && (
              <div className="upInfoSection">
                {user.email && (
                  <div className="upInfoRow">
                    <span className="upInfoIcon">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                        <polyline points="22,6 12,13 2,6"/>
                      </svg>
                    </span>
                    <div className="upInfoContent">
                      <div className="upInfoLabel">Почта</div>
                      <div className="upInfoValue">{user.email}</div>
                    </div>
                  </div>
                )}
                {user.bio && (
                  <div className="upInfoRow">
                    <span className="upInfoIcon">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                        <circle cx="12" cy="7" r="4"/>
                      </svg>
                    </span>
                    <div className="upInfoContent">
                      <div className="upInfoLabel">О себе</div>
                      <div className="upInfoValue">{user.bio}</div>
                    </div>
                  </div>
                )}
                {user.birth_date && (
                  <div className="upInfoRow">
                    <span className="upInfoIcon">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                        <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>
                        <line x1="3" y1="10" x2="21" y2="10"/>
                      </svg>
                    </span>
                    <div className="upInfoContent">
                      <div className="upInfoLabel">Дата рождения</div>
                      <div className="upInfoValue">{formatBirthDate(user.birth_date)}</div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Action */}
            {onStartChat && (
              <div className="upFooter">
                <button className="upChatBtn" onClick={() => { onStartChat(user); onClose(); }}>
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
