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

/** Дни недели в порядке отображения (Пн..Вс), значение = индекс JS (0=вс..6=сб). */
export const WEEKDAYS: { value: number; short: string }[] = [
  { value: 1, short: 'Пн' },
  { value: 2, short: 'Вт' },
  { value: 3, short: 'Ср' },
  { value: 4, short: 'Чт' },
  { value: 5, short: 'Пт' },
  { value: 6, short: 'Сб' },
  { value: 0, short: 'Вс' },
];

/** Курируемый список часовых поясов (РФ/СНГ + базовые). */
export const TIMEZONES: { value: string; label: string }[] = [
  { value: 'Europe/Kaliningrad', label: 'Калининград (MSK−1)' },
  { value: 'Europe/Moscow',      label: 'Москва (MSK)' },
  { value: 'Europe/Samara',      label: 'Самара (MSK+1)' },
  { value: 'Asia/Yekaterinburg', label: 'Екатеринбург (MSK+2)' },
  { value: 'Asia/Omsk',          label: 'Омск (MSK+3)' },
  { value: 'Asia/Krasnoyarsk',   label: 'Красноярск (MSK+4)' },
  { value: 'Asia/Irkutsk',       label: 'Иркутск (MSK+5)' },
  { value: 'Asia/Yakutsk',       label: 'Якутск (MSK+6)' },
  { value: 'Asia/Vladivostok',   label: 'Владивосток (MSK+7)' },
  { value: 'Asia/Magadan',       label: 'Магадан (MSK+8)' },
  { value: 'Asia/Kamchatka',     label: 'Камчатка (MSK+9)' },
  { value: 'Europe/Kiev',        label: 'Киев' },
  { value: 'Europe/Minsk',       label: 'Минск' },
  { value: 'Asia/Almaty',        label: 'Алматы' },
  { value: 'Asia/Tashkent',      label: 'Ташкент' },
  { value: 'Asia/Tbilisi',       label: 'Тбилиси' },
  { value: 'Asia/Yerevan',       label: 'Ереван' },
  { value: 'UTC',                label: 'UTC' },
];

/** Гарантировать, что текущий пояс есть в списке (иначе добавить как «своё»). */
export function timezoneOptions(current: string): { value: string; label: string }[] {
  if (TIMEZONES.some(t => t.value === current)) return TIMEZONES;
  return [{ value: current, label: current }, ...TIMEZONES];
}
