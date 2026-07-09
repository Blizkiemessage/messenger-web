/**
 * Standalone /privacy и /terms — доступны БЕЗ авторизации по прямому URL
 * (обязательное требование сторов при подаче карточки, §1 STORE_LAUNCH_TZ.md).
 * В проекте нет клиентского роутера — эти пути перехватываются в main.tsx
 * ДО рендера <App/>, минуя весь auth-флоу.
 */
import '../../app.css'; // токены (--bg/--text/--accent/...) + шрифт Manrope
import '../../i18n'; // сайд-эффект: регистрирует глобальный i18next-инстанс —
// эта страница рендерится ДО <App/> (main.tsx), где обычно и происходит первый
// импорт i18n; без явного импорта здесь useTranslation() не найдёт инстанс.

import { useTranslation } from 'react-i18next';
import { getPrivacySections, getTermsSections } from './legalContent';

const STYLES = `
  .legalPage { min-height: 100%; display: flex; justify-content: center;
    background: var(--bg); color: var(--text); padding: 40px 16px 72px; }
  .legalCard { width: min(760px, 100%); background: var(--sidebar);
    border: 1px solid var(--border); border-radius: 20px; box-shadow: var(--shadow);
    padding: 40px clamp(20px, 5vw, 56px); }
  .legalBack { display: inline-flex; align-items: center; gap: 6px; color: var(--muted);
    text-decoration: none; font-size: 14px; margin-bottom: 28px; }
  .legalBack:hover { color: var(--text); }
  .legalTabs { display: flex; gap: 8px; margin-bottom: 28px; }
  .legalTab { padding: 8px 16px; border-radius: 10px; font-size: 13.5px; font-weight: 600;
    text-decoration: none; color: var(--muted); background: var(--panel); border: 1px solid var(--border); }
  .legalTab.active { color: #fff; background: var(--grad-accent); border-color: transparent; }
  .legalTitle { font-size: 26px; font-weight: 800; margin-bottom: 4px; }
  .legalUpdated { color: var(--muted); font-size: 13px; margin-bottom: 32px; }
  .legalSection { margin-bottom: 26px; }
  .legalSection h2 { font-size: 16.5px; font-weight: 700; margin-bottom: 10px; }
  .legalSection p { color: var(--muted); font-size: 14.5px; line-height: 1.65; margin-bottom: 10px; }
  .legalSection ul { padding-left: 20px; margin-bottom: 10px; }
  .legalSection li { color: var(--muted); font-size: 14.5px; line-height: 1.65; margin-bottom: 6px; }
  .legalSection strong { color: var(--text); }
  .legalContact { color: var(--accent); text-decoration: none; }
  .legalContact:hover { text-decoration: underline; }
`;

interface Props {
  page: 'privacy' | 'terms';
}

export function LegalPage({ page }: Props) {
  const { t } = useTranslation('legal');
  const sections = page === 'privacy' ? getPrivacySections(t) : getTermsSections(t);
  const title = page === 'privacy' ? t('privacyTitle') : t('termsTitle');

  return (
    <div className="legalPage">
      <style>{STYLES}</style>
      <div className="legalCard">
        <a className="legalBack" href="/">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" />
          </svg>
          {t('backToApp')}
        </a>

        <div className="legalTabs">
          <a className={`legalTab${page === 'privacy' ? ' active' : ''}`} href="/privacy">{t('privacyTitle')}</a>
          <a className={`legalTab${page === 'terms' ? ' active' : ''}`} href="/terms">{t('termsTitle')}</a>
        </div>

        <div className="legalTitle">{title}</div>
        <div className="legalUpdated">{t('settings:documents.effectiveFrom', { date: t('lastUpdated') })}</div>

        {sections.map(s => (
          <div className="legalSection" key={s.title}>
            <h2>{s.title}</h2>
            {s.body}
          </div>
        ))}
      </div>
    </div>
  );
}
