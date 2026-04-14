import { useState } from 'react';
import Picker from '@emoji-mart/react';
import data from '@emoji-mart/data';
import { GifTab } from './GifTab';
import { StickersTab } from './StickersTab';
import { EmojiPackSection } from './EmojiPackSection';

type Tab = 'emoji' | 'sticker' | 'gif' | 'studio';

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

  return (
    <div className="espRoot">
      {/* Tab bar */}
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

      {/* Tab content */}
      {tab === 'emoji' && (
        <div className="espEmojiTabContent">
          {/* Standard emoji picker */}
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
          {/* Custom emoji packs section */}
          <EmojiPackSection
            onSelectEmoji={onSendCustomEmoji}
            onOpenStudio={onOpenStudio}
          />
        </div>
      )}

      {tab === 'sticker' && (
        <StickersTab onSendSticker={onSendSticker} onOpenStudio={onOpenStudio} />
      )}

      {tab === 'gif' && (
        <GifTab onSendGif={onSendGif} />
      )}
    </div>
  );
}
