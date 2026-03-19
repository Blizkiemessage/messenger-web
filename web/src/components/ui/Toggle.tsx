/**
 * Toggle
 *
 * Simple on/off switch. Uses the same CSS classes as the existing
 * psToggle / psToggleKnob styles in app.css.
 */

interface Props {
  value: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}

export function Toggle({ value, onChange, disabled = false }: Props) {
  return (
    <div
      className={`psToggle${value ? ' on' : ''}${disabled ? ' disabled' : ''}`}
      onClick={() => !disabled && onChange(!value)}
      role="switch"
      aria-checked={value}
      tabIndex={0}
      onKeyDown={e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); !disabled && onChange(!value); } }}
    >
      <div className="psToggleKnob" />
    </div>
  );
}
