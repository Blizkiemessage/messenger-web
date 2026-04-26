/**
 * StatusPicker
 *
 * Compact inline status picker used in SidebarBottom's profile popup.
 * Shows current status + expands to let the user change it.
 *
 * Statuses: free | busy | dnd | null (clear)
 * Optional note (max 60 chars) and optional auto-expiry.
 */
import { useState, useRef, useEffect } from 'react';
import { PRESENCE_LABELS, PRESENCE_COLORS, PRESENCE_EMOJI } from './Avatar';
import { setPresenceStatus, type PresenceStatus } from '../../api/presence';
import { useSessionStore } from '../../store/useSessionStore';

type ExpiryOption = '1h' | '4h' | 'today' | 'none';

function getExpiryMs(opt: ExpiryOption): number | null {
  const now = Date.now();
  if (opt === '1h')   return now + 60 * 60 * 1000;
  if (opt === '4h')   return now + 4 * 60 * 60 * 1000;
  if (opt === 'today') {
    const end = new Date(); end.setHours(23, 59, 59, 999);
    return end.getTime();
  }
  return null;
}

const STATUS_OPTIONS: { value: PresenceStatus; label: string; emoji: string; color: string }[] = [
  { value: 'free', label: 'Свободен',         emoji: PRESENCE_EMOJI.free, color: PRESENCE_COLORS.free },
  { value: 'busy', label: 'Занят',            emoji: PRESENCE_EMOJI.busy, color: PRESENCE_COLORS.busy },
  { value: 'dnd',  label: 'Не беспокоить',   emoji: PRESENCE_EMOJI.dnd,  color: PRESENCE_COLORS.dnd  },
];

interface Props {
  currentStatus: PresenceStatus;
  currentNote?: string | null;
  currentExpiresAt?: number | null;
}

export function StatusPicker({ currentStatus, currentNote, currentExpiresAt: _currentExpiresAt }: Props) {
  const [open,        setOpen]        = useState(false);
  const [selected,    setSelected]    = useState<PresenceStatus>(currentStatus);
  const [note,        setNote]        = useState(currentNote ?? '');
  const [expiry,      setExpiry]      = useState<ExpiryOption>('none');
  const [busy,        setBusy]        = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const updateMe = useSessionStore(s => s.updateMe);

  // Sync if external state changes (e.g., status cleared by expiry)
  useEffect(() => {
    setSelected(currentStatus);
    setNote(currentNote ?? '');
  }, [currentStatus, currentNote]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  async function apply(status: PresenceStatus) {
    setSelected(status);
    setBusy(true);
    try {
      const expiresAt = status ? getExpiryMs(expiry) : null;
      const updated = await setPresenceStatus({
        status,
        note: (status && note.trim()) ? note.trim() : null,
        expires_at: expiresAt,
      });
      updateMe(updated);
      setOpen(false);
    } catch {/* ignore */} finally {
      setBusy(false);
    }
  }

  const color = selected ? PRESENCE_COLORS[selected] : undefined;

  return (
    <div ref={wrapRef} className="statusPicker">
      {/* Current status chip — click to expand */}
      <button
        className="statusPickerChip"
        onClick={() => setOpen(v => !v)}
        style={color ? { borderColor: color, color } : undefined}
        title="Изменить статус"
      >
        {selected ? (
          <>
            <span>{PRESENCE_EMOJI[selected]}</span>
            <span className="statusPickerChipLabel">{PRESENCE_LABELS[selected]}</span>
            {currentNote && <span className="statusPickerChipNote">— {currentNote}</span>}
          </>
        ) : (
          <span className="statusPickerChipEmpty">Установить статус</span>
        )}
        <svg
          className={`statusPickerChevron${open ? ' open' : ''}`}
          width="12" height="12" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
        >
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>

      {/* Expanded picker */}
      {open && (
        <div className="statusPickerPanel">
          <div className="statusPickerOptions">
            {STATUS_OPTIONS.map(opt => (
              <button
                key={opt.value}
                className={`statusPickerOption${selected === opt.value ? ' active' : ''}`}
                style={{ '--sp-color': opt.color } as React.CSSProperties}
                onClick={() => setSelected(opt.value)}
                disabled={busy}
              >
                <span className="statusPickerEmoji">{opt.emoji}</span>
                <span className="statusPickerOptLabel">{opt.label}</span>
                {selected === opt.value && (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ marginLeft: 'auto', flexShrink: 0 }}>
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                )}
              </button>
            ))}
          </div>

          {selected && (
            <>
              <input
                className="statusPickerNoteInput"
                placeholder="Заметка (необязательно)"
                value={note}
                maxLength={60}
                onChange={e => setNote(e.target.value)}
              />
              <select
                className="statusPickerExpiry"
                value={expiry}
                onChange={e => setExpiry(e.target.value as ExpiryOption)}
              >
                <option value="none">Без истечения</option>
                <option value="1h">Через 1 час</option>
                <option value="4h">Через 4 часа</option>
                <option value="today">До конца дня</option>
              </select>
            </>
          )}

          <div className="statusPickerActions">
            <button
              className="statusPickerApply"
              style={color ? { background: color } : undefined}
              onClick={() => apply(selected)}
              disabled={busy || !selected}
            >
              {busy ? '…' : 'Применить'}
            </button>
            {selected && (
              <button className="statusPickerClear" onClick={() => apply(null)} disabled={busy}>
                Сбросить
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
