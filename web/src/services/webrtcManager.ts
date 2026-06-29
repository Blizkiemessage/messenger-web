/**
 * webrtcManager — E3: WebRTC peer connection lifecycle manager
 *
 * A module-level singleton (not a React hook) so that socket event handlers
 * in useSocket.ts can call it directly without hook-nesting restrictions.
 *
 * Flow:
 *  Caller:  initiateOffer()  → creates PC, gets media, sends offer via socket
 *  Callee:  handleOffer()    → creates PC, gets media, sends answer via socket
 *  Caller:  handleAnswer()   → sets remote description
 *  Both:    addIceCandidate()  → processes ICE candidates (queued before remote desc)
 *  Either:  hangup()         → teardown, optional socket emit
 *
 * Reliability measures:
 *  - iceCandidatePoolSize: 0   — disabled to avoid parallel TURN ALLOCATE flood
 *  - bundlePolicy: max-bundle  — single ICE component for all tracks
 *  - iceConnectionState handler — hang up immediately on ICE 'failed'
 *  - 30 s ICE connect timeout  — client-side guard if ICE stays stuck in 'checking'
 *  - disconnected state timer  — 15 s grace period after an established connection drops
 *  - Local stream reuse        — ICE restart doesn't ask for media again
 */
import { useCallStore } from '../store/useCallStore';
import { getSocket } from '../socket/socketClient';
import { API_BASE_URL } from '../config';
import { getToken } from '../storage/session';
import type { CallType } from '../types';

// Целевой размер аудио-буфера приёмника (мс). По умолчанию NetEq адаптивно
// раздувает буфер на дребезжащих сетях (мобильный аплинк) до 1–2 секунд → «огромная
// задержка». Низкий целевой ориентир прижимает раздувание, при этом НЕ добавляет
// задержку на чистой сети (там буфер и так мал). Компромисс: на очень плохой сети
// возможны лёгкие артефакты вместо растущего лага. Тюнить тут: меньше = меньше
// задержка/больше риск «бульканья», больше = устойчивее/выше задержка.
const AUDIO_JITTER_BUFFER_TARGET_MS = 100;

// Потолок битрейта исходящего видео. Главная причина РАСТУЩЕЙ задержки на мобильной
// сети — видео забивает узкий аплинк → пакеты копятся в буфере модема (bufferbloat)
// → растёт задержка ВСЕГО, включая аудио. Жёсткий потолок не даёт видео переполнять
// канал; WebRTC сам снизит разрешение под битрейт (qualityLimitationReason=bandwidth).
const MAX_VIDEO_BITRATE = 700_000;   // ~0.7 Мбит/с — безопасно для моб. аплинка
const MAX_VIDEO_FRAMERATE = 30;

class WebRTCManager {
  private pc: RTCPeerConnection | null = null;
  private iceCandidateQueue: RTCIceCandidateInit[] = [];
  private remoteDescSet = false;
  private disconnectedTimer: ReturnType<typeof setTimeout> | null = null;
  /** Fires if ICE never reaches 'connected' within 30 s — prevents silent hangs */
  private iceConnectTimer: ReturnType<typeof setTimeout> | null = null;
  /** Periodic getStats() diagnostics while connected (RTT/loss/jitter/bitrate) */
  private statsTimer: ReturnType<typeof setInterval> | null = null;

  // ── ICE server config from backend ────────────────────────────────────────
  private async getIceServers(): Promise<RTCConfiguration> {
    try {
      const token = getToken();
      const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
      const res = await fetch(`${API_BASE_URL}/calls/ice-servers`, {
        credentials: 'include',
        headers,
      });
      if (!res.ok) throw new Error(`ice-servers fetch failed: ${res.status}`);
      const config = await res.json() as RTCConfiguration;

      // ── Diagnostic: log what servers we got ─────────────────────────────
      const servers = config.iceServers as RTCIceServer[] | undefined;
      if (servers) {
        const turnCount = servers.filter(s => {
          const u = Array.isArray(s.urls) ? s.urls[0] : s.urls;
          return typeof u === 'string' && u.startsWith('turn');
        }).length;
        console.log(`[WebRTC] ICE config: ${servers.length} servers total, ${turnCount} TURN`);
        if (turnCount === 0) {
          console.warn('[WebRTC] ⚠ No TURN servers — cross-network calls will fail!');
        }
      }
      return config;
    } catch (err) {
      console.warn('[WebRTC] getIceServers failed, using public STUN:', err);
      return {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
        ],
      };
    }
  }

  // ── Start 30-second ICE connect timeout ───────────────────────────────────
  private startIceConnectTimer(callId: string) {
    this.clearIceConnectTimer();
    this.iceConnectTimer = setTimeout(() => {
      this.iceConnectTimer = null;
      const state = this.pc?.connectionState;
      if (state && state !== 'connected' && state !== 'closed') {
        console.warn(`[WebRTC] ⏱ ICE connect timeout (45 s from 'checking') — state: ${state} — hanging up`);
        this.hangup(callId, true, 'failed');
      }
    }, 45_000);
  }

  private clearIceConnectTimer() {
    if (this.iceConnectTimer !== null) {
      clearTimeout(this.iceConnectTimer);
      this.iceConnectTimer = null;
    }
  }

  // ── Cap outgoing video bitrate/framerate (anti-bufferbloat) ────────────────
  // Without a cap the encoder can flood a narrow mobile uplink, queueing packets
  // in the modem buffer → latency grows for audio AND video. With a cap, WebRTC
  // scales resolution to fit the bitrate instead of overrunning the link.
  private async applySenderLimits(): Promise<void> {
    if (!this.pc) return;
    const sender = this.pc.getSenders().find(s => s.track?.kind === 'video');
    if (!sender) return;
    try {
      const params = sender.getParameters();
      if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];
      params.encodings[0].maxBitrate   = MAX_VIDEO_BITRATE;
      params.encodings[0].maxFramerate = MAX_VIDEO_FRAMERATE;
      // Под нехватку канала жертвуем разрешением, а не плавностью/задержкой.
      (params as RTCRtpSendParameters & { degradationPreference?: string }).degradationPreference = 'balanced';
      await sender.setParameters(params);
      console.log(`[WebRTC] video sender capped: ${MAX_VIDEO_BITRATE / 1000} kbps / ${MAX_VIDEO_FRAMERATE} fps`);
    } catch (err) {
      console.warn('[WebRTC] applySenderLimits failed:', err);
    }
  }

  // ── Periodic stats diagnostics (RTT / loss / jitter / bitrate) ─────────────
  // Prints a compact line every 3 s while connected so the real bottleneck is
  // visible (network RTT vs packet loss vs jitter-buffer vs video bitrate).
  private startStatsMonitor(): void {
    this.stopStatsMonitor();
    let lastVideoBytes = 0;
    let lastTs = 0;
    this.statsTimer = setInterval(async () => {
      if (!this.pc) return;
      try {
        const stats = await this.pc.getStats();
        let rttMs = 0, outBitrate = 0, inBitrate = 0;
        let audioJitterMs = 0, audioLossPct = 0;
        let vidW = 0, vidH = 0, vidFps = 0, vidLimit = '';
        let outVideoBytes = 0, nowTs = 0;

        stats.forEach(r => {
          if (r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded') {
            if (typeof r.currentRoundTripTime === 'number') rttMs = Math.round(r.currentRoundTripTime * 1000);
            if (typeof r.availableOutgoingBitrate === 'number') outBitrate = Math.round(r.availableOutgoingBitrate / 1000);
            if (typeof r.availableIncomingBitrate === 'number') inBitrate = Math.round(r.availableIncomingBitrate / 1000);
          }
          if (r.type === 'inbound-rtp' && r.kind === 'audio') {
            if (r.jitterBufferDelay && r.jitterBufferEmittedCount) {
              audioJitterMs = Math.round((r.jitterBufferDelay / r.jitterBufferEmittedCount) * 1000);
            }
            const recv = (r.packetsReceived || 0) + (r.packetsLost || 0);
            if (recv > 0) audioLossPct = Math.round(((r.packetsLost || 0) / recv) * 100);
          }
          if (r.type === 'inbound-rtp' && r.kind === 'video') {
            vidW = r.frameWidth || 0; vidH = r.frameHeight || 0; vidFps = Math.round(r.framesPerSecond || 0);
          }
          if (r.type === 'outbound-rtp' && r.kind === 'video') {
            outVideoBytes = r.bytesSent || 0; nowTs = r.timestamp || 0;
            vidLimit = r.qualityLimitationReason || '';
          }
        });

        let outVidKbps = 0;
        if (lastTs && nowTs > lastTs) outVidKbps = Math.round(((outVideoBytes - lastVideoBytes) * 8) / (nowTs - lastTs));
        lastVideoBytes = outVideoBytes; lastTs = nowTs;

        console.log(
          `[WebRTC][stats] RTT=${rttMs}ms | audioBuf=${audioJitterMs}ms loss=${audioLossPct}% | ` +
          `BWE out/in=${outBitrate}/${inBitrate}kbps | video↑=${outVidKbps}kbps in=${vidW}x${vidH}@${vidFps}` +
          (vidLimit && vidLimit !== 'none' ? ` limit=${vidLimit}` : ''),
        );

        // ── Adaptive buffer drain ──────────────────────────────────────────
        // Транзиентные всплески задержки (нестабильный relay / мобильная сота)
        // раздувают аудио-буфер NetEq до ~1.5с, и он сливается крайне лениво —
        // отсюда «огромная задержка», которая держится минутами после того, как
        // сеть пришла в норму. Когда буфер раздут — форсим цель в 0 (агрессивный
        // слив); в норме держим небольшой baseline. Хуже сделать не может: 0
        // ставится только когда задержка уже большая.
        try {
          const ar = this.pc.getReceivers().find(r => r.track?.kind === 'audio') as
            (RTCRtpReceiver & { jitterBufferTarget?: number }) | undefined;
          if (ar && 'jitterBufferTarget' in ar) {
            const target = audioJitterMs > 400 ? 0 : AUDIO_JITTER_BUFFER_TARGET_MS;
            if (ar.jitterBufferTarget !== target) ar.jitterBufferTarget = target;
          }
        } catch { /* ignore */ }
      } catch { /* stats not critical */ }
    }, 3000);
  }

  private stopStatsMonitor(): void {
    if (this.statsTimer !== null) { clearInterval(this.statsTimer); this.statsTimer = null; }
  }

  // ── Create and configure RTCPeerConnection ────────────────────────────────
  private async createPC(callId: string): Promise<RTCPeerConnection> {
    this.teardownPC(); // close any lingering connection

    const config = await this.getIceServers();
    const pc = new RTCPeerConnection({
      ...config,
      // iceCandidatePoolSize intentionally 0:
      // With 3+ TURN servers, a pool of 10 triggers 30+ parallel ALLOCATE requests
      // immediately on PC creation. This can exhaust per-user TURN quotas and slow
      // down gathering. Candidates are gathered naturally after setLocalDescription().
      iceCandidatePoolSize: 0,
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
    });
    this.pc = pc;
    this.remoteDescSet = false;
    this.iceCandidateQueue = [];

    // ── ICE candidate relay ──────────────────────────────────────────────────
    pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        const t = candidate.type ?? 'unknown';
        const proto = candidate.protocol ?? '?';
        const addr = candidate.address ?? '?';
        const relAddr = candidate.relatedAddress ?? '';
        const marker = t === 'relay' ? '✅ RELAY' : t === 'srflx' ? '🌐 SRFLX' : '🏠 HOST';
        // For relay candidates also log the TURN server address (relatedAddress = TURN host)
        const extra = t === 'relay' ? ` via TURN@${relAddr}` : '';
        console.log(`[WebRTC] ${marker} candidate: ${proto} ${addr}${extra} (${candidate.candidate.slice(0, 100)})`);
        getSocket()?.emit('call:ice-candidate', { callId, candidate: candidate.toJSON() });
      } else {
        console.log('[WebRTC] ICE gathering complete — all candidates sent');
      }
    };

    // ── Remote stream ────────────────────────────────────────────────────────
    pc.ontrack = (event) => {
      const [stream] = event.streams;
      if (stream) useCallStore.getState().setRemoteStream(stream);

      // Прижать аудио-буфер приёмника, чтобы задержка не раздувалась на дребезжащей
      // мобильной сети (см. AUDIO_JITTER_BUFFER_TARGET_MS). Поддерживается в Chrome
      // 111+; на других браузерах свойство отсутствует — тихо пропускаем.
      try {
        const receiver = event.receiver as RTCRtpReceiver & { jitterBufferTarget?: number };
        if (event.track.kind === 'audio' && 'jitterBufferTarget' in receiver) {
          receiver.jitterBufferTarget = AUDIO_JITTER_BUFFER_TARGET_MS;
          console.log(`[WebRTC] audio jitterBufferTarget = ${AUDIO_JITTER_BUFFER_TARGET_MS}ms`);
        }
      } catch { /* not supported — keep default */ }
    };

    // ── Connection state (DTLS + ICE combined) ───────────────────────────────
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      console.log(`[WebRTC] connection state: ${state}`);

      if (state === 'connected') {
        this.clearIceConnectTimer();
        if (this.disconnectedTimer !== null) {
          clearTimeout(this.disconnectedTimer);
          this.disconnectedTimer = null;
        }
        useCallStore.getState().setStatus('active');
        useCallStore.getState().setStartedAt(Date.now());
        // Notify server that WebRTC is truly connected (so startedAt is set server-side)
        getSocket()?.emit('call:connected', { callId });
        // Cap video bitrate (canonical place — encodings populated after negotiation)
        // and start periodic stats diagnostics.
        this.applySenderLimits();
        this.startStatsMonitor();
        // Log selected ICE candidate pair for diagnostics
        pc.getStats().then(stats => {
          stats.forEach(report => {
            if (report.type === 'candidate-pair' && report.state === 'succeeded' && report.nominated) {
              const local  = stats.get(report.localCandidateId);
              const remote = stats.get(report.remoteCandidateId);
              if (local && remote) {
                console.log(`[WebRTC] ✅ Active path: local=${local.candidateType}(${local.protocol}:${local.address}) → remote=${remote.candidateType}(${remote.protocol}:${remote.address})`);
              }
            }
          });
        }).catch(() => { /* stats not critical */ });

      } else if (state === 'disconnected') {
        // Transient network blip after established connection — give 15 s to recover.
        console.log('[WebRTC] Connection disconnected — waiting 15 s...');
        this.disconnectedTimer = setTimeout(() => {
          this.disconnectedTimer = null;
          const s = this.pc?.connectionState;
          if (s === 'disconnected' || s === 'failed') {
            console.warn('[WebRTC] Still disconnected after 15 s, hanging up');
            this.hangup(callId, true, 'ended');
          }
        }, 15_000);

      } else if (state === 'failed') {
        this.clearIceConnectTimer();
        if (this.disconnectedTimer !== null) {
          clearTimeout(this.disconnectedTimer);
          this.disconnectedTimer = null;
        }
        console.warn('[WebRTC] Connection failed');
        this.hangup(callId, true, 'failed');
      }
    };

    // ── ICE connection state (more granular, Chrome-specific) ────────────────
    // Chrome sometimes keeps connectionState at 'connecting' even when ICE fails.
    // Explicitly handle 'failed' here so we don't wait for the 30-second timer.
    pc.oniceconnectionstatechange = () => {
      const s = pc.iceConnectionState;
      console.log(`[WebRTC] ICE connection state: ${s}`);

      if (s === 'checking') {
        // ICE has candidates on both sides and is now running connectivity checks.
        // Start the 45-second timer HERE (not at offer/answer time) so the full
        // 45 s is available for actual ICE checks regardless of how long ICE server
        // fetch or media acquisition took.
        this.startIceConnectTimer(callId);

      } else if (s === 'failed') {
        console.error('[WebRTC] ❌ ICE failed — connectivity checks exhausted');
        // Dump candidate pairs to understand what was tried
        pc.getStats().then(stats => {
          let hasRelay = false;
          const pairs: string[] = [];
          stats.forEach(r => {
            if (r.type === 'local-candidate' && r.candidateType === 'relay') hasRelay = true;
            if (r.type === 'candidate-pair') {
              const local  = stats.get(r.localCandidateId);
              const remote = stats.get(r.remoteCandidateId);
              if (local && remote) {
                pairs.push(`  [${r.state}] local=${local.candidateType}(${local.protocol}) → remote=${remote.candidateType}(${remote.protocol})`);
              }
            }
          });
          console.error(`[WebRTC]    Had relay candidates: ${hasRelay}`);
          if (pairs.length) console.error('[WebRTC]    Pairs tried:\n' + pairs.join('\n'));
          else console.error('[WebRTC]    No candidate pairs attempted');
        }).catch(() => {});
        this.clearIceConnectTimer();
        this.hangup(callId, true, 'failed');

      } else if (s === 'connected' || s === 'completed') {
        this.clearIceConnectTimer();
      }
    };

    pc.onicegatheringstatechange = () => {
      console.log(`[WebRTC] ICE gathering state: ${pc.iceGatheringState}`);
    };

    return pc;
  }

  // ── Create a silent audio track (used when no microphone is found) ──────────
  private createSilentStream(): MediaStream {
    try {
      const ctx = new AudioContext();
      const dest = ctx.createMediaStreamDestination();
      // Oscillator at volume 0 keeps the track "live" without sound
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      gain.gain.value = 0;
      osc.connect(gain);
      gain.connect(dest);
      osc.start();
      console.warn('[WebRTC] 🔇 No microphone — using silent audio track');
      useCallStore.getState().setIsMuted(true);
      return dest.stream;
    } catch {
      // Last resort: return empty MediaStream (no tracks)
      console.warn('[WebRTC] 🔇 AudioContext unavailable — empty stream');
      return new MediaStream();
    }
  }

  // ── Get user media (audio ± video) ────────────────────────────────────────
  private async getUserMedia(callType: CallType): Promise<MediaStream> {
    const audioConstraints = {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    };

    if (callType === 'video') {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: audioConstraints,
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
        });
        useCallStore.getState().setLocalStream(stream);
        return stream;
      } catch (err) {
        const name = err instanceof Error ? err.name : '';
        if (name === 'NotFoundError' || name === 'NotReadableError' || name === 'OverconstrainedError') {
          console.warn('[WebRTC] camera unavailable, falling back to audio-only');
          useCallStore.getState().setCallType('audio');
          useCallStore.getState().setIsVideoOff(true);
        } else {
          throw err;
        }
      }
    }

    // Audio-only path
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints, video: false });
      useCallStore.getState().setLocalStream(stream);
      return stream;
    } catch (err) {
      const name = err instanceof Error ? err.name : '';
      if (name === 'NotFoundError' || name === 'NotReadableError') {
        // No microphone available — use silent track so the call can still connect.
        // The user will be auto-muted; the other side can still talk.
        const silent = this.createSilentStream();
        useCallStore.getState().setLocalStream(silent);
        return silent;
      }
      throw err; // NotAllowedError (user denied) — rethrow
    }
  }

  // ── Get or acquire local stream ───────────────────────────────────────────
  private async getOrAcquireLocalStream(callType: CallType): Promise<MediaStream> {
    const existing = useCallStore.getState().localStream;
    if (existing && existing.getTracks().some(t => t.readyState === 'live')) {
      return existing;
    }
    return this.getUserMedia(callType);
  }

  // ── Drain queued ICE candidates ───────────────────────────────────────────
  private async drainIceQueue(): Promise<void> {
    if (!this.pc) return;
    const q = this.iceCandidateQueue.splice(0);
    for (const c of q) {
      try {
        await this.pc.addIceCandidate(new RTCIceCandidate(c));
      } catch { /* ignore stale candidates */ }
    }
  }

  // ── Caller: after receiving call:accepted ─────────────────────────────────
  async initiateOffer(callId: string, callType: CallType): Promise<void> {
    try {
      useCallStore.getState().setStatus('connecting');
      const pc = await this.createPC(callId);
      const stream = await this.getOrAcquireLocalStream(callType);
      stream.getTracks().forEach(track => pc.addTrack(track, stream));
      await this.applySenderLimits(); // cap before the first frames go out

      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: callType === 'video',
      });
      await pc.setLocalDescription(offer);

      getSocket()?.emit('call:offer', { callId, sdp: pc.localDescription });
      console.log('[WebRTC] offer sent');
    } catch (err) {
      console.error('[WebRTC] initiateOffer error:', err);
      this.hangup(callId, true, 'failed');
    }
  }

  // ── Callee: after receiving call:offer ───────────────────────────────────
  async handleOffer(
    callId: string,
    callType: CallType,
    offerSdp: RTCSessionDescriptionInit,
  ): Promise<void> {
    try {
      useCallStore.getState().setStatus('connecting');
      const pc = await this.createPC(callId);
      const stream = await this.getOrAcquireLocalStream(callType);
      stream.getTracks().forEach(track => pc.addTrack(track, stream));
      await this.applySenderLimits(); // cap before the first frames go out

      await pc.setRemoteDescription(new RTCSessionDescription(offerSdp));
      this.remoteDescSet = true;
      await this.drainIceQueue();

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      getSocket()?.emit('call:answer', { callId, sdp: pc.localDescription });
      console.log('[WebRTC] answer sent');
    } catch (err) {
      console.error('[WebRTC] handleOffer error:', err);
      this.hangup(callId, true, 'failed');
    }
  }

  // ── Caller: after receiving call:answer ──────────────────────────────────
  async handleAnswer(answerSdp: RTCSessionDescriptionInit): Promise<void> {
    if (!this.pc) return;
    try {
      await this.pc.setRemoteDescription(new RTCSessionDescription(answerSdp));
      this.remoteDescSet = true;
      await this.drainIceQueue();
      console.log('[WebRTC] answer applied');
    } catch (err) {
      console.error('[WebRTC] handleAnswer error:', err);
    }
  }

  // ── Both parties: process incoming ICE candidate ─────────────────────────
  async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    // Log the incoming candidate type so we can verify both sides exchange candidates
    const c = candidate.candidate ?? '';
    const typeMatch = c.match(/typ (\w+)/);
    const type = typeMatch ? typeMatch[1] : '?';
    const marker = type === 'relay' ? '✅' : type === 'srflx' ? '🌐' : '🏠';
    console.log(`[WebRTC] ← remote ${marker}${type} candidate ${this.remoteDescSet ? '(applied)' : '(queued)'}`);

    if (!this.pc || !this.remoteDescSet) {
      this.iceCandidateQueue.push(candidate);
      return;
    }
    try {
      await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch { /* ignore invalid candidates */ }
  }

  // ── Either party: terminate the call ─────────────────────────────────────
  hangup(
    callId: string | null,
    emitEvent: boolean,
    reason: 'ended' | 'rejected' | 'busy' | 'failed' = 'ended',
  ): void {
    if (emitEvent && callId) {
      getSocket()?.emit('call:end', { callId });
    }

    const store = useCallStore.getState();
    store.localStream?.getTracks().forEach(t => t.stop());
    store.remoteStream?.getTracks().forEach(t => t.stop());
    store.setLocalStream(null);
    store.setRemoteStream(null);

    this.teardownPC();

    store.setEndReason(reason);
    store.setStatus('ended');

    setTimeout(() => { useCallStore.getState().reset(); }, 2500);
  }

  // ── Toggle local audio mute ───────────────────────────────────────────────
  toggleMute(): void {
    const { localStream, isMuted } = useCallStore.getState();
    localStream?.getAudioTracks().forEach(t => { t.enabled = isMuted; });
    useCallStore.getState().setIsMuted(!isMuted);
  }

  // ── Toggle local video ────────────────────────────────────────────────────
  toggleVideo(): void {
    const { localStream, isVideoOff, callType } = useCallStore.getState();
    if (callType !== 'video') return;
    localStream?.getVideoTracks().forEach(t => { t.enabled = isVideoOff; });
    useCallStore.getState().setIsVideoOff(!isVideoOff);
  }

  // ── Internal: close peer connection ───────────────────────────────────────
  private teardownPC(): void {
    this.stopStatsMonitor();
    this.clearIceConnectTimer();
    if (this.disconnectedTimer !== null) {
      clearTimeout(this.disconnectedTimer);
      this.disconnectedTimer = null;
    }
    if (!this.pc) return;
    this.pc.onicecandidate = null;
    this.pc.ontrack = null;
    this.pc.onconnectionstatechange = null;
    this.pc.oniceconnectionstatechange = null;
    this.pc.onicegatheringstatechange = null;
    this.pc.close();
    this.pc = null;
    this.iceCandidateQueue = [];
    this.remoteDescSet = false;
  }
}

// Singleton — one manager instance for the entire app lifetime
export const webrtcManager = new WebRTCManager();
