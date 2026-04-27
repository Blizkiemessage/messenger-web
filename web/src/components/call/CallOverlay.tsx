/**
 * CallOverlay — E3: Full-screen overlay shown during an active call.
 *
 * States handled:
 *  calling    → "Звоним…" (outgoing, waiting for callee)
 *  connecting → "Соединение…" (WebRTC handshake)
 *  active     → Video/Audio call with controls
 *  ended      → "Звонок завершён" (shown briefly)
 *
 * Audio output selector:
 *  Uses HTMLMediaElement.setSinkId() (Chrome/Android) to let the user
 *  switch between earpiece, loudspeaker, and Bluetooth devices.
 *  Button is hidden if the API is not supported by the browser.
 */
import { useEffect, useRef, useCallback, useState } from 'react';
import { useCallStore } from '../../store/useCallStore';
import { webrtcManager } from '../../services/webrtcManager';
import { Avatar } from '../ui/Avatar';

// ── Audio output device type heuristic ───────────────────────────────────────
type AudioOutputType = 'earpiece' | 'speaker' | 'bluetooth' | 'headphones';

function detectDeviceType(device: MediaDeviceInfo): AudioOutputType {
  const l = (device.label + ' ' + device.deviceId).toLowerCase();
  if (l.includes('bluetooth') || l.includes('airpod') || l.includes('buds') || l.includes('wireless'))
    return 'bluetooth';
  if (l.includes('headphone') || l.includes('headset') || l.includes('wired'))
    return 'headphones';
  if (l.includes('speaker') || l.includes('speakerphone') || l.includes('громк'))
    return 'speaker';
  if (l.includes('earpiece') || l.includes('receiver') || l.includes('earphone'))
    return 'earpiece';
  if (device.deviceId === 'default' || device.deviceId === 'communications')
    return 'earpiece';
  return 'speaker';
}

function AudioDeviceIcon({ type, size = 20 }: { type: AudioOutputType; size?: number }) {
  const w = size, h = size;
  if (type === 'earpiece') return (
    <svg width={w} height={h} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.4 2 2 0 0 1 3.6 1.24h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.91 8.77a16 16 0 0 0 6.29 6.29l.95-.95a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
    </svg>
  );
  if (type === 'bluetooth') return (
    <svg width={w} height={h} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6.5 6.5 17.5 17.5 12 23 12 1 17.5 6.5 6.5 17.5"/>
    </svg>
  );
  if (type === 'headphones') return (
    <svg width={w} height={h} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 18v-6a9 9 0 0 1 18 0v6"/>
      <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3z"/>
      <path d="M3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/>
    </svg>
  );
  // speaker (default)
  return (
    <svg width={w} height={h} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
    </svg>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────
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

  const localVideoRef   = useRef<HTMLVideoElement>(null);
  const remoteVideoRef  = useRef<HTMLVideoElement>(null);
  const remoteAudioRef  = useRef<HTMLAudioElement>(null);
  const audioPickerRef  = useRef<HTMLDivElement>(null);

  // Derived early so it can be used in useEffect deps below
  const isVideo = callType === 'video';

  // ── Audio output state ──────────────────────────────────────────────────────
  const [audioDevices, setAudioDevices]     = useState<MediaDeviceInfo[]>([]);
  const [currentSinkId, setCurrentSinkId]   = useState<string>('default');
  const [showAudioPicker, setShowAudioPicker] = useState(false);

  const sinkIdSupported =
    typeof HTMLMediaElement !== 'undefined' && 'sinkId' in HTMLMediaElement.prototype;

  // ── Bind local stream to local video element ────────────────────────────────
  useEffect(() => {
    const el = localVideoRef.current;
    if (!el) return;
    el.srcObject = localStream ?? null;
  }, [localStream]);

  // ── Bind remote stream to video (video call) or audio (audio call) ──────────
  useEffect(() => {
    const target = isVideo ? remoteVideoRef.current : remoteAudioRef.current;
    if (!target) return;
    target.srcObject = remoteStream ?? null;
  }, [remoteStream, isVideo]);

  // ── Populate audio output devices when call goes active ─────────────────────
  useEffect(() => {
    if (status !== 'active' || !sinkIdSupported) return;
    navigator.mediaDevices
      .enumerateDevices()
      .then(devs => {
        const outputs = devs.filter(d => d.kind === 'audiooutput');
        setAudioDevices(outputs);
      })
      .catch(() => {/* enumerateDevices not available */});
  }, [status, sinkIdSupported]);

  // ── Close audio picker on outside click ─────────────────────────────────────
  useEffect(() => {
    if (!showAudioPicker) return;
    function onOutside(e: MouseEvent) {
      if (audioPickerRef.current && !audioPickerRef.current.contains(e.target as Node)) {
        setShowAudioPicker(false);
      }
    }
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, [showAudioPicker]);

  // ── Duration timer — ticks every second when call is active ─────────────────
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

  // ── Audio output switch ──────────────────────────────────────────────────────
  const handleSetAudioOutput = useCallback(async (deviceId: string) => {
    const el = isVideo ? remoteVideoRef.current : remoteAudioRef.current;
    if (!el || !('setSinkId' in el)) return;
    try {
      await (el as any).setSinkId(deviceId);
      setCurrentSinkId(deviceId);
      setShowAudioPicker(false);
    } catch (err) {
      console.warn('[CallOverlay] setSinkId failed:', err);
    }
  }, [isVideo]);

  const handleAudioOutputClick = useCallback(() => {
    // With exactly 2 devices: toggle directly. With more: show picker.
    if (audioDevices.length === 2) {
      const other = audioDevices.find(d => d.deviceId !== currentSinkId) ?? audioDevices[0];
      if (other) handleSetAudioOutput(other.deviceId);
    } else {
      setShowAudioPicker(p => !p);
    }
  }, [audioDevices, currentSinkId, handleSetAudioOutput]);

  function getDeviceDisplayName(device: MediaDeviceInfo, index: number): string {
    if (device.label) return device.label;
    const id = device.deviceId.toLowerCase();
    if (id === 'default' || id === 'communications') return 'Телефон (наушник)';
    if (id.includes('speaker')) return 'Громкоговоритель';
    if (id.includes('bluetooth') || id.includes('bt')) return 'Bluetooth';
    return `Устройство ${index + 1}`;
  }

  const currentDevice    = audioDevices.find(d => d.deviceId === currentSinkId);
  const currentDevType   = detectDeviceType(currentDevice ?? ({ label: '', deviceId: currentSinkId } as any));
  const isSpeakerActive  = currentDevType === 'speaker';

  const audioOutputLabel =
    currentDevType === 'earpiece'   ? 'Телефон' :
    currentDevType === 'bluetooth'  ? 'Bluetooth' :
    currentDevType === 'headphones' ? 'Наушники' : 'Динамик';

  // ── Event handlers ───────────────────────────────────────────────────────────
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
      {/* Hidden audio element — used for audio calls to play remote stream */}
      {!isVideo && (
        <audio ref={remoteAudioRef} autoPlay />
      )}

      {/* ── Video streams (video call only) ──────────────────────────────────── */}
      {isVideo && (
        <>
          <video ref={remoteVideoRef} className="callVideoRemote" autoPlay playsInline />
          <video
            ref={localVideoRef}
            className={`callVideoLocal${isVideoOff ? ' hidden' : ''}`}
            autoPlay playsInline muted
          />
        </>
      )}

      {/* ── Avatar + status (audio call or pre-connect) ───────────────────────── */}
      {(!isVideo || status !== 'active') && (
        <div className="callCenterInfo">
          <div className="callAvatarWrap">
            {status === 'active' && <div className="callAvatarPulse" />}
            <Avatar user={peerInfo} size={96} radius={48} />
          </div>
          <div className="callPeerName">{peerName}</div>
        </div>
      )}

      {/* ── Status / duration ─────────────────────────────────────────────────── */}
      <div className="callStatusText">{statusText}</div>

      {/* ── Controls ──────────────────────────────────────────────────────────── */}
      {status !== 'ended' && (
        <div className="callControls">

          {/* ── Audio output selector ─────────────────────────────────────────── */}
          {sinkIdSupported && audioDevices.length >= 2 && status === 'active' && (
            <div className="callAudioOutputWrap" ref={audioPickerRef}>
              {/* Picker popup */}
              {showAudioPicker && (
                <div className="callAudioPicker">
                  {audioDevices.map((d, i) => (
                    <button
                      key={d.deviceId}
                      className={`callAudioPickerItem${d.deviceId === currentSinkId ? ' active' : ''}`}
                      onClick={() => handleSetAudioOutput(d.deviceId)}
                    >
                      <AudioDeviceIcon type={detectDeviceType(d)} size={18} />
                      <span className="callAudioPickerLabel">{getDeviceDisplayName(d, i)}</span>
                      {d.deviceId === currentSinkId && (
                        <svg className="callAudioPickerCheck" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12"/>
                        </svg>
                      )}
                    </button>
                  ))}
                </div>
              )}
              {/* Toggle button */}
              <button
                className={`callControlBtn${isSpeakerActive ? ' active' : ''}`}
                onClick={handleAudioOutputClick}
                title="Аудиовыход"
              >
                <AudioDeviceIcon type={currentDevType} />
                <span className="callControlLabel">{audioOutputLabel}</span>
              </button>
            </div>
          )}

          {/* ── Mute ────────────────────────────────────────────────────────── */}
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

          {/* ── Video toggle (video calls only) ─────────────────────────────── */}
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

          {/* ── End call ────────────────────────────────────────────────────── */}
          <button
            className="callControlBtn callControlEnd"
            onClick={handleEnd}
            title="Завершить звонок"
          >
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M23.65 15.57c-1.29-.6-3.27-.98-5.65-.98-2.37 0-4.35.38-5.64.97L9.87 19.5A19.42 19.42 0 0 1 4.5 14.13l3.94-2.49c.6-1.29.97-3.27.97-5.64 0-2.38-.38-4.36-.97-5.65L4.5.41A21.7 21.7 0 0 0 .5 8.5c0 8.56 6.94 15.5 15.5 15.5a21.7 21.7 0 0 0 8.09-4l-3.94-3.44-.5-.99z"/>
            </svg>
            <span className="callControlLabel">Завершить</span>
          </button>

        </div>
      )}
    </div>
  );
}
