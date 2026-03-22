/**
 * ProfileTab
 * ✅ FIXED: Avatar upload uses axios client instead of raw fetch.
 *   - Axios client handles auth token automatically via interceptor
 *   - No trailing-slash URL issues (axios baseURL handles this correctly)
 *   - Better error messages from server responses
 */

import { useState, useRef } from 'react';
import { type User } from '../../types';
import { avatarLetter } from '../../utils/format';
import { resolveUrl } from '../ui/Avatar';
import { updateMe } from '../../api/users';
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
  const [avatarPreview, setAvatarPreview] = useState<string | null>(
    resolveUrl(me.avatar_url) ?? null
  );
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [busy,  setBusy]  = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok,    setOk]    = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function handleAvatarPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setAvatarFile(f);
    const reader = new FileReader();
    reader.onload = ev => setAvatarPreview(ev.target?.result as string);
    reader.readAsDataURL(f);
  }

  // ✅ Use axios client — auth token added automatically, no URL issues
  async function uploadAvatar(file: File): Promise<string> {
    const fd = new FormData();
    fd.append('file', file);
    // axios sets Content-Type: multipart/form-data; boundary=... automatically
    const res = await client.post<{ url: string; type: string; name: string; size: number }>(
      '/upload',
      fd,
      { headers: { 'Content-Type': undefined }, timeout: 60_000 }
    );
    return res.data.url;
  }

  async function onSave() {
    setError(null); setBusy(true); setOk(false);
    try {
      let avatar_url = me.avatar_url ?? null;
      if (avatarFile) avatar_url = await uploadAvatar(avatarFile);
      const next = await updateMe({
        username:        username.trim().toLowerCase() || null,
        display_name:    displayName.trim() || '',
        avatar_url,
        bio:             bio.trim() || null,
        birth_date:      birthDate || null,
        hide_bio:        hideBio,
        hide_birth_date: hideBirth,
      });
      onUpdate(next);
      setOk(true);
      setTimeout(() => setOk(false), 2500);
    } catch (e: any) {
      // Surface the actual server error if available
      setError(e?.message ?? 'Ошибка сохранения');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="psBody">
      {/* Avatar */}
      <div className="psAvatarSection">
        <div className="psAvatarWrap" onClick={() => fileRef.current?.click()} title="Изменить фото">
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
        <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleAvatarPick} />
      </div>

      {/* Fields */}
      <div className="psField">
        <label className="psLabel">Имя</label>
        <input className="psInput" value={displayName}
               onChange={e => setDisplayName(e.target.value)}
               placeholder="Как вас зовут" maxLength={64} />
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
    </div>
  );
}
