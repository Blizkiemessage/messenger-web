import { useState } from 'react';
import { EyeIcon } from './icons/EyeIcon';

export function PasswordInput({
  value,
  onChange,
  placeholder,
  className = 'authInput',
  wrapClass = 'authInputWrap',
  eyeClass = 'authEye',
  onKeyDown,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  wrapClass?: string;
  eyeClass?: string;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className={wrapClass}>
      <input
        type={show ? 'text' : 'password'}
        className={className}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder ?? 'Пароль'}
        autoComplete="current-password"
        onKeyDown={onKeyDown}
      />
      <button
        type="button"
        className={eyeClass}
        onClick={() => setShow(v => !v)}
        tabIndex={-1}
      >
        <EyeIcon visible={show} />
      </button>
    </div>
  );
}
