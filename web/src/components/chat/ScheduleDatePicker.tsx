/**
 * ScheduleDatePicker — F1 Капсула времени
 *
 * A small popup that lets the user pick a future date/time
 * and then confirms scheduling. Rendered above the Composer.
 */
import { useState, useEffect } from 'react';

interface Props {
  onConfirm: (deliverAt: number) => void;
  onClose: () => void;
}

/** Format Date to "YYYY-MM-DDTHH:mm" for <input type="datetime-local"> */
function toInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Preset quick-pick options */
const PRESETS: { label: string; addMs: () => number }[] = [
  { label: 'Через 1 час',  addMs: () => 60 * 60 * 1000 },
  { label: 'Через 3 часа', addMs: () => 3 * 60 * 60 * 1000 },
  { label: 'Завтра утром', addMs: () => {
    const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0);
    return d.getTime() - Date.now();
  }},
  { label: 'Завтра вечером', addMs: () => {
    const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(20, 0, 0, 0);
    return d.getTime() - Date.now();
  }},
];

export function ScheduleDatePicker({ onConfirm, onClose }: Props) {
  // Default: 1 hour from now, rounded to next 5 minutes
  const defaultDate = () => {
    const d = new Date(Date.now() + 60 * 60 * 1000);
    d.setMinutes(Math.ceil(d.getMinutes() / 5) * 5, 0, 0);
    return d;
  };

  const [value, setValue] = useState<string>(toInputValue(defaultDate()));
  const [error, setError] = useState<string | null>(null);

  const minValue = toInputValue(new Date(Date.now() + 60 * 1000)); // at least 1 minute from now

  const handlePreset = (preset: typeof PRESETS[number]) => {
    const d = new Date(Date.now() + preset.addMs());
    setValue(toInputValue(d));
    setError(null);
  };

  const handleConfirm = () => {
    const ts = new Date(value).getTime();
    if (isNaN(ts) || ts <= Date.now()) {
      setError('Выберите время в будущем');
      return;
    }
    onConfirm(ts);
  };

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className="sdpBackdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="sdpPanel">
        <div className="sdpHeader">
          <span className="sdpTitle">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <circle cx="12" cy="12" r="10"/>
              <polyline points="12 6 12 12 16 14"/>
            </svg>
            Запланировать сообщение
          </span>
          <button className="sdpClose" onClick={onClose}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Quick presets */}
        <div className="sdpPresets">
          {PRESETS.map(p => (
            <button key={p.label} className="sdpPreset" onClick={() => handlePreset(p)}>
              {p.label}
            </button>
          ))}
        </div>

        {/* Custom datetime input */}
        <input
          className="sdpInput"
          type="datetime-local"
          value={value}
          min={minValue}
          onChange={e => { setValue(e.target.value); setError(null); }}
        />

        {error && <div className="sdpError">{error}</div>}

        <div className="sdpActions">
          <button className="sdpConfirm" onClick={handleConfirm}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <circle cx="12" cy="12" r="10"/>
              <polyline points="12 6 12 12 16 14"/>
            </svg>
            Запланировать
          </button>
          <button className="sdpCancel" onClick={onClose}>Отмена</button>
        </div>
      </div>
    </div>
  );
}
