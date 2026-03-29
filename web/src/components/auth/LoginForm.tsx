/**
 * LoginForm — accepts username or email + password.
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
  const [login,    setLogin]    = useState('');
  const [password, setPassword] = useState('');
  const [busy,  setBusy]  = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready = login.trim().length >= 3 && password.length >= 1;

  const onLogin = useCallback(async () => {
    if (!ready || busy) return;
    setError(null);
    setBusy(true);
    try {
      const res = await authLoginPassword(login.trim(), password);
      onAuthenticated(res.token, res.user);
    } catch (e: any) {
      setError(e?.message ?? 'Неверный username/email или пароль');
    } finally {
      setBusy(false);
    }
  }, [login, password, ready, busy, onAuthenticated]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && ready && !busy) onLogin();
  };

  return (
    <>
      <div className="authLabel">Username или Email</div>
      <input
        className="authInput"
        value={login}
        onChange={e => setLogin(e.target.value)}
        placeholder="username или email@example.com"
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
