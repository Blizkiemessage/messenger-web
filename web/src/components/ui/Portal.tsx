/**
 * Portal.tsx
 * Renders children directly into document.body, bypassing any CSS stacking
 * contexts (overflow, transform, backdrop-filter) from ancestor elements.
 * Use for context menus, modal overlays, tooltips.
 */
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  children: React.ReactNode;
}

export function Portal({ children }: Props) {
  const el = useRef(document.createElement('div'));

  useEffect(() => {
    const node = el.current;
    document.body.appendChild(node);
    return () => { document.body.removeChild(node); };
  }, []);

  return createPortal(children, el.current);
}
