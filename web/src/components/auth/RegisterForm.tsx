/**
<<<<<<< HEAD
 * RegisterForm
 *
 * New account creation with username + password.
 * On success calls onAuthenticated — handled by AuthScreen.
 */

=======
 * RegisterForm — contextual per-field hints, inline password-mismatch warning.
 */
>>>>>>> devDK
import { useState, useCallback } from 'react';
import { type User } from '../../types';
import { PasswordInput } from '../ui/PasswordInput';
import { authRegister } from '../../api/auth';

interface Props {
  onAuthenticated: (token: string, user: User) => void;
<<<<<<< HEAD
}

export function RegisterForm({ onAuthenticated }: Props) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ready =
    username.trim().length >= 3 &&
    password.length >= 6 &&
    password === passwordConfirm;

  const onRegister = useCallback(async () => {
    setError(null);
    if (!password) return setError('Введите пароль');
    if (password.length < 6) return setError('Пароль: минимум 6 символов');
    if (password !== passwordConfirm) return setError('Пароли не совпадают');
=======
  onSwitchTab: () => void;
}

export function RegisterForm({ onAuthenticated, onSwitchTab }: Props) {
  const [username,        setUsername]        = useState('');
  const [password,        setPassword]        = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [busy,  setBusy]  = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Which field has ever been touched (for contextual hints)
  const [touchedUser,  setTouchedUser]  = useState(false);
  const [touchedPass,  setTouchedPass]  = useState(false);
  const [touchedConf,  setTouchedConf]  = useState(false);

  const passwordsMatch = password === passwordConfirm;
  const showMismatch   = touchedConf && passwordConfirm.length > 0 && !passwordsMatch;

  const ready =
    username.trim().length >= 3 &&
    password.length >= 6 &&
    passwordsMatch &&
    passwordConfirm.length > 0;

  const onRegister = useCallback(async () => {
    if (!ready || busy) return;
    setError(null);
>>>>>>> devDK
    setBusy(true);
    try {
      const res = await authRegister(username.trim(), password);
      onAuthenticated(res.token, res.user);
    } catch (e: any) {
      setError(e?.message ?? 'Ошибка регистрации');
    } finally {
      setBusy(false);
    }
<<<<<<< HEAD
  }, [username, password, passwordConfirm, onAuthenticated]);
=======
  }, [username, password, ready, busy, onAuthenticated]);
>>>>>>> devDK

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && ready && !busy) onRegister();
  };

  return (
    <>
<<<<<<< HEAD
      <div className="authSub">Создайте новый аккаунт с паролем</div>

=======
      {/* Username */}
>>>>>>> devDK
      <div className="authLabel">Username</div>
      <input
        className="authInput"
        value={username}
        onChange={e => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
<<<<<<< HEAD
=======
        onFocus={() => setTouchedUser(true)}
>>>>>>> devDK
        placeholder="username"
        autoCapitalize="none"
        autoComplete="username"
        autoFocus
        onKeyDown={handleKeyDown}
      />
<<<<<<< HEAD

=======
      {touchedUser && username.length > 0 && username.trim().length < 3 && (
        <div className="authFieldHint">Минимум 3 символа · только латиница, цифры и _</div>
      )}

      {/* Password */}
>>>>>>> devDK
      <div className="authLabel">Пароль</div>
      <PasswordInput
        value={password}
        onChange={setPassword}
<<<<<<< HEAD
        placeholder="Минимум 6 символов"
        onKeyDown={handleKeyDown}
      />

=======
        onFocus={() => setTouchedPass(true)}
        placeholder="Минимум 6 символов"
        onKeyDown={handleKeyDown}
      />
      {touchedPass && password.length > 0 && password.length < 6 && (
        <div className="authFieldHint">Пароль должен быть не менее 6 символов</div>
      )}

      {/* Confirm password */}
>>>>>>> devDK
      <div className="authLabel">Повторите пароль</div>
      <PasswordInput
        value={passwordConfirm}
        onChange={setPasswordConfirm}
<<<<<<< HEAD
        placeholder="Повторите пароль"
        onKeyDown={handleKeyDown}
      />
      <div className="authHint">Только латиница, цифры и _ · Минимум 3 символа</div>

      {error && <div className="authError">{error}</div>}

      <button
        className="authBtn"
        disabled={!ready || busy}
        onClick={onRegister}
      >
        {busy ? '…' : 'Создать аккаунт'}
      </button>
=======
        onFocus={() => setTouchedConf(true)}
        placeholder="Повторите пароль"
        onKeyDown={handleKeyDown}
      />
      {showMismatch && (
        <div className="authFieldHintError">Пароли не совпадают</div>
      )}

      {error && <div className="authError">{error}</div>}

      <button className="authBtn" disabled={!ready || busy} onClick={onRegister}>
        {busy ? '…' : 'Создать аккаунт'}
      </button>

      <div className="authSwitchRow">
        Уже есть аккаунт?{' '}
        <button className="authSwitchLink" onClick={onSwitchTab}>
          Войти
        </button>
      </div>
>>>>>>> devDK
    </>
  );
}
