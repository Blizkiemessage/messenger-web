/**
 * messageBubble/QuotedText.tsx — reply-quote text with a "показать больше" expander.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

export function QuotedText({ text }: { text: string | null | undefined }) {
  const { t } = useTranslation('chat');
  const [expanded, setExpanded] = useState(false);
  const LIMIT = 120;
  if (!text) return <span className="bubbleReplyNoText">{t('replyBar.mediaFile')}</span>;
  if (text.length <= LIMIT || expanded) return <span>{text}</span>;
  return (
    <>
      <span>{text.slice(0, LIMIT)}…</span>
      <button
        className="bubbleReplyExpand"
        onClick={e => { e.stopPropagation(); setExpanded(true); }}
      >
        {t('bubble.showMore')}
      </button>
    </>
  );
}
