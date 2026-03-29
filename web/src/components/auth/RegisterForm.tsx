/**
 * RegisterForm — username, email, password, confirm password.
 * After submit, shows OTP verification modal.
 */
import { useState, useCallback } from 'react';
import { type User } from '../../types';
import { PasswordInput } from '../ui/PasswordInput';
import { Portal } from '../ui/Portal';
import { authRegister, authVerifyEmail } from '../../api/auth';

interface Props {
  onAuthenticated: (token: string, user: User) => void;
  onSwitchTab: () => void;
}

export function RegisterForm({ onAuthenticated, onSwitchTab }: Props) {
  const [username,        setUsername]        = useState('');
  const [email,           setEmail]           = useState('');
  const [password,        setPassword]        = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [busy,  setBusy]  = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Which field has ever been touched (for contextual hints)
  const [touchedUser,  setTouchedUser]  = useState(false);
  const [touchedEmail, setTouchedEmail] = useState(false);
  const [touchedPass,  setTouchedPass]  = useState(false);
  const [touchedConf,  setTouchedConf]  = useState(false);

  // OTP modal state
  const [step,         setStep]         = useState<'form' | 'otp'>('form');
  const [otp,          setOtp]          = useState('');
  const [pendingEmail, setPendingEmail] = useState('');
  const [otpBusy,      setOtpBusy]     = useState(false);
  const [otpError,     setOtpError]    = useState<string | null>(null);

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const passwordsMatch = password === passwordConfirm;
  const showMismatch   = touchedConf && passwordConfirm.length > 0 && !passwordsMatch;

  const ready =
    username.trim().length >= 3 &&
    emailValid &&
    password.length >= 6 &&
    passwordsMatch &&
    passwordConfirm.length > 0;

  const onRegister = useCallback(async () => {
    if (!ready || busy) return;
    setError(null);
    setBusy(true);
    try {
      const res = await authRegister(username.trim(), email.trim(), password);
      setPendingEmail(res.email);
      setStep('otp');
    } catch (e: any) {
      setError(e?.message ?? 'Ошибка регистрации');
    } finally {
      setBusy(false);
    }
  }, [username, email, password, ready, busy]);

  const onVerify = useCallback(async () => {
    if (otp.length !== 6 || otpBusy) return;
    setOtpError(null);
    setOtpBusy(true);
    try {
      const res = await authVerifyEmail(pendingEmail, otp);
      onAuthenticated(res.token, res.user);
    } catch (e: any) {
      setOtpError(e?.message ?? 'Неверный код');
      setOtp('');
    } finally {
      setOtpBusy(false);
    }
  }, [otp, pendingEmail, otpBusy, onAuthenticated]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && ready && !busy) onRegister();
  };

  return (
    <>
      {/* Username */}
      <div className="authLabel">Username</div>
      <input
        className="authInput"
        value={username}
        onChange={e => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
        onFocus={() => setTouchedUser(true)}
        placeholder="username"
        autoCapitalize="none"
        autoComplete="username"
        autoFocus
        onKeyDown={handleKeyDown}
      />
      {touchedUser && username.length > 0 && username.trim().length < 3 && (
        <div className="authFieldHint">Минимум 3 символа · только латиница, цифры и _</div>
      )}

      {/* Email */}
      <div className="authLabel">Email</div>
      <input
        className="authInput"
        type="email"
        value={email}
        onChange={e => setEmail(e.target.value)}
        onFocus={() => setTouchedEmail(true)}
        placeholder="you@example.com"
        autoCapitalize="none"
        autoComplete="email"
        onKeyDown={handleKeyDown}
      />
      {touchedEmail && email.length > 0 && !emailValid && (
        <div className="authFieldHint">Введите корректный email</div>
      )}

      {/* Password */}
      <div className="authLabel">Пароль</div>
      <PasswordInput
        value={password}
        onChange={setPassword}
        onFocus={() => setTouchedPass(true)}
        placeholder="Минимум 6 символов"
        onKeyDown={handleKeyDown}
      />
      {touchedPass && password.length > 0 && password.length < 6 && (
        <div className="authFieldHint">Пароль должен быть не менее 6 символов</div>
      )}

      {/* Confirm password */}
      <div className="authLabel">Повторите пароль</div>
      <PasswordInput
        value={passwordConfirm}
        onChange={setPasswordConfirm}
        onFocus={() => setTouchedConf(true)}
        placeholder="Повторите пароль"
        onKeyDown={handleKeyDown}
      />
      {showMismatch && (
        <div className="authFieldHintError">Пароли не совпадают</div>
      )}

      {error && <div className="authError">{error}</div>}

      <button className="authBtn" disabled={!ready || busy} onClick={onRegister}>
        {busy ? '…' : 'Создать аккаунт'}
      </button>

      <div className="authSwitchRow">
        Уже есть аккаунт?{' '}
        <button className="authSwitchLink" onClick={onSwitchTab}>
          Войти
        </button>
      </div>

      {/* OTP verification modal */}
      {step === 'otp' && (
        <Portal>
          <div className="modalOverlay">
            <div className="modalCard" style={{ width: 'min(400px, 90vw)', padding: '28px' }}>
              <div className="modalTitle" style={{ marginBottom: 8 }}>Подтверждение email</div>
              <p style={{ fontSize: 14, color: 'var(--muted)', marginBottom: 20, lineHeight: 1.5 }}>
                На вашу почту <strong>{pendingEmail}</strong> выслан разовый код подтверждения
              </p>

              <div className="authLabel">Код из письма</div>
              <input
                className="authInput"
                value={otp}
                onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                inputMode="numeric"
                autoFocus
                onKeyDown={e => { if (e.key === 'Enter' && otp.length === 6) onVerify(); }}
              />
              {otpError && <div className="authError">{otpError}</div>}

              <button
                className="authBtn"
                style={{ marginTop: 8 }}
                disabled={otp.length !== 6 || otpBusy}
                onClick={onVerify}
              >
                {otpBusy ? '…' : 'Подтвердить'}
              </button>

              <div className="authSwitchRow" style={{ marginTop: 8 }}>
                <button
                  className="authSwitchLink"
                  onClick={() => { setStep('form'); setOtp(''); setOtpError(null); }}
                >
                  Изменить данные
                </button>
              </div>
            </div>
          </div>
        </Portal>
      )}
    </>
  );
}
