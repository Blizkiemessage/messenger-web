import { create } from 'zustand';
import client from '../api/client';
import { type StickerPack, type StickerPackItem } from '../types';

const RECENT_KEY = 'recentStickers';
const RECENT_MAX = 24;

function loadRecent(): StickerPackItem[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown[]) : [];
    // Sanitize: drop any elements that are not proper StickerPackItem objects
    return Array.isArray(parsed)
      ? (parsed.filter((r): r is StickerPackItem => !!r && typeof r === 'object' && typeof (r as StickerPackItem).id === 'string'))
      : [];
  } catch {
    return [];
  }
}

function saveRecent(items: StickerPackItem[]): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(items));
  } catch { /* ignore */ }
}

interface StickerStore {
  installedPacks: StickerPack[];
  packItems: Record<string, StickerPackItem[]>;
  recentStickers: StickerPackItem[];

  /** Installed packs of type 'sticker' only */
  stickerPacks: StickerPack[];
  /** Installed packs of type 'emoji' only */
  emojiPacks: StickerPack[];

  fetchInstalledPacks: (force?: boolean) => Promise<void>;
  fetchPackItems: (packId: string) => Promise<void>;
  installPack: (packId: string) => Promise<void>;
  uninstallPack: (packId: string) => Promise<void>;
  reorderPacks: (orderedIds: string[]) => Promise<void>;
  addRecent: (item: StickerPackItem) => void;
}

// Ensure corrupted localStorage is cleaned up immediately on first load
const _initialRecent = loadRecent();
if (_initialRecent.length === 0) {
  // loadRecent already sanitized; if it was corrupted and returned [], persist the clean state
  try { localStorage.setItem(RECENT_KEY, '[]'); } catch { /* ignore */ }
}

// Module-level dedup: one in-flight promise shared across all callers
let _fetchPacksPromise: Promise<void> | null = null;
let _fetchPacksLastAt = 0;
const FETCH_PACKS_TTL = 30_000; // 30 s — don't re-fetch if already fresh

export const useStickerStore = create<StickerStore>((set, get) => ({
  installedPacks: [],
  packItems: {},
  recentStickers: _initialRecent,
  stickerPacks: [],
  emojiPacks: [],

  fetchInstalledPacks: async (force = false) => {
    const now = Date.now();
    // Skip if a fresh load happened recently (unless forced, e.g. after install)
    if (!force && now - _fetchPacksLastAt < FETCH_PACKS_TTL) return;
    // Deduplicate concurrent calls — all callers await the same promise
    if (_fetchPacksPromise) return _fetchPacksPromise;
    _fetchPacksPromise = (async () => {
      try {
        const res = await client.get<StickerPack[]>('/sticker-packs/installed');
        const packs = Array.isArray(res.data) ? res.data.filter(p => p?.id) : [];
        const stickerPacks = packs.filter(p => p.type === 'sticker');
        const emojiPacks   = packs.filter(p => p.type === 'emoji');
        set({ installedPacks: packs, stickerPacks, emojiPacks });
        _fetchPacksLastAt = Date.now();
        // Pre-fetch emoji pack items so inline emojis resolve immediately
        for (const p of emojiPacks) {
          if (!get().packItems[p.id]) get().fetchPackItems(p.id);
        }
      } finally {
        _fetchPacksPromise = null;
      }
    })();
    return _fetchPacksPromise;
  },

  fetchPackItems: async (packId: string) => {
    if (get().packItems[packId]) return; // already cached
    const res = await client.get<StickerPackItem[]>(`/sticker-packs/${packId}/items`);
    const items = Array.isArray(res.data) ? res.data.filter(it => it?.id) : [];
    set(state => ({ packItems: { ...state.packItems, [packId]: items } }));
  },

  installPack: async (packId: string) => {
    await client.post(`/sticker-packs/${packId}/install`);
    _fetchPacksLastAt = 0; // invalidate TTL so next call always re-fetches
    await get().fetchInstalledPacks(true);
  },

  uninstallPack: async (packId: string) => {
    await client.delete(`/sticker-packs/${packId}/install`);
    set(state => {
      const installedPacks = state.installedPacks.filter(p => p.id !== packId);
      return {
        installedPacks,
        stickerPacks: installedPacks.filter(p => p.type === 'sticker'),
        emojiPacks:   installedPacks.filter(p => p.type === 'emoji'),
      };
    });
  },

  reorderPacks: async (orderedIds: string[]) => {
    await client.patch('/sticker-packs/installed/order', { order: orderedIds });
    const current = get().installedPacks;
    const sorted = [...current].sort(
      (a, b) => orderedIds.indexOf(a.id) - orderedIds.indexOf(b.id),
    );
    set({ installedPacks: sorted });
  },

  addRecent: (item: StickerPackItem) => {
    if (!item?.id) return;
    const prev = get().recentStickers.filter(r => r?.id && r.id !== item.id);
    const next = [item, ...prev].slice(0, RECENT_MAX);
    saveRecent(next);
    set({ recentStickers: next });
  },
}));
