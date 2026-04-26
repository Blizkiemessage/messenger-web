/**
 * SecurityTab — TOTP two-factor authentication management.
 * Lives inside ProfileSettingsModal under the "Безопасность" menu item.
 */

import { useState, useCallback } from 'react';
import { type User } from '../../types';
import { totpSetup, totpConfirm, totpDisable, totpRegenerateBackup } from '../../api/totp';

interface Props {
  me: User;
  onUpdate: (u: User) => void;
}

type Step =
  | 'idle'          // showing current status
  | 'setup-qr'      // showing QR code, waiting for first verification
  | 'setup-done'    // showing backup codes after enabling
  | 'disable-confirm' // asking for code before disabling
  | 'regen-confirm' // asking for code before regenerating backup codes
  | 'regen-done';   // showing new backup codes

interface SetupData { secret: string; qrDataUrl: string; }

export function SecurityTab({ me, onUpdate }: Props) {
  const enabled = !!me.totp_enabled;

  const [step,       setStep]       = useState<Step>('idle');
  const [setupData,  setSetupData]  = useState<SetupData | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [code,       setCode]       = useState('');
  const [busy,       setBusy]       = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [copied,     setCopied]     = useState(false);

  function reset() {
    setStep('idle');
    setCode('');
    setError(null);
    setSetupData(null);
    setBackupCodes([]);
  }

  // ── Setup flow ──────────────────────────────────────────────────────────────

  const startSetup = useCallback(async () => {
    setBusy(true); setError(null);
    try {
      const data = await totpSetup();
      setSetupData({ secret: data.secret, qrDataUrl: data.qrDataUrl });
      setCode('');
      setStep('setup-qr');
    } catch (e: any) {
      setError(e?.message ?? 'Ошибка');
    } finally {
      setBusy(false);
    }
  }, []);

  const confirmSetup = useCallback(async () => {
    if (!/^\d{6}$/.test(code.trim())) return setError('Введите 6-значный код');
    setBusy(true); setError(null);
    try {
      const res = await totpConfirm(code.trim());
      setBackupCodes(res.backupCodes);
      onUpdate({ ...me, totp_enabled: true });
      setStep('setup-done');
    } catch (e: any) {
      setError(e?.message ?? 'Неверный код');
    } finally {
      setBusy(false);
    }
  }, [code, me, onUpdate]);

  // ── Disable flow ────────────────────────────────────────────────────────────

  const confirmDisable = useCallback(async () => {
    if (!code.trim()) return setError('Введите код');
    setBusy(true); setError(null);
    try {
      await totpDisable(code.trim());
      onUpdate({ ...me, totp_enabled: false });
      reset();
    } catch (e: any) {
      setError(e?.message ?? 'Неверный код');
    } finally {
      setBusy(false);
    }
  }, [code, me, onUpdate]);

  // ── Regenerate backup codes flow ────────────────────────────────────────────

  const confirmRegen = useCallback(async () => {
    if (!/^\d{6}$/.test(code.trim())) return setError('Введите 6-значный TOTP-код');
    setBusy(true); setError(null);
    try {
      const res = await totpRegenerateBackup(code.trim());
      setBackupCodes(res.backupCodes);
      setStep('regen-done');
    } catch (e: any) {
      setError(e?.message ?? 'Неверный код');
    } finally {
      setBusy(false);
    }
  }, [code]);

  // ── Copy backup codes ───────────────────────────────────────────────────────

  function copyBackupCodes() {
    navigator.clipboard.writeText(backupCodes.join('\n')).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  // ── Render helpers ──────────────────────────────────────────────────────────

  function CodeInput({
    label,
    placeholder = '000000',
    inputMode = 'numeric',
    maxLength = 6,
  }: {
    label: string;
    placeholder?: string;
    inputMode?: 'numeric' | 'text';
    maxLength?: number;
  }) {
    return (
      <div className="psField">
        <label className="psLabel">{label}</label>
        <input
          className="psInput"
          value={code}
          onChange={e => { setCode(e.target.value); setError(null); }}
          placeholder={placeholder}
          inputMode={inputMode}
          maxLength={maxLength}
          autoFocus
          autoComplete="one-time-code"
          onKeyDown={e => {
            if (e.key === 'Enter') {
              if (step === 'setup-qr') confirmSetup();
              else if (step === 'disable-confirm') confirmDisable();
              else if (step === 'regen-confirm') confirmRegen();
            }
          }}
          style={{ letterSpacing: inputMode === 'numeric' ? 4 : 1 }}
        />
      </div>
    );
  }

  // ── QR / setup screen ───────────────────────────────────────────────────────
  if (step === 'setup-qr' && setupData) {
    return (
      <div className="psBody">
        <div style={{ textAlign: 'center', marginBottom: 8 }}>
          <img src={setupData.qrDataUrl} alt="QR код для 2FA" style={{ width: 200, height: 200, borderRadius: 8 }} />
        </div>

        <div className="psField">
          <label className="psLabel">Секретный ключ (ручной ввод)</label>
          <div
            className="psInput"
            style={{
              fontFamily: 'monospace',
              letterSpacing: 2,
              fontSize: 13,
              cursor: 'pointer',
              userSelect: 'all',
              wordBreak: 'break-all',
            }}
            title="Нажмите, чтобы скопировать"
            onClick={() => navigator.clipboard.writeText(setupData.secret)}
          >
            {setupData.secret}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>
            Отсканируйте QR-код или введите ключ вручную в Google Authenticator, Authy или другое приложение.
          </div>
        </div>

        <CodeInput label="Код подтверждения" placeholder="000000" />

        {error && <div className="psError">{error}</div>}

        <button className="psSaveBtn" onClick={confirmSetup} disabled={busy || !/^\d{6}$/.test(code.trim())}>
          {busy ? '…' : 'Включить 2FA'}
        </button>
        <button
          className="psDeleteBtn"
          style={{ marginTop: 8 }}
          onClick={reset}
          disabled={busy}
        >
          Отмена
        </button>
      </div>
    );
  }

  // ── Backup codes display (after enable or regen) ────────────────────────────
  if (step === 'setup-done' || step === 'regen-done') {
    return (
      <div className="psBody">
        <div className="psOk" style={{ marginBottom: 8 }}>
          {step === 'setup-done'
            ? '✓ Двухфакторная аутентификация включена'
            : '✓ Резервные коды обновлены'}
        </div>

        <div className="psField">
          <label className="psLabel">Резервные коды</label>
          <div style={{
            background: 'var(--bg-secondary)',
            borderRadius: 8,
            padding: '12px 16px',
            fontSize: 13,
            fontFamily: 'monospace',
            lineHeight: 2,
            letterSpacing: 1,
          }}>
            {backupCodes.map((c, i) => (
              <div key={i}>{c}</div>
            ))}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 6 }}>
            Сохраните эти коды в безопасном месте. Каждый код можно использовать только один раз.
          </div>
        </div>

        <button className="psSaveBtn" onClick={copyBackupCodes}>
          {copied ? '✓ Скопировано!' : 'Скопировать коды'}
        </button>
        <button className="psSaveBtn" style={{ marginTop: 8, background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }} onClick={reset}>
          Готово
        </button>
      </div>
    );
  }

  // ── Disable confirm screen ───────────────────────────────────────────────────
  if (step === 'disable-confirm') {
    return (
      <div className="psBody">
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
          Для отключения 2FA введите действующий TOTP-код или один из резервных кодов.
        </div>

        <div className="psField">
          <label className="psLabel">Код подтверждения</label>
          <input
            className="psInput"
            value={code}
            onChange={e => { setCode(e.target.value); setError(null); }}
            placeholder="000000 или XXXXXX-XXXXXX"
            autoFocus
            onKeyDown={e => e.key === 'Enter' && confirmDisable()}
          />
        </div>

        {error && <div className="psError">{error}</div>}

        <button
          style={{ marginTop: 4 }}
          className="psDeleteConfirmBtn"
          onClick={confirmDisable}
          disabled={busy || !code.trim()}
        >
          {busy ? '…' : 'Отключить 2FA'}
        </button>
        <button className="psDeleteCancelBtn" style={{ marginTop: 8 }} onClick={reset} disabled={busy}>
          Отмена
        </button>
      </div>
    );
  }

  // ── Regen confirm screen ─────────────────────────────────────────────────────
  if (step === 'regen-confirm') {
    return (
      <div className="psBody">
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12 }}>
          Введите текущий TOTP-код для создания новых резервных кодов. Старые коды станут недействительными.
        </div>

        <CodeInput label="TOTP-код" placeholder="000000" />

        {error && <div className="psError">{error}</div>}

        <button className="psSaveBtn" onClick={confirmRegen} disabled={busy || !/^\d{6}$/.test(code.trim())}>
          {busy ? '…' : 'Создать новые коды'}
        </button>
        <button className="psDeleteCancelBtn" style={{ marginTop: 8 }} onClick={reset} disabled={busy}>
          Отмена
        </button>
      </div>
    );
  }

  // ── Idle / status screen ─────────────────────────────────────────────────────
  return (
    <div className="psBody">
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

      {error && <div className="psError">{error}</div>}

      {!enabled && (
        <button className="psSaveBtn" onClick={startSetup} disabled={busy}>
          {busy ? '…' : 'Включить 2FA'}
        </button>
      )}

      {enabled && (
        <>
          <button
            className="psSaveBtn"
            style={{ background: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}
            onClick={() => { setStep('regen-confirm'); setCode(''); setError(null); }}
          >
            Обновить резервные коды
          </button>
          <button
            className="psDeleteBtn"
            style={{ marginTop: 8 }}
            onClick={() => { setStep('disable-confirm'); setCode(''); setError(null); }}
          >
            Отключить 2FA
          </button>
        </>
      )}
    </div>
  );
}
