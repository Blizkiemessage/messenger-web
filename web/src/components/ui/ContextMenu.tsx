/**
 * ContextMenu
 *
 * Reusable positioned context menu with click-outside detection.
 * Used by ChatContextMenu (sidebar) and member context menu (GroupInfoModal).
 *
 * Positions itself so it never overflows the viewport.
 */

import { useRef, useEffect } from 'react';

interface Props {
  x: number;
  y: number;
  onClose: () => void;
  children: React.ReactNode;
  /** Extra zIndex offset when stacked above other modals. Default: 9999 */
  zIndex?: number;
  /** Minimum clearance from viewport edges in px. Default: 60 */
  margin?: number;
}

export function ContextMenu({ x, y, onClose, children, zIndex = 9999, margin = 60 }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [onClose]);

  // Escape key closes the menu
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const top = Math.min(y, window.innerHeight - margin);
  const left = Math.min(x, window.innerWidth - 180);

  return (
    <div
      ref={ref}
      className="ctxMenu"
      style={{ position: 'fixed', top, left, zIndex }}
    >
      {children}
    </div>
  );
}
