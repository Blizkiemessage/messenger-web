/**
 * AuthScreen — manages login/register tabs.
 * Passes onSwitchTab so forms can redirect each other.
 */
import { useState } from 'react';
import { type User } from '../../types';
import { type Theme } from '../../utils/theme';
import { ThemeIcon } from '../ui/icons/ThemeIcon';
import { LoginForm } from './LoginForm';
import { RegisterForm } from './RegisterForm';

type AuthTab = 'login' | 'register';

interface Props {
  theme: Theme;
  onThemeToggle: () => void;
  onAuthenticated: (token: string, user: User) => void;
}

export function AuthScreen({ theme, onThemeToggle, onAuthenticated }: Props) {
  const [tab, setTab] = useState<AuthTab>('login');

  return (
    <div className="authWrap">
      <button className="authThemeBtn" onClick={onThemeToggle}>
        <ThemeIcon theme={theme} />
      </button>
      <div className="authCard">
        <div className="authLogo">B</div>
        <div className="authTitle">Blizkie</div>

        <div className="authTabs">
          <button className={`authTab${tab === 'login'    ? ' active' : ''}`} onClick={() => setTab('login')}>Войти</button>
          <button className={`authTab${tab === 'register' ? ' active' : ''}`} onClick={() => setTab('register')}>Регистрация</button>
        </div>

        {tab === 'login'
          ? <LoginForm    onAuthenticated={onAuthenticated} onSwitchTab={() => setTab('register')} />
          : <RegisterForm onAuthenticated={onAuthenticated} onSwitchTab={() => setTab('login')} />
        }
      </div>
    </div>
  );
}
