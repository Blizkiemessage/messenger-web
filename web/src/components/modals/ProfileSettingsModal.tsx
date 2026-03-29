import { useState } from 'react';
import { type User } from '../../types';
import { ProfileTab }    from '../profile/ProfileTab';
import { PasswordTab }   from '../profile/PasswordTab';
import { PrivacyTab }    from '../profile/PrivacyTab';
import { AppearanceTab } from '../profile/AppearanceTab';

interface Props {
  me: User;
  token: string;
  onClose: () => void;
  onUpdate: (u: User) => void;
  onDeleteAccount: () => Promise<void>;
}

type Tab = 'profile' | 'password' | 'privacy' | 'appearance';

export function ProfileSettingsModal({ me, token, onClose, onUpdate, onDeleteAccount }: Props) {
  const [tab, setTab] = useState<Tab>('profile');

  // Step 1: first confirmation
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  // Step 2: username confirmation
  const [showDeleteUsername, setShowDeleteUsername] = useState(false);
  const [deleteInput, setDeleteInput]   = useState('');
  const [deleteError, setDeleteError]   = useState<string | null>(null);
  const [deleting,    setDeleting]      = useState(false);

  function openDeleteConfirm() {
    setShowDeleteConfirm(true);
    setShowDeleteUsername(false);
    setDeleteInput('');
    setDeleteError(null);
  }

  function proceedToUsernameStep() {
    setShowDeleteConfirm(false);
    setShowDeleteUsername(true);
    setDeleteInput('');
    setDeleteError(null);
  }

  function cancelDelete() {
    setShowDeleteConfirm(false);
    setShowDeleteUsername(false);
    setDeleteInput('');
    setDeleteError(null);
  }

  async function confirmDeleteWithUsername() {
    if (deleteInput.trim().toLowerCase() !== (me.username ?? '').toLowerCase()) {
      setDeleteError('Неверный username');
      return;
    }
    setDeleting(true);
    setDeleteError(null);
    try {
      await onDeleteAccount();
    } catch {
      setDeleting(false);
      setDeleteError('Ошибка при удалении. Попробуйте снова.');
    }
  }

  return (
    <div className="modalOverlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="psCard">
        <div className="psHeader">
          <div className="psTitle">Настройки профиля</div>
          <button className="modalClose" onClick={onClose}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div className="psTabs">
          <button className={`psTab${tab === 'profile'    ? ' active' : ''}`} onClick={() => setTab('profile')}>Профиль</button>
          <button className={`psTab${tab === 'password'   ? ' active' : ''}`} onClick={() => setTab('password')}>Пароль</button>
          <button className={`psTab${tab === 'privacy'    ? ' active' : ''}`} onClick={() => setTab('privacy')}>Конфиденциальность</button>
          <button className={`psTab${tab === 'appearance' ? ' active' : ''}`} onClick={() => setTab('appearance')}>Внешний вид</button>
        </div>

        {tab === 'profile'    && <ProfileTab    me={me} token={token} onUpdate={onUpdate} />}
        {tab === 'password'   && <PasswordTab   me={me} onUpdate={onUpdate} />}
        {tab === 'privacy'    && <PrivacyTab    me={me} onUpdate={onUpdate} />}
        {tab === 'appearance' && <AppearanceTab />}

        <div className="psDeleteSection">
          <button className="psDeleteBtn" onClick={openDeleteConfirm}>
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

      {/* Step 1 — warning confirmation */}
      {showDeleteConfirm && (
        <div className="modalOverlay" style={{ zIndex: 10200 }}
          onClick={e => e.target === e.currentTarget && cancelDelete()}>
          <div className="confirmCard">
            <div className="confirmIcon" style={{ color: 'var(--danger)' }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
            </div>
            <div className="confirmTitle">Удалить аккаунт?</div>
            <div className="confirmText">
              Это действие необратимо. Все ваши личные чаты будут удалены, вы покинете все группы,
              а ваш никнейм освободится.
            </div>
            <div className="confirmBtns">
              <button className="psDeleteCancelBtn" onClick={cancelDelete}>Отмена</button>
              <button className="psDeleteConfirmBtn" onClick={proceedToUsernameStep}>
                Продолжить
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Step 2 — type username to confirm */}
      {showDeleteUsername && (
        <div className="modalOverlay" style={{ zIndex: 10200 }}
          onClick={e => e.target === e.currentTarget && !deleting && cancelDelete()}>
          <div className="confirmCard" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div className="confirmIcon" style={{ color: 'var(--danger)' }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                <path d="M10 11v6M14 11v6"/>
                <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
              </svg>
            </div>
            <div className="confirmTitle">Подтвердите удаление</div>
            <div className="confirmText" style={{ marginBottom: 0 }}>
              Введите ваш username <strong>@{me.username}</strong> для подтверждения
            </div>
            <input
              className="authInput"
              value={deleteInput}
              onChange={e => { setDeleteInput(e.target.value); setDeleteError(null); }}
              placeholder={me.username ?? 'username'}
              autoFocus
              disabled={deleting}
              onKeyDown={e => { if (e.key === 'Enter' && !deleting) confirmDeleteWithUsername(); }}
            />
            {deleteError && <div className="authError">{deleteError}</div>}
            <div className="confirmBtns">
              <button className="psDeleteCancelBtn" onClick={cancelDelete} disabled={deleting}>Отмена</button>
              <button
                className="psDeleteConfirmBtn"
                disabled={deleting || !deleteInput.trim()}
                onClick={confirmDeleteWithUsername}
              >
                {deleting ? '…' : 'Удалить навсегда'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
