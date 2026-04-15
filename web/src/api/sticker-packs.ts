import client from './client';
import { type StickerPack, type StickerPackItem, type UserCreationQuota } from '../types';

// ── Browse / install ─────────────────────────────────────────────────────────

export async function browsePublicPacks(params?: {
  q?: string;
  limit?: number;
  offset?: number;
}): Promise<(StickerPack & { is_installed: boolean })[]> {
  const res = await client.get<(StickerPack & { is_installed: boolean })[]>(
    '/sticker-packs/browse',
    { params },
  );
  return res.data;
}

export async function getInstalledPacks(): Promise<StickerPack[]> {
  const res = await client.get<StickerPack[]>('/sticker-packs/installed');
  return res.data;
}

export async function getPackItems(packId: string): Promise<StickerPackItem[]> {
  const res = await client.get<StickerPackItem[]>(`/sticker-packs/${packId}/items`);
  return res.data;
}

export async function installPack(packId: string): Promise<void> {
  await client.post(`/sticker-packs/${packId}/install`);
}

export async function uninstallPack(packId: string): Promise<void> {
  await client.delete(`/sticker-packs/${packId}/install`);
}

export async function reorderPacks(orderedIds: string[]): Promise<void> {
  await client.patch('/sticker-packs/installed/order', { ids: orderedIds });
}

// ── Studio ───────────────────────────────────────────────────────────────────

export async function getMyPacks(): Promise<StickerPack[]> {
  const res = await client.get<StickerPack[]>('/sticker-packs/my');
  return res.data;
}

export async function createPack(data: {
  name: string;
  description?: string;
  type?: 'sticker' | 'emoji';
  is_public?: boolean;
}): Promise<StickerPack> {
  const res = await client.post<StickerPack>('/sticker-packs', data);
  return res.data;
}

export async function updatePack(id: string, data: Partial<Pick<StickerPack, 'name' | 'description' | 'is_public' | 'cover_url'>>): Promise<StickerPack> {
  const res = await client.patch<StickerPack>(`/sticker-packs/${id}`, data);
  return res.data;
}

export async function deletePack(id: string): Promise<void> {
  await client.delete(`/sticker-packs/${id}`);
}

export async function uploadStickerItem(
  packId: string,
  file: File,
  meta: { emoji_hint?: string; keywords?: string },
): Promise<StickerPackItem> {
  const form = new FormData();
  form.append('file', file);
  if (meta.emoji_hint) form.append('emoji_hint', meta.emoji_hint);
  if (meta.keywords)   form.append('keywords',   meta.keywords);
  const res = await client.post<StickerPackItem>(`/sticker-packs/${packId}/items`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return res.data;
}

export async function deleteStickerItem(packId: string, itemId: string): Promise<void> {
  await client.delete(`/sticker-packs/${packId}/items/${itemId}`);
}

export async function updateStickerItem(
  packId: string,
  itemId: string,
  data: { emoji_hint?: string | null },
): Promise<StickerPackItem> {
  const res = await client.patch<StickerPackItem>(`/sticker-packs/${packId}/items/${itemId}`, data);
  return res.data;
}

export async function reorderItems(packId: string, orderedIds: string[]): Promise<void> {
  await client.patch(`/sticker-packs/${packId}/items/order`, { ids: orderedIds });
}

export async function getMyQuota(): Promise<UserCreationQuota> {
  const res = await client.get<UserCreationQuota>('/quota/my');
  return res.data;
}

export async function getPackById(packId: string): Promise<StickerPack & { is_installed: boolean }> {
  const res = await client.get<StickerPack & { is_installed: boolean }>(`/sticker-packs/${packId}`);
  return res.data;
}

export async function uploadPackLogo(packId: string, file: File): Promise<{ cover_url: string }> {
  const form = new FormData();
  form.append('file', file);
  const res = await client.post<{ cover_url: string }>(`/sticker-packs/${packId}/logo`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return res.data;
}
