/**
 * chatArea/useMessageSearch.ts — in-chat message search (open state, query,
 * current match navigation). Fully self-contained: derives matches from the
 * current messages + query and exposes the navigation handlers.
 */
import { useState, useMemo, useCallback } from 'react';
import type { Message } from '../../../types';

export function useMessageSearch(messages: Message[]) {
  const [searchOpen,  setSearchOpen]  = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchIdx,   setSearchIdx]   = useState(0);

  const matchedIds = useMemo<string[]>(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return messages.filter(m => !m.is_system && m.text?.toLowerCase().includes(q)).map(m => m.id);
  }, [messages, searchQuery]);

  const currentMatchId = matchedIds.length > 0 ? matchedIds[searchIdx] : null;

  const handleToggleSearch = useCallback(() => {
    setSearchOpen(v => { if (v) { setSearchQuery(''); setSearchIdx(0); } return !v; });
  }, []);
  const handleSearchChange = useCallback((q: string) => { setSearchQuery(q); setSearchIdx(0); }, []);
  const handleSearchNext   = useCallback(() => setSearchIdx(i => (i + 1) % matchedIds.length), [matchedIds.length]);
  const handleSearchPrev   = useCallback(() => setSearchIdx(i => (i - 1 + matchedIds.length) % matchedIds.length), [matchedIds.length]);
  const handleSearchClose  = useCallback(() => { setSearchOpen(false); setSearchQuery(''); setSearchIdx(0); }, []);

  return {
    searchOpen, searchQuery, searchIdx, matchedIds, currentMatchId,
    handleToggleSearch, handleSearchChange, handleSearchNext, handleSearchPrev, handleSearchClose,
  };
}
