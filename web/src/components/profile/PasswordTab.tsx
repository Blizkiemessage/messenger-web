/**
 * PasswordTab
 *
 * "Пароль" tab inside ProfileSettingsModal.
 * Handles setting and changing password.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type User } from '../../types';
import { PasswordInput } from '../ui/PasswordInput';
import { authSetPassword } from '../../api/auth';

const PW_DIGIT_OR_SPECIAL = /[0-9!@#$%^&*()\-_=+[\]{}|;:'",.<>?/\\`~]/;

interface Props {
  me: User;
  onUpdate: (u: User) => void;
}

export function PasswordTab({ me, onUpdate }: Props) {
  const { t } = useTranslation('settings');
  const [pwCurrent, setPwCurrent] = useState('');
  const [pwNew, setPwNew] = useState('');
  const [pwConfirm, setPwConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const pwLongEnough       = pwNew.length >= 8;
  const pwHasDigitOrSpecial = PW_DIGIT_OR_SPECIAL.test(pwNew);
  const pwStrong            = pwLongEnough && pwHasDigitOrSpecial;

  async function onSave() {
    setError(null); setOk(false);
    if (!pwStrong) return setError(
      !pwLongEnough
        ? t('password.minLengthError')
        : t('password.digitOrSpecialError')
    );
    if (pwNew !== pwConfirm) return setError(t('auth:register.passwordMismatch'));
    setBusy(true);
    try {
      await authSetPassword(pwNew, me.has_password ? pwCurrent : undefined);
      onUpdate({ ...me, has_password: true });
      setPwCurrent(''); setPwNew(''); setPwConfirm('');
      setOk(true);
      setTimeout(() => setOk(false), 2500);
    } catch (e: any) {
      setError(e?.message ?? t('common:error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="psBody">
      <div className="psPassStatus">
        <span className="psLabel" style={{ marginBottom: 0 }}>{t('password.statusLabel')}</span>
        <span className={`ppBadge ${me.has_password ? 'has' : 'none'}`}>
          {me.has_password ? `✓ ${t('password.statusSet')}` : `✗ ${t('password.statusNotSet')}`}
        </span>
      </div>

      {me.has_password && (
        <div className="psField">
          <label className="psLabel">{t('password.currentPassword')}</label>
          <PasswordInput value={pwCurrent} onChange={setPwCurrent} placeholder={t('password.currentPassword')} className="psInput" wrapClass="psInputWrap" eyeClass="psEye" />
        </div>
      )}

      <div className="psField">
        <label className="psLabel">{t('password.newPassword')}</label>
        <PasswordInput value={pwNew} onChange={setPwNew} placeholder={t('auth:register.passwordMinLength')} className="psInput" wrapClass="psInputWrap" eyeClass="psEye" />
        {pwNew.length > 0 && (
          <div className="pwStrength pwStrengthPs">
            <span className={pwLongEnough ? 'pwReqOk' : 'pwReqNo'}>
              {pwLongEnough ? '✓' : '✗'} {t('auth:register.passwordMinLength')}
            </span>
            <span className={pwHasDigitOrSpecial ? 'pwReqOk' : 'pwReqNo'}>
              {pwHasDigitOrSpecial ? '✓' : '✗'} {t('auth:register.passwordDigitOrSpecial')}
            </span>
          </div>
        )}
      </div>

      <div className="psField">
        <label className="psLabel">{t('auth:register.confirmPassword')}</label>
        <PasswordInput value={pwConfirm} onChange={setPwConfirm} placeholder={t('auth:register.confirmPasswordPlaceholder')} className="psInput" wrapClass="psInputWrap" eyeClass="psEye" />
      </div>

      {error && <div className="psError">{error}</div>}
      {ok && <div className="psOk">✓ {t('password.updateSuccess')}</div>}

      <button className="psSaveBtn" onClick={onSave} disabled={busy}>
        {busy ? '…' : me.has_password ? t('password.changeBtn') : t('password.setBtn')}
      </button>
    </div>
  );
}
