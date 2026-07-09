/**
 * messageBubble/ReactionBar.tsx — grouped emoji reaction chips under a bubble.
 */
import { useTranslation } from 'react-i18next';
import { type MessageReaction } from '../../../types';
import { isCustomEmoji, resolveCustomEmojiUrl } from './helpers';

export function ReactionBar({
  reactions, meId, isOwn, onReact,
}: {
  reactions: MessageReaction[];
  meId: string;
  isOwn: boolean;
  onReact: (emoji: string) => void;
}) {
  const { t } = useTranslation('chat');
  if (!reactions || reactions.length === 0) return null;

  // Group by emoji
  const groups: Record<string, { count: number; isMine: boolean }> = {};
  for (const r of reactions) {
    if (!groups[r.emoji]) groups[r.emoji] = { count: 0, isMine: false };
    groups[r.emoji].count++;
    if (r.userId === meId) groups[r.emoji].isMine = true;
  }

  return (
    <div className={`reactionBar${isOwn ? ' reactionBarOwn' : ''}`}>
      {Object.entries(groups).map(([emoji, { count, isMine }]) => {
        const custom = isCustomEmoji(emoji);
        const customUrl = custom ? resolveCustomEmojiUrl(emoji) : null;
        return (
          <button
            key={emoji}
            className={`reactionChip${isMine ? ' reactionChipMine' : ''}${custom ? ' reactionChipCustom' : ''}`}
            onClick={e => { e.stopPropagation(); onReact(emoji); }}
            title={isMine ? t('media.removeReaction') : t('media.addReaction')}
          >
            {custom && customUrl
              ? <img src={customUrl} className="customEmojiReaction" alt="" loading="lazy" />
              : <span>{emoji}</span>
            }
            {count > 1 && <span className="reactionCount">{count}</span>}
          </button>
        );
      })}
    </div>
  );
}
