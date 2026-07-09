/**
 * EmojiPicker — floating emoji grid rendered via Portal.
 * Used for message reactions.
 * Supports both standard emoji and custom emoji packs (Этап 8).
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation('chat');
  const ref  = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<'standard' | 'custom'>('standard');

  const { emojiPacks, packItems, fetchPackItems, fetchInstalledPacks } = useStickerStore();
  const [activePackId, setActivePackId] = useState<string | null>(null);

  // Eagerly load installed packs so the Custom tab is populated
  useEffect(() => { fetchInstalledPacks(); }, [fetchInstalledPacks]);

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

  // Clamp to viewport — always use wider panel (tabs are always shown)
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const PANEL_W = 260;
  const PANEL_H = tab === 'custom' ? 220 : 108;
  const cx = Math.max(8, Math.min(x, vw - PANEL_W - 8));
  const cy = Math.max(8, Math.min(y - PANEL_H - 8, vh - PANEL_H - 8));

  const activeItems = activePackId ? (packItems[activePackId] ?? []) : [];

  return (
    <Portal>
      <div
        ref={ref}
        className="emojiPickerPanel withTabs"
        style={{ left: cx, top: cy, width: PANEL_W }}
        onContextMenu={e => e.preventDefault()}
      >
        {/* Tab bar — always shown */}
        <div className="emojiPickerTabs">
          <button
            className={`emojiPickerTabBtn${tab === 'standard' ? ' active' : ''}`}
            onClick={() => setTab('standard')}
          >
            {t('emojiPanel.subStandard')}
          </button>
          <button
            className={`emojiPickerTabBtn${tab === 'custom' ? ' active' : ''}`}
            onClick={() => setTab('custom')}
          >
            {t('emojiPanel.subCustom')}
          </button>
        </div>

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
              <div className="emojiPickerCustomEmpty">{t('emojiPackSection.noPacksInstalled')}</div>
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
                      title={item.emoji_hint || item.keywords?.[0] || t('emojiPackSection.emojiAlt')}
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
