import client from './client';
import { type GifResult } from '../types';

export interface GifPage {
  results: GifResult[];
  next: string;  // stringified offset for next page
}

export async function fetchTrendingGifs(limit = 20, offset = 0): Promise<GifPage> {
  const res = await client.get<GifPage>('/gif/trending', { params: { limit, offset } });
  return res.data;
}

export async function searchGifs(q: string, limit = 20, offset = 0): Promise<GifPage> {
  const res = await client.get<GifPage>('/gif/search', { params: { q, limit, offset } });
  return res.data;
}
