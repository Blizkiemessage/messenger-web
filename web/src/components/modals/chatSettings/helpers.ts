/**
 * helpers.ts — утилиты секции «Вопрос дня» в хабе «Настройки чата».
 */

/** Минуты от полуночи → 'HH:MM' для <input type="time">. */
export function minutesToHHMM(m: number): string {
  const mm = Math.max(0, Math.min(1439, Math.floor(m || 0)));
  const h = Math.floor(mm / 60);
  const min = mm % 60;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/** 'HH:MM' → минуты от полуночи. Невалидное → 1260 (21:00). */
export function hhmmToMinutes(s: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s || '');
  if (!m) return 1260;
  const h = Math.min(23, Number(m[1]));
  const min = Math.min(59, Number(m[2]));
  return h * 60 + min;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Локализованные краткие дни недели (Пн..Вс), значение = индекс JS (0=вс..6=сб). */
export function getWeekdays(locale: string): { value: number; short: string }[] {
  const order = [1, 2, 3, 4, 5, 6, 0]; // Пн..Вс в JS Date.getDay()
  return order.map((value, i) => ({
    value,
    short: capitalize(new Date(2024, 0, 1 + i).toLocaleDateString(locale, { weekday: 'short' })),
  }));
}

/** Курируемый список часовых поясов (РФ/СНГ + базовые), RU/EN подписи. */
const TIMEZONE_DEFS: { value: string; ru: string; en: string }[] = [
  { value: 'Europe/Kaliningrad', ru: 'Калининград (MSK−1)', en: 'Kaliningrad (MSK−1)' },
  { value: 'Europe/Moscow',      ru: 'Москва (MSK)',         en: 'Moscow (MSK)' },
  { value: 'Europe/Samara',      ru: 'Самара (MSK+1)',       en: 'Samara (MSK+1)' },
  { value: 'Asia/Yekaterinburg', ru: 'Екатеринбург (MSK+2)', en: 'Yekaterinburg (MSK+2)' },
  { value: 'Asia/Omsk',          ru: 'Омск (MSK+3)',         en: 'Omsk (MSK+3)' },
  { value: 'Asia/Krasnoyarsk',   ru: 'Красноярск (MSK+4)',   en: 'Krasnoyarsk (MSK+4)' },
  { value: 'Asia/Irkutsk',       ru: 'Иркутск (MSK+5)',      en: 'Irkutsk (MSK+5)' },
  { value: 'Asia/Yakutsk',       ru: 'Якутск (MSK+6)',       en: 'Yakutsk (MSK+6)' },
  { value: 'Asia/Vladivostok',   ru: 'Владивосток (MSK+7)',  en: 'Vladivostok (MSK+7)' },
  { value: 'Asia/Magadan',       ru: 'Магадан (MSK+8)',      en: 'Magadan (MSK+8)' },
  { value: 'Asia/Kamchatka',     ru: 'Камчатка (MSK+9)',     en: 'Kamchatka (MSK+9)' },
  { value: 'Europe/Kiev',        ru: 'Киев',                 en: 'Kyiv' },
  { value: 'Europe/Minsk',       ru: 'Минск',                en: 'Minsk' },
  { value: 'Asia/Almaty',        ru: 'Алматы',               en: 'Almaty' },
  { value: 'Asia/Tashkent',      ru: 'Ташкент',              en: 'Tashkent' },
  { value: 'Asia/Tbilisi',       ru: 'Тбилиси',              en: 'Tbilisi' },
  { value: 'Asia/Yerevan',       ru: 'Ереван',               en: 'Yerevan' },
  { value: 'UTC',                ru: 'UTC',                  en: 'UTC' },
];

/** Гарантировать, что текущий пояс есть в списке (иначе добавить как «своё»). */
export function timezoneOptions(current: string, locale: string): { value: string; label: string }[] {
  const list = TIMEZONE_DEFS.map(d => ({ value: d.value, label: locale === 'en' ? d.en : d.ru }));
  if (list.some(t => t.value === current)) return list;
  return [{ value: current, label: current }, ...list];
}
