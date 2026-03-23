/**
<<<<<<< HEAD
 * AuthScreen
 *
 * Container for login/register. Delegates form rendering to LoginForm
 * and RegisterForm — this file only manages the tab and card wrapper.
=======
 * AuthScreen — manages login/register tabs.
 * Passes onSwitchTab so forms can redirect each other.
>>>>>>> devDK
 */
import { useState } from 'react';
import { type User } from '../../types';
import { type Theme } from '../../utils/theme';
import { ThemeIcon } from '../ui/icons/ThemeIcon';
import { LoginForm } from './LoginForm';
import { RegisterForm } from './RegisterForm';

<<<<<<< HEAD
=======
type AuthTab = 'login' | 'register';

>>>>>>> devDK
interface Props {
  theme: Theme;
  onThemeToggle: () => void;
  onAuthenticated: (token: string, user: User) => void;
}

export function AuthScreen({ theme, onThemeToggle, onAuthenticated }: Props) {
<<<<<<< HEAD
  type AuthTab = 'login' | 'register';
  const [tab, setTab] = useState<AuthTab>('login');

  function switchTab(t: AuthTab) { setTab(t); }

=======
  const [tab, setTab] = useState<AuthTab>('login');

>>>>>>> devDK
  return (
    <div className="authWrap">
      <button className="authThemeBtn" onClick={onThemeToggle}>
        <ThemeIcon theme={theme} />
      </button>
      <div className="authCard">
        <div className="authLogo">B</div>
        <div className="authTitle">Blizkie</div>
<<<<<<< HEAD
        <div className="authTabs">
          <button className={`authTab${tab === 'login' ? ' active' : ''}`} onClick={() => switchTab('login')}>Войти</button>
          <button className={`authTab${tab === 'register' ? ' active' : ''}`} onClick={() => switchTab('register')}>Регистрация</button>
        </div>

        {tab === 'login'
          ? <LoginForm onAuthenticated={onAuthenticated} />
          : <RegisterForm onAuthenticated={onAuthenticated} />
=======

        <div className="authTabs">
          <button className={`authTab${tab === 'login'    ? ' active' : ''}`} onClick={() => setTab('login')}>Войти</button>
          <button className={`authTab${tab === 'register' ? ' active' : ''}`} onClick={() => setTab('register')}>Регистрация</button>
        </div>

        {tab === 'login'
          ? <LoginForm    onAuthenticated={onAuthenticated} onSwitchTab={() => setTab('register')} />
          : <RegisterForm onAuthenticated={onAuthenticated} onSwitchTab={() => setTab('login')} />
>>>>>>> devDK
        }
      </div>
    </div>
  );
}
