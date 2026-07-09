import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t, i18n } = useTranslation('chat');
  const [tab, setTab] = useState<Tab>('emoji');
  const [emojiSub, setEmojiSub] = useState<EmojiSubTab>('standard');

  const { emojiPacks, fetchInstalledPacks } = useStickerStore();

  // Eagerly load installed packs when the panel opens so sub-tabs show
  // the correct badge count immediately (and emoji packs are available)
  useEffect(() => { fetchInstalledPacks(); }, [fetchInstalledPacks]);

  return (
    <div className="espRoot">
      {/* ── Main tab bar ──────────────────────────────────────────────────── */}
      <div className="espTabs">
        <button
          className={`espTab${tab === 'emoji' ? ' active' : ''}`}
          onClick={() => setTab('emoji')}
        >
          {t('emojiPanel.tabEmoji')}
        </button>
        <button
          className={`espTab${tab === 'sticker' ? ' active' : ''}`}
          onClick={() => setTab('sticker')}
        >
          {t('emojiPanel.tabStickers')}
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
          {t('emojiPanel.tabStudio')}
        </button>
      </div>

      {/* ── Emoji tab ─────────────────────────────────────────────────────── */}
      {tab === 'emoji' && (
        <div className="espEmojiTab">
          {/* Sub-tab switcher: always shown so users can discover & install emoji packs */}
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
              {t('emojiPanel.subStandard')}
            </button>
            <button
              className={`espEmojiSubTab${emojiSub === 'custom' ? ' active' : ''}`}
              onClick={() => setEmojiSub('custom')}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
              </svg>
              {t('emojiPanel.subCustom')}
              {emojiPacks.length > 0 && (
                <span className="espEmojiSubTabBadge">{emojiPacks.length}</span>
              )}
            </button>
          </div>

          {/* Standard emoji picker */}
          {emojiSub === 'standard' && (
            <Picker
              data={data}
              onEmojiSelect={onEmojiSelect}
              theme={theme}
              locale={i18n.language === 'en' ? 'en' : 'ru'}
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
