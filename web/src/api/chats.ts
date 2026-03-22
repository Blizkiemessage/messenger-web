import client from './client';
import { type Chat, type Message } from '../types';

export async function getChats(): Promise<Chat[]> {
  const res = await client.get<Chat[]>('/chats');
  return res.data;
}

export async function createDirectChat(userId: string): Promise<Chat> {
  if (!userId) throw new Error('userId is required');
  const res = await client.post<Chat>('/chats', { userId });
  return res.data;
}

export async function createGroupChat(payload: {
  name: string;
  memberIds: string[];
  description?: string;
}): Promise<Chat> {
  const res = await client.post<Chat>('/chats/group', payload);
  return res.data;
}

export async function getChatMessages(chatId: string): Promise<Message[]> {
  const res = await client.get<Message[]>(`/chats/${chatId}/messages`);
  return res.data;
}

export async function sendChatMessage(
  chatId: string,
  payload: {
    text?: string;
    attachment_url?: string;
    attachment_type?: string;
    attachment_name?: string;
    attachment_size?: number | null;  // ✅ file size
  },
): Promise<Message> {
  const res = await client.post<Message>(`/chats/${chatId}/messages`, payload);
  return res.data;
}

export async function markChatRead(chatId: string): Promise<{ readAt: number }> {
  const res = await client.post<{ ok: boolean; readAt: number }>(`/chats/${chatId}/read`);
  return res.data;
}

export async function deleteMessages(chatId: string, messageIds: string[]): Promise<string[]> {
  const res = await client.delete<{ ok: boolean; deleted: string[] }>(`/chats/${chatId}/messages`, {
    data: { messageIds },
  });
  return res.data.deleted;
}

/** ✅ Returns closed=true if the requester is the admin (group closed instead of leaving) */
export async function leaveGroup(chatId: string): Promise<{ ok: boolean; closed?: boolean }> {
  const res = await client.post<{ ok: boolean; closed?: boolean }>(`/chats/${chatId}/leave`);
  return res.data;
}

export async function deleteDirectChat(chatId: string): Promise<void> {
  await client.delete(`/chats/${chatId}`);
}

export async function addGroupMember(chatId: string, userId: string): Promise<Chat> {
  const res = await client.post<Chat>(`/chats/${chatId}/members`, { userId });
  return res.data;
}

export async function removeGroupMember(chatId: string, userId: string): Promise<Chat> {
  const res = await client.delete<Chat>(`/chats/${chatId}/members/${userId}`);
  return res.data;
}

export async function updateGroupChat(chatId: string, payload: { name?: string; description?: string }): Promise<Chat> {
  const res = await client.patch<Chat>(`/chats/${chatId}`, payload);
  return res.data;
}

/** ✅ Admin closes the group — no one can send messages anymore */
export async function closeGroup(chatId: string): Promise<void> {
  await client.post(`/chats/${chatId}/close`);
}

/** ✅ Admin transfers admin rights to another member */
export async function transferAdminRights(chatId: string, newAdminId: string): Promise<Chat> {
  const res = await client.post<Chat>(`/chats/${chatId}/transfer-admin`, { newAdminId });
  return res.data;
}

/** ✅ Update group avatar and broadcast system message */
export async function updateGroupAvatar(chatId: string, avatarUrl: string): Promise<Chat> {
  const res = await client.patch<Chat>(`/chats/${chatId}/avatar`, { avatar_url: avatarUrl });
  return res.data;
}
