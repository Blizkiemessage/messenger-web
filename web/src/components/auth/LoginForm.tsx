import { useState, useCallback, useRef, useEffect } from 'react';
import { type User } from '../../types';
import { PasswordInput } from '../ui/PasswordInput';
import { authLoginPassword, authTotpVerify } from '../../api/auth';

interface Props {
  onAuthenticated: (user: User, sessionId: string | null) => void;
  onSwitchTab: () => void;
  onForgotPassword: () => void;
}

export function LoginForm({ onAuthenticated, onSwitchTab, onForgotPassword }: Props) {
  const [login,    setLogin]    = useState('');
  const [password, setPassword] = useState('');
  const [busy,     setBusy]     = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  // 2FA step
  const [requires2FA,  setRequires2FA]  = useState(false);
  const [totpCode,     setTotpCode]     = useState('');
  const [useBackup,    setUseBackup]    = useState(false);
  // pendingToken is returned by /auth/login and passed back to /auth/totp-verify.
  // Kept in React state (not cookie) to avoid cross-origin third-party cookie issues.
  const [pendingToken, setPendingToken] = useState<string>('');
  const totpInputRef = useRef<HTMLInputElement>(null);

  const ready = login.trim().length >= 3 && password.length >= 1;

  // Focus TOTP input when the 2FA step appears
  useEffect(() => {
    if (requires2FA) totpInputRef.current?.focus();
  }, [requires2FA]);

  const onLogin = useCallback(async () => {
    if (!ready || busy) return;
    setError(null);
    setBusy(true);
    try {
      const res = await authLoginPassword(login.trim(), password);

      // Server signals that 2FA is required; store the pending token from the body
      if ((res as any).requires2FA) {
        setRequires2FA(true);
        setTotpCode('');
        setPendingToken((res as any).pendingToken ?? '');
        return;
      }

      onAuthenticated((res as any).user, (res as any).sessionId ?? null);
    } catch (e: any) {
      setError(e?.message ?? 'Неверный username/email или пароль');
    } finally {
      setBusy(false);
    }
  }, [login, password, ready, busy, onAuthenticated]);

  const onTotpSubmit = useCallback(async () => {
    const code = totpCode.trim();
    if (!code || busy) return;
    setError(null);
    setBusy(true);
    try {
      const res = await authTotpVerify(code, pendingToken);
      onAuthenticated(res.user, res.sessionId ?? null);
    } catch (e: any) {
      setError(e?.message ?? 'Неверный код');
    } finally {
      setBusy(false);
    }
  }, [totpCode, busy, onAuthenticated]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && ready && !busy) onLogin();
  };

  const handleTotpKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') onTotpSubmit();
  };

  // ── 2FA step ────────────────────────────────────────────────────────────────
  if (requires2FA) {
    const totpReady = useBackup ? totpCode.trim().length > 0 : /^\d{6}$/.test(totpCode.trim());
    return (
      <>
        <div className="authTotpIcon">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
        </div>
        <div className="authLabel" style={{ textAlign: 'center', marginBottom: 4 }}>
          Двухфакторная аутентификация
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', textAlign: 'center', marginBottom: 16 }}>
          {useBackup
            ? 'Введите резервный код (формат XXXXXX-XXXXXX)'
            : 'Введите 6-значный код из приложения-аутентификатора'}
        </div>

        <input
          ref={totpInputRef}
          className="authInput"
          style={{ textAlign: 'center', letterSpacing: useBackup ? 2 : 6, fontSize: useBackup ? 15 : 20 }}
          value={totpCode}
          onChange={e => { setTotpCode(e.target.value); setError(null); }}
          placeholder={useBackup ? 'XXXXXX-XXXXXX' : '000000'}
          inputMode={useBackup ? 'text' : 'numeric'}
          maxLength={useBackup ? 13 : 6}
          autoComplete="one-time-code"
          onKeyDown={handleTotpKeyDown}
        />

        {error && <div className="authError">{error}</div>}

        <button className="authBtn" disabled={!totpReady || busy} onClick={onTotpSubmit}>
          {busy ? '…' : 'Подтвердить'}
        </button>

        <div className="authSwitchRow">
          <button
            className="authSwitchLink"
            onClick={() => { setUseBackup(v => !v); setTotpCode(''); setError(null); }}
          >
            {useBackup ? '← Использовать TOTP-код' : 'Использовать резервный код'}
          </button>
        </div>

        <div className="authSwitchRow" style={{ marginTop: 4 }}>
          <button
            className="authSwitchLink"
            style={{ color: 'var(--text-secondary)', fontSize: 12 }}
            onClick={() => { setRequires2FA(false); setTotpCode(''); setError(null); }}
          >
            ← Назад ко входу
          </button>
        </div>
      </>
    );
  }

  // ── Password step ────────────────────────────────────────────────────────────
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

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: -8 }}>
        <div className="authLabel" style={{ margin: 0 }}>Пароль</div>
        <button
          type="button"
          className="authSwitchLink"
          style={{ fontSize: 12 }}
          onClick={onForgotPassword}
        >
          Забыли пароль?
        </button>
      </div>
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
