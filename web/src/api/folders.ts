import client from './client';
import { type ChatFolder } from '../types';

export async function getFolders(): Promise<ChatFolder[]> {
  const res = await client.get<ChatFolder[]>('/folders');
  return res.data;
}

export async function createFolder(name: string, emoji: string): Promise<ChatFolder> {
  const res = await client.post<ChatFolder>('/folders', { name, emoji });
  return res.data;
}

export async function updateFolder(id: number, patch: { name?: string; emoji?: string }): Promise<ChatFolder> {
  const res = await client.patch<ChatFolder>(`/folders/${id}`, patch);
  return res.data;
}

export async function deleteFolder(id: number): Promise<void> {
  await client.delete(`/folders/${id}`);
}

export async function addChatToFolder(folderId: number, chatId: string): Promise<ChatFolder> {
  const res = await client.post<ChatFolder>(`/folders/${folderId}/chats`, { chatId });
  return res.data;
}

export async function removeChatFromFolder(folderId: number, chatId: string): Promise<ChatFolder> {
  const res = await client.delete<ChatFolder>(`/folders/${folderId}/chats/${chatId}`);
  return res.data;
}
