/**
 * richText.ts
 * Converts between markdown strings and the HTML used inside the
 * contenteditable composer. Shared by Composer and FormatToolbar.
 */

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function lineToHtml(line: string): string {
  const INLINE_RE =
    /\*\*(.+?)\*\*|_(.+?)_|\|\|(.+?)\|\||\[([^\]\n]+)\]\((https?:\/\/[^\)\n\s]+)\)/gs;
  const parts: string[] = [];
  let last = 0;
  INLINE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = INLINE_RE.exec(line)) !== null) {
    if (m.index > last) parts.push(escHtml(line.slice(last, m.index)));
    if      (m[1] != null) parts.push(`<b>${lineToHtml(m[1])}</b>`);
    else if (m[2] != null) parts.push(`<i>${lineToHtml(m[2])}</i>`);
    else if (m[3] != null) parts.push(`<span class="composerSpoilerHint">${lineToHtml(m[3])}</span>`);
    else if (m[4] != null) parts.push(`<a href="${escHtml(m[5] ?? '')}" target="_blank" rel="noopener noreferrer">${escHtml(m[4])}</a>`);
    last = INLINE_RE.lastIndex;
  }
  if (last < line.length) parts.push(escHtml(line.slice(last)));
  return parts.join('');
}

/** Convert markdown to HTML for setting inside a contenteditable div. */
export function mdToHtml(md: string): string {
  if (!md) return '';
  return md.split('\n').map(lineToHtml).join('<br>');
}

/** Serialize a contenteditable element's content back to markdown. */
export function htmlToMd(el: HTMLElement): string {
  function walk(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const e = node as HTMLElement;
    const tag = e.tagName;
    const inner = Array.from(e.childNodes).map(walk).join('');
    if (tag === 'B' || tag === 'STRONG') return `**${inner}**`;
    if (tag === 'I' || tag === 'EM')     return `_${inner}_`;
    if (tag === 'BR')                    return '\n';
    if (e.classList.contains('composerSpoilerHint')) return `||${inner}||`;
    if (tag === 'A') return `[${inner}](${e.getAttribute('href') ?? ''})`;
    // Custom emoji inline image: <img data-emoji="packId:itemId"> → :packId:itemId:
    if (tag === 'IMG' && e.dataset.emoji) {
      const parts = e.dataset.emoji.split(':');
      if (parts.length === 2) return `:${parts[0]}:${parts[1]}:`;
    }
    // Chrome wraps new lines in <div>
    if (tag === 'DIV') {
      const isFirst = !e.previousElementSibling && e === e.parentElement?.firstElementChild;
      return (isFirst ? '' : '\n') + inner;
    }
    return inner;
  }
  return Array.from(el.childNodes).map(walk).join('').replace(/\n$/, '');
}

/** Get visible text content before the cursor in a contenteditable element. */
export function getTextBeforeCursor(editor: HTMLElement): string {
  const sel = window.getSelection();
  if (!sel || !sel.anchorNode || !editor.contains(sel.anchorNode)) return '';
  try {
    const range = document.createRange();
    range.setStart(editor, 0);
    range.setEnd(sel.anchorNode, sel.anchorOffset);
    return range.toString();
  } catch {
    return '';
  }
}
