interface MsgStatusProps {
  isRead:     boolean;
  isPending?: boolean;
  isError?:   boolean;
  onRetry?:   () => void;
}

export function MsgStatus({ isRead, isPending, isError, onRetry }: MsgStatusProps) {
  // Sending spinner — clock/ring animation
  if (isPending) {
    return (
      <svg className="msgStatus sending" width="14" height="14" viewBox="0 0 14 14" fill="none">
        <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.6" strokeOpacity="0.35"/>
        <path d="M7 1.5A5.5 5.5 0 0 1 12.5 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
      </svg>
    );
  }

  // Send error — red exclamation badge (tappable for retry)
  if (isError) {
    return (
      <button
        className="msgStatus error"
        onClick={e => { e.stopPropagation(); onRetry?.(); }}
        title="Ошибка отправки. Нажмите, чтобы повторить"
        aria-label="Ошибка отправки"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <circle cx="7" cy="7" r="6" fill="currentColor" fillOpacity="0.15"/>
          <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.4"/>
          <line x1="7" y1="4" x2="7" y2="7.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          <circle cx="7" cy="9.8" r="0.75" fill="currentColor"/>
        </svg>
      </button>
    );
  }

  // Read (double-tick, accent) / Sent (single-tick, muted)
  return isRead ? (
    <svg className="msgStatus read" width="16" height="11" viewBox="0 0 16 11" fill="none">
      <path d="M1 5.5L4.5 9L10 3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M6 5.5L9.5 9L15 3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  ) : (
    <svg className="msgStatus sent" width="12" height="10" viewBox="0 0 12 10" fill="none">
      <path d="M1 5L4.5 8.5L11 1.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}
