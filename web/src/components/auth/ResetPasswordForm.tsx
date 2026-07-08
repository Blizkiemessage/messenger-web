import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { PasswordInput } from '../ui/PasswordInput';
import { authResetPassword } from '../../api/auth';

interface Props {
  resetId: string;
  resetToken: string;
  onSuccess: () => void;
  onExpired: () => void;
}

type Step = 'form' | 'success' | 'expired';

export function ResetPasswordForm({ resetId, resetToken, onSuccess, onExpired }: Props) {
  const { t } = useTranslation('auth');
  const [password,        setPassword]        = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [step,   setStep]  = useState<Step>('form');
  const [busy,   setBusy]  = useState(false);
  const [error,  setError] = useState<string | null>(null);
  const [touchedConf, setTouchedConf] = useState(false);

  const passwordsMatch      = password === passwordConfirm;
  const showMismatch        = touchedConf && passwordConfirm.length > 0 && !passwordsMatch;
  const pwLongEnough        = password.length >= 8;
  const pwHasDigitOrSpecial = /[0-9!@#$%^&*()\-_=+[\]{}|;:'",.<>?/\\`~]/.test(password);
  const pwStrong            = pwLongEnough && pwHasDigitOrSpecial;
  const ready =
    pwStrong &&
    passwordsMatch &&
    passwordConfirm.length > 0;

  const onSubmit = useCallback(async () => {
    if (!ready || busy) return;
    setError(null);
    setBusy(true);
    try {
      await authResetPassword(resetId, resetToken, password);
      setStep('success');
    } catch (e: any) {
      const msg: string = e?.message ?? '';
      if (msg.includes('истекла') || msg.includes('недействительна') || msg.includes('попыток')) {
        setStep('expired');
      } else {
        setError(msg || t('reset.genericError'));
      }
    } finally {
      setBusy(false);
    }
  }, [resetId, resetToken, password, ready, busy, t]);

  /* ── Success ── */
  if (step === 'success') {
    return (
      <>
        <div style={{ textAlign: 'center', padding: '8px 0 4px' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
          <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 8 }}>{t('reset.successTitle')}</div>
          <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.6, margin: 0 }}>
            {t('reset.successText')}
          </p>
        </div>

        <button className="authBtn" onClick={onSuccess}>
          {t('reset.successCta')}
        </button>
      </>
    );
  }

  /* ── Expired / invalid token ── */
  if (step === 'expired') {
    return (
      <>
        <div style={{ textAlign: 'center', padding: '8px 0 4px' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>⏰</div>
          <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 8 }}>{t('reset.expiredTitle')}</div>
          <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.6, margin: 0 }}>
            {t('reset.expiredText')}
          </p>
        </div>

        <button className="authBtn" onClick={onExpired}>
          {t('reset.expiredCta')}
        </button>
      </>
    );
  }

  /* ── Form ── */
  return (
    <>
      <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.6, margin: '-4px 0 2px', textAlign: 'center' }}>
        {t('reset.prompt')}
      </p>

      <div className="authLabel">{t('reset.newPassword')}</div>
      <PasswordInput
        value={password}
        onChange={setPassword}
        placeholder={t('register.passwordPlaceholder')}
        onKeyDown={e => { if (e.key === 'Enter' && ready && !busy) onSubmit(); }}
      />
      {password.length > 0 && (
        <div className="pwStrength">
          <span className={pwLongEnough ? 'pwReqOk' : 'pwReqNo'}>
            {pwLongEnough ? '✓' : '✗'} {t('register.passwordMinLength')}
          </span>
          <span className={pwHasDigitOrSpecial ? 'pwReqOk' : 'pwReqNo'}>
            {pwHasDigitOrSpecial ? '✓' : '✗'} {t('register.passwordDigitOrSpecial')}
          </span>
        </div>
      )}

      <div className="authLabel">{t('reset.confirmPassword')}</div>
      <PasswordInput
        value={passwordConfirm}
        onChange={setPasswordConfirm}
        placeholder={t('register.confirmPasswordPlaceholder')}
        onFocus={() => setTouchedConf(true)}
        onKeyDown={e => { if (e.key === 'Enter' && ready && !busy) onSubmit(); }}
      />
      {showMismatch && (
        <div className="authFieldHintError">{t('register.passwordMismatch')}</div>
      )}

      {error && <div className="authError">{error}</div>}

      <button className="authBtn" disabled={!ready || busy} onClick={onSubmit}>
        {busy ? '…' : t('reset.submit')}
      </button>
    </>
  );
}
