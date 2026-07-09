/**
 * Тексты Privacy Policy / Terms of Service.
 * ЕДИНЫЙ источник правды для docs/STORE_LAUNCH_TZ.md §1 — если меняется
 * поведение приложения (новые данные/новый сторонний обработчик/новая
 * механика модерации), текст нужно обновить в i18n/locales/{ru,en}/legal.json
 * (и здесь, если меняется сама структура секций), иначе документ соврёт.
 *
 * Текст переведён (RU/EN) — живёт в legal.json, а не здесь. `getPrivacySections(t)`/
 * `getTermsSections(t)` собирают JSX (параграфы/списки/жирный/ссылка на email) из
 * переведённых строк; вызывать нужно внутри тела компонента, чтобы смена языка
 * подхватывалась (см. соответствующий паттерн в assistant/faq.ts).
 *
 * Оператор — физическое лицо (временное решение, см. журнал CLAUDE.md
 * 2026-07-04: оба стора допускают individual/personal developer-аккаунт без
 * регистрации юрлица). Если позже появится ИП/ООО — раздел 1 обновить.
 */
import type { ReactNode } from 'react';
import type { TFunction } from 'i18next';
import { renderMarkdown } from '../../utils/markdown';

export const CONTACT_EMAIL = 'blizkie.noreply@mail.ru';

export interface LegalSection {
  title: string;
  body: ReactNode;
}

function EmailLink() {
  return <a href={`mailto:${CONTACT_EMAIL}`} className="legalContact">{CONTACT_EMAIL}</a>;
}

export function getPrivacySections(t: TFunction): LegalSection[] {
  const p = 'legal:privacy';
  return [
    {
      title: t(`${p}.s1.title`),
      body: (
        <>
          <p>{t(`${p}.s1.p1`)}</p>
          <p><strong>{t('legal:operatorName')}</strong></p>
          <p>{t(`${p}.s1.p3`)}</p>
          <p>{t(`${p}.s1.p4Prefix`)}<EmailLink />{t(`${p}.s1.p4Suffix`)}</p>
        </>
      ),
    },
    {
      title: t(`${p}.s2.title`),
      body: (
        <ul>
          <li>{t(`${p}.s2.li1`)}</li>
          <li>{t(`${p}.s2.li2`)}</li>
          <li>{t(`${p}.s2.li3`)}</li>
          <li>{t(`${p}.s2.li4`)}</li>
          <li>{t(`${p}.s2.li5`)}</li>
          <li>{t(`${p}.s2.li6`)}</li>
        </ul>
      ),
    },
    {
      title: t(`${p}.s3.title`),
      body: (
        <>
          <p>{t(`${p}.s3.p1`)}</p>
          <p><strong>{t(`${p}.s3.p2Bold`)}</strong>{t(`${p}.s3.p2Rest`)}</p>
        </>
      ),
    },
    {
      title: t(`${p}.s4.title`),
      body: (
        <>
          <p>{t(`${p}.s4.intro`)}</p>
          <ul>
            <li>{renderMarkdown(t(`${p}.s4.li1`))}</li>
            <li>{renderMarkdown(t(`${p}.s4.li2`))}</li>
            <li>{renderMarkdown(t(`${p}.s4.li3`))}</li>
            <li>{renderMarkdown(t(`${p}.s4.li4`))}</li>
          </ul>
        </>
      ),
    },
    { title: t(`${p}.s5.title`), body: <p>{t(`${p}.s5.p1`)}</p> },
    {
      title: t(`${p}.s6.title`),
      body: (
        <>
          <p>{t(`${p}.s6.p1`)}</p>
          <p>{t(`${p}.s6.p2`)}</p>
        </>
      ),
    },
    { title: t(`${p}.s7.title`), body: <p>{t(`${p}.s7.p1`)}</p> },
    {
      title: t(`${p}.s8.title`),
      body: (
        <>
          <p>{t(`${p}.s8.p1`)}</p>
          <p>{t(`${p}.s8.p2`)}</p>
          <p>{t(`${p}.s8.p3`)}</p>
        </>
      ),
    },
    {
      title: t(`${p}.s9.title`),
      body: (
        <ul>
          <li>{t(`${p}.s9.li1`)}</li>
          <li>{t(`${p}.s9.li2`)}</li>
          <li>{t(`${p}.s9.li3`)}</li>
          <li>{t(`${p}.s9.li4Prefix`)}<EmailLink />{t(`${p}.s9.li4Suffix`)}</li>
        </ul>
      ),
    },
    { title: t(`${p}.s10.title`), body: <p>{t(`${p}.s10.p1`)}</p> },
    { title: t(`${p}.s11.title`), body: <p>{t(`${p}.s11.p1`)}</p> },
  ];
}

export function getTermsSections(t: TFunction): LegalSection[] {
  const s = 'legal:terms';
  return [
    { title: t(`${s}.s1.title`), body: <p>{t(`${s}.s1.p1`)}</p> },
    { title: t(`${s}.s2.title`), body: <p>{t(`${s}.s2.p1`)}</p> },
    {
      title: t(`${s}.s3.title`),
      body: (
        <ul>
          <li>{t(`${s}.s3.li1`)}</li>
          <li>{t(`${s}.s3.li2`)}</li>
          <li>{t(`${s}.s3.li3`)}</li>
        </ul>
      ),
    },
    {
      title: t(`${s}.s4.title`),
      body: (
        <>
          <p>{t(`${s}.s4.intro`)}</p>
          <ul>
            <li>{t(`${s}.s4.li1`)}</li>
            <li>{t(`${s}.s4.li2`)}</li>
            <li>{t(`${s}.s4.li3`)}</li>
            <li>{t(`${s}.s4.li4`)}</li>
            <li>{t(`${s}.s4.li5`)}</li>
          </ul>
        </>
      ),
    },
    {
      title: t(`${s}.s5.title`),
      body: (
        <>
          <p>{t(`${s}.s5.p1`)}</p>
          <p>{t(`${s}.s5.p2`)}</p>
          <ul>
            <li>{t(`${s}.s5.li1`)}</li>
            <li>{t(`${s}.s5.li2`)}</li>
            <li>{t(`${s}.s5.li3`)}</li>
          </ul>
          <p>{t(`${s}.s5.p3`)}</p>
        </>
      ),
    },
    { title: t(`${s}.s6.title`), body: <p>{t(`${s}.s6.p1`)}</p> },
    { title: t(`${s}.s7.title`), body: <p>{t(`${s}.s7.p1`)}</p> },
    { title: t(`${s}.s8.title`), body: <p>{t(`${s}.s8.p1`)}</p> },
    { title: t(`${s}.s9.title`), body: <p>{t(`${s}.s9.p1`)}</p> },
    { title: t(`${s}.s10.title`), body: <p>{t(`${s}.s10.p1`)}</p> },
    {
      title: t(`${s}.s11.title`),
      body: <p>{t(`${s}.s11.p1Prefix`)}<EmailLink />{t(`${s}.s11.p1Suffix`)}</p>,
    },
  ];
}
