/**
 * EmojiPicker — floating emoji grid rendered via Portal.
 * Used for message reactions.
 * Supports both standard emoji and custom emoji packs (Этап 8).
 */
import { useEffect, useRef, useState } from 'react';
import { Portal } from './Portal';
import { useStickerStore } from '../../store/useStickerStore';
import { PackCover } from './PackCover';

const EMOJIS = ['❤️', '👍', '😂', '😮', '😢', '🔥', '👏', '🎉', '🤔', '💯', '😍', '😡'];

interface Props {
  x: number;
  y: number;
  onPick: (emoji: string) => void;
  onClose: () => void;
}

export function EmojiPicker({ x, y, onPick, onClose }: Props) {
  const ref  = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<'standard' | 'custom'>('standard');

  const { emojiPacks, packItems, fetchPackItems } = useStickerStore();
  const [activePackId, setActivePackId] = useState<string | null>(null);

  // Auto-select first emoji pack
  useEffect(() => {
    if (emojiPacks.length > 0 && !activePackId) {
      setActivePackId(emojiPacks[0].id);
    }
  }, [emojiPacks, activePackId]);

  // Load items when pack selected
  useEffect(() => {
    if (activePackId && !packItems[activePackId]) {
      fetchPackItems(activePackId);
    }
  }, [activePackId, packItems, fetchPackItems]);

  // Close on outside click
  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const t = setTimeout(() => window.addEventListener('mousedown', handle), 50);
    return () => { clearTimeout(t); window.removeEventListener('mousedown', handle); };
  }, [onClose]);

  const hasCustom = emojiPacks.length > 0;

  // Clamp to viewport
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const PANEL_W = hasCustom ? 260 : 236;
  const PANEL_H = tab === 'custom' ? 220 : (hasCustom ? 108 : 88);
  const cx = Math.max(8, Math.min(x, vw - PANEL_W - 8));
  const cy = Math.max(8, Math.min(y - PANEL_H - 8, vh - PANEL_H - 8));

  const activeItems = activePackId ? (packItems[activePackId] ?? []) : [];

  return (
    <Portal>
      <div
        ref={ref}
        className={`emojiPickerPanel${hasCustom ? ' withTabs' : ''}`}
        style={{ left: cx, top: cy, width: PANEL_W }}
        onContextMenu={e => e.preventDefault()}
      >
        {/* Tab bar — only shown when there are custom packs */}
        {hasCustom && (
          <div className="emojiPickerTabs">
            <button
              className={`emojiPickerTabBtn${tab === 'standard' ? ' active' : ''}`}
              onClick={() => setTab('standard')}
            >
              Стандарт
            </button>
            <button
              className={`emojiPickerTabBtn${tab === 'custom' ? ' active' : ''}`}
              onClick={() => setTab('custom')}
            >
              Кастомные
            </button>
          </div>
        )}

        {/* Standard emoji grid */}
        {tab === 'standard' && (
          <div className="emojiPickerGrid">
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
        )}

        {/* Custom emoji tab */}
        {tab === 'custom' && (
          <div className="emojiPickerCustom">
            {emojiPacks.length === 0 ? (
              <div className="emojiPickerCustomEmpty">Нет паков</div>
            ) : (
              <>
                {/* Pack icon strip */}
                <div className="emojiPickerPackStrip">
                  {emojiPacks.map(pack => (
                    <button
                      key={pack.id}
                      className={`emojiPickerPackIcon${activePackId === pack.id ? ' active' : ''}`}
                      onClick={() => setActivePackId(pack.id)}
                      title={pack.name}
                    >
                      <PackCover url={pack.cover_url} name={pack.name} />
                    </button>
                  ))}
                </div>
                {/* Emoji grid */}
                <div className="emojiPickerCustomGrid">
                  {activeItems.length === 0 && (
                    <div className="emojiPickerCustomEmpty">
                      <div className="gifSpinner" style={{ width: 16, height: 16 }} />
                    </div>
                  )}
                  {activeItems.map(item => (
                    <button
                      key={item.id}
                      className="emojiPickerCustomBtn"
                      title={item.emoji_hint || item.keywords?.[0] || 'эмодзи'}
                      onClick={() => {
                        onPick(`:${item.pack_id}:${item.id}:`);
                        onClose();
                      }}
                    >
                      <img
                        src={item.thumb_url || item.file_url}
                        className="emojiPickerCustomImg"
                        alt=""
                        loading="lazy"
                      />
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </Portal>
  );
}
