import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../i18n';
import { NavProfilePopover } from './NavProfilePopover';
import { type User } from '../../types';

const me: User = { id: 'u1', username: 'kesh', display_name: 'Кеша' };

function renderPopover(language: 'ru' | 'en', onSetLanguage: (l: 'ru' | 'en') => void = () => {}) {
  return render(
    <I18nextProvider i18n={i18n}>
      <NavProfilePopover
        me={me}
        theme="dark"
        language={language}
        onClose={() => {}}
        onOpenSettings={() => {}}
        onOpenInvite={() => {}}
        onToggleTheme={() => {}}
        onSetLanguage={onSetLanguage}
        onLogout={() => {}}
      />
    </I18nextProvider>,
  );
}

describe('NavProfilePopover — language switcher', () => {
  afterEach(() => {
    cleanup();
    i18n.changeLanguage('ru');
  });

  it('renders the label translated per active language', () => {
    i18n.changeLanguage('ru');
    renderPopover('ru');
    expect(screen.getByText('Язык')).toBeInTheDocument();
    cleanup();

    i18n.changeLanguage('en');
    renderPopover('en');
    expect(screen.getByText('Language')).toBeInTheDocument();
  });

  it('marks the active language card and calls onSetLanguage on click', async () => {
    const user = userEvent.setup();
    let picked: 'ru' | 'en' | null = null;
    i18n.changeLanguage('ru');
    renderPopover('ru', (l) => { picked = l; });

    const ruCard = screen.getByRole('button', { name: /Русский/ });
    const enCard = screen.getByRole('button', { name: /English/ });
    expect(ruCard.className).toContain('active');
    expect(enCard.className).not.toContain('active');

    await user.click(enCard);
    expect(picked).toBe('en');
  });
});
