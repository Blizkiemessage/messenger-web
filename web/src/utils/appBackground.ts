/**
 * appBackground.ts — пользовательский фон всего приложения.
 *
 * Модель AppBg переиспользуема: те же типы/функции пригодятся для
 * индивидуальных фонов чатов (там добавится type: 'image' и привязка к chatId).
 *
 * Ключ в localStorage: `blizkie.appbg.<userId>`
 * Применение: CSS-переменная --app-bg на <html>; в app.css
 * .layout использует var(--app-bg, <дефолтная аврора>).
 */

export type AppBgType = 'aurora' | 'solid' | 'gradient';

export interface AppBg {
  type: AppBgType;
  /** Основной цвет (solid) или начало градиента */
  c1?: string;
  /** Конец градиента */
  c2?: string;
  /** Угол градиента в градусах (по умолчанию 160) */
  angle?: number;
}

export const DEFAULT_APP_BG: AppBg = { type: 'aurora' };

export const APP_BG_PRESETS: { label: string; bg: AppBg }[] = [
  { label: 'Аврора (по умолчанию)', bg: { type: 'aurora' } },
  { label: 'Полночь',          bg: { type: 'solid',    c1: '#0b0911' } },
  { label: 'Уголь',            bg: { type: 'solid',    c1: '#101418' } },
  { label: 'Глубина',          bg: { type: 'gradient', c1: '#0c1222', c2: '#1b2a4a', angle: 160 } },
  { label: 'Закат',            bg: { type: 'gradient', c1: '#2d1b4e', c2: '#7c2d5e', angle: 160 } },
  { label: 'Северное сияние',  bg: { type: 'gradient', c1: '#071a14', c2: '#103c4a', angle: 200 } },
  { label: 'Розовый рассвет',  bg: { type: 'gradient', c1: '#ffd9e8', c2: '#ffeedd', angle: 160 } },
  { label: 'Лаванда',          bg: { type: 'gradient', c1: '#e8e2ff', c2: '#f6e9f5', angle: 160 } },
  { label: 'Мята',             bg: { type: 'gradient', c1: '#dcf5ea', c2: '#e8f4ff', angle: 160 } },
];

/** CSS-значение background для AppBg; null = дефолтная аврора из app.css */
export function cssForAppBg(bg: AppBg): string | null {
  if (!bg || bg.type === 'aurora') return null;
  if (bg.type === 'solid') return bg.c1 || null;
  if (bg.type === 'gradient' && bg.c1 && bg.c2) {
    return `linear-gradient(${bg.angle ?? 160}deg, ${bg.c1} 0%, ${bg.c2} 100%)`;
  }
  return null;
}

/** Применить фон к CSS (не сохраняет). */
export function applyAppBgCss(bg: AppBg): void {
  const css = cssForAppBg(bg);
  const root = document.documentElement;
  if (css) root.style.setProperty('--app-bg', css);
  else root.style.removeProperty('--app-bg');
}

function storageKey(userId: string) {
  return `blizkie.appbg.${userId}`;
}

export function loadUserAppBg(userId: string): AppBg {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return DEFAULT_APP_BG;
    const parsed = JSON.parse(raw) as AppBg;
    if (parsed && (parsed.type === 'aurora' || parsed.type === 'solid' || parsed.type === 'gradient')) {
      return parsed;
    }
    return DEFAULT_APP_BG;
  } catch {
    return DEFAULT_APP_BG;
  }
}

export function saveUserAppBg(userId: string, bg: AppBg): void {
  try { localStorage.setItem(storageKey(userId), JSON.stringify(bg)); } catch {}
}

/** Применить + сохранить. */
export function applyAppBg(userId: string, bg: AppBg): void {
  applyAppBgCss(bg);
  saveUserAppBg(userId, bg);
}

/** Безопасно распарсить JSON-строку фона с сервера (users.app_bg). */
export function parseAppBg(raw: string | null | undefined): AppBg | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as AppBg;
    if (parsed && (parsed.type === 'aurora' || parsed.type === 'solid' || parsed.type === 'gradient')) {
      return parsed;
    }
  } catch {}
  return null;
}

/** Применить фон, пришедший с сервера, и закэшировать локально. */
export function applyServerAppBg(userId: string, raw: string | null | undefined): AppBg {
  const bg = parseAppBg(raw) || DEFAULT_APP_BG;
  applyAppBgCss(bg);
  saveUserAppBg(userId, bg);
  return bg;
}

/** На входе пользователя: загрузить и применить его фон. */
export function onUserLoginBg(userId: string): AppBg {
  const bg = loadUserAppBg(userId);
  applyAppBgCss(bg);
  return bg;
}

/** На выходе: вернуть дефолтную аврору. */
export function onUserLogoutBg(): void {
  applyAppBgCss(DEFAULT_APP_BG);
}

export function isSameAppBg(a: AppBg, b: AppBg): boolean {
  return a.type === b.type
    && (a.c1 || '') === (b.c1 || '')
    && (a.c2 || '') === (b.c2 || '')
    && (a.angle ?? 160) === (b.angle ?? 160);
}
