/**
 * DailyPromptCard — карточка «Вопроса дня» в ленте чата.
 * Рендерится в MessageBubble вместо обычного текста, когда
 * attachment_type === 'daily_prompt'. Клик открывает тред ответов.
 */
import { type Message } from '../../types';

interface Props {
  m: Message;
  onOpen: (instanceId: string) => void;
}

export function DailyPromptCard({ m, onOpen }: Props) {
  const instanceId = m.daily_prompt?.instance_id;
  const count = m.daily_prompt?.answer_count ?? 0;

  return (
    <button
      className="dpCard"
      onClick={e => { e.stopPropagation(); if (instanceId) onOpen(instanceId); }}
    >
      <div className="dpCardEyebrow">
        <span className="dpCardMoon">🌙</span> Вопрос дня
      </div>
      <div className="dpCardQuestion">{m.text}</div>
      <div className="dpCardFooter">
        <span className="dpCardCount">
          {count > 0 ? `${count} ${plural(count, 'ответ', 'ответа', 'ответов')}` : 'Ещё нет ответов'}
        </span>
        <span className="dpCardCta">{count > 0 ? 'Смотреть' : 'Ответить'} →</span>
      </div>
    </button>
  );
}

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}
