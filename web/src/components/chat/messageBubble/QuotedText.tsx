/**
 * messageBubble/QuotedText.tsx — reply-quote text with a "показать больше" expander.
 */
import { useState } from 'react';

export function QuotedText({ text }: { text: string | null | undefined }) {
  const [expanded, setExpanded] = useState(false);
  const LIMIT = 120;
  if (!text) return <span className="bubbleReplyNoText">Медиафайл</span>;
  if (text.length <= LIMIT || expanded) return <span>{text}</span>;
  return (
    <>
      <span>{text.slice(0, LIMIT)}…</span>
      <button
        className="bubbleReplyExpand"
        onClick={e => { e.stopPropagation(); setExpanded(true); }}
      >
        показать больше
      </button>
    </>
  );
}
