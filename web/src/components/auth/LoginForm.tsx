/**
<<<<<<< HEAD
 * LoginForm
 *
 * Username-only or username+password login.
 * On success calls onAuthenticated — handled by AuthScreen.
 */

import { useState, useCallback } from 'react';
import { type User } from '../../types';
import { PasswordInput } from '../ui/PasswordInput';
import { authLogin, authLoginPassword } from '../../api/auth';

interface Props {
  onAuthenticated: (token: string, user: User) => void;
}

export function LoginForm({ onAuthenticated }: Props) {
=======
 * LoginForm — password required, "Нет аккаунта?" link at bottom.
 */
import { useState, useCallback } from 'react';
import { type User } from '../../types';
import { PasswordInput } from '../ui/PasswordInput';
import { authLoginPassword } from '../../api/auth';

interface Props {
  onAuthenticated: (token: string, user: User) => void;
  onSwitchTab: () => void;
}

export function LoginForm({ onAuthenticated, onSwitchTab }: Props) {
>>>>>>> devDK
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

<<<<<<< HEAD
  const ready = username.trim().length >= 3;

  const onLogin = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const res = password
        ? await authLoginPassword(username.trim(), password)
        : await authLogin(username.trim());
      onAuthenticated(res.token, res.user);
    } catch (e: any) {
      setError(e?.message ?? 'Ошибка входа');
    } finally {
      setBusy(false);
    }
  }, [username, password, onAuthenticated]);
=======
  const ready = username.trim().length >= 3 && password.length >= 1;

  const onLogin = useCallback(async () => {
    if (!ready || busy) return;
    setError(null);
    setBusy(true);
    try {
      const res = await authLoginPassword(username.trim(), password);
      onAuthenticated(res.token, res.user);
    } catch (e: any) {
      setError(e?.message ?? 'Неверный username или пароль');
    } finally {
      setBusy(false);
    }
  }, [username, password, ready, busy, onAuthenticated]);
>>>>>>> devDK

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && ready && !busy) onLogin();
  };

  return (
    <>
<<<<<<< HEAD
      <div className="authSub">Введите username чтобы войти или добавьте пароль</div>

=======
>>>>>>> devDK
      <div className="authLabel">Username</div>
      <input
        className="authInput"
        value={username}
        onChange={e => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
        placeholder="username"
        autoCapitalize="none"
        autoComplete="username"
        autoFocus
        onKeyDown={handleKeyDown}
      />

<<<<<<< HEAD
      <div className="authLabel">
        Пароль <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(необязательно)</span>
      </div>
      <PasswordInput
        value={password}
        onChange={setPassword}
        placeholder="Пароль (если привязан)"
        onKeyDown={handleKeyDown}
      />
      <div className="authHint">Без пароля — вход по username · С паролем — проверка пароля</div>

      {error && <div className="authError">{error}</div>}

      <button
        className="authBtn"
        disabled={!ready || busy}
        onClick={onLogin}
      >
        {busy ? '…' : 'Войти'}
      </button>
=======
      <div className="authLabel">Пароль</div>
      <PasswordInput
        value={password}
        onChange={setPassword}
        placeholder="Введите пароль"
        onKeyDown={handleKeyDown}
      />

      {error && <div className="authError">{error}</div>}

      <button className="authBtn" disabled={!ready || busy} onClick={onLogin}>
        {busy ? '…' : 'Войти'}
      </button>

      <div className="authSwitchRow">
        Нет аккаунта?{' '}
        <button className="authSwitchLink" onClick={onSwitchTab}>
          Зарегистрируйтесь
        </button>
      </div>
>>>>>>> devDK
    </>
  );
}
