/**
 * FormatToolbar.tsx
 * Floating formatting toolbar for the contenteditable composer.
 * Appears whenever the user has a non-empty selection inside the editor div.
 *
 * Menus:
 *   main   → Вырезать | Копировать | Вставить | ···
 *   more   → ‹ | Выделить всё | Форматирование ›
 *   format → ‹ | B | I | S | UL | OL | Link | Сбросить
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { htmlToMd } from '../../utils/richText';

interface Props {
  editorRef: React.RefObject<HTMLDivElement | null>;
  onChange:  (val: string) => void;
}

type FmtMenu = 'main' | 'more' | 'format';

export function FormatToolbar({ editorRef, onChange }: Props) {
  const [visible,  setVisible]  = useState(false);
  const [selText,  setSelText]  = useState('');
  const [menu,     setMenu]     = useState<FmtMenu>('main');
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl,  setLinkUrl]  = useState('');

  const linkOpenRef  = useRef(false);
  const menuRef      = useRef<FmtMenu>('main');
  const freezeUntil  = useRef(0);
  const savedRange   = useRef<Range | null>(null);
  const tbRef        = useRef<HTMLDivElement>(null);
  const linkRef      = useRef<HTMLInputElement>(null);

  useEffect(() => { linkOpenRef.current = linkOpen; }, [linkOpen]);

  const changeMenu = useCallback((m: FmtMenu) => {
    menuRef.current = m;
    setMenu(m);
  }, []);

  // After DOM edits, serialize editor → markdown and notify parent
  const serializeEditor = useCallback(() => {
    const editor = editorRef.current;
    if (editor) onChange(htmlToMd(editor));
  }, [editorRef, onChange]);

  // Restore saved Range into window.getSelection() before DOM ops
  const restoreSelection = useCallback((): boolean => {
    const r = savedRange.current;
    if (!r) return false;
    const sel = window.getSelection();
    if (!sel) return false;
    try {
      sel.removeAllRanges();
      sel.addRange(r.cloneRange());
      return true;
    } catch {
      return false;
    }
  }, []);

  // ── Read selection ─────────────────────────────────────────────────────────
  const readSel = useCallback(() => {
    if (linkOpenRef.current) return;
    if (Date.now() < freezeUntil.current) return;
    const editor = editorRef.current;
    if (!editor) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      setVisible(false); setSelText(''); savedRange.current = null;
      changeMenu('main'); setLinkOpen(false);
      return;
    }
    const range = sel.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) {
      setVisible(false); setSelText(''); savedRange.current = null;
      changeMenu('main'); setLinkOpen(false);
      return;
    }
    savedRange.current = range.cloneRange();
    setSelText(sel.toString());
    setVisible(true);
    if (menuRef.current !== 'more' && menuRef.current !== 'format') changeMenu('main');
  }, [editorRef, changeMenu]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const onUp  = () => setTimeout(readSel, 20);
    const onKey = () => setTimeout(readSel, 20);
    const onPtrUp = (e: PointerEvent) => { if (e.pointerType !== 'mouse') setTimeout(readSel, 50); };
    const onSelChange = () => {
      if (editor === document.activeElement || editor.contains(document.activeElement))
        setTimeout(readSel, 20);
    };
    editor.addEventListener('mouseup', onUp);
    editor.addEventListener('keyup', onKey);
    editor.addEventListener('pointerup', onPtrUp);
    document.addEventListener('selectionchange', onSelChange);
    return () => {
      editor.removeEventListener('mouseup', onUp);
      editor.removeEventListener('keyup', onKey);
      editor.removeEventListener('pointerup', onPtrUp);
      document.removeEventListener('selectionchange', onSelChange);
    };
  }, [editorRef, readSel]);

  // ── Hide on outside click ──────────────────────────────────────────────────
  useEffect(() => {
    if (!visible) return;
    const handler = (e: MouseEvent) => {
      if (tbRef.current?.contains(e.target as Node)) return;
      if (editorRef.current?.contains(e.target as Node)) return;
      setVisible(false); setSelText(''); savedRange.current = null;
      changeMenu('main'); setLinkOpen(false); setLinkUrl('');
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [visible, editorRef, changeMenu]);

  if (!visible) return null;

  // ── Active-state detection via DOM ────────────────────────────────────────
  function isInTag(tagName: string, className?: string): boolean {
    const r = savedRange.current;
    if (!r) return false;
    let node: Node | null = r.commonAncestorContainer;
    if (node?.nodeType === Node.TEXT_NODE) node = node.parentNode;
    while (node && node !== editorRef.current) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as HTMLElement;
        if (el.tagName === tagName.toUpperCase() && (!className || el.classList.contains(className))) return true;
      }
      node = node.parentNode;
    }
    return false;
  }

  const nonEmptyLines = selText.split('\n').filter(l => l.trim() !== '');
  const isBoldActive    = isInTag('B');
  const isItalicActive  = isInTag('I') && !isBoldActive;
  const isSpoilerActive = isInTag('SPAN', 'composerSpoilerHint');
  const isULActive = nonEmptyLines.length > 0 && nonEmptyLines.every(l => l.startsWith('- '));
  const isOLActive = nonEmptyLines.length > 0 && nonEmptyLines.every(l => /^\d+\. /.test(l));

  // ── Helpers ────────────────────────────────────────────────────────────────
  function done() {
    setVisible(false); setSelText(''); savedRange.current = null;
    changeMenu('main'); setLinkOpen(false); setLinkUrl('');
    window.getSelection()?.removeAllRanges();
    setTimeout(() => editorRef.current?.focus(), 0);
  }

  // Wrap/unwrap the current selection in a DOM element
  function toggleWrap(tag: string, isActive: boolean, className?: string) {
    freezeUntil.current = Date.now() + 500;
    if (!restoreSelection()) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;

    if (isActive) {
      // Unwrap: find the wrapping element and hoist its children
      const range = sel.getRangeAt(0);
      let node: Node | null = range.commonAncestorContainer;
      if (node?.nodeType === Node.TEXT_NODE) node = node.parentNode;
      while (node && node !== editorRef.current) {
        const el = node as HTMLElement;
        if (el.tagName === tag.toUpperCase() && (!className || el.classList.contains(className))) {
          const parent = el.parentNode!;
          const frag = document.createDocumentFragment();
          const children = Array.from(el.childNodes);
          children.forEach(c => frag.appendChild(c));
          parent.replaceChild(frag, el);
          // Restore selection over unwrapped content
          try {
            const newRange = document.createRange();
            newRange.setStartBefore(children[0]);
            newRange.setEndAfter(children[children.length - 1]);
            sel.removeAllRanges();
            sel.addRange(newRange);
            savedRange.current = newRange.cloneRange();
            setSelText(sel.toString());
          } catch { /* ignore */ }
          break;
        }
        node = node.parentNode;
      }
    } else {
      // Wrap selection in new element
      const range = sel.getRangeAt(0);
      const el = document.createElement(tag);
      if (className) el.className = className;
      try {
        range.surroundContents(el);
      } catch {
        const frag = range.extractContents();
        el.appendChild(frag);
        range.insertNode(el);
      }
      // Re-select the wrapped content so the toolbar stays open and active-state is correct
      const newRange = document.createRange();
      newRange.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(newRange);
      savedRange.current = newRange.cloneRange();
      setSelText(sel.toString());
    }

    serializeEditor();
  }

  // ── Clipboard ─────────────────────────────────────────────────────────────
  function handleCut() {
    navigator.clipboard.writeText(selText).catch(() => {});
    if (restoreSelection()) {
      const sel = window.getSelection();
      if (sel?.rangeCount) { sel.getRangeAt(0).deleteContents(); serializeEditor(); }
    }
    done();
  }

  function handleCopy() {
    navigator.clipboard.writeText(selText).catch(() => {});
    done();
  }

  async function handlePaste() {
    try {
      const text = await navigator.clipboard.readText();
      if (text && restoreSelection()) {
        document.execCommand('insertText', false, text);
        serializeEditor();
      }
    } catch { /* ignore */ }
    done();
  }

  function handleSelectAll() {
    const editor = editorRef.current;
    if (!editor) return;
    const range = document.createRange();
    range.selectNodeContents(editor);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    savedRange.current = range.cloneRange();
    setSelText(editor.textContent ?? '');
    changeMenu('main');
  }

  // ── Inline list formatting ─────────────────────────────────────────────────
  function applyList(ordered: boolean) {
    freezeUntil.current = Date.now() + 500;
    if (!restoreSelection()) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;
    const lines = selText.split('\n');
    let newText: string;
    if (ordered && isOLActive)       newText = lines.map(l => l.replace(/^\d+\. /, '')).join('\n');
    else if (!ordered && isULActive) newText = lines.map(l => l.replace(/^- /, '')).join('\n');
    else if (ordered && isULActive)  newText = lines.map(l => l.replace(/^- /, '')).map((l, i) => `${i + 1}. ${l}`).join('\n');
    else if (!ordered && isOLActive) newText = lines.map(l => l.replace(/^\d+\. /, '')).map(l => `- ${l}`).join('\n');
    else newText = ordered ? lines.map((l, i) => `${i + 1}. ${l}`).join('\n') : lines.map(l => `- ${l}`).join('\n');
    document.execCommand('insertText', false, newText);
    serializeEditor();
    setSelText(newText);
  }

  // ── Reset all formatting ───────────────────────────────────────────────────
  function resetFormatting() {
    freezeUntil.current = Date.now() + 500;
    if (!restoreSelection()) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;
    const text = sel.toString();
    document.execCommand('insertText', false, text);
    serializeEditor();
    setSelText(text);
  }

  // ── Link ──────────────────────────────────────────────────────────────────
  function openLinkMenu() {
    setLinkOpen(true);
    setLinkUrl('');
    setTimeout(() => linkRef.current?.focus(), 50);
  }

  function closeLinkMenu() {
    setLinkOpen(false);
    setLinkUrl('');
  }

  function applyLink() {
    if (!linkUrl.trim()) return;
    if (!restoreSelection()) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    const url = /^https?:\/\//i.test(linkUrl) ? linkUrl : `https://${linkUrl}`;
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    try {
      range.surroundContents(a);
    } catch {
      const frag = range.extractContents();
      a.appendChild(frag);
      range.insertNode(a);
    }
    serializeEditor();
    closeLinkMenu();
    done();
  }

  // ── noBlur: prevent contenteditable from losing selection on toolbar click ─
  const noBlur = (e: React.PointerEvent) => {
    e.preventDefault();
    freezeUntil.current = Date.now() + 300;
  };

  const containerPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as Element).closest('input')) return;
    e.preventDefault();
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div ref={tbRef} className="fmtToolbar" onPointerDown={containerPointerDown}>
      {/* ── Main: Cut / Copy / Paste / ··· ── */}
      {menu === 'main' && (
        <div className="fmtRow">
          <button className="fmtBtn" onPointerDown={e => { noBlur(e); handleCut(); }} title="Вырезать">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/>
              <line x1="20" y1="4" x2="8.12" y2="15.88"/>
              <line x1="14.47" y1="14.48" x2="20" y2="20"/>
              <line x1="8.12" y1="8.12" x2="12" y2="12"/>
            </svg>
            Вырезать
          </button>
          <div className="fmtSep" />
          <button className="fmtBtn" onPointerDown={e => { noBlur(e); handleCopy(); }} title="Копировать">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
            Копировать
          </button>
          <div className="fmtSep" />
          <button className="fmtBtn" onPointerDown={e => { noBlur(e); handlePaste(); }} title="Вставить">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
              <rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>
            </svg>
            Вставить
          </button>
          <div className="fmtSep" />
          <button className="fmtBtn fmtBtnIcon" onPointerDown={e => { noBlur(e); changeMenu('more'); }} title="Ещё">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/>
            </svg>
          </button>
        </div>
      )}

      {/* ── More: ‹ | Выделить всё | Форматирование › ── */}
      {menu === 'more' && (
        <div className="fmtRow">
          <button className="fmtBtn fmtBtnIcon fmtBtnBack" onPointerDown={e => { noBlur(e); changeMenu('main'); }} title="Назад">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </button>
          <div className="fmtSep" />
          <button className="fmtBtn" onPointerDown={e => { noBlur(e); handleSelectAll(); }}>
            Выделить всё
          </button>
          <div className="fmtSep" />
          <button className="fmtBtn fmtBtnNext" onPointerDown={e => { noBlur(e); changeMenu('format'); }}>
            Форматирование
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </button>
        </div>
      )}

      {/* ── Format: ‹ | B | I | S | UL | OL | Link | Сбросить ── */}
      {menu === 'format' && (
        <>
          <div className="fmtRow">
            <button className="fmtBtn fmtBtnIcon fmtBtnBack" onPointerDown={e => { noBlur(e); changeMenu('more'); closeLinkMenu(); }} title="Назад">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6"/>
              </svg>
            </button>
            <div className="fmtSep" />
            <button className={`fmtBtn fmtBtnFmt${isBoldActive ? ' fmtBtnActive' : ''}`} onPointerDown={e => { noBlur(e); toggleWrap('b', isBoldActive); }} title="Жирный">
              <strong>Ж</strong>
            </button>
            <div className="fmtSep" />
            <button className={`fmtBtn fmtBtnFmt${isItalicActive ? ' fmtBtnActive' : ''}`} onPointerDown={e => { noBlur(e); toggleWrap('i', isItalicActive); }} title="Курсив">
              <em>К</em>
            </button>
            <div className="fmtSep" />
            <button className={`fmtBtn fmtBtnFmt fmtBtnSpoiler${isSpoilerActive ? ' fmtBtnActive' : ''}`} onPointerDown={e => { noBlur(e); toggleWrap('span', isSpoilerActive, 'composerSpoilerHint'); }} title="Скрытый текст">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                <line x1="1" y1="1" x2="23" y2="23"/>
              </svg>
            </button>
            <div className="fmtSep" />
            <button className={`fmtBtn fmtBtnFmt${isULActive ? ' fmtBtnActive' : ''}`} onPointerDown={e => { noBlur(e); applyList(false); }} title="Список">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/>
                <circle cx="4" cy="6" r="1.5" fill="currentColor" stroke="none"/>
                <circle cx="4" cy="12" r="1.5" fill="currentColor" stroke="none"/>
                <circle cx="4" cy="18" r="1.5" fill="currentColor" stroke="none"/>
              </svg>
            </button>
            <div className="fmtSep" />
            <button className={`fmtBtn fmtBtnFmt${isOLActive ? ' fmtBtnActive' : ''}`} onPointerDown={e => { noBlur(e); applyList(true); }} title="Нумерованный список">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/>
                <path d="M4 4.5h1.5v4H4" /><path d="M4 9.5h2"/>
                <path d="M4 14c0-.8 2-1.5 2-2.5s-.8-1-1.5-1c-.6 0-1 .3-1.2.7"/>
                <path d="M4 19h2v-.7H5v-.6h1v-.7H4v0H4v-1h2v1"/>
              </svg>
            </button>
            <div className="fmtSep" />
            <button className={`fmtBtn fmtBtnFmt${linkOpen ? ' fmtBtnActive' : ''}`} onPointerDown={e => { noBlur(e); linkOpen ? closeLinkMenu() : openLinkMenu(); }} title="Ссылка">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
              </svg>
            </button>
            <div className="fmtSep" />
            <button className="fmtBtn fmtBtnFmt fmtBtnReset" onPointerDown={e => { noBlur(e); resetFormatting(); }} title="Сбросить форматирование">
              Сбросить
            </button>
          </div>

          {linkOpen && (
            <div className="fmtRow fmtRowLink">
              <input
                ref={linkRef}
                className="fmtLinkInput"
                placeholder="https://example.com"
                value={linkUrl}
                onChange={e => setLinkUrl(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') { e.preventDefault(); applyLink(); }
                  if (e.key === 'Escape') closeLinkMenu();
                }}
              />
              <button className="fmtBtn fmtBtnApply" onPointerDown={e => { noBlur(e); applyLink(); }}>
                Применить
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
