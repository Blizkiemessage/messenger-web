/**
 * RegisterForm — username, email, password, confirm password.
 * After submit, shows OTP verification modal.
 */
import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { type User } from '../../types';
import { PasswordInput } from '../ui/PasswordInput';
import { Portal } from '../ui/Portal';
import { authRegister, authVerifyEmail } from '../../api/auth';
import { saveToken, saveRefreshToken } from '../../storage/session';

interface Props {
  onAuthenticated: (user: User, sessionId: string | null) => void;
  onSwitchTab: () => void;
}

export function RegisterForm({ onAuthenticated, onSwitchTab }: Props) {
  const { t } = useTranslation('auth');
  const [username,        setUsername]        = useState('');
  const [email,           setEmail]           = useState('');
  const [password,        setPassword]        = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [busy,  setBusy]  = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [acceptedTerms, setAcceptedTerms] = useState(false);

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

  const pwLongEnough  = password.length >= 8;
  const pwHasDigitOrSpecial = /[0-9!@#$%^&*()\-_=+[\]{}|;:'",.<>?/\\`~]/.test(password);
  const pwStrong = pwLongEnough && pwHasDigitOrSpecial;

  const ready =
    username.trim().length >= 3 &&
    emailValid &&
    pwStrong &&
    passwordsMatch &&
    passwordConfirm.length > 0 &&
    acceptedTerms;

  const onRegister = useCallback(async () => {
    if (!ready || busy) return;
    setError(null);
    setBusy(true);
    try {
      const res = await authRegister(username.trim(), email.trim(), password, acceptedTerms);
      setPendingEmail(res.email);
      setStep('otp');
    } catch (e: any) {
      setError(e?.message ?? t('register.genericError'));
    } finally {
      setBusy(false);
    }
  }, [username, email, password, acceptedTerms, ready, busy, t]);

  const onVerify = useCallback(async () => {
    if (otp.length !== 6 || otpBusy) return;
    setOtpError(null);
    setOtpBusy(true);
    try {
      const res = await authVerifyEmail(pendingEmail, otp);
      // Persist tokens for cross-origin Bearer auth (Vercel → Amvera)
      if (res.token) saveToken(res.token);
      if (res.refreshToken) saveRefreshToken(res.refreshToken);
      onAuthenticated(res.user, res.sessionId ?? null);
    } catch (e: any) {
      setOtpError(e?.message ?? t('register.otpInvalid'));
      setOtp('');
    } finally {
      setOtpBusy(false);
    }
  }, [otp, pendingEmail, otpBusy, onAuthenticated, t]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && ready && !busy) onRegister();
  };

  return (
    <>
      {/* Username */}
      <div className="authLabel">{t('register.username')}</div>
      <input
        className="authInput"
        value={username}
        onChange={e => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
        onFocus={() => setTouchedUser(true)}
        placeholder={t('register.usernamePlaceholder')}
        autoCapitalize="none"
        autoComplete="username"
        autoFocus
        onKeyDown={handleKeyDown}
      />
      {touchedUser && username.length > 0 && username.trim().length < 3 && (
        <div className="authFieldHint">{t('register.usernameHint')}</div>
      )}

      {/* Email */}
      <div className="authLabel">{t('register.email')}</div>
      <input
        className="authInput"
        type="email"
        value={email}
        onChange={e => setEmail(e.target.value)}
        onFocus={() => setTouchedEmail(true)}
        placeholder={t('register.emailPlaceholder')}
        autoCapitalize="none"
        autoComplete="email"
        onKeyDown={handleKeyDown}
      />
      {touchedEmail && email.length > 0 && !emailValid && (
        <div className="authFieldHint">{t('register.emailHint')}</div>
      )}

      {/* Password */}
      <div className="authLabel">{t('register.password')}</div>
      <PasswordInput
        value={password}
        onChange={setPassword}
        onFocus={() => setTouchedPass(true)}
        placeholder={t('register.passwordPlaceholder')}
        onKeyDown={handleKeyDown}
      />
      {touchedPass && password.length > 0 && (
        <div className="pwStrength">
          <span className={pwLongEnough ? 'pwReqOk' : 'pwReqNo'}>
            {pwLongEnough ? '✓' : '✗'} {t('register.passwordMinLength')}
          </span>
          <span className={pwHasDigitOrSpecial ? 'pwReqOk' : 'pwReqNo'}>
            {pwHasDigitOrSpecial ? '✓' : '✗'} {t('register.passwordDigitOrSpecial')}
          </span>
        </div>
      )}

      {/* Confirm password */}
      <div className="authLabel">{t('register.confirmPassword')}</div>
      <PasswordInput
        value={passwordConfirm}
        onChange={setPasswordConfirm}
        onFocus={() => setTouchedConf(true)}
        placeholder={t('register.confirmPasswordPlaceholder')}
        onKeyDown={handleKeyDown}
      />
      {showMismatch && (
        <div className="authFieldHintError">{t('register.passwordMismatch')}</div>
      )}

      {/* Consent checkbox — required, App Store/Play Market submission needs it (docs/STORE_LAUNCH_TZ.md §1) */}
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, color: 'var(--muted)', lineHeight: 1.4, margin: '4px 0 2px', cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={acceptedTerms}
          onChange={e => setAcceptedTerms(e.target.checked)}
          style={{ marginTop: 2, flexShrink: 0 }}
        />
        <span>
          {t('register.acceptTermsPrefix')}{' '}
          <a href="/terms" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>
            {t('register.termsOfService')}
          </a>{' '}
          {t('register.and')}{' '}
          <a href="/privacy" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>
            {t('register.privacyPolicy')}
          </a>
        </span>
      </label>

      {error && <div className="authError">{error}</div>}

      <button className="authBtn" disabled={!ready || busy} onClick={onRegister}>
        {busy ? '…' : t('register.submit')}
      </button>

      <div className="authSwitchRow">
        {t('register.haveAccount')}{' '}
        <button className="authSwitchLink" onClick={onSwitchTab}>
          {t('register.loginLink')}
        </button>
      </div>

      {/* OTP verification modal */}
      {step === 'otp' && (
        <Portal>
          <div className="modalOverlay">
            <div className="confirmCard" style={{ width: 'min(400px, 100%)', display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>{t('register.otpTitle')}</div>
                <p style={{ fontSize: 14, color: 'var(--muted)', lineHeight: 1.5, margin: 0 }}>
                  {t('register.otpSentToPrefix')} <strong>{pendingEmail}</strong> {t('register.otpSentToSuffix')}
                </p>
              </div>

              <div className="authLabel">{t('register.otpCodeLabel')}</div>
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
                disabled={otp.length !== 6 || otpBusy}
                onClick={onVerify}
              >
                {otpBusy ? '…' : t('register.otpConfirm')}
              </button>

              <div className="authSwitchRow">
                <button
                  className="authSwitchLink"
                  onClick={() => { setStep('form'); setOtp(''); setOtpError(null); }}
                >
                  {t('register.editData')}
                </button>
              </div>
            </div>
          </div>
        </Portal>
      )}
    </>
  );
}
