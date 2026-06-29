import { useState, type ReactNode } from 'react';
import { type User } from '../../types';
import { avatarLetter } from '../../utils/format';
import { resolveUrl }   from '../ui/Avatar';
import { ProfileTab }          from '../profile/ProfileTab';
import { PasswordSecurityTab } from '../profile/PasswordSecurityTab';
import { PrivacyTab }          from '../profile/PrivacyTab';
import { AppearanceTab }       from '../profile/AppearanceTab';
import { SessionsTab }         from '../profile/SessionsTab';
import { PermissionsTab }      from '../profile/PermissionsTab';
import { ExportDataTab }       from '../profile/ExportDataTab';

interface Props {
  me: User;
  onClose: () => void;
  onUpdate: (u: User) => void;
  onDeleteAccount: () => Promise<void>;
}

type Tab = 'profile' | 'password' | 'privacy' | 'appearance' | 'sessions' | 'permissions' | 'export';

interface MenuItem {
  id: Tab;
  label: string;
  icon: ReactNode;
}

interface MenuSection {
  title: string;
  items: MenuItem[];
}

// Монохромные иконки (в цвет текста, без рамок/фона); сгруппированы по секциям.
// Пункт «Профиль» убран из списка — его роль выполняет карточка аккаунта сверху.
const MENU_SECTIONS: MenuSection[] = [
  {
    title: 'Аккаунт и безопасность',
    items: [
      {
        id: 'privacy',
        label: 'Конфиденциальность',
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
          </svg>
        ),
      },
      {
        id: 'password',
        label: 'Пароль и безопасность',
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
        ),
      },
      {
        id: 'permissions',
        label: 'Разрешения',
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
            <line x1="12" y1="19" x2="12" y2="23"/>
            <line x1="8" y1="23" x2="16" y2="23"/>
          </svg>
        ),
      },
    ],
  },
  {
    title: 'Приложение',
    items: [
      {
        id: 'appearance',
        label: 'Внешний вид',
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <path d="M12 2a10 10 0 0 1 0 20"/>
            <path d="M12 2C6.48 2 2 6.48 2 12"/>
            <circle cx="12" cy="12" r="3"/>
          </svg>
        ),
      },
      {
        id: 'sessions',
        label: 'Сессии',
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
            <path d="M8 21h8M12 17v4"/>
          </svg>
        ),
      },
      {
        id: 'export',
        label: 'Мои данные',
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
        ),
      },
    ],
  },
];

const TAB_LABELS: Record<Tab, string> = {
  profile:     'Профиль',
  password:    'Пароль и безопасность',
  privacy:     'Конфиденциальность',
  appearance:  'Внешний вид',
  sessions:    'Сессии',
  permissions: 'Разрешения',
  export:      'Мои данные',
};

export function ProfileSettingsModal({ me, onClose, onUpdate, onDeleteAccount }: Props) {
  const [tab, setTab] = useState<Tab | null>(null);

  const [showDeleteConfirm,  setShowDeleteConfirm]  = useState(false);
  const [showDeleteUsername, setShowDeleteUsername] = useState(false);
  const [deleteInput,  setDeleteInput]  = useState('');
  const [deleteError,  setDeleteError]  = useState<string | null>(null);
  const [deleting,     setDeleting]     = useState(false);

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

  const avatarUrl = resolveUrl(me.avatar_url);
  const letter    = avatarLetter(me.display_name || me.username || '');

  return (
    <div className="modalOverlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="psCard">

        {/* ── Header ───────────────────────────────────────────────────────── */}
        <div className="psHeader">
          {tab !== null ? (
            <button className="psBackBtn" onClick={() => setTab(null)} title="Назад">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="19" y1="12" x2="5" y2="12"/>
                <polyline points="12 19 5 12 12 5"/>
              </svg>
            </button>
          ) : (
            <div className="psTitle">Настройки</div>
          )}
          {tab !== null && <div className="psTitle">{TAB_LABELS[tab]}</div>}
          <button className="modalClose" onClick={onClose}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* ── Hub / Section body ────────────────────────────────────────────── */}
        {tab === null ? (
          <div className="psHub">
            {/* Аккаунт — отдельная крупная кнопка-карточка сверху */}
            <button className="psAccountCard" onClick={() => setTab('profile')}>
              <div className="psHubAvatar">
                {avatarUrl
                  ? <img src={avatarUrl} alt="" className="psHubAvatarImg" />
                  : <span className="psHubAvatarLetter">{letter}</span>
                }
              </div>
              <div className="psHubProfileInfo">
                <div className="psHubName">{me.display_name || me.username}</div>
                {me.username && <div className="psHubUsername">@{me.username}</div>}
              </div>
              <svg className="psHubChevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </button>

            {/* Секции настроек — монохромные иконки, сгруппированы в карточки */}
            {MENU_SECTIONS.map(section => (
              <div className="psSection" key={section.title}>
                <div className="psSectionTitle">{section.title}</div>
                <div className="psSectionCard">
                  {section.items.map(item => (
                    <button key={item.id} className="psRow" onClick={() => setTab(item.id)}>
                      <span className="psRowIcon">{item.icon}</span>
                      <span className="psRowLabel">{item.label}</span>
                      <svg className="psHubChevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="9 18 15 12 9 6"/>
                      </svg>
                    </button>
                  ))}
                </div>
              </div>
            ))}

            {/* Удаление аккаунта — просто красный текст+иконка, без рамки */}
            <div className="psSection">
              <div className="psSectionCard">
                <button className="psRow psRowDanger" onClick={openDeleteConfirm}>
                  <span className="psRowIcon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6"/>
                      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                      <path d="M10 11v6M14 11v6"/>
                      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                    </svg>
                  </span>
                  <span className="psRowLabel">Удалить аккаунт</span>
                  <svg className="psHubChevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6"/>
                  </svg>
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="psBody">
            {tab === 'profile'     && <ProfileTab          me={me} onUpdate={onUpdate} />}
            {tab === 'password'    && <PasswordSecurityTab me={me} onUpdate={onUpdate} />}
            {tab === 'privacy'     && <PrivacyTab          me={me} onUpdate={onUpdate} />}
            {tab === 'appearance'  && <AppearanceTab />}
            {tab === 'sessions'    && <SessionsTab />}
            {tab === 'permissions' && <PermissionsTab />}
            {tab === 'export'      && <ExportDataTab />}
          </div>
        )}
      </div>

      {/* Delete confirmation — step 1 */}
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
              <button className="psDeleteConfirmBtn" onClick={proceedToUsernameStep}>Продолжить</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation — step 2 */}
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
