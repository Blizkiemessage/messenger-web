/**
 * CallOverlay — E3: Full-screen overlay shown during an active call.
 *
 * States handled:
 *  calling    → "Звоним…" (outgoing, waiting for callee)
 *  connecting → "Соединение…" (WebRTC handshake)
 *  active     → Video/Audio call with controls
 *  ended      → "Звонок завершён" (shown briefly)
 */
import { useEffect, useRef, useCallback } from 'react';
import { useCallStore } from '../../store/useCallStore';
import { webrtcManager } from '../../services/webrtcManager';
import { Avatar } from '../ui/Avatar';

export function CallOverlay() {
  const status        = useCallStore(s => s.status);
  const callId        = useCallStore(s => s.callId);
  const callType      = useCallStore(s => s.callType);
  const peerInfo      = useCallStore(s => s.peerInfo);
  const localStream   = useCallStore(s => s.localStream);
  const remoteStream  = useCallStore(s => s.remoteStream);
  const isMuted       = useCallStore(s => s.isMuted);
  const isVideoOff    = useCallStore(s => s.isVideoOff);
  const startedAt     = useCallStore(s => s.startedAt);
  const elapsedSeconds = useCallStore(s => s.elapsedSeconds);

  const localVideoRef  = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);

  // Derived early so it can be used in useEffect deps below
  const isVideo = callType === 'video';

  // Bind local stream to local video element
  useEffect(() => {
    const el = localVideoRef.current;
    if (!el) return;
    el.srcObject = localStream ?? null;
  }, [localStream]);

  // Bind remote stream to video (video call) or audio (audio call) element.
  // For audio calls the <video> refs are never mounted, so we need a dedicated
  // <audio> element — otherwise remoteStream is set in the store but never
  // attached to any DOM node and the caller hears nothing.
  useEffect(() => {
    const target = isVideo ? remoteVideoRef.current : remoteAudioRef.current;
    if (!target) return;
    target.srcObject = remoteStream ?? null;
  }, [remoteStream, isVideo]);

  // Duration timer — ticks every second when call is active
  useEffect(() => {
    if (status !== 'active' || !startedAt) return;
    const tick = () => {
      useCallStore.getState().setElapsedSeconds(
        Math.floor((Date.now() - startedAt) / 1000)
      );
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [status, startedAt]);

  const handleEnd = useCallback(() => {
    if (!callId) return;
    webrtcManager.hangup(callId, true);
  }, [callId]);

  const handleToggleMute  = useCallback(() => webrtcManager.toggleMute(),  []);
  const handleToggleVideo = useCallback(() => webrtcManager.toggleVideo(), []);

  // Don't render when idle or incoming (incoming has its own modal)
  if (status === 'idle' || status === 'incoming') return null;

  const peerName = peerInfo?.display_name || peerInfo?.username || 'Пользователь';

  function formatDuration(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  const statusText =
    status === 'calling'    ? 'Звоним…' :
    status === 'connecting' ? 'Соединение…' :
    status === 'active'     ? formatDuration(elapsedSeconds) :
    status === 'ended'      ? 'Звонок завершён' : '';

  return (
    <div className={`callOverlay${isVideo && status === 'active' ? ' callOverlayVideo' : ''}`}>
      {/* Hidden audio element — used for audio calls to play remote stream.
          For video calls the <video> element below handles audio+video. */}
      {!isVideo && (
        <audio ref={remoteAudioRef} autoPlay />
      )}

      {/* ── Video streams (video call only) ─────────────────────────────────── */}
      {isVideo && (
        <>
          {/* Remote (full screen) */}
          <video
            ref={remoteVideoRef}
            className="callVideoRemote"
            autoPlay
            playsInline
          />
          {/* Local (picture-in-picture corner) */}
          <video
            ref={localVideoRef}
            className={`callVideoLocal${isVideoOff ? ' hidden' : ''}`}
            autoPlay
            playsInline
            muted
          />
        </>
      )}

      {/* ── Avatar + status (audio call or no remote video yet) ─────────── */}
      {(!isVideo || status !== 'active') && (
        <div className="callCenterInfo">
          <div className="callAvatarWrap">
            {status === 'active' && (
              <div className="callAvatarPulse" />
            )}
            <Avatar user={peerInfo} size={96} radius={48} />
          </div>
          <div className="callPeerName">{peerName}</div>
        </div>
      )}

      {/* ── Status / duration ───────────────────────────────────────────── */}
      <div className="callStatusText">{statusText}</div>

      {/* ── Controls ─────────────────────────────────────────────────────── */}
      {status !== 'ended' && (
        <div className="callControls">
          {/* Mute */}
          <button
            className={`callControlBtn${isMuted ? ' active' : ''}`}
            onClick={handleToggleMute}
            title={isMuted ? 'Включить микрофон' : 'Отключить микрофон'}
          >
            {isMuted ? (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="1" y1="1" x2="23" y2="23"/>
                <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/>
                <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/>
                <line x1="12" y1="19" x2="12" y2="23"/>
                <line x1="8" y1="23" x2="16" y2="23"/>
              </svg>
            ) : (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                <line x1="12" y1="19" x2="12" y2="23"/>
                <line x1="8" y1="23" x2="16" y2="23"/>
              </svg>
            )}
            <span className="callControlLabel">{isMuted ? 'Вкл. микр.' : 'Выкл. микр.'}</span>
          </button>

          {/* Video toggle (video calls only) */}
          {isVideo && (
            <button
              className={`callControlBtn${isVideoOff ? ' active' : ''}`}
              onClick={handleToggleVideo}
              title={isVideoOff ? 'Включить камеру' : 'Выключить камеру'}
            >
              {isVideoOff ? (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m5.66 0H14a2 2 0 0 1 2 2v3.34l1 1L23 7v10"/>
                  <line x1="1" y1="1" x2="23" y2="23"/>
                </svg>
              ) : (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="23 7 16 12 23 17 23 7"/>
                  <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
                </svg>
              )}
              <span className="callControlLabel">{isVideoOff ? 'Вкл. камеру' : 'Выкл. камеру'}</span>
            </button>
          )}

          {/* End call */}
          <button
            className="callControlBtn callControlEnd"
            onClick={handleEnd}
            title="Завершить звонок"
          >
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M23.65 15.57c-1.29-.6-3.27-.98-5.65-.98-2.37 0-4.35.38-5.64.97L9.87 19.5A19.42 19.42 0 0 1 4.5 14.13l3.94-2.49c.6-1.29.97-3.27.97-5.64 0-2.38-.38-4.36-.97-5.65L4.5.41A21.7 21.7 0 0 0 .5 8.5c0 8.56 6.94 15.5 15.5 15.5a21.7 21.7 0 0 0 8.09-4l-3.94-3.44-.5-.99z"/>
              <line x1="2" y1="2" x2="22" y2="22"/>
            </svg>
            <span className="callControlLabel">Завершить</span>
          </button>
        </div>
      )}
    </div>
  );
}
