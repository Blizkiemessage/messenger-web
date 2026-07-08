import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { authForgotPassword } from '../../api/auth';

interface Props {
  onBack: () => void;
  onSwitchToRegister: () => void;
}

type Step = 'form' | 'sent' | 'notFound';

export function ForgotPasswordForm({ onBack, onSwitchToRegister }: Props) {
  const { t } = useTranslation('auth');
  const [email,   setEmail]   = useState('');
  const [step,    setStep]    = useState<Step>('form');
  const [busy,    setBusy]    = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  const onSubmit = useCallback(async () => {
    if (!emailValid || busy) return;
    setError(null);
    setBusy(true);
    try {
      await authForgotPassword(email.trim());
      setStep('sent');
    } catch (e: any) {
      if (e?.status === 404 || e?.message?.includes('не найден')) {
        setStep('notFound');
      } else {
        setError(e?.message ?? t('forgot.genericError'));
      }
    } finally {
      setBusy(false);
    }
  }, [email, emailValid, busy, t]);

  /* ── Sent state ── */
  if (step === 'sent') {
    return (
      <>
        <div style={{ textAlign: 'center', padding: '8px 0 4px' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📬</div>
          <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 8 }}>{t('forgot.sentTitle')}</div>
          <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.6, margin: '0 0 4px' }}>
            {t('forgot.sentTo')}
          </p>
          <p style={{ fontSize: 13, fontWeight: 600, margin: '0 0 16px', wordBreak: 'break-all' }}>
            {email.trim()}
          </p>
          <p style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6, margin: 0 }}>
            {t('forgot.sentHint')}
          </p>
        </div>

        <button className="authBtn" onClick={onBack}>
          {t('forgot.returnToLogin')}
        </button>
      </>
    );
  }

  /* ── Not found state ── */
  if (step === 'notFound') {
    return (
      <>
        <div style={{ textAlign: 'center', padding: '8px 0 4px' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🔍</div>
          <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 8 }}>{t('forgot.notFoundTitle')}</div>
          <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.6, margin: 0 }}>
            {t('forgot.notFoundTextPrefix')} <strong style={{ color: 'var(--text)' }}>{email.trim()}</strong>{' '}
            {t('forgot.notFoundTextSuffix')}
          </p>
        </div>

        <button className="authBtn" onClick={onSwitchToRegister}>
          {t('forgot.registerCta')}
        </button>

        <div className="authSwitchRow">
          <button className="authSwitchLink" onClick={() => setStep('form')}>
            {t('forgot.tryAnotherEmail')}
          </button>
        </div>
      </>
    );
  }

  /* ── Form state ── */
  return (
    <>
      <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.6, margin: '-4px 0 2px', textAlign: 'center' }}>
        {t('forgot.prompt')}
      </p>

      <div className="authLabel">{t('forgot.emailLabel')}</div>
      <input
        className="authInput"
        type="email"
        value={email}
        onChange={e => setEmail(e.target.value)}
        placeholder="you@example.com"
        autoCapitalize="none"
        autoComplete="email"
        autoFocus
        onKeyDown={e => { if (e.key === 'Enter' && emailValid && !busy) onSubmit(); }}
      />

      {error && <div className="authError">{error}</div>}

      <button className="authBtn" disabled={!emailValid || busy} onClick={onSubmit}>
        {busy ? '…' : t('forgot.submit')}
      </button>

      <div className="authSwitchRow">
        <button className="authSwitchLink" onClick={onBack}>
          {t('forgot.backToLogin')}
        </button>
      </div>
    </>
  );
}
