/**
 * IncomingCallModal — E3: shown to the callee when a call arrives.
 *
 * Displays caller info, plays a ringtone, and provides Accept / Reject actions.
 */
import { useEffect } from 'react';
import { useCallStore } from '../../store/useCallStore';
import { emitCallAccept, emitCallReject } from '../../socket/socketClient';
import { Avatar } from '../ui/Avatar';

export function IncomingCallModal() {
  const status   = useCallStore(s => s.status);
  const callId   = useCallStore(s => s.callId);
  const callType = useCallStore(s => s.callType);
  const peerInfo = useCallStore(s => s.peerInfo);

  // Play ringtone while incoming
  useEffect(() => {
    if (status !== 'incoming') return;

    // Create oscillator-based ringtone — no external audio file needed
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    let stopped = false;
    let handle: ReturnType<typeof setTimeout>;

    function ring() {
      if (stopped) return;
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type      = 'sine';
      osc.frequency.value = 440;
      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.3, ctx.currentTime + 0.05);
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.4);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.5);
      handle = setTimeout(ring, 1500);
    }

    ring();

    return () => {
      stopped = true;
      clearTimeout(handle);
      ctx.close();
    };
  }, [status]);

  if (status !== 'incoming' || !peerInfo) return null;

  const callerName = peerInfo.display_name || peerInfo.username || 'Пользователь';

  function accept() {
    if (!callId) return;
    emitCallAccept(callId);
    // Status will update to 'connecting' via useCallStore when server relays offer
    useCallStore.getState().setStatus('connecting');
  }

  function reject() {
    if (!callId) return;
    emitCallReject(callId);
    useCallStore.getState().reset();
  }

  return (
    <div className="incomingCallOverlay" role="dialog" aria-modal="true" aria-label="Входящий звонок">
      <div className="incomingCallCard">
        {/* Animated pulse ring */}
        <div className="incomingCallRing">
          <div className="incomingCallRingInner" />
        </div>

        <div className="incomingCallAvatar">
          <Avatar user={peerInfo} size={80} radius={40} />
        </div>

        <div className="incomingCallLabel">
          {callType === 'video' ? 'Входящий видеозвонок' : 'Входящий аудиозвонок'}
        </div>
        <div className="incomingCallName">{callerName}</div>

        <div className="incomingCallActions">
          <button className="callBtnReject" onClick={reject} title="Отклонить">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M23.65 15.57c-1.29-.6-3.27-.98-5.65-.98-2.37 0-4.35.38-5.64.97L9.87 19.5A19.42 19.42 0 0 1 4.5 14.13l3.94-2.49c.6-1.29.97-3.27.97-5.64 0-2.38-.38-4.36-.97-5.65L4.5.41A21.7 21.7 0 0 0 .5 8.5c0 8.56 6.94 15.5 15.5 15.5a21.7 21.7 0 0 0 8.09-4l-3.94-3.44-.5-.99zM23.65 15.57"/>
              <line x1="2" y1="2" x2="22" y2="22"/>
            </svg>
          </button>
          <button className="callBtnAccept" onClick={accept} title="Принять">
            {callType === 'video' ? (
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="23 7 16 12 23 17 23 7"/>
                <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
              </svg>
            ) : (
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.4 2 2 0 0 1 3.6 1.24h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.91 8.77a16 16 0 0 0 6.29 6.29l.95-.95a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
