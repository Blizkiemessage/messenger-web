/**
 * FormatToolbar.tsx
 * Floating formatting toolbar that appears inside the composer
 * whenever the user has a non-empty text selection in the textarea.
 *
 * Menus:
 *   main   → Вырезать | Копировать | Вставить | ···
 *   more   → ‹ | Выделить всё | Форматирование ›
 *   format → ‹ | B | I | S (spoiler) | UL | OL | Link
 *   link   → ‹ | [url input] | Применить
 */
import { useState, useEffect, useRef, useCallback } from 'react';

interface Props {
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  value:       string;
  onChange:    (val: string) => void;
}

type FmtMenu = 'main' | 'more' | 'format' | 'link';

interface Sel { start: number; end: number }

export function FormatToolbar({ textareaRef, value, onChange }: Props) {
  const [visible,  setVisible]  = useState(false);
  const [sel,      setSel]      = useState<Sel | null>(null);
  const [menu,     setMenu]     = useState<FmtMenu>('main');
  const [linkUrl,  setLinkUrl]  = useState('');

  // Keep a ref to menu to use in callbacks without stale closure
  const menuRef    = useRef<FmtMenu>('main');
  // Save selection when entering link menu (textarea will blur → selection is lost)
  const savedSelRef = useRef<Sel | null>(null);
  const tbRef      = useRef<HTMLDivElement>(null);
  const linkRef    = useRef<HTMLInputElement>(null);

  useEffect(() => { menuRef.current = menu; }, [menu]);

  // ── Read selection from textarea ──────────────────────────────────────────
  const readSel = useCallback(() => {
    // Don't override while user is typing in the link input
    if (menuRef.current === 'link') return;
    const ta = textareaRef.current;
    if (!ta) return;
    const { selectionStart: s, selectionEnd: e } = ta;
    if (typeof s === 'number' && typeof e === 'number' && s !== e) {
      setSel({ start: s, end: e });
      setVisible(true);
      // Only reset menu to 'main' if not currently in a submenu
      if (menuRef.current !== 'more' && menuRef.current !== 'format') {
        setMenu('main');
      }
    } else {
      setVisible(false);
      setSel(null);
    }
  }, [textareaRef]);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    // Small delay on mouseup so browser has committed the selection
    const onUp = () => setTimeout(readSel, 20);
    const onKey = () => setTimeout(readSel, 20);
    ta.addEventListener('mouseup', onUp);
    ta.addEventListener('keyup',   onKey);
    ta.addEventListener('select',  readSel);
    return () => {
      ta.removeEventListener('mouseup', onUp);
      ta.removeEventListener('keyup',   onKey);
      ta.removeEventListener('select',  readSel);
    };
  }, [textareaRef, readSel]);

  // ── Hide on outside click ─────────────────────────────────────────────────
  useEffect(() => {
    if (!visible) return;
    const handler = (e: MouseEvent) => {
      if (tbRef.current?.contains(e.target as Node)) return;
      if (e.target === textareaRef.current) return;
      setVisible(false);
      setSel(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [visible, textareaRef]);

  if (!visible || !sel) return null;

  const selectedText = value.slice(sel.start, sel.end);

  // ── Helpers ───────────────────────────────────────────────────────────────
  /** Replace the selection with `before + selectedText + after` */
  function wrapSel(before: string, after = before) {
    const newVal =
      value.slice(0, sel.start) + before + selectedText + after + value.slice(sel.end);
    onChange(newVal);
    done();
  }

  function replaceWithText(text: string, rangeOverride?: Sel) {
    const r = rangeOverride ?? sel;
    const newVal = value.slice(0, r.start) + text + value.slice(r.end);
    onChange(newVal);
    done();
  }

  function done() {
    setVisible(false);
    setSel(null);
    savedSelRef.current = null;
    setLinkUrl('');
    setTimeout(() => textareaRef.current?.focus(), 0);
  }

  // ── Clipboard actions ─────────────────────────────────────────────────────
  function handleCut() {
    navigator.clipboard.writeText(selectedText).catch(() => {});
    replaceWithText('');
  }

  function handleCopy() {
    navigator.clipboard.writeText(selectedText).catch(() => {});
    done();
  }

  async function handlePaste() {
    try {
      const text = await navigator.clipboard.readText();
      if (text) replaceWithText(text);
      else done();
    } catch {
      done();
    }
  }

  function handleSelectAll() {
    const ta = textareaRef.current;
    if (!ta) return;
    const newSel = { start: 0, end: ta.value.length };
    setSel(newSel);
    setMenu('main');
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(0, ta.value.length);
    });
  }

  // ── List formatting ───────────────────────────────────────────────────────
  function applyList(ordered: boolean) {
    const lines = selectedText.split('\n');
    const formatted = ordered
      ? lines.map((l, i) => `${i + 1}. ${l}`).join('\n')
      : lines.map(l => `- ${l}`).join('\n');
    replaceWithText(formatted);
  }

  // ── Link formatting ───────────────────────────────────────────────────────
  function openLinkMenu() {
    savedSelRef.current = sel; // save before textarea may blur
    setMenu('link');
    setTimeout(() => linkRef.current?.focus(), 50);
  }

  function applyLink() {
    if (!linkUrl.trim()) return;
    const range = savedSelRef.current ?? sel;
    const selText = value.slice(range.start, range.end);
    const url = /^https?:\/\//i.test(linkUrl) ? linkUrl : `https://${linkUrl}`;
    replaceWithText(`[${selText}](${url})`, range);
  }

  // ── Prevent textarea blur when clicking toolbar buttons ───────────────────
  // All buttons use onMouseDown + e.preventDefault() instead of onClick
  const noBlur = (e: React.MouseEvent) => e.preventDefault();

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div ref={tbRef} className="fmtToolbar">
      {/* ── Main: Cut / Copy / Paste / ··· ── */}
      {menu === 'main' && (
        <div className="fmtRow">
          <button className="fmtBtn" onMouseDown={e => { noBlur(e); handleCut(); }} title="Вырезать">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/>
              <line x1="20" y1="4" x2="8.12" y2="15.88"/>
              <line x1="14.47" y1="14.48" x2="20" y2="20"/>
              <line x1="8.12" y1="8.12" x2="12" y2="12"/>
            </svg>
            Вырезать
          </button>
          <div className="fmtSep" />
          <button className="fmtBtn" onMouseDown={e => { noBlur(e); handleCopy(); }} title="Копировать">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
            Копировать
          </button>
          <div className="fmtSep" />
          <button className="fmtBtn" onMouseDown={e => { noBlur(e); handlePaste(); }} title="Вставить">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
              <rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>
            </svg>
            Вставить
          </button>
          <div className="fmtSep" />
          <button className="fmtBtn fmtBtnIcon" onMouseDown={e => { noBlur(e); setMenu('more'); }} title="Ещё">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/>
            </svg>
          </button>
        </div>
      )}

      {/* ── More: ‹ | Выделить всё | Форматирование › ── */}
      {menu === 'more' && (
        <div className="fmtRow">
          <button className="fmtBtn fmtBtnIcon fmtBtnBack" onMouseDown={e => { noBlur(e); setMenu('main'); }} title="Назад">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </button>
          <div className="fmtSep" />
          <button className="fmtBtn" onMouseDown={e => { noBlur(e); handleSelectAll(); }}>
            Выделить всё
          </button>
          <div className="fmtSep" />
          <button className="fmtBtn fmtBtnNext" onMouseDown={e => { noBlur(e); setMenu('format'); }}>
            Форматирование
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </button>
        </div>
      )}

      {/* ── Format: ‹ | B | I | S | UL | OL | Link ── */}
      {menu === 'format' && (
        <div className="fmtRow">
          <button className="fmtBtn fmtBtnIcon fmtBtnBack" onMouseDown={e => { noBlur(e); setMenu('more'); }} title="Назад">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </button>
          <div className="fmtSep" />
          {/* Bold */}
          <button className="fmtBtn fmtBtnFmt" onMouseDown={e => { noBlur(e); wrapSel('**'); }} title="Жирный">
            <strong>Ж</strong>
          </button>
          <div className="fmtSep" />
          {/* Italic */}
          <button className="fmtBtn fmtBtnFmt" onMouseDown={e => { noBlur(e); wrapSel('_'); }} title="Курсив">
            <em>К</em>
          </button>
          <div className="fmtSep" />
          {/* Spoiler */}
          <button className="fmtBtn fmtBtnFmt fmtBtnSpoiler" onMouseDown={e => { noBlur(e); wrapSel('||'); }} title="Скрытый текст">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
              <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
              <line x1="1" y1="1" x2="23" y2="23"/>
            </svg>
          </button>
          <div className="fmtSep" />
          {/* Unordered list */}
          <button className="fmtBtn fmtBtnFmt" onMouseDown={e => { noBlur(e); applyList(false); }} title="Список">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/>
              <circle cx="4" cy="6" r="1.5" fill="currentColor" stroke="none"/>
              <circle cx="4" cy="12" r="1.5" fill="currentColor" stroke="none"/>
              <circle cx="4" cy="18" r="1.5" fill="currentColor" stroke="none"/>
            </svg>
          </button>
          <div className="fmtSep" />
          {/* Ordered list */}
          <button className="fmtBtn fmtBtnFmt" onMouseDown={e => { noBlur(e); applyList(true); }} title="Нумерованный список">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/>
              <path d="M4 4.5h1.5v4H4" /><path d="M4 9.5h2"/>
              <path d="M4 14c0-.8 2-1.5 2-2.5s-.8-1-1.5-1c-.6 0-1 .3-1.2.7"/>
              <path d="M4 19h2v-.7H5v-.6h1v-.7H4v0H4v-1h2v1"/>
            </svg>
          </button>
          <div className="fmtSep" />
          {/* Link */}
          <button className="fmtBtn fmtBtnFmt" onMouseDown={e => { noBlur(e); openLinkMenu(); }} title="Ссылка">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
            </svg>
          </button>
        </div>
      )}

      {/* ── Link input ── */}
      {menu === 'link' && (
        <div className="fmtRow fmtRowLink">
          <button className="fmtBtn fmtBtnIcon fmtBtnBack" onMouseDown={e => { noBlur(e); setMenu('format'); }} title="Назад">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </button>
          <input
            ref={linkRef}
            className="fmtLinkInput"
            placeholder="https://example.com"
            value={linkUrl}
            onChange={e => setLinkUrl(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); applyLink(); }
              if (e.key === 'Escape') setMenu('format');
            }}
          />
          <button className="fmtBtn fmtBtnApply" onMouseDown={e => { noBlur(e); applyLink(); }}>
            Применить
          </button>
        </div>
      )}
    </div>
  );
}
