/**
 * useDeepLinkStore — однопунктовая «очередь» текущего действия-перехода.
 * Раннеры (App.tsx — глобальные, ChatArea — чат-привязанные) подписываются на
 * `pending`, исполняют своё и вызывают consume().
 */
import { create } from 'zustand';
import type { DeepLinkAction } from '../deeplinks';

interface DeepLinkState {
  pending: DeepLinkAction | null;
  open: (action: DeepLinkAction) => void;
  consume: () => void;
}

export const useDeepLinkStore = create<DeepLinkState>((set) => ({
  pending: null,
  open: (action) => set({ pending: action }),
  consume: () => set({ pending: null }),
}));
