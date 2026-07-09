/**
 * DocumentsTab — постоянный доступ к Privacy Policy / ToS из настроек
 * (docs/STORE_LAUNCH_TZ.md §1). Рендерит тот же контент, что и /privacy и
 * /terms (components/legal/legalContent.tsx — единый источник, без дублей),
 * прямо внутри модалки — не нужно покидать приложение, чтобы их прочитать.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LEGAL_LAST_UPDATED, PRIVACY_SECTIONS, TERMS_SECTIONS } from '../legal/legalContent';

type Doc = 'privacy' | 'terms';

const STYLES = `
  .docsTabs { display: flex; gap: 8px; }
  .docsTab { padding: 8px 14px; border-radius: 10px; font-size: 13px; font-weight: 600;
    color: var(--muted); background: var(--panel); border: 1px solid var(--border); cursor: pointer; }
  .docsTab.active { color: #fff; background: var(--grad-accent); border-color: transparent; }
  .docsUpdated { color: var(--muted); font-size: 12.5px; }
  .docsSection h3 { font-size: 14.5px; font-weight: 700; margin-bottom: 8px; color: var(--text); }
  .docsSection p { color: var(--muted); font-size: 13.5px; line-height: 1.6; margin-bottom: 8px; }
  .docsSection ul { padding-left: 18px; margin-bottom: 8px; }
  .docsSection li { color: var(--muted); font-size: 13.5px; line-height: 1.6; margin-bottom: 5px; }
  .docsSection strong { color: var(--text); }
  .docsLink { color: var(--accent); }
`;

export function DocumentsTab() {
  const { t } = useTranslation('settings');
  const [doc, setDoc] = useState<Doc>('privacy');
  const sections = doc === 'privacy' ? PRIVACY_SECTIONS : TERMS_SECTIONS;

  return (
    <div className="permTab">
      <style>{STYLES}</style>
      <p className="permTabHint">
        {t('documents.hint')}
      </p>

      <div className="docsTabs">
        <button className={`docsTab${doc === 'privacy' ? ' active' : ''}`} onClick={() => setDoc('privacy')}>
          {t('documents.privacy')}
        </button>
        <button className={`docsTab${doc === 'terms' ? ' active' : ''}`} onClick={() => setDoc('terms')}>
          {t('documents.terms')}
        </button>
      </div>
      <div className="docsUpdated">{t('documents.effectiveFrom', { date: LEGAL_LAST_UPDATED })}</div>

      {sections.map(s => (
        <div className="docsSection" key={s.title}>
          <h3>{s.title}</h3>
          {s.body}
        </div>
      ))}
    </div>
  );
}
