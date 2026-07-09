/**
 * ReplyPreviewBar — shown above the Composer when user is replying to a message.
 * Shows sender name + quoted text snippet + cancel button.
 */
import { useTranslation } from 'react-i18next';

interface Props {
  reply: {
    messageId: string;
    senderName: string;
    quotedText: string;
  };
  onCancel: () => void;
  onViewUser?: (userId: string) => void;
  senderId?: string | null;
}

export function ReplyPreviewBar({ reply, onCancel, onViewUser, senderId }: Props) {
  const { t } = useTranslation('chat');
  const snippet = reply.quotedText.length > 120
    ? reply.quotedText.slice(0, 120) + '…'
    : reply.quotedText;

  return (
    <div className="replyPreviewBar">
      {/* Left accent stripe */}
      <div className="replyPreviewAccent" />

      {/* Reply icon */}
      <svg className="replyPreviewIcon" width="16" height="16" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="9 17 4 12 9 7"/>
        <path d="M20 18v-2a4 4 0 0 0-4-4H4"/>
      </svg>

      {/* Content */}
      <div className="replyPreviewContent">
        <button
          className="replyPreviewSender"
          onClick={() => onViewUser && senderId && onViewUser(senderId)}
        >
          {reply.senderName}
        </button>
        <div className="replyPreviewText">
          {snippet || <span className="replyPreviewNoText">{t('replyBar.mediaFile')}</span>}
        </div>
      </div>

      {/* Close button */}
      <button className="replyPreviewClose" onClick={onCancel} title={t('replyBar.cancelReply')}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2.5" strokeLinecap="round">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>
  );
}
