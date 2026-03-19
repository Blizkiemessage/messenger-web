/**
 * RegisterForm
 *
 * New account creation with username + password.
 * On success calls onAuthenticated — handled by AuthScreen.
 */

import { useState, useCallback } from 'react';
import { type User } from '../../types';
import { PasswordInput } from '../ui/PasswordInput';
import { authRegister } from '../../api/auth';

interface Props {
  onAuthenticated: (token: string, user: User) => void;
}

export function RegisterForm({ onAuthenticated }: Props) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready =
    username.trim().length >= 3 &&
    password.length >= 6 &&
    password === passwordConfirm;

  const onRegister = useCallback(async () => {
    setError(null);
    if (!password) return setError('Введите пароль');
    if (password.length < 6) return setError('Пароль: минимум 6 символов');
    if (password !== passwordConfirm) return setError('Пароли не совпадают');
    setBusy(true);
    try {
      const res = await authRegister(username.trim(), password);
      onAuthenticated(res.token, res.user);
    } catch (e: any) {
      setError(e?.message ?? 'Ошибка регистрации');
    } finally {
      setBusy(false);
    }
  }, [username, password, passwordConfirm, onAuthenticated]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && ready && !busy) onRegister();
  };

  return (
    <>
      <div className="authSub">Создайте новый аккаунт с паролем</div>

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

      <div className="authLabel">Пароль</div>
      <PasswordInput
        value={password}
        onChange={setPassword}
        placeholder="Минимум 6 символов"
        onKeyDown={handleKeyDown}
      />

      <div className="authLabel">Повторите пароль</div>
      <PasswordInput
        value={passwordConfirm}
        onChange={setPasswordConfirm}
        placeholder="Повторите пароль"
        onKeyDown={handleKeyDown}
      />
      <div className="authHint">Только латиница, цифры и _ · Минимум 3 символа</div>

      {error && <div className="authError">{error}</div>}

      <button
        className="authBtn"
        disabled={!ready || busy}
        onClick={onRegister}
      >
        {busy ? '…' : 'Создать аккаунт'}
      </button>
    </>
  );
}
