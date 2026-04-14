import { useState } from 'react';
import Picker from '@emoji-mart/react';
import data from '@emoji-mart/data';
import { GifTab } from './GifTab';
import { StickersTab } from './StickersTab';
import { EmojiPackSection } from './EmojiPackSection';
import { useStickerStore } from '../../store/useStickerStore';

type Tab = 'emoji' | 'sticker' | 'gif' | 'studio';
type EmojiSubTab = 'standard' | 'custom';

interface Props {
  onEmojiSelect: (emoji: { native: string }) => void;
  onSendGif: (url: string) => void;
  onSendSticker: (url: string, itemId: string, packId: string) => void;
  onSendCustomEmoji: (packId: string, itemId: string, fileUrl: string) => void;
  onOpenStudio: () => void;
  theme: 'dark' | 'light';
}

export function EmojiStickerPanel({
  onEmojiSelect, onSendGif, onSendSticker, onSendCustomEmoji, onOpenStudio, theme,
}: Props) {
  const [tab, setTab] = useState<Tab>('emoji');
  const [emojiSub, setEmojiSub] = useState<EmojiSubTab>('standard');

  const { emojiPacks } = useStickerStore();
  const hasCustom = emojiPacks.length > 0;

  return (
    <div className="espRoot">
      {/* ── Main tab bar ──────────────────────────────────────────────────── */}
      <div className="espTabs">
        <button
          className={`espTab${tab === 'emoji' ? ' active' : ''}`}
          onClick={() => setTab('emoji')}
        >
          Эмодзи
        </button>
        <button
          className={`espTab${tab === 'sticker' ? ' active' : ''}`}
          onClick={() => setTab('sticker')}
        >
          Стикеры
        </button>
        <button
          className={`espTab${tab === 'gif' ? ' active' : ''}`}
          onClick={() => setTab('gif')}
        >
          GIF
        </button>
        <button
          className={`espTab${tab === 'studio' ? ' active' : ''}`}
          onClick={() => { setTab('studio'); onOpenStudio(); }}
        >
          Студия
        </button>
      </div>

      {/* ── Emoji tab ─────────────────────────────────────────────────────── */}
      {tab === 'emoji' && (
        <div className="espEmojiTab">
          {/* Sub-tab switcher: shown only when there are custom packs */}
          {hasCustom && (
            <div className="espEmojiSubTabs">
              <button
                className={`espEmojiSubTab${emojiSub === 'standard' ? ' active' : ''}`}
                onClick={() => setEmojiSub('standard')}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/>
                  <path d="M8 14s1.5 2 4 2 4-2 4-2"/>
                  <line x1="9" y1="9" x2="9.01" y2="9"/>
                  <line x1="15" y1="9" x2="15.01" y2="9"/>
                </svg>
                Стандарт
              </button>
              <button
                className={`espEmojiSubTab${emojiSub === 'custom' ? ' active' : ''}`}
                onClick={() => setEmojiSub('custom')}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                </svg>
                Кастомные
                <span className="espEmojiSubTabBadge">{emojiPacks.length}</span>
              </button>
            </div>
          )}

          {/* Standard emoji picker */}
          {emojiSub === 'standard' && (
            <Picker
              data={data}
              onEmojiSelect={onEmojiSelect}
              theme={theme}
              locale="ru"
              previewPosition="none"
              skinTonePosition="none"
              maxFrequentRows={2}
              noCountryFlags={false}
            />
          )}

          {/* Custom emoji packs */}
          {emojiSub === 'custom' && (
            <div className="espCustomEmojiPanel">
              <EmojiPackSection
                onSelectEmoji={onSendCustomEmoji}
                onOpenStudio={() => { onOpenStudio(); }}
              />
            </div>
          )}

          {/* If no custom packs yet — show a hint below the standard picker */}
          {!hasCustom && emojiSub === 'standard' && (
            <div className="espCustomEmojiHint">
              <button className="espCustomEmojiHintBtn" onClick={onOpenStudio}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/>
                  <line x1="12" y1="8" x2="12" y2="16"/>
                  <line x1="8" y1="12" x2="16" y2="12"/>
                </svg>
                Создать кастомные эмодзи
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Stickers tab ──────────────────────────────────────────────────── */}
      {tab === 'sticker' && (
        <StickersTab onSendSticker={onSendSticker} onOpenStudio={onOpenStudio} />
      )}

      {/* ── GIF tab ───────────────────────────────────────────────────────── */}
      {tab === 'gif' && (
        <GifTab onSendGif={onSendGif} />
      )}
    </div>
  );
}
