/**
 * ProfileTab
 * ✅ Added: "Сброс фото" button to remove avatar and restore default letter.
 * ✅ Added: Email section with change/link flow (OTP) and hide toggle.
 */
import { useState, useRef, useCallback } from 'react';
import { type User } from '../../types';
import { avatarLetter } from '../../utils/format';
import { resolveUrl } from '../ui/Avatar';
import { updateMe, requestEmailChange, verifyEmailChange } from '../../api/users';
import { Portal } from '../ui/Portal';
import client from '../../api/client';

const BIO_MAX = 150;

interface Props {
  me: User;
  token: string;
  onUpdate: (u: User) => void;
}

export function ProfileTab({ me, onUpdate }: Props) {
  const [displayName, setDisplayName] = useState(me.display_name ?? '');
  const [username,    setUsername]    = useState(me.username    ?? '');
  const [bio,         setBio]         = useState(me.bio         ?? '');
  const [birthDate,   setBirthDate]   = useState(me.birth_date  ?? '');
  const [hideBio,     setHideBio]     = useState(me.hide_bio          ?? false);
  const [hideBirth,   setHideBirth]   = useState(me.hide_birth_date   ?? false);
  const [hideEmail,   setHideEmail]   = useState(me.hide_email        ?? false);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(
    resolveUrl(me.avatar_url) ?? null
  );
  const [avatarFile,    setAvatarFile]    = useState<File | null>(null);
  const [resetAvatar,   setResetAvatar]   = useState(false);
  const [busy,  setBusy]  = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok,    setOk]    = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Email change state
  const [emailStep,    setEmailStep]    = useState<'idle' | 'input' | 'otp'>('idle');
  const [newEmail,     setNewEmail]     = useState('');
  const [emailOtp,     setEmailOtp]     = useState('');
  const [emailBusy,    setEmailBusy]    = useState(false);
  const [emailError,   setEmailError]   = useState<string | null>(null);
  const [pendingEmail, setPendingEmail] = useState('');

  // Displayed email — updated locally after successful change
  const [currentEmail, setCurrentEmail] = useState(me.email ?? null);

  function handleAvatarPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setAvatarFile(f);
    setResetAvatar(false);
    const reader = new FileReader();
    reader.onload = ev => setAvatarPreview(ev.target?.result as string);
    reader.readAsDataURL(f);
  }

  function handleResetAvatar() {
    setAvatarFile(null);
    setAvatarPreview(null);
    setResetAvatar(true);
  }

  const hasAvatar = !!avatarPreview;

  async function uploadAvatar(file: File): Promise<string> {
    const fd = new FormData();
    fd.append('file', file);
    const res = await client.post<{ url: string }>('/upload', fd, {
      headers: { 'Content-Type': undefined },
      timeout: 60_000,
    });
    return res.data.url;
  }

  async function onSave() {
    setError(null); setBusy(true); setOk(false);
    try {
      let avatar_url: string | null = me.avatar_url ?? null;
      if (resetAvatar)       avatar_url = null;
      else if (avatarFile)   avatar_url = await uploadAvatar(avatarFile);

      const next = await updateMe({
        username:        username.trim().toLowerCase() || null,
        display_name:    displayName.trim() || '',
        avatar_url,
        bio:             bio.trim() || null,
        birth_date:      birthDate || null,
        hide_email:      hideEmail,
        hide_bio:        hideBio,
        hide_birth_date: hideBirth,
      });
      onUpdate(next);
      setResetAvatar(false);
      setAvatarFile(null);
      setOk(true);
      setTimeout(() => setOk(false), 2500);
    } catch (e: any) {
      setError(e?.message ?? 'Ошибка сохранения');
    } finally {
      setBusy(false);
    }
  }

  const onRequestEmailChange = useCallback(async () => {
    const trimmed = newEmail.trim();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setEmailError('Введите корректный email');
      return;
    }
    setEmailError(null);
    setEmailBusy(true);
    try {
      const res = await requestEmailChange(trimmed);
      setPendingEmail(res.email);
      setEmailStep('otp');
    } catch (e: any) {
      setEmailError(e?.message ?? 'Ошибка отправки кода');
    } finally {
      setEmailBusy(false);
    }
  }, [newEmail]);

  const onVerifyEmailChange = useCallback(async () => {
    if (emailOtp.length !== 6) return;
    setEmailError(null);
    setEmailBusy(true);
    try {
      const updatedUser = await verifyEmailChange(pendingEmail, emailOtp);
      onUpdate(updatedUser);
      setCurrentEmail(updatedUser.email ?? null);
      setEmailStep('idle');
      setNewEmail('');
      setEmailOtp('');
    } catch (e: any) {
      setEmailError(e?.message ?? 'Неверный код');
      setEmailOtp('');
    } finally {
      setEmailBusy(false);
    }
  }, [emailOtp, pendingEmail, onUpdate]);

  function closeEmailModal() {
    setEmailStep('idle');
    setNewEmail('');
    setEmailOtp('');
    setEmailError(null);
  }

  return (
    <div className="psBody">
      {/* Avatar */}
      <div className="psAvatarSection">
        <div
          className="psAvatarWrap"
          onClick={() => fileRef.current?.click()}
          title="Изменить фото"
        >
          {avatarPreview
            ? <img src={avatarPreview} alt="" className="psAvatarImg" />
            : <div className="psAvatarFallback">{avatarLetter(displayName || username || '')}</div>
          }
          <div className="psAvatarOverlay">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
              <circle cx="12" cy="13" r="4"/>
            </svg>
          </div>
        </div>
        <div className="psAvatarHint">Нажмите чтобы изменить фото</div>

        {hasAvatar && (
          <button className="psAvatarResetBtn" onClick={handleResetAvatar}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2L5 6"/>
              <path d="M10 11v6M14 11v6"/>
            </svg>
            Сбросить фото
          </button>
        )}

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={handleAvatarPick}
        />
      </div>

      {/* Fields */}
      <div className="psField">
        <label className="psLabel">Имя</label>
        <input
          className="psInput"
          value={displayName}
          onChange={e => setDisplayName(e.target.value)}
          placeholder="Как вас зовут"
          maxLength={64}
        />
      </div>

      <div className="psField">
        <label className="psLabel">Username</label>
        <div className="psInputPrefix">
          <span className="psAt">@</span>
          <input
            className="psInput psInputPad"
            value={username}
            onChange={e => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
            placeholder="username"
            maxLength={32}
            autoCapitalize="none"
          />
        </div>
      </div>

      {/* Email */}
      <div className="psField">
        <label className="psLabel">Почта</label>
        {currentEmail ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="psInput" style={{ flex: 1, color: 'var(--text)', cursor: 'default', userSelect: 'text' }}>
              {currentEmail}
            </span>
            <span style={{ fontSize: 12, color: 'var(--accent)', fontWeight: 600, whiteSpace: 'nowrap' }}>
              ✓ Подтверждена
            </span>
          </div>
        ) : (
          <div className="psInput" style={{ color: 'var(--muted)', cursor: 'default' }}>
            Не привязана
          </div>
        )}
        <button
          className="psAvatarResetBtn"
          style={{ alignSelf: 'flex-start', marginTop: 4 }}
          onClick={() => { setEmailStep('input'); setEmailError(null); setNewEmail(''); }}
        >
          {currentEmail ? 'Сменить почту' : 'Привязать почту'}
        </button>
        {currentEmail && (
          <label className="psPrivacyLabel">
            <input type="checkbox" className="psCheckbox" checked={hideEmail}
              onChange={e => setHideEmail(e.target.checked)} />
            Скрыть от других пользователей
          </label>
        )}
      </div>

      <div className="psField">
        <label className="psLabel">О себе</label>
        <div className="psTextareaWrap">
          <textarea
            className="psTextarea"
            value={bio}
            onChange={e => setBio(e.target.value.slice(0, BIO_MAX))}
            placeholder="Расскажите о себе…"
            rows={3}
            maxLength={BIO_MAX}
          />
          <span className={`psCharCounter${bio.length >= BIO_MAX ? ' psCharCounterMax' : ''}`}>
            {bio.length}/{BIO_MAX}
          </span>
        </div>
        <label className="psPrivacyLabel">
          <input type="checkbox" className="psCheckbox" checked={hideBio}
            onChange={e => setHideBio(e.target.checked)} />
          Скрыть от других пользователей
        </label>
      </div>

      <div className="psField">
        <label className="psLabel">Дата рождения</label>
        <input type="date" className="psInput" value={birthDate}
          onChange={e => setBirthDate(e.target.value)} />
        <label className="psPrivacyLabel">
          <input type="checkbox" className="psCheckbox" checked={hideBirth}
            onChange={e => setHideBirth(e.target.checked)} />
          Скрыть от других пользователей
        </label>
      </div>

      {error && <div className="psError">{error}</div>}
      {ok    && <div className="psOk">✓ Профиль сохранён</div>}
      <button className="psSaveBtn" onClick={onSave} disabled={busy}>
        {busy ? '…' : 'Сохранить изменения'}
      </button>

      {/* Email input modal */}
      {emailStep === 'input' && (
        <Portal>
          <div className="modalOverlay">
            <div className="confirmCard" style={{ width: 'min(400px, 100%)', display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>
                  {currentEmail ? 'Сменить почту' : 'Привязать почту'}
                </div>
                <p style={{ fontSize: 14, color: 'var(--muted)', margin: 0, lineHeight: 1.5 }}>
                  Введите новый email — на него придёт код подтверждения
                </p>
              </div>
              <div className="authLabel">Новый email</div>
              <input
                className="authInput"
                type="email"
                value={newEmail}
                onChange={e => setNewEmail(e.target.value)}
                placeholder="you@example.com"
                autoFocus
                onKeyDown={e => { if (e.key === 'Enter') onRequestEmailChange(); }}
              />
              {emailError && <div className="authError">{emailError}</div>}
              <button
                className="authBtn"
                disabled={!newEmail.trim() || emailBusy}
                onClick={onRequestEmailChange}
              >
                {emailBusy ? '…' : 'Отправить код'}
              </button>
              <div className="authSwitchRow">
                <button className="authSwitchLink" onClick={closeEmailModal}>Отмена</button>
              </div>
            </div>
          </div>
        </Portal>
      )}

      {/* OTP verification modal */}
      {emailStep === 'otp' && (
        <Portal>
          <div className="modalOverlay">
            <div className="confirmCard" style={{ width: 'min(400px, 100%)', display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Подтверждение email</div>
                <p style={{ fontSize: 14, color: 'var(--muted)', margin: 0, lineHeight: 1.5 }}>
                  На вашу почту <strong>{pendingEmail}</strong> выслан разовый код подтверждения
                </p>
              </div>
              <div className="authLabel">Код из письма</div>
              <input
                className="authInput"
                value={emailOtp}
                onChange={e => setEmailOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                inputMode="numeric"
                autoFocus
                onKeyDown={e => { if (e.key === 'Enter' && emailOtp.length === 6) onVerifyEmailChange(); }}
              />
              {emailError && <div className="authError">{emailError}</div>}
              <button
                className="authBtn"
                disabled={emailOtp.length !== 6 || emailBusy}
                onClick={onVerifyEmailChange}
              >
                {emailBusy ? '…' : 'Подтвердить'}
              </button>
              <div className="authSwitchRow">
                <button className="authSwitchLink" onClick={() => { setEmailStep('input'); setEmailOtp(''); setEmailError(null); }}>
                  Изменить email
                </button>
              </div>
            </div>
          </div>
        </Portal>
      )}
    </div>
  );
}
