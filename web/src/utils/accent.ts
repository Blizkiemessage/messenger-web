/**
 * accent.ts — manages the user's custom accent colour.
 * Stores hex in localStorage, applies it as CSS custom properties on :root.
 */

const STORAGE_KEY = 'blizkie.accent';

export const DEFAULT_ACCENT = '#2f81f7';

export const ACCENT_PRESETS = [
  { label: 'Синий (по умолчанию)', value: '#2f81f7' },
  { label: 'Индиго',               value: '#6366f1' },
  { label: 'Фиолетовый',           value: '#a855f7' },
  { label: 'Розовый',              value: '#ec4899' },
  { label: 'Красный',              value: '#ef4444' },
  { label: 'Оранжевый',            value: '#f97316' },
  { label: 'Жёлтый',              value: '#eab308' },
  { label: 'Зелёный',              value: '#22c55e' },
  { label: 'Бирюзовый',            value: '#14b8a6' },
  { label: 'Голубой',              value: '#38bdf8' },
];

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return null;
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  };
}

export function applyAccent(hex: string): void {
  const rgb = hexToRgb(hex);
  if (!rgb) return;
  const { r, g, b } = rgb;
  const root = document.documentElement;
  root.style.setProperty('--accent',        hex);
  root.style.setProperty('--accent-dim',    `rgba(${r},${g},${b},0.15)`);
  root.style.setProperty('--accent-border', `rgba(${r},${g},${b},0.35)`);
  try { localStorage.setItem(STORAGE_KEY, hex); } catch {}
}

export function getStoredAccent(): string {
  try { return localStorage.getItem(STORAGE_KEY) || DEFAULT_ACCENT; }
  catch { return DEFAULT_ACCENT; }
}

export function resetAccent(): void {
  document.documentElement.style.removeProperty('--accent');
  document.documentElement.style.removeProperty('--accent-dim');
  document.documentElement.style.removeProperty('--accent-border');
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
}
