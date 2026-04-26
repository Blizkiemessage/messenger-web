/**
 * useCallStore — E3: WebRTC call state
 *
 * Keeps the complete state of the current call lifecycle.
 * Intentionally separate from useChatsStore to avoid polluting the chat domain.
 *
 * MediaStream objects are stored directly — this store is never persisted,
 * so non-serializable values are safe here.
 */
import { create } from 'zustand';
import type { CallType, CallStatus, User } from '../types';

interface CallState {
  callId: string | null;
  chatId: string | null;
  callType: CallType;
  status: CallStatus;
  /** The other person in the call */
  peerId: string | null;
  peerInfo: User | null;
  /** true = we initiated the call; false = we received it */
  isInitiator: boolean;
  /** Our local camera/mic stream */
  localStream: MediaStream | null;
  /** The remote peer's stream */
  remoteStream: MediaStream | null;
  isMuted: boolean;
  isVideoOff: boolean;
  /** Unix ms when both parties were connected (RTCPeerConnection 'connected') */
  startedAt: number | null;
  /** Elapsed seconds, ticked by interval in CallOverlay */
  elapsedSeconds: number;

  // ── Primitive setters ─────────────────────────────────────────────────────
  setStatus: (s: CallStatus) => void;
  setLocalStream: (s: MediaStream | null) => void;
  setRemoteStream: (s: MediaStream | null) => void;
  setIsMuted: (v: boolean) => void;
  setIsVideoOff: (v: boolean) => void;
  setStartedAt: (ts: number | null) => void;
  setElapsedSeconds: (n: number) => void;

  // ── Complex actions ───────────────────────────────────────────────────────
  startOutgoingCall: (p: {
    callId: string; chatId: string; callType: CallType;
    peerId: string; peerInfo: User;
  }) => void;

  handleIncomingCall: (p: {
    callId: string; chatId: string; callType: CallType;
    peerId: string; peerInfo: User;
  }) => void;

  /** Stop all tracks and reset to idle state */
  reset: () => void;
}

const IDLE: Pick<
  CallState,
  'callId'|'chatId'|'callType'|'status'|'peerId'|'peerInfo'|'isInitiator'|
  'localStream'|'remoteStream'|'isMuted'|'isVideoOff'|'startedAt'|'elapsedSeconds'
> = {
  callId: null, chatId: null, callType: 'audio', status: 'idle',
  peerId: null, peerInfo: null, isInitiator: false,
  localStream: null, remoteStream: null,
  isMuted: false, isVideoOff: false,
  startedAt: null, elapsedSeconds: 0,
};

export const useCallStore = create<CallState>((set, get) => ({
  ...IDLE,

  setStatus:         (status)         => set({ status }),
  setLocalStream:    (localStream)    => set({ localStream }),
  setRemoteStream:   (remoteStream)   => set({ remoteStream }),
  setIsMuted:        (isMuted)        => set({ isMuted }),
  setIsVideoOff:     (isVideoOff)     => set({ isVideoOff }),
  setStartedAt:      (startedAt)      => set({ startedAt }),
  setElapsedSeconds: (elapsedSeconds) => set({ elapsedSeconds }),

  startOutgoingCall: ({ callId, chatId, callType, peerId, peerInfo }) =>
    set({ ...IDLE, callId, chatId, callType, peerId, peerInfo, status: 'calling', isInitiator: true }),

  handleIncomingCall: ({ callId, chatId, callType, peerId, peerInfo }) =>
    set({ ...IDLE, callId, chatId, callType, peerId, peerInfo, status: 'incoming', isInitiator: false }),

  reset: () => {
    const { localStream, remoteStream } = get();
    localStream?.getTracks().forEach(t => t.stop());
    remoteStream?.getTracks().forEach(t => t.stop());
    set(IDLE);
  },
}));
