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
 *  - iceCandidatePoolSize: 10  — pre-gather candidates immediately, not on offer
 *  - bundlePolicy: max-bundle  — single ICE pair for all tracks
 *  - disconnected state timer  — 15 s grace period before declaring failure
 *  - Local stream reuse        — ICE restart doesn't ask for media again
 */
import { useCallStore } from '../store/useCallStore';
import { getSocket } from '../socket/socketClient';
import { API_BASE_URL } from '../config';
import { getToken } from '../storage/session';
import type { CallType } from '../types';

class WebRTCManager {
  private pc: RTCPeerConnection | null = null;
  private iceCandidateQueue: RTCIceCandidateInit[] = [];
  private remoteDescSet = false;
  private disconnectedTimer: ReturnType<typeof setTimeout> | null = null;

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
      return await res.json() as RTCConfiguration;
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

  // ── Create and configure RTCPeerConnection ────────────────────────────────
  private async createPC(callId: string): Promise<RTCPeerConnection> {
    this.teardownPC(); // close any lingering connection

    const config = await this.getIceServers();
    const pc = new RTCPeerConnection({
      ...config,
      // Pre-gather ICE candidates immediately (before offer is even created)
      // so the first offer/answer cycle is much faster.
      iceCandidatePoolSize: 10,
      // Single ICE component for all tracks → fewer candidates, faster pairing.
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require',
    });
    this.pc = pc;
    this.remoteDescSet = false;
    this.iceCandidateQueue = [];

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        console.log(`[WebRTC] ICE candidate: type=${candidate.type} proto=${candidate.protocol}`);
        getSocket()?.emit('call:ice-candidate', {
          callId,
          candidate: candidate.toJSON(),
        });
      } else {
        console.log('[WebRTC] ICE gathering complete');
      }
    };

    pc.ontrack = (event) => {
      const [stream] = event.streams;
      if (stream) useCallStore.getState().setRemoteStream(stream);
    };

    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      console.log('[WebRTC] connection state:', state);

      if (state === 'connected') {
        // Clear any pending disconnection timer
        if (this.disconnectedTimer !== null) {
          clearTimeout(this.disconnectedTimer);
          this.disconnectedTimer = null;
        }
        useCallStore.getState().setStatus('active');
        useCallStore.getState().setStartedAt(Date.now());

      } else if (state === 'disconnected') {
        // Transient — give 15 s for the network to recover before giving up.
        // (Chrome can sit in 'disconnected' for 30+ s before transitioning to 'failed')
        console.log('[WebRTC] Connection disconnected — waiting 15 s before hangup...');
        this.disconnectedTimer = setTimeout(() => {
          this.disconnectedTimer = null;
          const s = this.pc?.connectionState;
          if (s === 'disconnected' || s === 'failed') {
            console.warn('[WebRTC] Still disconnected after timeout, hanging up');
            this.hangup(callId, true);
          }
        }, 15_000);

      } else if (state === 'failed') {
        if (this.disconnectedTimer !== null) {
          clearTimeout(this.disconnectedTimer);
          this.disconnectedTimer = null;
        }
        console.warn('[WebRTC] Connection failed, hanging up');
        this.hangup(callId, true);
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log('[WebRTC] ICE connection state:', pc.iceConnectionState);
    };

    pc.onicegatheringstatechange = () => {
      console.log('[WebRTC] ICE gathering state:', pc.iceGatheringState);
    };

    return pc;
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
        // Camera unavailable or locked — degrade to audio-only rather than drop the call
        if (name === 'NotFoundError' || name === 'NotReadableError' || name === 'OverconstrainedError') {
          console.warn('[WebRTC] camera unavailable, falling back to audio-only');
          useCallStore.getState().setCallType('audio');
          useCallStore.getState().setIsVideoOff(true);
          // fall through to audio-only path below
        } else {
          throw err; // NotAllowedError (permission denied) — rethrow so caller sees it
        }
      }
    }

    const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints, video: false });
    useCallStore.getState().setLocalStream(stream);
    return stream;
  }

  // ── Get or acquire local stream (reuse existing to avoid double mic access) ─
  private async getOrAcquireLocalStream(callType: CallType): Promise<MediaStream> {
    const existing = useCallStore.getState().localStream;
    if (existing && existing.getTracks().some(t => t.readyState === 'live')) {
      return existing;
    }
    return this.getUserMedia(callType);
  }

  // ── Drain queued ICE candidates (safe: ignores invalid ones) ─────────────
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

      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: callType === 'video',
      });
      await pc.setLocalDescription(offer);

      getSocket()?.emit('call:offer', { callId, sdp: pc.localDescription });
      console.log('[WebRTC] offer sent');
    } catch (err) {
      console.error('[WebRTC] initiateOffer error:', err);
      this.hangup(callId, true);
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

      await pc.setRemoteDescription(new RTCSessionDescription(offerSdp));
      this.remoteDescSet = true;
      await this.drainIceQueue();

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      getSocket()?.emit('call:answer', { callId, sdp: pc.localDescription });
      console.log('[WebRTC] answer sent');
    } catch (err) {
      console.error('[WebRTC] handleOffer error:', err);
      this.hangup(callId, true);
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
    if (!this.pc || !this.remoteDescSet) {
      // Queue until remote description is set
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

    // Stop all local tracks (releases camera/mic)
    const store = useCallStore.getState();
    store.localStream?.getTracks().forEach(t => t.stop());
    store.remoteStream?.getTracks().forEach(t => t.stop());

    // Null out streams immediately so the deferred reset() below cannot
    // double-stop tracks (important if a new call starts within 2.5 s).
    store.setLocalStream(null);
    store.setRemoteStream(null);

    this.teardownPC();

    store.setEndReason(reason);
    store.setStatus('ended');

    // Show "Call ended / Busy / Rejected" briefly before hiding the overlay
    setTimeout(() => {
      useCallStore.getState().reset();
    }, 2500);
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

  // ── Internal: close peer connection without touching store streams ────────
  private teardownPC(): void {
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
