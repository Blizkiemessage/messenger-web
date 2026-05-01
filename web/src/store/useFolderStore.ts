import { create } from 'zustand';
import { type ChatFolder } from '../types';
import {
  getFolders,
  createFolder as apiCreate,
  updateFolder as apiUpdate,
  deleteFolder as apiDelete,
  addChatToFolder as apiAddChat,
  removeChatFromFolder as apiRemoveChat,
} from '../api/folders';

interface FolderState {
  folders: ChatFolder[];
  loaded: boolean;

  loadFolders: () => Promise<void>;
  createFolder: (name: string, emoji: string) => Promise<ChatFolder>;
  updateFolder: (id: number, patch: { name?: string; emoji?: string }) => Promise<void>;
  deleteFolder: (id: number) => Promise<void>;
  addChatToFolder: (folderId: number, chatId: string) => Promise<void>;
  removeChatFromFolder: (folderId: number, chatId: string) => Promise<void>;
}

export const useFolderStore = create<FolderState>((set) => ({
  folders: [],
  loaded: false,

  loadFolders: async () => {
    try {
      const folders = await getFolders();
      set({ folders, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },

  createFolder: async (name, emoji) => {
    const folder = await apiCreate(name, emoji);
    set(s => ({ folders: [...s.folders, folder] }));
    return folder;
  },

  updateFolder: async (id, patch) => {
    const folder = await apiUpdate(id, patch);
    set(s => ({ folders: s.folders.map(f => f.id === id ? folder : f) }));
  },

  deleteFolder: async (id) => {
    await apiDelete(id);
    set(s => ({ folders: s.folders.filter(f => f.id !== id) }));
  },

  addChatToFolder: async (folderId, chatId) => {
    const folder = await apiAddChat(folderId, chatId);
    set(s => ({ folders: s.folders.map(f => f.id === folderId ? folder : f) }));
  },

  removeChatFromFolder: async (folderId, chatId) => {
    const folder = await apiRemoveChat(folderId, chatId);
    set(s => ({ folders: s.folders.map(f => f.id === folderId ? folder : f) }));
  },
}));
