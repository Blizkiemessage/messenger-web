import { useState, useCallback, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { type User } from '../../types';
import { PasswordInput } from '../ui/PasswordInput';
import { authLoginPassword, authTotpVerify } from '../../api/auth';
import { saveToken, saveRefreshToken } from '../../storage/session';
import { passkeyAuthenticate, isWebAuthnSupported } from '../../api/webauthn';

interface Props {
  onAuthenticated: (user: User, sessionId: string | null) => void;
  onSwitchTab: () => void;
  onForgotPassword: () => void;
}

export function LoginForm({ onAuthenticated, onSwitchTab, onForgotPassword }: Props) {
  const { t } = useTranslation('auth');
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

  const ready         = login.trim().length >= 3 && password.length >= 1;
  const webauthnReady = isWebAuthnSupported();

  const onPasskeyLogin = useCallback(async () => {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const res = await passkeyAuthenticate(login.trim() || undefined);
      if (res.token) saveToken(res.token);
      if (res.refreshToken) saveRefreshToken(res.refreshToken);
      onAuthenticated(res.user, res.sessionId ?? null);
    } catch (e: any) {
      const msg = e?.message ?? '';
      if (msg.toLowerCase().includes('cancel') || msg.toLowerCase().includes('abort') || msg.toLowerCase().includes('not allowed')) {
        setError(null);
      } else {
        setError(e?.response?.data?.error ?? msg ?? t('login.passkeyError'));
      }
    } finally {
      setBusy(false);
    }
  }, [login, busy, onAuthenticated, t]);

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

      // Persist tokens for cross-origin Bearer auth (Vercel → Amvera)
      if ((res as any).token) saveToken((res as any).token);
      if ((res as any).refreshToken) saveRefreshToken((res as any).refreshToken);
      onAuthenticated((res as any).user, (res as any).sessionId ?? null);
    } catch (e: any) {
      setError(e?.message ?? t('login.invalidCredentials'));
    } finally {
      setBusy(false);
    }
  }, [login, password, ready, busy, onAuthenticated, t]);

  const onTotpSubmit = useCallback(async () => {
    const code = totpCode.trim();
    if (!code || busy) return;
    setError(null);
    setBusy(true);
    try {
      const res = await authTotpVerify(code, pendingToken);
      // Persist tokens for cross-origin Bearer auth (Vercel → Amvera)
      if (res.token) saveToken(res.token);
      if (res.refreshToken) saveRefreshToken(res.refreshToken);
      onAuthenticated(res.user, res.sessionId ?? null);
    } catch (e: any) {
      setError(e?.message ?? t('login.invalidCode'));
    } finally {
      setBusy(false);
    }
  }, [totpCode, busy, onAuthenticated, t]);

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
          {t('login.totpTitle')}
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', textAlign: 'center', marginBottom: 16 }}>
          {useBackup ? t('login.totpHintBackup') : t('login.totpHintApp')}
        </div>

        <input
          ref={totpInputRef}
          className="authInput"
          style={{ textAlign: 'center', letterSpacing: useBackup ? 2 : 6, fontSize: useBackup ? 15 : 20 }}
          value={totpCode}
          onChange={e => { setTotpCode(e.target.value); setError(null); }}
          placeholder={useBackup ? t('login.backupPlaceholder') : t('login.totpPlaceholder')}
          inputMode={useBackup ? 'text' : 'numeric'}
          maxLength={useBackup ? 13 : 6}
          autoComplete="one-time-code"
          onKeyDown={handleTotpKeyDown}
        />

        {error && <div className="authError">{error}</div>}

        <button className="authBtn" disabled={!totpReady || busy} onClick={onTotpSubmit}>
          {busy ? '…' : t('login.confirm')}
        </button>

        <div className="authSwitchRow">
          <button
            className="authSwitchLink"
            onClick={() => { setUseBackup(v => !v); setTotpCode(''); setError(null); }}
          >
            {useBackup ? t('login.useTotpCode') : t('login.useBackupCode')}
          </button>
        </div>

        <div className="authSwitchRow" style={{ marginTop: 4 }}>
          <button
            className="authSwitchLink"
            style={{ color: 'var(--text-secondary)', fontSize: 12 }}
            onClick={() => { setRequires2FA(false); setTotpCode(''); setError(null); }}
          >
            {t('login.backToLogin')}
          </button>
        </div>
      </>
    );
  }

  // ── Password step ────────────────────────────────────────────────────────────
  return (
    <>
      <div className="authLabel">{t('login.usernameOrEmail')}</div>
      <input
        className="authInput"
        value={login}
        onChange={e => setLogin(e.target.value)}
        placeholder={t('login.usernameOrEmailPlaceholder')}
        autoCapitalize="none"
        autoComplete="username"
        autoFocus
        onKeyDown={handleKeyDown}
      />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: -8 }}>
        <div className="authLabel" style={{ margin: 0 }}>{t('login.password')}</div>
        <button
          type="button"
          className="authSwitchLink"
          style={{ fontSize: 12 }}
          onClick={onForgotPassword}
        >
          {t('login.forgotPassword')}
        </button>
      </div>
      <PasswordInput
        value={password}
        onChange={setPassword}
        placeholder={t('login.passwordPlaceholder')}
        onKeyDown={handleKeyDown}
      />

      {error && <div className="authError">{error}</div>}

      <button className="authBtn" disabled={!ready || busy} onClick={onLogin}>
        {busy ? '…' : t('login.submit')}
      </button>

      {webauthnReady && (
        <>
          <div className="authDividerRow">
            <span className="authDividerLine" />
            <span className="authDividerText">{t('login.or')}</span>
            <span className="authDividerLine" />
          </div>
          <button className="authPasskeyBtn" disabled={busy} onClick={onPasskeyLogin}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>
            </svg>
            {t('login.passkeyLogin')}
          </button>
        </>
      )}

      <div className="authSwitchRow">
        {t('login.noAccount')}{' '}
        <button className="authSwitchLink" onClick={onSwitchTab}>
          {t('login.registerLink')}
        </button>
      </div>
    </>
  );
}
