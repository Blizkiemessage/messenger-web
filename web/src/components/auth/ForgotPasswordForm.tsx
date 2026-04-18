import { useState, useCallback } from 'react';
import { authForgotPassword } from '../../api/auth';

interface Props {
  onBack: () => void;
  onSwitchToRegister: () => void;
}

type Step = 'form' | 'sent' | 'notFound';

export function ForgotPasswordForm({ onBack, onSwitchToRegister }: Props) {
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
        setError(e?.message ?? 'Что-то пошло не так. Попробуйте позже.');
      }
    } finally {
      setBusy(false);
    }
  }, [email, emailValid, busy]);

  /* ── Sent state ── */
  if (step === 'sent') {
    return (
      <>
        <div style={{ textAlign: 'center', padding: '8px 0 4px' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📬</div>
          <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 8 }}>Письмо отправлено!</div>
          <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.6, margin: '0 0 4px' }}>
            Ссылка для сброса пароля отправлена на
          </p>
          <p style={{ fontSize: 13, fontWeight: 600, margin: '0 0 16px', wordBreak: 'break-all' }}>
            {email.trim()}
          </p>
          <p style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6, margin: 0 }}>
            Ссылка действительна&nbsp;1&nbsp;час. Проверьте папку «Спам», если письмо не пришло.
          </p>
        </div>

        <button className="authBtn" onClick={onBack}>
          Вернуться ко входу
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
          <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 8 }}>Аккаунт не найден</div>
          <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.6, margin: 0 }}>
            Аккаунт с адресом <strong style={{ color: 'var(--text)' }}>{email.trim()}</strong> не существует.
            Возможно, вы указали другой email при регистрации.
          </p>
        </div>

        <button className="authBtn" onClick={onSwitchToRegister}>
          Зарегистрироваться
        </button>

        <div className="authSwitchRow">
          <button className="authSwitchLink" onClick={() => setStep('form')}>
            Попробовать другой email
          </button>
        </div>
      </>
    );
  }

  /* ── Form state ── */
  return (
    <>
      <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.6, margin: '-4px 0 2px', textAlign: 'center' }}>
        Введите email аккаунта — мы отправим ссылку для сброса пароля
      </p>

      <div className="authLabel">Email аккаунта</div>
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
        {busy ? '…' : 'Отправить ссылку'}
      </button>

      <div className="authSwitchRow">
        <button className="authSwitchLink" onClick={onBack}>
          ← Вернуться ко входу
        </button>
      </div>
    </>
  );
}
