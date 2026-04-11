import { create } from 'zustand';
import client from '../api/client';
import { type UserGif } from '../types';

interface GifStore {
  myGifs: UserGif[];
  fetchMyGifs: () => Promise<void>;
}

export const useGifStore = create<GifStore>((set) => ({
  myGifs: [],

  fetchMyGifs: async () => {
    const res = await client.get<UserGif[]>('/gif/my');
    set({ myGifs: res.data });
  },
}));
