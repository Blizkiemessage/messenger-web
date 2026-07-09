/**
 * PasswordSecurityTab
 *
 * Combined "Пароль и безопасность" tab.
 * Password section at top, 2FA section below, separated by a divider.
 */
import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation('settings');

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
      !pwLongEnough ? t('password.minLengthError') : t('password.digitOrSpecialError')
    );
    if (pwNew !== pwConfirm) return setPwError(t('auth:register.passwordMismatch'));
    setPwBusy(true);
    try {
      await authSetPassword(pwNew, me.has_password ? pwCurrent : undefined);
      onUpdate({ ...me, has_password: true });
      setPwCurrent(''); setPwNew(''); setPwConfirm('');
      setPwOk(true);
      setTimeout(() => setPwOk(false), 2500);
    } catch (e: any) {
      setPwError(e?.message ?? t('common:error'));
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
    } catch (e: any) { setTfaError(e?.message ?? t('common:error')); }
    finally { setTfaBusy(false); }
  }, [t]);

  const confirmSetup = useCallback(async () => {
    if (!/^\d{6}$/.test(code.trim())) return setTfaError(t('twoFactor.enter6DigitCode'));
    setTfaBusy(true); setTfaError(null);
    try {
      const res = await totpConfirm(code.trim());
      setBackupCodes(res.backupCodes);
      onUpdate({ ...me, totp_enabled: true });
      setStep('setup-done');
    } catch (e: any) { setTfaError(e?.message ?? t('twoFactor.invalidCode')); }
    finally { setTfaBusy(false); }
  }, [code, me, onUpdate, t]);

  const confirmDisable = useCallback(async () => {
    if (!code.trim()) return setTfaError(t('twoFactor.enterCode'));
    setTfaBusy(true); setTfaError(null);
    try {
      await totpDisable(code.trim());
      onUpdate({ ...me, totp_enabled: false });
      resetTfa();
    } catch (e: any) { setTfaError(e?.message ?? t('twoFactor.invalidCode')); }
    finally { setTfaBusy(false); }
  }, [code, me, onUpdate, t]); // eslint-disable-line

  const confirmRegen = useCallback(async () => {
    if (!/^\d{6}$/.test(code.trim())) return setTfaError(t('twoFactor.enter6DigitTotp'));
    setTfaBusy(true); setTfaError(null);
    try {
      const res = await totpRegenerateBackup(code.trim());
      setBackupCodes(res.backupCodes);
      setStep('regen-done');
    } catch (e: any) { setTfaError(e?.message ?? t('twoFactor.invalidCode')); }
    finally { setTfaBusy(false); }
  }, [code, t]);

  function copyBackupCodes() {
    navigator.clipboard.writeText(backupCodes.join('\n')).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 2000);
    });
  }

  // ── Render ──────────────────────────────────────────────────────────
  return (
    <div className="psBody">

      {/* ══════════════ PASSWORD SECTION ══════════════ */}
      <div className="psSectionLabel">{t('password.title')}</div>

      <div className="psPassStatus">
        <span className="psLabel" style={{ marginBottom: 0 }}>{t('password.status')}</span>
        <span className={`ppBadge ${me.has_password ? 'has' : 'none'}`}>
          {me.has_password ? `✓ ${t('password.statusSet')}` : `✗ ${t('password.statusNotSet')}`}
        </span>
      </div>

      {me.has_password && (
        <div className="psField">
          <label className="psLabel">{t('password.currentPassword')}</label>
          <PasswordInput value={pwCurrent} onChange={setPwCurrent} placeholder={t('password.currentPassword')}
            className="psInput" wrapClass="psInputWrap" eyeClass="psEye" />
        </div>
      )}

      <div className="psField">
        <label className="psLabel">{t('password.newPassword')}</label>
        <PasswordInput value={pwNew} onChange={setPwNew} placeholder={t('auth:register.passwordMinLength')}
          className="psInput" wrapClass="psInputWrap" eyeClass="psEye" />
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
        <PasswordInput value={pwConfirm} onChange={setPwConfirm} placeholder={t('auth:register.confirmPasswordPlaceholder')}
          className="psInput" wrapClass="psInputWrap" eyeClass="psEye" />
      </div>

      {pwError && <div className="psError">{pwError}</div>}
      {pwOk    && <div className="psOk">✓ {t('password.updateSuccess')}</div>}

      <button className="psSaveBtn" onClick={savePw} disabled={pwBusy}>
        {pwBusy ? '…' : me.has_password ? t('password.changeBtn') : t('password.setBtn')}
      </button>

      {/* ══════════════ DIVIDER ══════════════ */}
      <div className="psSectionDivider">
        <span>{t('twoFactor.title')}</span>
      </div>

      {/* ══════════════ 2FA SECTION ══════════════ */}

      {/* ── Idle: status + action buttons ── */}
      {step === 'idle' && (
        <>
          <div className="psPassStatus">
            <span className="psLabel" style={{ marginBottom: 0 }}>{t('twoFactor.status')}</span>
            <span className={`ppBadge ${enabled ? 'has' : 'none'}`}>
              {enabled ? `✓ ${t('twoFactor.enabled')}` : `✗ ${t('twoFactor.disabled')}`}
            </span>
          </div>

          <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            {enabled
              ? t('twoFactor.enabledHint')
              : t('twoFactor.disabledHint')}
          </div>

          {tfaError && <div className="psError">{tfaError}</div>}

          {!enabled && (
            <button className="psSaveBtn" onClick={startSetup} disabled={tfaBusy}>
              {tfaBusy ? '…' : t('twoFactor.enableBtn')}
            </button>
          )}
          {enabled && (
            <>
              <button
                className="psSaveBtn"
                style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}
                onClick={() => { setStep('regen-confirm'); setCode(''); setTfaError(null); }}
              >
                {t('twoFactor.regenBackupBtn')}
              </button>
              <button
                className="psDeleteBtn"
                style={{ marginTop: 4 }}
                onClick={() => { setStep('disable-confirm'); setCode(''); setTfaError(null); }}
              >
                {t('twoFactor.disableBtn')}
              </button>
            </>
          )}
        </>
      )}

      {/* ── Setup: QR code screen ── */}
      {step === 'setup-qr' && setupData && (
        <>
          <div style={{ textAlign: 'center' }}>
            <img src={setupData.qrDataUrl} alt={t('twoFactor.qrAlt')} style={{ width: 200, height: 200, borderRadius: 8 }} />
          </div>
          <div className="psField">
            <label className="psLabel">{t('twoFactor.secretKeyLabel')}</label>
            <div
              className="psInput"
              style={{ fontFamily: 'monospace', letterSpacing: 2, fontSize: 13, cursor: 'pointer', userSelect: 'all', wordBreak: 'break-all' }}
              title={t('twoFactor.clickToCopy')}
              onClick={() => navigator.clipboard.writeText(setupData.secret)}
            >
              {setupData.secret}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>
              {t('twoFactor.scanHint')}
            </div>
          </div>
          <div className="psField">
            <label className="psLabel">{t('twoFactor.confirmCodeLabel')}</label>
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
            {tfaBusy ? '…' : t('twoFactor.enableBtn')}
          </button>
          <button className="psDeleteBtn" style={{ marginTop: 4 }} onClick={resetTfa} disabled={tfaBusy}>
            {t('common:cancel')}
          </button>
        </>
      )}

      {/* ── Backup codes display ── */}
      {(step === 'setup-done' || step === 'regen-done') && (
        <>
          <div className="psOk" style={{ marginBottom: 4 }}>
            {step === 'setup-done' ? `✓ ${t('twoFactor.setupDone')}` : `✓ ${t('twoFactor.regenDone')}`}
          </div>
          <div className="psField">
            <label className="psLabel">{t('twoFactor.backupCodesLabel')}</label>
            <div style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: '12px 16px', fontSize: 13, fontFamily: 'monospace', lineHeight: 2, letterSpacing: 1 }}>
              {backupCodes.map((c, i) => <div key={i}>{c}</div>)}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 6 }}>
              {t('twoFactor.backupCodesHint')}
            </div>
          </div>
          <button className="psSaveBtn" onClick={copyBackupCodes}>
            {copied ? `✓ ${t('twoFactor.copied')}` : t('twoFactor.copyCodesBtn')}
          </button>
          <button className="psSaveBtn" style={{ marginTop: 4, background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }} onClick={resetTfa}>
            {t('twoFactor.doneBtn')}
          </button>
        </>
      )}

      {/* ── Disable confirm ── */}
      {step === 'disable-confirm' && (
        <>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            {t('twoFactor.disableHint')}
          </div>
          <div className="psField">
            <label className="psLabel">{t('twoFactor.confirmCodeLabel')}</label>
            <input
              className="psInput"
              value={code}
              onChange={e => { setCode(e.target.value); setTfaError(null); }}
              placeholder={t('twoFactor.disablePlaceholder')}
              autoFocus
              onKeyDown={e => e.key === 'Enter' && confirmDisable()}
            />
          </div>
          {tfaError && <div className="psError">{tfaError}</div>}
          <button className="psDeleteConfirmBtn" onClick={confirmDisable} disabled={tfaBusy || !code.trim()}>
            {tfaBusy ? '…' : t('twoFactor.disableBtn')}
          </button>
          <button className="psDeleteCancelBtn" style={{ marginTop: 4 }} onClick={resetTfa} disabled={tfaBusy}>
            {t('common:cancel')}
          </button>
        </>
      )}

      {/* ── Regen confirm ── */}
      {step === 'regen-confirm' && (
        <>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            {t('twoFactor.regenHint')}
          </div>
          <div className="psField">
            <label className="psLabel">{t('twoFactor.totpCodeLabel')}</label>
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
            {tfaBusy ? '…' : t('twoFactor.createNewCodesBtn')}
          </button>
          <button className="psDeleteCancelBtn" style={{ marginTop: 4 }} onClick={resetTfa} disabled={tfaBusy}>
            {t('common:cancel')}
          </button>
        </>
      )}

      {/* ══════════════ PASSKEYS SECTION ══════════════ */}
      <div className="psSectionDivider">
        <span>{t('twoFactor.passkeysSectionTitle')}</span>
      </div>
      <PasskeysSection />

    </div>
  );
}
