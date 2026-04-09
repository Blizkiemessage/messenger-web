/**
 * MediaPlayerContext
 *
 * Shared context for the mini media player bar that appears below the chat header
 * while an audio or video-note message is playing.
 *
 * Usage:
 *   - Wrap the chat area with <MediaPlayerProvider clearKey={activeChatId}>
 *   - AudioPlayer / VideoNotePlayer call ctx.activate(el, info) on play
 *   - MiniPlayer reads activeMedia, controls mediaElRef
 *   - clearKey change (chat switch) auto-stops playback and hides the bar
 */
import { createContext, useContext, useRef, useState, useCallback, useEffect } from 'react';

export interface ActiveMedia {
  msgId:      string;
  type:       'audio' | 'video_note';
  senderName: string;
}

interface MediaPlayerCtx {
  activeMedia:  ActiveMedia | null;
  mediaElRef:   React.MutableRefObject<HTMLMediaElement | null>;
  activate:     (el: HTMLMediaElement, info: ActiveMedia) => void;
  deactivate:   (msgId?: string) => void;
}

const Ctx = createContext<MediaPlayerCtx | null>(null);

export function MediaPlayerProvider({
  children,
  clearKey,
}: {
  children:  React.ReactNode;
  clearKey?: string;
}) {
  const [activeMedia, setActiveMedia] = useState<ActiveMedia | null>(null);
  const mediaElRef   = useRef<HTMLMediaElement | null>(null);
  const isFirst      = useRef(true);

  // Auto-clear when clearKey changes (e.g. switching chats)
  useEffect(() => {
    if (isFirst.current) { isFirst.current = false; return; }
    if (mediaElRef.current) {
      mediaElRef.current.pause();
      mediaElRef.current = null;
    }
    setActiveMedia(null);
  }, [clearKey]); // eslint-disable-line

  const activate = useCallback((el: HTMLMediaElement, info: ActiveMedia) => {
    // Pause the previous element if different
    if (mediaElRef.current && mediaElRef.current !== el) {
      mediaElRef.current.pause();
    }
    mediaElRef.current = el;
    setActiveMedia(info);
  }, []);

  const deactivate = useCallback((msgId?: string) => {
    if (msgId && activeMedia?.msgId !== msgId) return;
    if (mediaElRef.current) {
      mediaElRef.current.pause();
      mediaElRef.current = null;
    }
    setActiveMedia(null);
  }, [activeMedia?.msgId]); // eslint-disable-line

  return (
    <Ctx.Provider value={{ activeMedia, mediaElRef, activate, deactivate }}>
      {children}
    </Ctx.Provider>
  );
}

export function useMediaPlayer(): MediaPlayerCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useMediaPlayer must be used inside <MediaPlayerProvider>');
  return ctx;
}
