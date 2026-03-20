interface Props {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
}

export function Composer({ value, onChange, onSend }: Props) {
  return (
    <div className="composer">
      <input
        className="composerInput"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="Сообщение…"
        onKeyDown={e => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            onSend();
          }
        }}
      />
      <button className="composerSend" onClick={onSend} disabled={!value.trim()}>
        <svg viewBox="0 0 24 24" fill="none" width="20" height="20">
          <path d="M22 2L11 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          <path d="M22 2L15 22L11 13L2 9L22 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
    </div>
  );
}
