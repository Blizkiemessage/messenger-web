import { useState, useCallback } from 'react';
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
  const [password,        setPassword]        = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [step,   setStep]  = useState<Step>('form');
  const [busy,   setBusy]  = useState(false);
  const [error,  setError] = useState<string | null>(null);
  const [touchedConf, setTouchedConf] = useState(false);

  const passwordsMatch = password === passwordConfirm;
  const showMismatch   = touchedConf && passwordConfirm.length > 0 && !passwordsMatch;
  const ready =
    password.length >= 6 &&
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
        setError(msg || 'Не удалось сбросить пароль. Попробуйте ещё раз.');
      }
    } finally {
      setBusy(false);
    }
  }, [resetId, resetToken, password, ready, busy]);

  /* ── Success ── */
  if (step === 'success') {
    return (
      <>
        <div style={{ textAlign: 'center', padding: '8px 0 4px' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
          <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 8 }}>Пароль изменён!</div>
          <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.6, margin: 0 }}>
            Новый пароль успешно установлен. Теперь войдите в аккаунт с новым паролем.
          </p>
        </div>

        <button className="authBtn" onClick={onSuccess}>
          Войти в аккаунт
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
          <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 8 }}>Ссылка устарела</div>
          <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.6, margin: 0 }}>
            Ссылка для сброса пароля недействительна или истекла (1 час).
            Запросите новую ссылку.
          </p>
        </div>

        <button className="authBtn" onClick={onExpired}>
          Запросить новую ссылку
        </button>
      </>
    );
  }

  /* ── Form ── */
  return (
    <>
      <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.6, margin: '-4px 0 2px', textAlign: 'center' }}>
        Придумайте новый пароль для вашего аккаунта
      </p>

      <div className="authLabel">Новый пароль</div>
      <PasswordInput
        value={password}
        onChange={setPassword}
        placeholder="Минимум 6 символов"
        onKeyDown={e => { if (e.key === 'Enter' && ready && !busy) onSubmit(); }}
      />
      {password.length > 0 && password.length < 6 && (
        <div className="authFieldHint">Пароль должен быть не менее 6 символов</div>
      )}

      <div className="authLabel">Подтвердите пароль</div>
      <PasswordInput
        value={passwordConfirm}
        onChange={setPasswordConfirm}
        placeholder="Повторите пароль"
        onFocus={() => setTouchedConf(true)}
        onKeyDown={e => { if (e.key === 'Enter' && ready && !busy) onSubmit(); }}
      />
      {showMismatch && (
        <div className="authFieldHintError">Пароли не совпадают</div>
      )}

      {error && <div className="authError">{error}</div>}

      <button className="authBtn" disabled={!ready || busy} onClick={onSubmit}>
        {busy ? '…' : 'Сохранить новый пароль'}
      </button>
    </>
  );
}
