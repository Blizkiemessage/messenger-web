import { useEffect, useState } from 'react';

/**
 * useIsMobile — true, когда вьюпорт ≤ breakpoint (по умолчанию 700px,
 * тот же порог, что и в CSS-слое мобильного меню). Реактивно следит за
 * resize/поворотом экрана через matchMedia.
 */
export function useIsMobile(breakpoint = 700): boolean {
  const query = `(max-width: ${breakpoint}px)`;
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  );

  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    setIsMobile(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);

  return isMobile;
}
