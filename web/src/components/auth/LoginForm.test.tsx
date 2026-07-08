import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../i18n';
import { LoginForm } from './LoginForm';

function renderForm() {
  return render(
    <I18nextProvider i18n={i18n}>
      <LoginForm onAuthenticated={vi.fn()} onSwitchTab={vi.fn()} onForgotPassword={vi.fn()} />
    </I18nextProvider>,
  );
}

describe('LoginForm — renders translated per active language', () => {
  afterEach(() => {
    cleanup();
    i18n.changeLanguage('ru');
  });

  it('shows Russian labels by default', () => {
    i18n.changeLanguage('ru');
    renderForm();
    expect(screen.getByText('Username или Email')).toBeInTheDocument();
    expect(screen.getByText('Забыли пароль?')).toBeInTheDocument();
    expect(screen.getByText('Войти', { selector: 'button.authBtn' })).toBeInTheDocument();
    expect(screen.getByText('Зарегистрируйтесь')).toBeInTheDocument();
  });

  it('shows English labels when switched', () => {
    i18n.changeLanguage('en');
    renderForm();
    expect(screen.getByText('Username or Email')).toBeInTheDocument();
    expect(screen.getByText('Forgot password?')).toBeInTheDocument();
    expect(screen.getByText('Sign in', { selector: 'button.authBtn' })).toBeInTheDocument();
    expect(screen.getByText('Sign up')).toBeInTheDocument();
  });
});
