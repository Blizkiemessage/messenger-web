/**
 * UserSearch — unified search with mode tabs.
 *
 * Modes:
 *   "general"  — users + chats + messages (default)
 *   "user"     — users only (existing behaviour: click starts a DM)
 *   "message"  — messages only (global backend search)
 *
 * Tabs appear only when the query is ≥ 2 chars.
 */
import { useState, useEffect, useRef } from 'react';
import { Avatar, resolveUrl } from '../ui/Avatar';
import { useSearch } from '../../hooks/useSearch';
import { globalSearch, type GlobalSearchResult, type ChatSearchResult, type MessageSearchResult } from '../../api/search';
import { createDirectChat } from '../../api/chats';
import { useChatsStore } from '../../store/useChatsStore';
import { type User } from '../../types';

type Mode = 'general' | 'user' | 'message';

const TABS: { id: Mode; label: string }[] = [
  { id: 'general',  label: 'Общий' },
  { id: 'user',     label: 'Люди' },
  { id: 'message',  label: 'Сообщения' },
];

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
}

function highlightSnippet(text: string, query: string): string {
  if (!text) return '';
  // find the position of the match, show up to 80 chars around it
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  const idx = lower.indexOf(q);
  let snippet = text;
  if (text.length > 80) {
    const start = Math.max(0, idx - 30);
    snippet = (start > 0 ? '…' : '') + text.slice(start, start + 80) + (start + 80 < text.length ? '…' : '');
  }
  // Wrap the matched word with <mark> (safe — no user-controlled HTML, query comes from our own input)
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return snippet.replace(new RegExp(`(${escaped})`, 'gi'), '<mark>$1</mark>');
}

// Small generic avatar square used for chat/message results
function SquareAvatar({ name, avatarUrl, size = 36 }: { name: string; avatarUrl?: string | null; size?: number }) {
  const [failed, setFailed] = useState(false);
  const src = resolveUrl(avatarUrl);
  const letter = (name || '?')[0].toUpperCase();
  const style: React.CSSProperties = { width: size, height: size, borderRadius: 10, flexShrink: 0, overflow: 'hidden', display: 'grid', placeItems: 'center' };

  if (src && !failed) {
    return (
      <img
        src={src}
        alt={name}
        style={{ ...style, objectFit: 'cover' }}
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <div style={{ ...style, background: 'var(--accent-dim)', color: 'var(--accent)', fontWeight: 700, fontSize: Math.round(size * 0.42) }}>
      {letter}
    </div>
  );
}

// Chat-bubble icon for message results
function MsgIcon({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" fill="none" style={{ flexShrink: 0 }}>
      <rect width="28" height="28" rx="9" fill="var(--panel)" />
      <path
        d="M7 9.5A1.5 1.5 0 0 1 8.5 8h11A1.5 1.5 0 0 1 21 9.5v7a1.5 1.5 0 0 1-1.5 1.5H16l-2 2-2-2H8.5A1.5 1.5 0 0 1 7 16.5v-7Z"
        stroke="var(--muted)"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function UserSearch() {
  const [mode, setMode] = useState<Mode>('general');
  const { query, setQuery, results: userResults, searching: userSearching } = useSearch();

  const [globalResults, setGlobalResults] = useState<GlobalSearchResult | null>(null);
  const [globalLoading, setGlobalLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setActiveChatId     = useChatsStore(s => s.setActiveChatId);
  const setScrollToMessageId = useChatsStore(s => s.setScrollToMessageId);

  const showTabs    = query.trim().length >= 1;
  const showResults = query.trim().length >= 1;

  // ── Global search debounce ─────────────────────────────────────────────────
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < 1 || mode === 'user') {
      setGlobalResults(null);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setGlobalLoading(true);
      try {
        setGlobalResults(await globalSearch(query));
      } catch {
        setGlobalResults(null);
      } finally {
        setGlobalLoading(false);
      }
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, mode]);

  // Reset global results when mode switches to 'user'
  useEffect(() => {
    if (mode === 'user') setGlobalResults(null);
  }, [mode]);

  function clear() {
    setQuery('');
    setGlobalResults(null);
  }

  async function onStartChat(u: User) {
    try {
      const chat = await createDirectChat(u.id);
      useChatsStore.getState().upsertChat(chat);
      setActiveChatId(chat.id);
      clear();
    } catch { /* ignore */ }
  }

  function onOpenChat(chatId: string) {
    setActiveChatId(chatId);
    clear();
  }

  function onOpenMessage(msg: MessageSearchResult) {
    setActiveChatId(msg.chat_id);
    setScrollToMessageId(msg.id);
    clear();
  }

  // ── Derived display sets ───────────────────────────────────────────────────
  const showUsers    = mode === 'general' || mode === 'user';
  const showChats    = mode === 'general';
  const showMessages = mode === 'general' || mode === 'message';

  const displayedUsers    = showUsers    ? userResults                          : [];
  const displayedChats    = showChats    ? (globalResults?.chats    ?? [])     : [];
  const displayedMessages = showMessages ? (globalResults?.messages ?? [])     : [];

  const isLoading = userSearching || globalLoading;

  const hasAny = displayedUsers.length > 0 || displayedChats.length > 0 || displayedMessages.length > 0;

  return (
    <div className="sidebarSearch">
      {/* ── Search input ── */}
      <div className="searchRow">
        <svg className="searchIcon" viewBox="0 0 20 20" fill="none">
          <circle cx="8.5" cy="8.5" r="5.5" stroke="currentColor" strokeWidth="1.6"/>
          <path d="M13.5 13.5L17 17" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
        </svg>
        <input
          className="searchInput"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Поиск…"
        />
        {isLoading && <span className="searchSpinner">…</span>}
        {query && !isLoading && (
          <button className="searchClear" onClick={clear} aria-label="Очистить">
            <svg viewBox="0 0 16 16" fill="none" width="14" height="14">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
            </svg>
          </button>
        )}
      </div>

      {/* ── Mode tabs (appear when query ≥ 2 chars) ── */}
      {showTabs && (
        <div className="searchTabs">
          {TABS.map(tab => (
            <button
              key={tab.id}
              className={`searchTab${mode === tab.id ? ' active' : ''}`}
              onClick={() => setMode(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}

      {/* ── Results ── */}
      {showResults && (
        <div className="searchResults">
          {/* Users section */}
          {showUsers && displayedUsers.length > 0 && (
            <div className="srSection">
              {mode === 'general' && <div className="srLabel">Люди</div>}
              {displayedUsers.map(u => (
                <button key={u.id} className="srItem" onClick={() => onStartChat(u)}>
                  <Avatar user={u} size={34} radius={10} />
                  <div>
                    <div className="srName">{u.display_name || u.username || u.id}</div>
                    {u.username && <div className="srSub">@{u.username}</div>}
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Chats section */}
          {showChats && displayedChats.length > 0 && (
            <div className="srSection">
              <div className="srLabel">Чаты</div>
              {displayedChats.map((c: ChatSearchResult) => (
                <button key={c.id} className="srItem" onClick={() => onOpenChat(c.id)}>
                  <SquareAvatar name={c.name} avatarUrl={c.avatar_url} size={34} />
                  <div>
                    <div className="srName">{c.name}</div>
                    <div className="srSub">{c.type === 'group' ? 'Группа' : (c.partner_username ? `@${c.partner_username}` : 'Личный чат')}</div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Messages section */}
          {showMessages && displayedMessages.length > 0 && (
            <div className="srSection">
              {mode === 'general' && <div className="srLabel">Сообщения</div>}
              {displayedMessages.map((m: MessageSearchResult) => (
                <button key={m.id} className="srMsgItem" onClick={() => onOpenMessage(m)}>
                  <MsgIcon size={34} />
                  <div className="srMsgBody">
                    <div className="srMsgChat">{m.chat_name}</div>
                    <div
                      className="srMsgSnippet"
                      dangerouslySetInnerHTML={{ __html: highlightSnippet(m.text, query.trim()) }}
                    />
                  </div>
                  <div className="srMsgTime">{formatTime(m.created_at)}</div>
                </button>
              ))}
            </div>
          )}

          {/* Empty state */}
          {!isLoading && showResults && !hasAny && (
            <div className="srEmpty">Ничего не найдено</div>
          )}
        </div>
      )}
    </div>
  );
}
