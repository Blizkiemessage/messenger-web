/**
 * accent.ts — manages per-user accent colour.
 *
 * Key in localStorage: `blizkie.accent.<userId>`
 * On login  → load that user's colour and apply it
 * On logout → reset to default (blue)
 */

export const DEFAULT_ACCENT = '#8e75f2';

/** Локализованные пресеты акцентного цвета (label требует i18n.t). */
export function getAccentPresets(t: (k: string) => string): { label: string; value: string }[] {
  return [
    { label: t('appearance.accentAurora'),   value: '#8e75f2' },
    { label: t('appearance.accentBlue'),     value: '#2f81f7' },
    { label: t('appearance.accentIndigo'),   value: '#6366f1' },
    { label: t('appearance.accentPurple'),   value: '#a855f7' },
    { label: t('appearance.accentPink'),     value: '#ec4899' },
    { label: t('appearance.accentRed'),      value: '#ef4444' },
    { label: t('appearance.accentOrange'),   value: '#f97316' },
    { label: t('appearance.accentYellow'),   value: '#eab308' },
    { label: t('appearance.accentGreen'),    value: '#22c55e' },
    { label: t('appearance.accentTeal'),     value: '#14b8a6' },
    { label: t('appearance.accentSkyBlue'),  value: '#38bdf8' },
  ];
}

function storageKey(userId: string) {
  return `blizkie.accent.${userId}`;
}

function hexToRgb(hex: string) {
  const c = hex.replace('#', '');
  if (c.length !== 6) return null;
  return {
    r: parseInt(c.slice(0, 2), 16),
    g: parseInt(c.slice(2, 4), 16),
    b: parseInt(c.slice(4, 6), 16),
  };
}

/** Apply a hex colour to CSS variables (does NOT save to localStorage). */
export function applyAccentCss(hex: string): void {
  const rgb = hexToRgb(hex);
  if (!rgb) return;
  const { r, g, b } = rgb;
  const root = document.documentElement;
  root.style.setProperty('--accent',        hex);
  root.style.setProperty('--accent-dim',    `rgba(${r},${g},${b},0.15)`);
  root.style.setProperty('--accent-border', `rgba(${r},${g},${b},0.35)`);
}

/** Reset CSS variables to stylesheet defaults (blue). */
export function resetAccentCss(): void {
  const root = document.documentElement;
  root.style.removeProperty('--accent');
  root.style.removeProperty('--accent-dim');
  root.style.removeProperty('--accent-border');
}

/** Load this user's saved accent (or DEFAULT_ACCENT). */
export function loadUserAccent(userId: string): string {
  try {
    return localStorage.getItem(storageKey(userId)) || DEFAULT_ACCENT;
  } catch {
    return DEFAULT_ACCENT;
  }
}

/** Save accent for a specific user. */
export function saveUserAccent(userId: string, hex: string): void {
  try { localStorage.setItem(storageKey(userId), hex); } catch {}
}

/** Apply + save for a specific user. */
export function applyAccent(userId: string, hex: string): void {
  applyAccentCss(hex);
  saveUserAccent(userId, hex);
}

/** Call on login: load and apply this user's colour. */
export function onUserLogin(userId: string): string {
  const hex = loadUserAccent(userId);
  applyAccentCss(hex);
  return hex;
}

/** Call on logout: reset CSS to default blue. */
export function onUserLogout(): void {
  resetAccentCss();
}
