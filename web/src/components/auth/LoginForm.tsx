/**
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
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && ready && !busy) onLogin();
  };

  return (
    <>
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
    </>
  );
}
