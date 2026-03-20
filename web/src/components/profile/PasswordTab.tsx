/**
 * PasswordTab
 *
 * "Пароль" tab inside ProfileSettingsModal.
 * Handles setting and changing password.
 */

import { useState } from 'react';
import { type User } from '../../types';
import { PasswordInput } from '../ui/PasswordInput';
import { authSetPassword } from '../../api/auth';

interface Props {
  me: User;
  onUpdate: (u: User) => void;
}

export function PasswordTab({ me, onUpdate }: Props) {
  const [pwCurrent, setPwCurrent] = useState('');
  const [pwNew, setPwNew] = useState('');
  const [pwConfirm, setPwConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  async function onSave() {
    setError(null); setOk(false);
    if (pwNew.length < 6) return setError('Пароль: минимум 6 символов');
    if (pwNew !== pwConfirm) return setError('Пароли не совпадают');
    setBusy(true);
    try {
      await authSetPassword(pwNew, me.has_password ? pwCurrent : undefined);
      onUpdate({ ...me, has_password: true });
      setPwCurrent(''); setPwNew(''); setPwConfirm('');
      setOk(true);
      setTimeout(() => setOk(false), 2500);
    } catch (e: any) {
      setError(e?.message ?? 'Ошибка');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="psBody">
      <div className="psPassStatus">
        <span className="psLabel" style={{ marginBottom: 0 }}>Статус пароля</span>
        <span className={`ppBadge ${me.has_password ? 'has' : 'none'}`}>
          {me.has_password ? '✓ Установлен' : '✗ Не задан'}
        </span>
      </div>

      {me.has_password && (
        <div className="psField">
          <label className="psLabel">Текущий пароль</label>
          <PasswordInput value={pwCurrent} onChange={setPwCurrent} placeholder="Текущий пароль" className="psInput" wrapClass="psInputWrap" eyeClass="psEye" />
        </div>
      )}

      <div className="psField">
        <label className="psLabel">Новый пароль</label>
        <PasswordInput value={pwNew} onChange={setPwNew} placeholder="Минимум 6 символов" className="psInput" wrapClass="psInputWrap" eyeClass="psEye" />
      </div>

      <div className="psField">
        <label className="psLabel">Повторите пароль</label>
        <PasswordInput value={pwConfirm} onChange={setPwConfirm} placeholder="Повторите пароль" className="psInput" wrapClass="psInputWrap" eyeClass="psEye" />
      </div>

      {error && <div className="psError">{error}</div>}
      {ok && <div className="psOk">✓ Пароль успешно обновлён</div>}

      <button className="psSaveBtn" onClick={onSave} disabled={busy}>
        {busy ? '…' : me.has_password ? 'Сменить пароль' : 'Установить пароль'}
      </button>
    </div>
  );
}
