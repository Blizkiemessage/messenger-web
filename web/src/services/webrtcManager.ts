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
 */
import { useCallStore } from '../store/useCallStore';
import { getSocket } from '../socket/socketClient';
import { API_BASE_URL } from '../config';
import type { CallType } from '../types';

class WebRTCManager {
  private pc: RTCPeerConnection | null = null;
  private iceCandidateQueue: RTCIceCandidateInit[] = [];
  private remoteDescSet = false;

  // ── ICE server config from backend ────────────────────────────────────────
  private async getIceServers(): Promise<RTCConfiguration> {
    try {
      const res = await fetch(`${API_BASE_URL}/calls/ice-servers`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('ice-servers fetch failed');
      return await res.json() as RTCConfiguration;
    } catch {
      // Fallback to public STUN — works for same-network / relay-free connections
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
    const pc = new RTCPeerConnection(config);
    this.pc = pc;
    this.remoteDescSet = false;
    this.iceCandidateQueue = [];

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        getSocket()?.emit('call:ice-candidate', {
          callId,
          candidate: candidate.toJSON(),
        });
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
        useCallStore.getState().setStatus('active');
        useCallStore.getState().setStartedAt(Date.now());
      } else if (state === 'failed') {
        this.hangup(callId, true);
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log('[WebRTC] ICE connection state:', pc.iceConnectionState);
    };

    return pc;
  }

  // ── Get user media (audio ± video) ────────────────────────────────────────
  private async getUserMedia(callType: CallType): Promise<MediaStream> {
    const constraints: MediaStreamConstraints = {
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: callType === 'video'
        ? { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' }
        : false,
    };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    useCallStore.getState().setLocalStream(stream);
    return stream;
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
      const stream = await this.getUserMedia(callType);
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
      const stream = await this.getUserMedia(callType);
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
  hangup(callId: string | null, emitEvent: boolean): void {
    if (emitEvent && callId) {
      getSocket()?.emit('call:end', { callId });
    }

    // Stop all local tracks (releases camera/mic)
    const store = useCallStore.getState();
    store.localStream?.getTracks().forEach(t => t.stop());
    store.remoteStream?.getTracks().forEach(t => t.stop());

    this.teardownPC();

    store.setStatus('ended');
    // Show "Call ended" briefly before hiding the overlay
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
    if (!this.pc) return;
    this.pc.onicecandidate = null;
    this.pc.ontrack = null;
    this.pc.onconnectionstatechange = null;
    this.pc.oniceconnectionstatechange = null;
    this.pc.close();
    this.pc = null;
    this.iceCandidateQueue = [];
    this.remoteDescSet = false;
  }
}

// Singleton — one manager instance for the entire app lifetime
export const webrtcManager = new WebRTCManager();
