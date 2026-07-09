/**
 * InviteModal — постоянная личная пригласительная ссылка (Этап B).
 * Показывает ссылку + QR, копирование, системный «Поделиться», счётчик
 * присоединившихся и «Обновить ссылку» (отзыв старой).
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getMyInvite, regenerateInvite, type InvitePayload } from '../../api/invites';

interface Props { onClose: () => void; }

export function InviteModal({ onClose }: Props) {
  const { t } = useTranslation('modals');
  const [data, setData] = useState<InvitePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmRegen, setConfirmRegen] = useState(false);

  useEffect(() => {
    let alive = true;
    getMyInvite()
      .then(d => { if (alive) setData(d); })
      .catch(e => { if (alive) setError(e?.message || t('invite.linkError')); });
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
          text: t('invite.shareText'),
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
      setError(e?.message || t('invite.regenerateError'));
    } finally { setBusy(false); }
  }

  return (
    <div className="modalOverlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modalCard inviteCard">
        <div className="inviteHeader">
          <div className="inviteTitle">{t('invite.title')}</div>
          <button className="upCloseBtn" onClick={onClose}>✕</button>
        </div>

        <p className="inviteSub">
          {t('invite.subtitle')}
        </p>

        {error && <div className="inviteError">{error}</div>}
        {!data && !error && <div className="inviteLoading">{t('common:loading')}</div>}

        {data && (
          <>
            {data.qr && (
              <div className="inviteQrWrap">
                <img className="inviteQr" src={data.qr} alt={t('invite.qrAlt')} width={200} height={200} />
              </div>
            )}

            <div className="inviteLinkRow">
              <input className="inviteLinkInput" readOnly value={data.link}
                onFocus={e => e.currentTarget.select()} />
              <button className="inviteCopyBtn" onClick={copy}>{copied ? t('invite.copied') : t('common:copy')}</button>
            </div>

            {data.used_count > 0 && (
              <div className="inviteCount">
                🎉 {t('invite.joinedCount', { count: data.used_count })}
              </div>
            )}

            <button className="inviteShareBtn" onClick={share}>{t('common:share')}</button>

            <div className="inviteRegen">
              {confirmRegen ? (
                <>
                  <span className="inviteRegenWarn">{t('invite.regenWarning')}</span>
                  <div className="inviteRegenActions">
                    <button className="inviteRegenCancel" onClick={() => setConfirmRegen(false)} disabled={busy}>{t('common:cancel')}</button>
                    <button className="inviteRegenConfirm" onClick={regenerate} disabled={busy}>{busy ? '…' : t('invite.regenConfirm')}</button>
                  </div>
                </>
              ) : (
                <button className="inviteRegenLink" onClick={() => setConfirmRegen(true)}>{t('invite.regenerateLink')}</button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
