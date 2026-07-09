/**
 * DailyPromptCard — карточка «Вопроса дня» в ленте чата.
 * Рендерится в MessageBubble вместо обычного текста, когда
 * attachment_type === 'daily_prompt'. Клик открывает тред ответов.
 */
import { useTranslation } from 'react-i18next';
import { type Message } from '../../types';

interface Props {
  m: Message;
  onOpen: (instanceId: string) => void;
}

export function DailyPromptCard({ m, onOpen }: Props) {
  const { t } = useTranslation('chat');
  const instanceId = m.daily_prompt?.instance_id;
  const count = m.daily_prompt?.answer_count ?? 0;

  return (
    <button
      className="dpCard"
      onClick={e => { e.stopPropagation(); if (instanceId) onOpen(instanceId); }}
    >
      <div className="dpCardEyebrow">
        <span className="dpCardMoon">🌙</span> {t('infoPanel.dailyPrompt')}
      </div>
      <div className="dpCardQuestion">{m.text}</div>
      <div className="dpCardFooter">
        <span className="dpCardCount">
          {count > 0 ? t('dailyPrompt.answerCount', { count }) : t('dailyPrompt.noAnswersYet')}
        </span>
        <span className="dpCardCta">{count > 0 ? t('dailyPrompt.viewCta') : t('dailyPrompt.replyCta')} →</span>
      </div>
    </button>
  );
}
