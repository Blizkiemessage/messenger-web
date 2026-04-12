import { create } from 'zustand';
import client from '../api/client';
import { type StickerPack, type StickerPackItem } from '../types';

const RECENT_KEY = 'recentStickers';
const RECENT_MAX = 24;

function loadRecent(): StickerPackItem[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? (JSON.parse(raw) as StickerPackItem[]) : [];
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

  fetchInstalledPacks: () => Promise<void>;
  fetchPackItems: (packId: string) => Promise<void>;
  installPack: (packId: string) => Promise<void>;
  uninstallPack: (packId: string) => Promise<void>;
  reorderPacks: (orderedIds: string[]) => Promise<void>;
  addRecent: (item: StickerPackItem) => void;
}

export const useStickerStore = create<StickerStore>((set, get) => ({
  installedPacks: [],
  packItems: {},
  recentStickers: loadRecent(),

  fetchInstalledPacks: async () => {
    const res = await client.get<StickerPack[]>('/sticker-packs/installed');
    set({ installedPacks: Array.isArray(res.data) ? res.data.filter(p => p?.id) : [] });
  },

  fetchPackItems: async (packId: string) => {
    if (get().packItems[packId]) return; // already cached
    const res = await client.get<StickerPackItem[]>(`/sticker-packs/${packId}/items`);
    const items = Array.isArray(res.data) ? res.data.filter(it => it?.id) : [];
    set(state => ({ packItems: { ...state.packItems, [packId]: items } }));
  },

  installPack: async (packId: string) => {
    await client.post(`/sticker-packs/${packId}/install`);
    await get().fetchInstalledPacks();
  },

  uninstallPack: async (packId: string) => {
    await client.delete(`/sticker-packs/${packId}/install`);
    set(state => ({
      installedPacks: state.installedPacks.filter(p => p.id !== packId),
    }));
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
    const prev = get().recentStickers.filter(r => r.id !== item.id);
    const next = [item, ...prev].slice(0, RECENT_MAX);
    saveRecent(next);
    set({ recentStickers: next });
  },
}));
