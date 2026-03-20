/**
 * useSearch
 *
 * Debounced user search hook. Reusable across:
 *   - UserSearch (sidebar) — start a DM
 *   - CreateGroupModal     — pick members
 *   - AddGroupMembersModal — add to existing group
 *
 * Returns raw API results; each consumer filters/transforms as needed.
 */

import { useState, useEffect } from 'react';
import { type User } from '../types';
import { searchUsers } from '../api/users';

interface UseSearchOptions {
  /** Debounce delay in ms. Default: 350 */
  debounce?: number;
}

export function useSearch(opts: UseSearchOptions = {}) {
  const delay = opts.debounce ?? 350;

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<User[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    setError(null);
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        setResults(await searchUsers(query));
      } catch (e: any) {
        setError(e?.message ?? 'Ошибка поиска');
      } finally {
        setSearching(false);
      }
    }, delay);
    return () => clearTimeout(t);
  }, [query, delay]);

  function clear() {
    setQuery('');
    setResults([]);
    setError(null);
  }

  return { query, setQuery, results, searching, error, clear };
}
