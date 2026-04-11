import { useState } from 'react';
import Picker from '@emoji-mart/react';
import data from '@emoji-mart/data';
import { GifTab } from './GifTab';

type Tab = 'emoji' | 'gif';

interface Props {
  onEmojiSelect: (emoji: { native: string }) => void;
  onSendGif: (url: string) => void;
  theme: 'dark' | 'light';
}

export function EmojiStickerPanel({ onEmojiSelect, onSendGif, theme }: Props) {
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
          className={`espTab${tab === 'gif' ? ' active' : ''}`}
          onClick={() => setTab('gif')}
        >
          GIF
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

      {tab === 'gif' && (
        <GifTab onSendGif={onSendGif} />
      )}
    </div>
  );
}
