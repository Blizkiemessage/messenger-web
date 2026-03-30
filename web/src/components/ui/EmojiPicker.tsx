/**
 * EmojiPicker — small floating emoji grid rendered via Portal.
 * Used for message reactions.
 */
import { useEffect, useRef } from 'react';
import { Portal } from './Portal';

const EMOJIS = ['❤️', '👍', '😂', '😮', '😢', '🔥', '👏', '🎉', '🤔', '💯', '😍', '😡'];

interface Props {
  x: number;
  y: number;
  onPick: (emoji: string) => void;
  onClose: () => void;
}

export function EmojiPicker({ x, y, onPick, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    // slight delay so the opening click doesn't immediately close it
    const t = setTimeout(() => window.addEventListener('mousedown', handle), 50);
    return () => { clearTimeout(t); window.removeEventListener('mousedown', handle); };
  }, [onClose]);

  // Clamp to viewport
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const PANEL_W = 236;
  const PANEL_H = 88;
  const cx = Math.max(8, Math.min(x, vw - PANEL_W - 8));
  const cy = Math.max(8, Math.min(y - PANEL_H - 8, vh - PANEL_H - 8));

  return (
    <Portal>
      <div
        ref={ref}
        className="emojiPickerPanel"
        style={{ left: cx, top: cy }}
        onContextMenu={e => e.preventDefault()}
      >
        {EMOJIS.map(emoji => (
          <button
            key={emoji}
            className="emojiPickerBtn"
            onClick={() => { onPick(emoji); onClose(); }}
            title={emoji}
          >
            {emoji}
          </button>
        ))}
      </div>
    </Portal>
  );
}
