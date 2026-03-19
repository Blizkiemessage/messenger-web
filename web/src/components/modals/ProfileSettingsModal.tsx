/**
 * ProfileSettingsModal
 *
 * Wrapper: tabs + delete-account button.
 * Each tab is its own component in components/profile/.
 */
import { useState } from 'react';
import { type User } from '../../types';
import { ProfileTab } from '../profile/ProfileTab';
import { PasswordTab } from '../profile/PasswordTab';
import { PrivacyTab } from '../profile/PrivacyTab';

interface Props {
  me: User;
  token: string;
  onClose: () => void;
  onUpdate: (u: User) => void;
  onDeleteAccount: () => Promise<void>;
}

export function ProfileSettingsModal({ me, token, onClose, onUpdate, onDeleteAccount }: Props) {
  const [tab, setTab] = useState<'profile' | 'password' | 'privacy'>('profile');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);

  return (
    <div className="modalOverlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="psCard">
        {/* Header */}
        <div className="psHeader">
          <div className="psTitle">Настройки профиля</div>
          <button className="modalClose" onClick={onClose}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="psTabs">
          <button className={`psTab${tab === 'profile'  ? ' active' : ''}`} onClick={() => setTab('profile')}>Профиль</button>
          <button className={`psTab${tab === 'password' ? ' active' : ''}`} onClick={() => setTab('password')}>Пароль</button>
          <button className={`psTab${tab === 'privacy'  ? ' active' : ''}`} onClick={() => setTab('privacy')}>Конфиденциальность</button>
        </div>

        {/* Tab content */}
        {tab === 'profile'  && <ProfileTab  me={me} token={token} onUpdate={onUpdate} />}
        {tab === 'password' && <PasswordTab me={me} onUpdate={onUpdate} />}
        {tab === 'privacy'  && <PrivacyTab  me={me} onUpdate={onUpdate} />}

        {/* Delete account */}
        <div className="psDeleteSection">
          <button className="psDeleteBtn" onClick={() => setShowDeleteConfirm(true)}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
              <path d="M10 11v6M14 11v6"/>
              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
            </svg>
            Удалить аккаунт
          </button>
        </div>
      </div>

      {/* Delete confirmation dialog */}
      {showDeleteConfirm && (
        <div className="modalOverlay" style={{ zIndex: 10200 }}
          onClick={e => e.target === e.currentTarget && !deleting && setShowDeleteConfirm(false)}>
          <div className="confirmCard">
            <div className="confirmIcon" style={{ color: 'var(--danger, #f87171)' }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
            </div>
            <div className="confirmTitle">Удалить аккаунт?</div>
            <div className="confirmText">
              Это действие необратимо. Все ваши личные чаты будут удалены, вы покинете все группы,
              а ваш никнейм освободится. Восстановить аккаунт будет невозможно.
            </div>
            <div className="confirmBtns">
              <button className="psDeleteCancelBtn" onClick={() => setShowDeleteConfirm(false)} disabled={deleting}>Отмена</button>
              <button className="psDeleteConfirmBtn" disabled={deleting} onClick={async () => {
                setDeleting(true);
                try { await onDeleteAccount(); }
                catch { setDeleting(false); }
              }}>
                {deleting ? '…' : 'Удалить навсегда'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
