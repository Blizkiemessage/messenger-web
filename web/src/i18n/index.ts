/**
 * i18n — react-i18next setup. RU (default) + EN, синк выбора между
 * устройствами через users.language (см. useAppStore.language + api/users.updateMe).
 *
 * Автоопределение по языку браузера СОЗНАТЕЛЬНО не делаем — аудитория
 * приложения русскоязычная (см. db/versions/021_user_language.js), общий
 * компьютер с английской локалью ОС не должен переключать язык сам.
 * Порядок разрешения языка при загрузке: users.language (если залогинен) →
 * localStorage (последний выбор на этом устройстве) → 'ru'.
 */
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import ru from './locales/ru';
import en from './locales/en';

export type Locale = 'ru' | 'en';

const STORAGE_KEY = 'blz.language';

export function getStoredLocale(): Locale {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v === 'ru' || v === 'en') return v;
  } catch { /* ignore */ }
  return 'ru';
}

/** Меняет активный язык интерфейса + запоминает выбор локально (устройство). */
export function setLocale(locale: Locale): void {
  i18n.changeLanguage(locale);
  try { window.localStorage.setItem(STORAGE_KEY, locale); } catch { /* ignore */ }
}

i18n.use(initReactI18next).init({
  resources: { ru, en },
  lng: getStoredLocale(),
  fallbackLng: 'ru',
  ns: Object.keys(ru),
  defaultNS: 'common',
  interpolation: { escapeValue: false }, // React already escapes
  returnNull: false,
});

export default i18n;
