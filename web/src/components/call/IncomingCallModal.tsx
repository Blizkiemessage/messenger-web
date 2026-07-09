/**
 * IncomingCallModal — экран входящего вызова (callee).
 *
 * Полноэкранный, с крупными однозначными кнопками «Отклонить»/«Принять»
 * (сплошной фон, большие тач-таргеты — надёжно нажимаются и на мобильном).
 * Пульсирующие кольца — строго ПОД контентом (pointer-events:none), чтобы
 * никогда не перехватывать тап по кнопкам.
 */
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useCallStore } from '../../store/useCallStore';
import { emitCallAccept, emitCallReject } from '../../socket/socketClient';
import { Avatar } from '../ui/Avatar';

// Material-style сплошные иконки (без хаков с rotate/overflow).
const ICON_CALL_END = 'M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.88 1.11-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08a.956.956 0 0 1-.29-.7c0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.7l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.1-.7-.28-.79-.74-1.69-1.36-2.67-1.85-.33-.16-.56-.5-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z';
const ICON_CALL = 'M6.62 10.79c1.44 2.83 3.76 5.15 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z';
const ICON_VIDEO = 'M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z';

export function IncomingCallModal() {
  const { t } = useTranslation('calls');
  const status   = useCallStore(s => s.status);
  const callId   = useCallStore(s => s.callId);
  const callType = useCallStore(s => s.callType);
  const peerInfo = useCallStore(s => s.peerInfo);

  // ── Ringtone ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (status !== 'incoming') return;
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    let stopped = false;
    let handle: ReturnType<typeof setTimeout>;

    function ring() {
      if (stopped) return;
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = 440;
      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.3, ctx.currentTime + 0.05);
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.4);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.5);
      handle = setTimeout(ring, 1500);
    }
    ctx.resume().then(() => ring()).catch(() => ring());
    return () => { stopped = true; clearTimeout(handle); ctx.close(); };
  }, [status]);

  if (status !== 'incoming' || !peerInfo) return null;

  const callerName = peerInfo.display_name || peerInfo.username || t('modals:forward.unknownUser');

  function accept() {
    if (!callId) return;
    emitCallAccept(callId);
    useCallStore.getState().setStatus('connecting');
  }
  function reject() {
    if (!callId) return;
    emitCallReject(callId);
    useCallStore.getState().reset();
  }

  return createPortal(
    <div className="incCallOverlay" role="dialog" aria-modal="true" aria-label={t('incoming.ariaLabel')}>
      <div className="incCallCard">
        <div className="incCallAvatarWrap">
          <span className="incCallPulse" aria-hidden="true" />
          <span className="incCallPulse incCallPulse2" aria-hidden="true" />
          <div className="incCallAvatar"><Avatar user={peerInfo} size={112} radius={56} /></div>
        </div>

        <div className="incCallName">{callerName}</div>
        <div className="incCallLabel">
          {callType === 'video' ? t('incoming.incomingVideoCall') : t('incoming.incomingAudioCall')}
        </div>

        <div className="incCallActions">
          <div className="incCallBtnCol">
            <button className="incCallBtn incCallReject" onClick={reject} aria-label={t('incoming.reject')} type="button">
              <svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor"><path d={ICON_CALL_END} /></svg>
            </button>
            <span className="incCallBtnLabel">{t('incoming.reject')}</span>
          </div>

          <div className="incCallBtnCol">
            <button className="incCallBtn incCallAccept" onClick={accept} aria-label={t('incoming.accept')} type="button">
              <svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor">
                <path d={callType === 'video' ? ICON_VIDEO : ICON_CALL} />
              </svg>
            </button>
            <span className="incCallBtnLabel">{t('incoming.accept')}</span>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
