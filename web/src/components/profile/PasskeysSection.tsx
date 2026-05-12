import { useState, useEffect, useCallback } from 'react';
import {
  listPasskeys, passkeyRegister, renamePasskey, deletePasskey,
  isWebAuthnSupported, type PasskeyCredential,
} from '../../api/webauthn';

function fmtDate(ms: number) {
  return new Date(ms).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function PasskeysSection() {
  const [creds,       setCreds]       = useState<PasskeyCredential[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [adding,      setAdding]      = useState(false);
  const [addError,    setAddError]    = useState<string | null>(null);
  const [editingId,   setEditingId]   = useState<string | null>(null);
  const [editName,    setEditName]    = useState('');
  const [deletingId,  setDeletingId]  = useState<string | null>(null);

  const supported = isWebAuthnSupported();

  const load = useCallback(async () => {
    try {
      setCreds(await listPasskeys());
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function addPasskey() {
    setAdding(true);
    setAddError(null);
    try {
      const name = `Устройство ${new Date().toLocaleDateString('ru-RU')}`;
      await passkeyRegister(name);
      await load();
    } catch (e: any) {
      const msg = e?.message ?? '';
      if (msg.toLowerCase().includes('cancel') || msg.toLowerCase().includes('abort') || msg.toLowerCase().includes('not allowed')) {
        setAddError('Добавление отменено');
      } else {
        setAddError(e?.response?.data?.error ?? msg ?? 'Ошибка добавления ключа');
      }
    } finally {
      setAdding(false);
    }
  }

  async function saveRename(id: string) {
    try {
      await renamePasskey(id, editName.trim());
      setCreds(prev => prev.map(c => c.id === id ? { ...c, device_name: editName.trim() || null } : c));
      setEditingId(null);
    } catch (e: any) {
      setAddError(e?.response?.data?.error ?? 'Ошибка переименования');
    }
  }

  async function removePasskey(id: string) {
    setDeletingId(id);
    try {
      await deletePasskey(id);
      setCreds(prev => prev.filter(c => c.id !== id));
    } catch (e: any) {
      setAddError(e?.response?.data?.error ?? 'Ошибка удаления');
    } finally {
      setDeletingId(null);
    }
  }

  if (!supported) {
    return (
      <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
        Ваш браузер не поддерживает ключи доступа (WebAuthn). Попробуйте Chrome, Safari или Edge.
      </div>
    );
  }

  return (
    <div className="passkeysSection">
      <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 12 }}>
        Ключи доступа позволяют входить без пароля с помощью биометрии или PIN-кода устройства.
      </div>

      {loading ? (
        <div className="passkeysLoading">Загрузка…</div>
      ) : creds.length === 0 ? (
        <div className="passkeysEmpty">Ключей доступа ещё нет</div>
      ) : (
        <div className="passkeysList">
          {creds.map(c => (
            <div key={c.id} className="passkeyItem">
              <span className="passkeyIcon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>
                </svg>
              </span>
              <div className="passkeyInfo">
                {editingId === c.id ? (
                  <input
                    className="passkeyNameInput"
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') saveRename(c.id);
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                    autoFocus
                    maxLength={64}
                  />
                ) : (
                  <span
                    className="passkeyName"
                    title="Нажмите, чтобы переименовать"
                    onClick={() => { setEditingId(c.id); setEditName(c.device_name ?? ''); }}
                  >
                    {c.device_name || 'Ключ доступа'}
                  </span>
                )}
                <span className="passkeyDate">{fmtDate(c.created_at)}</span>
              </div>
              {editingId === c.id ? (
                <div className="passkeyActions">
                  <button className="passkeyActionBtn passkeyOkBtn" onClick={() => saveRename(c.id)}>✓</button>
                  <button className="passkeyActionBtn" onClick={() => setEditingId(null)}>✕</button>
                </div>
              ) : (
                <button
                  className="passkeyDeleteBtn"
                  onClick={() => removePasskey(c.id)}
                  disabled={deletingId === c.id}
                  title="Удалить ключ"
                >
                  {deletingId === c.id ? '…' : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6"/>
                      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                      <path d="M10 11v6M14 11v6"/>
                      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                    </svg>
                  )}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {addError && <div className="psError" style={{ marginTop: 8 }}>{addError}</div>}

      <button className="psSaveBtn passkeyAddBtn" onClick={addPasskey} disabled={adding} style={{ marginTop: 10 }}>
        {adding ? (
          '…'
        ) : (
          <>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 6 }}>
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            Добавить ключ доступа
          </>
        )}
      </button>
    </div>
  );
}
