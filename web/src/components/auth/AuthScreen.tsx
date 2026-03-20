/**
 * AuthScreen
 *
 * Container for login/register. Delegates form rendering to LoginForm
 * and RegisterForm — this file only manages the tab and card wrapper.
 */
import { useState } from 'react';
import { type User } from '../../types';
import { type Theme } from '../../utils/theme';
import { ThemeIcon } from '../ui/icons/ThemeIcon';
import { LoginForm } from './LoginForm';
import { RegisterForm } from './RegisterForm';

interface Props {
  theme: Theme;
  onThemeToggle: () => void;
  onAuthenticated: (token: string, user: User) => void;
}

export function AuthScreen({ theme, onThemeToggle, onAuthenticated }: Props) {
  type AuthTab = 'login' | 'register';
  const [tab, setTab] = useState<AuthTab>('login');

  function switchTab(t: AuthTab) { setTab(t); }

  return (
    <div className="authWrap">
      <button className="authThemeBtn" onClick={onThemeToggle}>
        <ThemeIcon theme={theme} />
      </button>
      <div className="authCard">
        <div className="authLogo">B</div>
        <div className="authTitle">Blizkie</div>
        <div className="authTabs">
          <button className={`authTab${tab === 'login' ? ' active' : ''}`} onClick={() => switchTab('login')}>Войти</button>
          <button className={`authTab${tab === 'register' ? ' active' : ''}`} onClick={() => switchTab('register')}>Регистрация</button>
        </div>

        {tab === 'login'
          ? <LoginForm onAuthenticated={onAuthenticated} />
          : <RegisterForm onAuthenticated={onAuthenticated} />
        }
      </div>
    </div>
  );
}
