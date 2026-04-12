import { useState } from 'react';
import Picker from '@emoji-mart/react';
import data from '@emoji-mart/data';
import { GifTab } from './GifTab';
import { StickersTab } from './StickersTab';

type Tab = 'emoji' | 'sticker' | 'gif' | 'studio';

interface Props {
  onEmojiSelect: (emoji: { native: string }) => void;
  onSendGif: (url: string) => void;
  onSendSticker: (url: string, itemId: string, packId: string) => void;
  onOpenStudio: () => void;
  theme: 'dark' | 'light';
}

export function EmojiStickerPanel({ onEmojiSelect, onSendGif, onSendSticker, onOpenStudio, theme }: Props) {
  const [tab, setTab] = useState<Tab>('emoji');

  function handleStudioClick() {
    onOpenStudio();
  }

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
          className="espTab"
          onClick={handleStudioClick}
        >
          Студия
        </button>
      </div>

      {/* Tab content */}
      {tab === 'emoji' && (
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

      {tab === 'sticker' && (
        <StickersTab onSendSticker={onSendSticker} onOpenStudio={onOpenStudio} />
      )}

      {tab === 'gif' && (
        <GifTab onSendGif={onSendGif} />
      )}
    </div>
  );
}
