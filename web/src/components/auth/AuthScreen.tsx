import { useState, useEffect } from 'react';
import { type User } from '../../types';
import { type InviteInviter } from '../../api/invites';
import { type Theme } from '../../utils/theme';
import { ThemeIcon } from '../ui/icons/ThemeIcon';
import { LogoIcon } from '../ui/icons/LogoIcon';
import { LoginForm } from './LoginForm';
import { RegisterForm } from './RegisterForm';
import { ForgotPasswordForm } from './ForgotPasswordForm';
import { ResetPasswordForm } from './ResetPasswordForm';

type AuthTab  = 'login' | 'register';
type AuthView = 'tabs' | 'forgot' | 'reset';

interface ResetParams { id: string; token: string }

function parseResetParams(): ResetParams | null {
  const p = new URLSearchParams(window.location.search);
  const id  = p.get('rid');
  const tok = p.get('tok');
  if (id && tok) return { id, token: tok };
  return null;
}

function clearResetParams() {
  const url = window.location.pathname;
  window.history.replaceState({}, '', url);
}

interface Props {
  theme: Theme;
  onThemeToggle: () => void;
  onAuthenticated: (user: User, sessionId: string | null) => void;
  invitedBy?: InviteInviter | null;
}

const viewTitles: Record<AuthView, string> = {
  tabs:   'Добро пожаловать!',
  forgot: 'Восстановление пароля',
  reset:  'Новый пароль',
};

export function AuthScreen({ theme, onThemeToggle, onAuthenticated, invitedBy }: Props) {
  const [tab,         setTab]         = useState<AuthTab>('login');
  const [view,        setView]        = useState<AuthView>('tabs');
  const [resetParams, setResetParams] = useState<ResetParams | null>(null);

  // Пришли по приглашению → подсказываем регистрацию
  useEffect(() => { if (invitedBy) setTab('register'); }, [invitedBy]);

  // Detect ?rid=...&tok=... on mount (user clicked email link)
  useEffect(() => {
    const params = parseResetParams();
    if (params) {
      setResetParams(params);
      setView('reset');
      clearResetParams();
    }
  }, []);

  function goToLogin() {
    setView('tabs');
    setTab('login');
    setResetParams(null);
  }

  return (
    <div className="authWrap">
      <button className="authThemeBtn" onClick={onThemeToggle}>
        <ThemeIcon theme={theme} />
      </button>
      {invitedBy && (
        <div className="authInviteBanner">
          <div className="authInviteAvatar">
            {invitedBy.avatar_url
              ? <img src={invitedBy.avatar_url} alt="" />
              : <span>{(invitedBy.display_name || invitedBy.username || '?').charAt(0).toUpperCase()}</span>}
          </div>
          <div className="authInviteText">
            <b>{invitedBy.display_name || invitedBy.username}</b> приглашает вас в Blizkie
            <span className="authInviteHint">Зарегистрируйтесь — и вы сразу станете контактами</span>
          </div>
        </div>
      )}
      <div className="authCard">
        <div className="authLogo"><LogoIcon /></div>
        <div className="authTitle">{viewTitles[view]}</div>

        {/* Tabs — only shown in default view */}
        {view === 'tabs' && (
          <div className="authTabs">
            <button
              className={`authTab${tab === 'login'    ? ' active' : ''}`}
              onClick={() => setTab('login')}
            >
              Войти
            </button>
            <button
              className={`authTab${tab === 'register' ? ' active' : ''}`}
              onClick={() => setTab('register')}
            >
              Регистрация
            </button>
          </div>
        )}

        {view === 'tabs' && tab === 'login' && (
          <LoginForm
            onAuthenticated={onAuthenticated}
            onSwitchTab={() => setTab('register')}
            onForgotPassword={() => setView('forgot')}
          />
        )}

        {view === 'tabs' && tab === 'register' && (
          <RegisterForm
            onAuthenticated={onAuthenticated}
            onSwitchTab={() => setTab('login')}
          />
        )}

        {view === 'forgot' && (
          <ForgotPasswordForm
            onBack={goToLogin}
            onSwitchToRegister={() => { setView('tabs'); setTab('register'); }}
          />
        )}

        {view === 'reset' && resetParams && (
          <ResetPasswordForm
            resetId={resetParams.id}
            resetToken={resetParams.token}
            onSuccess={goToLogin}
            onExpired={() => { setResetParams(null); setView('forgot'); }}
          />
        )}
      </div>

      <div style={{ marginTop: 20, fontSize: 12.5, color: 'var(--muted)', display: 'flex', gap: 14, justifyContent: 'center' }}>
        <a href="/privacy" target="_blank" rel="noopener noreferrer" style={{ color: 'inherit' }}>Конфиденциальность</a>
        <a href="/terms" target="_blank" rel="noopener noreferrer" style={{ color: 'inherit' }}>Условия использования</a>
      </div>
    </div>
  );
}
