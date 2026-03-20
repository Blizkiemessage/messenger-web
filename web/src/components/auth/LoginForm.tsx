/**
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
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && ready && !busy) onLogin();
  };

  return (
    <>
      <div className="authSub">Введите username чтобы войти или добавьте пароль</div>

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
    </>
  );
}
