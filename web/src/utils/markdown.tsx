/**
 * markdown.tsx
 * Simple Telegram-style inline markdown renderer.
 * Supported syntax:
 *   **bold**, _italic_, ||spoiler||, [text](url), bare URLs, @mentions
 *   - unordered list items (lines starting with "- ")
 *   1. ordered list items (lines starting with "N. ")
 */
import { type ReactNode, Fragment } from 'react';
import type { User } from '../types';
import { useDeepLinkStore } from '../store/useDeepLinkStore';
import { parseDeepLink } from '../deeplinks';
import i18n from '../i18n';

export interface MdOptions {
  term?:           string;
  meUsername?:     string;
  members?:        User[];
  onMentionClick?: (id: string) => void;
  /** Resolve a custom emoji URL by packId + itemId. Returns null if not cached yet. */
  emojiResolver?:  (packId: string, itemId: string) => string | null;
}

// Inline token regex — order matters (most specific first)
// Groups: 1=bold 2=italic 3=spoiler 4=linkText 5=linkUrl 6=bareUrl 7=mention 8=customEmojiPack 9=customEmojiItem
const INLINE_RE =
  /\*\*(.+?)\*\*|_(.+?)_|\|\|(.+?)\|\||\[([^\]\n]+)\]\(((?:https?:\/\/|blz:)[^\)\n\s]+)\)|(https?:\/\/[^\s<>"'\n]+)|(@\w+)|:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):/gs;

interface Token {
  type: 'bold' | 'italic' | 'spoiler' | 'link' | 'url' | 'mention' | 'customEmoji' | 'text';
  content?: string;
  text?: string;
  url?: string;
  username?: string;
  packId?: string;
  itemId?: string;
}

function tokenizeLine(line: string): Token[] {
  const tokens: Token[] = [];
  let last = 0;
  INLINE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = INLINE_RE.exec(line)) !== null) {
    if (m.index > last) tokens.push({ type: 'text', content: line.slice(last, m.index) });
    if      (m[1] != null) tokens.push({ type: 'bold',        content: m[1] });
    else if (m[2] != null) tokens.push({ type: 'italic',      content: m[2] });
    else if (m[3] != null) tokens.push({ type: 'spoiler',     content: m[3] });
    else if (m[4] != null) tokens.push({ type: 'link',        text: m[4], url: m[5] });
    else if (m[6] != null) tokens.push({ type: 'url',         url: m[6] });
    else if (m[7] != null) tokens.push({ type: 'mention',     username: m[7] });
    else if (m[8] != null) tokens.push({ type: 'customEmoji', packId: m[8], itemId: m[9] });
    last = INLINE_RE.lastIndex;
  }
  if (last < line.length) tokens.push({ type: 'text', content: line.slice(last) });
  return tokens;
}

function highlight(text: string, term: string): ReactNode {
  if (!term) return text;
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'));
  return (
    <>
      {parts.map((p, i) =>
        p.toLowerCase() === term.toLowerCase()
          ? <mark key={i} className="msgHighlight">{p}</mark>
          : p,
      )}
    </>
  );
}

function renderTokens(tokens: Token[], opts: MdOptions, keyBase: string): ReactNode[] {
  return tokens.map((tok, i) => {
    const k = `${keyBase}_${i}`;
    switch (tok.type) {
      case 'bold':
        return <strong key={k}>{renderTokens(tokenizeLine(tok.content!), opts, k)}</strong>;
      case 'italic':
        return <em key={k}>{renderTokens(tokenizeLine(tok.content!), opts, k)}</em>;
      case 'spoiler':
        return (
          <span
            key={k}
            className="msgSpoiler"
            onClick={e => {
              e.stopPropagation();
              (e.currentTarget as HTMLElement).classList.toggle('revealed');
            }}
          >
            {renderTokens(tokenizeLine(tok.content!), opts, k)}
          </span>
        );
      case 'link': {
        const href = tok.url!;
        // Внутренняя ссылка-действие `blz:...` — диспатчим, не открываем вкладку
        if (href.startsWith('blz:')) {
          return (
            <a key={k} href={href} className="bubbleLink bubbleActionLink"
              onClick={e => {
                e.preventDefault();
                e.stopPropagation();
                const action = parseDeepLink(href);
                if (action) useDeepLinkStore.getState().open(action);
              }}>
              {tok.text}
            </a>
          );
        }
        return (
          <a key={k} href={href} target="_blank" rel="noopener noreferrer"
            className="bubbleLink" onClick={e => e.stopPropagation()}>
            {tok.text}
          </a>
        );
      }
      case 'url':
        return (
          <a key={k} href={tok.url!} target="_blank" rel="noopener noreferrer"
            className="bubbleLink" onClick={e => e.stopPropagation()}>
            {tok.url}
          </a>
        );
      case 'mention': {
        const username = tok.username!.slice(1);
        const isMe = opts.meUsername
          ? username.toLowerCase() === opts.meUsername.toLowerCase()
          : false;
        const member = opts.members?.find(
          m => m.username?.toLowerCase() === username.toLowerCase(),
        );
        if (member && opts.onMentionClick) {
          return (
            <span key={k}
              className={`mention mentionLink${isMe ? ' mentionMe' : ''}`}
              onClick={e => { e.stopPropagation(); opts.onMentionClick!(member.id); }}>
              {tok.username}
            </span>
          );
        }
        return <span key={k} className={`mention${isMe ? ' mentionMe' : ''}`}>{tok.username}</span>;
      }
      case 'customEmoji': {
        const url = opts.emojiResolver?.(tok.packId!, tok.itemId!);
        if (!url) return null; // not yet cached — renders invisible until store loads
        return (
          <img
            key={k}
            src={url}
            className="customEmojiInline"
            alt=""
            loading="lazy"
            draggable={false}
          />
        );
      }
      case 'text':
      default:
        if (!tok.content) return null;
        if (opts.term) return <Fragment key={k}>{highlight(tok.content, opts.term)}</Fragment>;
        return tok.content;
    }
  });
}

/**
 * Strip markdown syntax for chat-list previews and push notifications.
 * Custom emoji are replaced with their emoji_hint (unicode) when available,
 * otherwise with a generic placeholder.
 * Spoiler content is replaced with a placeholder so recipients can't read it
 * in the sidebar before revealing it in the chat.
 */
export function stripPreview(
  text: string,
  packItems?: Record<string, { id: string; emoji_hint?: string | null }[]>,
): string {
  return text
    .replace(
      /:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:/gi,
      (match) => {
        if (packItems) {
          const inner = match.slice(1, -1);
          const sep = inner.indexOf(':');
          const packId = inner.slice(0, sep);
          const itemId = inner.slice(sep + 1);
          const item = packItems[packId]?.find(it => it.id === itemId);
          if (item?.emoji_hint) return item.emoji_hint;
        }
        return i18n.t('common:emojiPlaceholder');
      },
    ) // :packId:itemId: → emoji_hint or the localized emoji placeholder
    .replace(/\|\|([^|]*)\|\|/g, () => i18n.t('common:hiddenTextPlaceholder'))  // spoilers → placeholder
    .replace(/\*\*([^*]*)\*\*/g, '$1')                   // **bold** → bold
    .replace(/_([^_]+)_/g, '$1')                          // _italic_ → italic
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')              // [text](url) → text
    .replace(/^(?:- |\d+\. )/gm, '');                     // list markers
}

export function renderMarkdown(text: string, opts: MdOptions = {}): ReactNode {
  const lines = text.split('\n');
  const result: ReactNode[] = [];

  const ulItems: ReactNode[] = [];
  const olItems: ReactNode[] = [];

  const flushUL = (k: string) => {
    if (ulItems.length) {
      result.push(<ul key={k} className="msgList">{[...ulItems]}</ul>);
      ulItems.length = 0;
    }
  };
  const flushOL = (k: string) => {
    if (olItems.length) {
      result.push(<ol key={k} className="msgList msgListOl">{[...olItems]}</ol>);
      olItems.length = 0;
    }
  };

  lines.forEach((line, li) => {
    const ulMatch = line.match(/^- (.*)$/);
    const olMatch = line.match(/^\d+\. (.*)$/);

    if (ulMatch) {
      flushOL(`ol_${li}`);
      const toks = tokenizeLine(ulMatch[1]);
      ulItems.push(<li key={li}>{renderTokens(toks, opts, `ul_${li}`)}</li>);
    } else if (olMatch) {
      flushUL(`ul_${li}`);
      const content = line.replace(/^\d+\. /, '');
      const toks = tokenizeLine(content);
      olItems.push(<li key={li}>{renderTokens(toks, opts, `ol_${li}`)}</li>);
    } else {
      flushUL(`ul_${li}`);
      flushOL(`ol_${li}`);
      const toks = tokenizeLine(line);
      result.push(
        <Fragment key={`line_${li}`}>
          {renderTokens(toks, opts, `l_${li}`)}
        </Fragment>,
      );
      if (li < lines.length - 1) result.push(<br key={`br_${li}`} />);
    }
  });

  flushUL('ul_end');
  flushOL('ol_end');

  return <>{result}</>;
}
