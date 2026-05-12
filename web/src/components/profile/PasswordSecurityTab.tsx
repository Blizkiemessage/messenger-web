/**
 * PasswordSecurityTab
 *
 * Combined "Пароль и безопасность" tab.
 * Password section at top, 2FA section below, separated by a divider.
 */
import { useState, useCallback } from 'react';
import { type User } from '../../types';
import { PasswordInput } from '../ui/PasswordInput';
import { authSetPassword } from '../../api/auth';
import { totpSetup, totpConfirm, totpDisable, totpRegenerateBackup } from '../../api/totp';
import { PasskeysSection } from './PasskeysSection';

const PW_DIGIT_OR_SPECIAL = /[0-9!@#$%^&*()\-_=+[\]{}|;:'",.<>?/\\`~]/;

interface Props {
  me: User;
  onUpdate: (u: User) => void;
}

type TotpStep =
  | 'idle'
  | 'setup-qr'
  | 'setup-done'
  | 'disable-confirm'
  | 'regen-confirm'
  | 'regen-done';

interface SetupData { secret: string; qrDataUrl: string; }

export function PasswordSecurityTab({ me, onUpdate }: Props) {

  // ── Password state ──────────────────────────────────────────────────
  const [pwCurrent,  setPwCurrent]  = useState('');
  const [pwNew,      setPwNew]      = useState('');
  const [pwConfirm,  setPwConfirm]  = useState('');
  const [pwBusy,     setPwBusy]     = useState(false);
  const [pwError,    setPwError]    = useState<string | null>(null);
  const [pwOk,       setPwOk]       = useState(false);

  const pwLongEnough       = pwNew.length >= 8;
  const pwHasDigitOrSpecial = PW_DIGIT_OR_SPECIAL.test(pwNew);
  const pwStrong            = pwLongEnough && pwHasDigitOrSpecial;

  async function savePw() {
    setPwError(null); setPwOk(false);
    if (!pwStrong) return setPwError(
      !pwLongEnough ? 'Пароль: минимум 8 символов' : 'Пароль должен содержать хотя бы одну цифру или спецсимвол'
    );
    if (pwNew !== pwConfirm) return setPwError('Пароли не совпадают');
    setPwBusy(true);
    try {
      await authSetPassword(pwNew, me.has_password ? pwCurrent : undefined);
      onUpdate({ ...me, has_password: true });
      setPwCurrent(''); setPwNew(''); setPwConfirm('');
      setPwOk(true);
      setTimeout(() => setPwOk(false), 2500);
    } catch (e: any) {
      setPwError(e?.message ?? 'Ошибка');
    } finally {
      setPwBusy(false);
    }
  }

  // ── 2FA state ───────────────────────────────────────────────────────
  const enabled = !!me.totp_enabled;
  const [step,        setStep]        = useState<TotpStep>('idle');
  const [setupData,   setSetupData]   = useState<SetupData | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [code,        setCode]        = useState('');
  const [tfaBusy,     setTfaBusy]     = useState(false);
  const [tfaError,    setTfaError]    = useState<string | null>(null);
  const [copied,      setCopied]      = useState(false);

  function resetTfa() {
    setStep('idle'); setCode(''); setTfaError(null);
    setSetupData(null); setBackupCodes([]);
  }

  const startSetup = useCallback(async () => {
    setTfaBusy(true); setTfaError(null);
    try {
      const data = await totpSetup();
      setSetupData({ secret: data.secret, qrDataUrl: data.qrDataUrl });
      setCode(''); setStep('setup-qr');
    } catch (e: any) { setTfaError(e?.message ?? 'Ошибка'); }
    finally { setTfaBusy(false); }
  }, []);

  const confirmSetup = useCallback(async () => {
    if (!/^\d{6}$/.test(code.trim())) return setTfaError('Введите 6-значный код');
    setTfaBusy(true); setTfaError(null);
    try {
      const res = await totpConfirm(code.trim());
      setBackupCodes(res.backupCodes);
      onUpdate({ ...me, totp_enabled: true });
      setStep('setup-done');
    } catch (e: any) { setTfaError(e?.message ?? 'Неверный код'); }
    finally { setTfaBusy(false); }
  }, [code, me, onUpdate]);

  const confirmDisable = useCallback(async () => {
    if (!code.trim()) return setTfaError('Введите код');
    setTfaBusy(true); setTfaError(null);
    try {
      await totpDisable(code.trim());
      onUpdate({ ...me, totp_enabled: false });
      resetTfa();
    } catch (e: any) { setTfaError(e?.message ?? 'Неверный код'); }
    finally { setTfaBusy(false); }
  }, [code, me, onUpdate]); // eslint-disable-line

  const confirmRegen = useCallback(async () => {
    if (!/^\d{6}$/.test(code.trim())) return setTfaError('Введите 6-значный TOTP-код');
    setTfaBusy(true); setTfaError(null);
    try {
      const res = await totpRegenerateBackup(code.trim());
      setBackupCodes(res.backupCodes);
      setStep('regen-done');
    } catch (e: any) { setTfaError(e?.message ?? 'Неверный код'); }
    finally { setTfaBusy(false); }
  }, [code]);

  function copyBackupCodes() {
    navigator.clipboard.writeText(backupCodes.join('\n')).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 2000);
    });
  }

  // ── Render ──────────────────────────────────────────────────────────
  return (
    <div className="psBody">

      {/* ══════════════ PASSWORD SECTION ══════════════ */}
      <div className="psSectionLabel">Пароль</div>

      <div className="psPassStatus">
        <span className="psLabel" style={{ marginBottom: 0 }}>Статус</span>
        <span className={`ppBadge ${me.has_password ? 'has' : 'none'}`}>
          {me.has_password ? '✓ Установлен' : '✗ Не задан'}
        </span>
      </div>

      {me.has_password && (
        <div className="psField">
          <label className="psLabel">Текущий пароль</label>
          <PasswordInput value={pwCurrent} onChange={setPwCurrent} placeholder="Текущий пароль"
            className="psInput" wrapClass="psInputWrap" eyeClass="psEye" />
        </div>
      )}

      <div className="psField">
        <label className="psLabel">Новый пароль</label>
        <PasswordInput value={pwNew} onChange={setPwNew} placeholder="Минимум 8 символов"
          className="psInput" wrapClass="psInputWrap" eyeClass="psEye" />
        {pwNew.length > 0 && (
          <div className="pwStrength pwStrengthPs">
            <span className={pwLongEnough ? 'pwReqOk' : 'pwReqNo'}>
              {pwLongEnough ? '✓' : '✗'} Минимум 8 символов
            </span>
            <span className={pwHasDigitOrSpecial ? 'pwReqOk' : 'pwReqNo'}>
              {pwHasDigitOrSpecial ? '✓' : '✗'} Цифра или спецсимвол
            </span>
          </div>
        )}
      </div>

      <div className="psField">
        <label className="psLabel">Повторите пароль</label>
        <PasswordInput value={pwConfirm} onChange={setPwConfirm} placeholder="Повторите пароль"
          className="psInput" wrapClass="psInputWrap" eyeClass="psEye" />
      </div>

      {pwError && <div className="psError">{pwError}</div>}
      {pwOk    && <div className="psOk">✓ Пароль успешно обновлён</div>}

      <button className="psSaveBtn" onClick={savePw} disabled={pwBusy}>
        {pwBusy ? '…' : me.has_password ? 'Сменить пароль' : 'Установить пароль'}
      </button>

      {/* ══════════════ DIVIDER ══════════════ */}
      <div className="psSectionDivider">
        <span>Двухфакторная аутентификация</span>
      </div>

      {/* ══════════════ 2FA SECTION ══════════════ */}

      {/* ── Idle: status + action buttons ── */}
      {step === 'idle' && (
        <>
          <div className="psPassStatus">
            <span className="psLabel" style={{ marginBottom: 0 }}>Статус 2FA</span>
            <span className={`ppBadge ${enabled ? 'has' : 'none'}`}>
              {enabled ? '✓ Включена' : '✗ Отключена'}
            </span>
          </div>

          <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            {enabled
              ? 'При входе потребуется код из приложения-аутентификатора (Google Authenticator, Authy и др.).'
              : 'Двухфакторная аутентификация значительно повышает безопасность аккаунта. После включения при каждом входе нужно будет вводить код из приложения-аутентификатора.'}
          </div>

          {tfaError && <div className="psError">{tfaError}</div>}

          {!enabled && (
            <button className="psSaveBtn" onClick={startSetup} disabled={tfaBusy}>
              {tfaBusy ? '…' : 'Включить 2FA'}
            </button>
          )}
          {enabled && (
            <>
              <button
                className="psSaveBtn"
                style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}
                onClick={() => { setStep('regen-confirm'); setCode(''); setTfaError(null); }}
              >
                Обновить резервные коды
              </button>
              <button
                className="psDeleteBtn"
                style={{ marginTop: 4 }}
                onClick={() => { setStep('disable-confirm'); setCode(''); setTfaError(null); }}
              >
                Отключить 2FA
              </button>
            </>
          )}
        </>
      )}

      {/* ── Setup: QR code screen ── */}
      {step === 'setup-qr' && setupData && (
        <>
          <div style={{ textAlign: 'center' }}>
            <img src={setupData.qrDataUrl} alt="QR код для 2FA" style={{ width: 200, height: 200, borderRadius: 8 }} />
          </div>
          <div className="psField">
            <label className="psLabel">Секретный ключ (ручной ввод)</label>
            <div
              className="psInput"
              style={{ fontFamily: 'monospace', letterSpacing: 2, fontSize: 13, cursor: 'pointer', userSelect: 'all', wordBreak: 'break-all' }}
              title="Нажмите, чтобы скопировать"
              onClick={() => navigator.clipboard.writeText(setupData.secret)}
            >
              {setupData.secret}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>
              Отсканируйте QR-код или введите ключ вручную в Google Authenticator, Authy или другое приложение.
            </div>
          </div>
          <div className="psField">
            <label className="psLabel">Код подтверждения</label>
            <input
              className="psInput"
              value={code}
              onChange={e => { setCode(e.target.value); setTfaError(null); }}
              placeholder="000000"
              inputMode="numeric"
              maxLength={6}
              autoFocus
              autoComplete="one-time-code"
              style={{ letterSpacing: 4 }}
              onKeyDown={e => e.key === 'Enter' && confirmSetup()}
            />
          </div>
          {tfaError && <div className="psError">{tfaError}</div>}
          <button className="psSaveBtn" onClick={confirmSetup} disabled={tfaBusy || !/^\d{6}$/.test(code.trim())}>
            {tfaBusy ? '…' : 'Включить 2FA'}
          </button>
          <button className="psDeleteBtn" style={{ marginTop: 4 }} onClick={resetTfa} disabled={tfaBusy}>
            Отмена
          </button>
        </>
      )}

      {/* ── Backup codes display ── */}
      {(step === 'setup-done' || step === 'regen-done') && (
        <>
          <div className="psOk" style={{ marginBottom: 4 }}>
            {step === 'setup-done' ? '✓ Двухфакторная аутентификация включена' : '✓ Резервные коды обновлены'}
          </div>
          <div className="psField">
            <label className="psLabel">Резервные коды</label>
            <div style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: '12px 16px', fontSize: 13, fontFamily: 'monospace', lineHeight: 2, letterSpacing: 1 }}>
              {backupCodes.map((c, i) => <div key={i}>{c}</div>)}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 6 }}>
              Сохраните эти коды в безопасном месте. Каждый код можно использовать только один раз.
            </div>
          </div>
          <button className="psSaveBtn" onClick={copyBackupCodes}>
            {copied ? '✓ Скопировано!' : 'Скопировать коды'}
          </button>
          <button className="psSaveBtn" style={{ marginTop: 4, background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }} onClick={resetTfa}>
            Готово
          </button>
        </>
      )}

      {/* ── Disable confirm ── */}
      {step === 'disable-confirm' && (
        <>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            Для отключения 2FA введите действующий TOTP-код или один из резервных кодов.
          </div>
          <div className="psField">
            <label className="psLabel">Код подтверждения</label>
            <input
              className="psInput"
              value={code}
              onChange={e => { setCode(e.target.value); setTfaError(null); }}
              placeholder="000000 или XXXXXX-XXXXXX"
              autoFocus
              onKeyDown={e => e.key === 'Enter' && confirmDisable()}
            />
          </div>
          {tfaError && <div className="psError">{tfaError}</div>}
          <button className="psDeleteConfirmBtn" onClick={confirmDisable} disabled={tfaBusy || !code.trim()}>
            {tfaBusy ? '…' : 'Отключить 2FA'}
          </button>
          <button className="psDeleteCancelBtn" style={{ marginTop: 4 }} onClick={resetTfa} disabled={tfaBusy}>
            Отмена
          </button>
        </>
      )}

      {/* ── Regen confirm ── */}
      {step === 'regen-confirm' && (
        <>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            Введите текущий TOTP-код для создания новых резервных кодов. Старые коды станут недействительными.
          </div>
          <div className="psField">
            <label className="psLabel">TOTP-код</label>
            <input
              className="psInput"
              value={code}
              onChange={e => { setCode(e.target.value); setTfaError(null); }}
              placeholder="000000"
              inputMode="numeric"
              maxLength={6}
              autoFocus
              autoComplete="one-time-code"
              style={{ letterSpacing: 4 }}
              onKeyDown={e => e.key === 'Enter' && confirmRegen()}
            />
          </div>
          {tfaError && <div className="psError">{tfaError}</div>}
          <button className="psSaveBtn" onClick={confirmRegen} disabled={tfaBusy || !/^\d{6}$/.test(code.trim())}>
            {tfaBusy ? '…' : 'Создать новые коды'}
          </button>
          <button className="psDeleteCancelBtn" style={{ marginTop: 4 }} onClick={resetTfa} disabled={tfaBusy}>
            Отмена
          </button>
        </>
      )}

      {/* ══════════════ PASSKEYS SECTION ══════════════ */}
      <div className="psSectionDivider">
        <span>Ключи доступа (Passkeys)</span>
      </div>
      <PasskeysSection />

    </div>
  );
}
