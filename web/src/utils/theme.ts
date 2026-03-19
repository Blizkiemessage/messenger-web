export type Theme = 'dark' | 'light';

export function getStoredTheme(): Theme {
  try {
    return (localStorage.getItem('blizkie.theme') as Theme) || 'dark';
  } catch {
    return 'dark';
  }
}

export function applyTheme(t: Theme): void {
  document.documentElement.setAttribute('data-theme', t);
  try {
    localStorage.setItem('blizkie.theme', t);
  } catch {}
}
