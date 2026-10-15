import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../i18n';

// jsdom has no WebAuthn, so the passkey button would not render at all —
// stub the API module. vi.hoisted: vi.mock is hoisted above plain consts.
const { passkeyAuthenticate } = vi.hoisted(() => ({ passkeyAuthenticate: vi.fn() }));
vi.mock('../../api/webauthn', () => ({
  passkeyAuthenticate,
  isWebAuthnSupported: () => true,
}));

import { LoginForm } from './LoginForm';

const HINT_RU = 'Вход по ключу не выполнен. Если ключ доступа создан в другом браузере или на другом устройстве — войдите паролем.';

function renderAndClickPasskey() {
  render(
    <I18nextProvider i18n={i18n}>
      <LoginForm onAuthenticated={vi.fn()} onSwitchTab={vi.fn()} onForgotPassword={vi.fn()} />
    </I18nextProvider>,
  );
  const btn = screen.getByText('Войти с ключом доступа').closest('button')!;
  fireEvent.click(btn);
  return btn;
}

// Regression: the button used to swallow every NotAllowedError silently, so a
// passkey stored in another browser or on another device looked like a dead
// button ("nothing happens after clicking").
describe('LoginForm — passkey sign-in failures are explained, not swallowed', () => {
  afterEach(() => {
    cleanup();
    passkeyAuthenticate.mockReset();
    i18n.changeLanguage('ru');
  });

  it('NotAllowedError (no passkey here / cancelled / timed out) shows a hint', async () => {
    i18n.changeLanguage('ru');
    passkeyAuthenticate.mockRejectedValue(
      Object.assign(new Error('The operation either timed out or was not allowed.'), { name: 'NotAllowedError' }),
    );
    renderAndClickPasskey();
    expect(await screen.findByText(HINT_RU)).toBeInTheDocument();
  });

  it('AbortError (programmatic abort) stays quiet', async () => {
    i18n.changeLanguage('ru');
    passkeyAuthenticate.mockRejectedValue(
      Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' }),
    );
    const btn = renderAndClickPasskey();
    await waitFor(() => expect(btn).not.toBeDisabled());
    expect(screen.queryByText(HINT_RU)).toBeNull();
  });

  it('a server error shows the server message', async () => {
    i18n.changeLanguage('ru');
    passkeyAuthenticate.mockRejectedValue(
      Object.assign(new Error('Request failed'), { response: { data: { error: 'Аккаунт заблокирован' } } }),
    );
    renderAndClickPasskey();
    expect(await screen.findByText('Аккаунт заблокирован')).toBeInTheDocument();
  });
});
