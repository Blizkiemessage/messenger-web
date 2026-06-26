/**
 * api/collections.ts — файловые коллекции чата («папки файлов»).
 * Бэкенд: routes/collections.js под /chats/:chatId/collections.
 */
import client from './client';

export interface Collection {
  id: string;
  chat_id: string;
  name: string;
  cover_url: string | null;
  item_count: number;
  created_by: string;
  created_at: number;
  updated_at: number;
}

export interface CollectionItem {
  id: string;
  collection_id: string;
  chat_id: string;
  attachment_url: string;
  attachment_type: string | null;
  attachment_name: string | null;
  attachment_size: number | null;
  attachment_meta: string | null;
  source_message_id: string | null;
  added_by: string;
  added_at: number;
}

export async function listCollections(chatId: string): Promise<Collection[]> {
  const res = await client.get<Collection[]>(`/chats/${chatId}/collections`);
  return res.data;
}

export async function createCollection(chatId: string, name: string): Promise<Collection> {
  const res = await client.post<Collection>(`/chats/${chatId}/collections`, { name });
  return res.data;
}

export async function renameCollection(chatId: string, collectionId: string, name: string): Promise<{ id: string; name: string }> {
  const res = await client.patch<{ id: string; name: string }>(`/chats/${chatId}/collections/${collectionId}`, { name });
  return res.data;
}

export async function deleteCollection(chatId: string, collectionId: string): Promise<void> {
  await client.delete(`/chats/${chatId}/collections/${collectionId}`);
}

export async function getCollectionItems(
  chatId: string,
  collectionId: string,
): Promise<{ collection: { id: string; name: string; created_by: string }; items: CollectionItem[] }> {
  const res = await client.get(`/chats/${chatId}/collections/${collectionId}/items`);
  return res.data;
}

export async function addUploadedItem(
  chatId: string,
  collectionId: string,
  attachment: { attachment_url: string; attachment_type?: string; attachment_name?: string; attachment_size?: number; attachment_meta?: string },
): Promise<CollectionItem> {
  const res = await client.post<CollectionItem>(`/chats/${chatId}/collections/${collectionId}/items`, attachment);
  return res.data;
}

export async function addItemFromMessage(chatId: string, collectionId: string, messageId: string): Promise<CollectionItem> {
  const res = await client.post<CollectionItem>(`/chats/${chatId}/collections/${collectionId}/items/from-message`, { messageId });
  return res.data;
}

export async function removeCollectionItem(chatId: string, collectionId: string, itemId: string): Promise<void> {
  await client.delete(`/chats/${chatId}/collections/${collectionId}/items/${itemId}`);
}
