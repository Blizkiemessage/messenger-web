export function MsgStatus({ isRead }: { isRead: boolean }) {
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
