/**
 * ScheduleDatePicker — F1 Капсула времени
 *
 * Beautiful custom calendar + HH:MM time picker (Telegram-style).
 * No native datetime-local input — full custom rendering.
 */
import { useState, useEffect, useCallback, useRef } from 'react';

interface Props {
  onConfirm: (deliverAt: number) => void;
  onClose: () => void;
}

const MONTH_NAMES = [
  'Январь','Февраль','Март','Апрель','Май','Июнь',
  'Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь',
];
const DOW = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];

/** Return 0-based weekday where Monday = 0 */
function mondayBasedDow(d: Date): number {
  return (d.getDay() + 6) % 7;
}

/** Build the calendar grid cells for a given month/year.
 *  Returns an array of Date | null (null = empty leading/trailing slot) */
function buildGrid(year: number, month: number): (Date | null)[] {
  const firstDay = new Date(year, month, 1);
  const lastDay  = new Date(year, month + 1, 0);
  const leading  = mondayBasedDow(firstDay);
  const cells: (Date | null)[] = [];
  for (let i = 0; i < leading; i++) cells.push(null);
  for (let d = 1; d <= lastDay.getDate(); d++) cells.push(new Date(year, month, d));
  // Pad to full rows of 7
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() &&
         a.getMonth()    === b.getMonth()    &&
         a.getDate()     === b.getDate();
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

/* ── Spin input (arrows + editable number) ─────────────────────────── */
interface SpinProps {
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  wrap?: boolean;
}
function SpinInput({ value, min, max, onChange, wrap = true }: SpinProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const inc = () => onChange(wrap ? (value >= max ? min : value + 1) : clamp(value + 1, min, max));
  const dec = () => onChange(wrap ? (value <= min ? max : value - 1) : clamp(value - 1, min, max));

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowUp')   { e.preventDefault(); inc(); }
    if (e.key === 'ArrowDown') { e.preventDefault(); dec(); }
  };

  return (
    <div className="sdpSpinWrap">
      <button className="sdpSpinArrow sdpSpinArrowUp" onMouseDown={e => { e.preventDefault(); inc(); }} tabIndex={-1}>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <polyline points="18 15 12 9 6 15"/>
        </svg>
      </button>
      <input
        ref={inputRef}
        className="sdpSpinInput"
        type="text"
        inputMode="numeric"
        value={String(value).padStart(2, '0')}
        onFocus={() => inputRef.current?.select()}
        onChange={e => {
          const n = parseInt(e.target.value, 10);
          if (!isNaN(n)) onChange(clamp(n, min, max));
        }}
        onBlur={e => {
          const n = parseInt(e.target.value, 10);
          onChange(isNaN(n) ? min : clamp(n, min, max));
        }}
        onKeyDown={handleKey}
      />
      <button className="sdpSpinArrow sdpSpinArrowDown" onMouseDown={e => { e.preventDefault(); dec(); }} tabIndex={-1}>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>
    </div>
  );
}

/* ── Main component ─────────────────────────────────────────────────── */
export function ScheduleDatePicker({ onConfirm, onClose }: Props) {
  const now = new Date();

  // Start with tomorrow as default selection
  const defaultDate = new Date(now);
  defaultDate.setDate(defaultDate.getDate() + 1);
  defaultDate.setHours(9, 0, 0, 0);

  const [viewYear,  setViewYear]  = useState(defaultDate.getFullYear());
  const [viewMonth, setViewMonth] = useState(defaultDate.getMonth());
  const [selDate,   setSelDate]   = useState<Date>(defaultDate);
  const [hours,     setHours]     = useState(defaultDate.getHours());
  const [minutes,   setMinutes]   = useState(defaultDate.getMinutes());
  const [error,     setError]     = useState<string | null>(null);

  const grid = buildGrid(viewYear, viewMonth);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const prevMonth = useCallback(() => {
    setViewMonth(m => {
      if (m === 0) { setViewYear(y => y - 1); return 11; }
      return m - 1;
    });
  }, []);

  const nextMonth = useCallback(() => {
    setViewMonth(m => {
      if (m === 11) { setViewYear(y => y + 1); return 0; }
      return m + 1;
    });
  }, []);

  const selectDay = useCallback((d: Date) => {
    // Disable past dates
    if (d < today) return;
    setSelDate(d);
    setError(null);
  }, [today]); // eslint-disable-line

  const handleConfirm = () => {
    const target = new Date(selDate);
    target.setHours(hours, minutes, 0, 0);
    if (target.getTime() <= Date.now() + 30_000) {
      setError('Выберите время хотя бы на 1 минуту вперёд');
      return;
    }
    onConfirm(target.getTime());
  };

  // Close on Escape
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);

  // ── Format selected date for the summary line ──
  const selLabel = selDate.toLocaleDateString('ru-RU', {
    day: 'numeric', month: 'long', year: 'numeric',
  });

  return (
    <div className="sdpBackdrop" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="sdpPanel">

        {/* ── Header ── */}
        <div className="sdpHeader">
          <span className="sdpTitle">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
            </svg>
            Запланировать сообщение
          </span>
          <button className="sdpClose" onClick={onClose} title="Закрыть">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* ── Calendar ── */}
        <div className="sdpCalendar">
          {/* Month nav */}
          <div className="sdpMonthNav">
            <button className="sdpMonthBtn" onClick={prevMonth} title="Предыдущий месяц">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <polyline points="15 18 9 12 15 6"/>
              </svg>
            </button>
            <span className="sdpMonthLabel">
              {MONTH_NAMES[viewMonth]} {viewYear}
            </span>
            <button className="sdpMonthBtn" onClick={nextMonth} title="Следующий месяц">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </button>
          </div>

          {/* Day-of-week headers */}
          <div className="sdpDowRow">
            {DOW.map(d => (
              <span key={d} className="sdpDowCell">{d}</span>
            ))}
          </div>

          {/* Day grid */}
          <div className="sdpDayGrid">
            {grid.map((cell, i) => {
              if (!cell) return <span key={`empty-${i}`} className="sdpDayEmpty" />;
              const isPast     = cell < today;
              const isToday    = sameDay(cell, today);
              const isSelected = sameDay(cell, selDate);
              let cls = 'sdpDay';
              if (isPast)     cls += ' sdpDayPast';
              if (isToday)    cls += ' sdpDayToday';
              if (isSelected) cls += ' sdpDaySelected';
              return (
                <button
                  key={cell.toISOString()}
                  className={cls}
                  disabled={isPast}
                  onClick={() => selectDay(cell)}
                >
                  {cell.getDate()}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Time picker ── */}
        <div className="sdpTimePicker">
          <div className="sdpTimeLabel">Время отправки</div>
          <div className="sdpTimeInputs">
            <SpinInput value={hours}   min={0} max={23} onChange={h => { setHours(h);   setError(null); }} />
            <span className="sdpTimeSep">:</span>
            <SpinInput value={minutes} min={0} max={59} onChange={m => { setMinutes(m); setError(null); }} />
          </div>
        </div>

        {/* ── Selected summary ── */}
        <div className="sdpSummary">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
          </svg>
          Отправится {selLabel} в {String(hours).padStart(2,'0')}:{String(minutes).padStart(2,'0')}
        </div>

        {error && <div className="sdpError">{error}</div>}

        {/* ── Actions ── */}
        <div className="sdpActions">
          <button className="sdpConfirm" onClick={handleConfirm}>
            Запланировать
          </button>
          <button className="sdpCancel" onClick={onClose}>Отмена</button>
        </div>

      </div>
    </div>
  );
}
