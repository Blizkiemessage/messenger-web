import client from './client';
import { type TenorGif } from '../types';

interface GifPage {
  results: TenorGif[];
  next: string;
}

export async function fetchTrendingGifs(limit = 20, pos = ''): Promise<GifPage> {
  const res = await client.get<GifPage>('/gif/trending', { params: { limit, pos } });
  return res.data;
}

export async function searchGifs(q: string, limit = 20, pos = ''): Promise<GifPage> {
  const res = await client.get<GifPage>('/gif/search', { params: { q, limit, pos } });
  return res.data;
}
