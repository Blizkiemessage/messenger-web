/**
 * InviteModal — постоянная личная пригласительная ссылка (Этап B).
 * Показывает ссылку + QR, копирование, системный «Поделиться», счётчик
 * присоединившихся и «Обновить ссылку» (отзыв старой).
 */
import { useEffect, useState } from 'react';
import { getMyInvite, regenerateInvite, type InvitePayload } from '../../api/invites';

interface Props { onClose: () => void; }

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}

export function InviteModal({ onClose }: Props) {
  const [data, setData] = useState<InvitePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmRegen, setConfirmRegen] = useState(false);

  useEffect(() => {
    let alive = true;
    getMyInvite()
      .then(d => { if (alive) setData(d); })
      .catch(e => { if (alive) setError(e?.message || 'Не удалось получить ссылку'); });
    return () => { alive = false; };
  }, []);

  async function copy() {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data.link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  }

  async function share() {
    if (!data) return;
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Blizkie',
          text: 'Присоединяйся ко мне в Blizkie — тёплый мессенджер для близких',
          url: data.link,
        });
      } catch { /* отменено */ }
    } else {
      copy();
    }
  }

  async function regenerate() {
    setBusy(true); setError(null);
    try {
      const d = await regenerateInvite();
      setData(d);
      setConfirmRegen(false);
    } catch (e: any) {
      setError(e?.message || 'Не удалось обновить ссылку');
    } finally { setBusy(false); }
  }

  return (
    <div className="modalOverlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modalCard inviteCard">
        <div className="inviteHeader">
          <div className="inviteTitle">Пригласить близких</div>
          <button className="upCloseBtn" onClick={onClose}>✕</button>
        </div>

        <p className="inviteSub">
          Отправьте ссылку семье или друзьям. Кто перейдёт по ней — сразу станет вашим
          контактом, и откроется личный чат.
        </p>

        {error && <div className="inviteError">{error}</div>}
        {!data && !error && <div className="inviteLoading">Загрузка…</div>}

        {data && (
          <>
            {data.qr && (
              <div className="inviteQrWrap">
                <img className="inviteQr" src={data.qr} alt="QR-код приглашения" width={200} height={200} />
              </div>
            )}

            <div className="inviteLinkRow">
              <input className="inviteLinkInput" readOnly value={data.link}
                onFocus={e => e.currentTarget.select()} />
              <button className="inviteCopyBtn" onClick={copy}>{copied ? 'Скопировано ✓' : 'Копировать'}</button>
            </div>

            {data.used_count > 0 && (
              <div className="inviteCount">
                🎉 {data.used_count} {plural(data.used_count, 'человек присоединился', 'человека присоединились', 'человек присоединились')} по вашей ссылке
              </div>
            )}

            <button className="inviteShareBtn" onClick={share}>Поделиться</button>

            <div className="inviteRegen">
              {confirmRegen ? (
                <>
                  <span className="inviteRegenWarn">Старая ссылка перестанет работать.</span>
                  <div className="inviteRegenActions">
                    <button className="inviteRegenCancel" onClick={() => setConfirmRegen(false)} disabled={busy}>Отмена</button>
                    <button className="inviteRegenConfirm" onClick={regenerate} disabled={busy}>{busy ? '…' : 'Обновить'}</button>
                  </div>
                </>
              ) : (
                <button className="inviteRegenLink" onClick={() => setConfirmRegen(true)}>Обновить ссылку</button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
