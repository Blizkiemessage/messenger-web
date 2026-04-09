/**
 * MediaPlayerContext
 *
 * Shared context for the mini media player bar that appears below the chat header
 * while an audio or video-note message is playing.
 *
 * Usage:
 *   - Wrap the chat area with <MediaPlayerProvider clearKey={activeChatId}>
 *   - AudioPlayer / VideoNotePlayer call ctx.activate(el, info) on play
 *   - AudioPlayer calls ctx.notifyDuration(msgId, dur) when Web Audio decodes real duration
 *   - MiniPlayer reads activeMedia + activeDuration, controls mediaElRef
 *   - clearKey change (chat switch) auto-stops playback and hides the bar
 *
 * Why activeDuration is separate:
 *   HTMLAudioElement.duration returns Infinity for WebM streams (voice messages).
 *   AudioPlayer decodes the real duration via Web Audio API and reports it here so
 *   MiniPlayer can display correct time and allow scrubbing.
 */
import { createContext, useContext, useRef, useState, useCallback, useEffect } from 'react';

export interface ActiveMedia {
  msgId:      string;
  type:       'audio' | 'video_note';
  senderName: string;
}

interface MediaPlayerCtx {
  activeMedia:     ActiveMedia | null;
  mediaElRef:      React.MutableRefObject<HTMLMediaElement | null>;
  activeDuration:  number;                            // best-known duration (may come from Web Audio)
  activate:        (el: HTMLMediaElement, info: ActiveMedia) => void;
  deactivate:      (msgId?: string) => void;
  notifyDuration:  (msgId: string, dur: number) => void; // called by AudioPlayer after decode
}

const Ctx = createContext<MediaPlayerCtx | null>(null);

export function MediaPlayerProvider({
  children,
  clearKey,
}: {
  children:  React.ReactNode;
  clearKey?: string;
}) {
  const [activeMedia,    setActiveMedia]    = useState<ActiveMedia | null>(null);
  const [activeDuration, setActiveDuration] = useState(0);
  const mediaElRef    = useRef<HTMLMediaElement | null>(null);
  const activeMsgId   = useRef<string | null>(null);
  const isFirst       = useRef(true);

  // Auto-clear when clearKey changes (e.g. switching chats)
  useEffect(() => {
    if (isFirst.current) { isFirst.current = false; return; }
    if (mediaElRef.current) {
      mediaElRef.current.pause();
      mediaElRef.current = null;
    }
    activeMsgId.current = null;
    setActiveMedia(null);
    setActiveDuration(0);
  }, [clearKey]); // eslint-disable-line

  const activate = useCallback((el: HTMLMediaElement, info: ActiveMedia) => {
    if (mediaElRef.current && mediaElRef.current !== el) {
      mediaElRef.current.pause();
    }
    mediaElRef.current   = el;
    activeMsgId.current  = info.msgId;
    setActiveMedia(info);
    // Reset duration — new media element's native duration will be read by MiniPlayer
    // (or notifyDuration will provide the decoded value for audio/webm)
    setActiveDuration(isFinite(el.duration) && el.duration > 0 ? el.duration : 0);
  }, []);

  const deactivate = useCallback((msgId?: string) => {
    if (msgId && activeMsgId.current !== msgId) return;
    if (mediaElRef.current) {
      mediaElRef.current.pause();
      mediaElRef.current = null;
    }
    activeMsgId.current = null;
    setActiveMedia(null);
    setActiveDuration(0);
  }, []); // eslint-disable-line

  // Called by AudioPlayer once Web Audio API has decoded the real duration
  const notifyDuration = useCallback((msgId: string, dur: number) => {
    if (activeMsgId.current === msgId && dur > 0) {
      setActiveDuration(dur);
    }
  }, []);

  return (
    <Ctx.Provider value={{ activeMedia, mediaElRef, activeDuration, activate, deactivate, notifyDuration }}>
      {children}
    </Ctx.Provider>
  );
}

export function useMediaPlayer(): MediaPlayerCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useMediaPlayer must be used inside <MediaPlayerProvider>');
  return ctx;
}
