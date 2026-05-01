import client from './client';
import { type Chat, type Message } from '../types';

export async function getChats(): Promise<Chat[]> {
  const res = await client.get<Chat[]>('/chats');
  return res.data;
}

export async function getSavedChat(): Promise<Chat> {
  const res = await client.post<Chat>('/chats/saved');
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

export async function getChatMessages(chatId: string, before?: number): Promise<Message[]> {
  const res = await client.get<Message[]>(`/chats/${chatId}/messages`, {
    params: before ? { before } : undefined,
  });
  return res.data;
}

export async function sendChatMessage(
  chatId: string,
  payload: {
    text?: string;
    attachment_url?: string;
    attachment_type?: string;
    attachment_name?: string;
    attachment_size?: number | null;
    attachment_duration?: number | null;
    attachment_meta?: string | null;
    voice_waveform?: string | null;
    reply?: {
      id: string;
      sender_id?: string | null;
      sender_username?: string | null;
      quoted_text?: string | null;
    } | null;
  },
): Promise<Message> {
  const res = await client.post<Message>(`/chats/${chatId}/messages`, payload);
  return res.data;
}

export async function reactToMessage(
  chatId: string,
  messageId: string,
  emoji: string,
): Promise<{ reactions: Array<{ userId: string; emoji: string }> }> {
  const res = await client.post(`/chats/${chatId}/messages/${messageId}/react2`, { emoji });
  return res.data;
}

export async function markChatRead(chatId: string, readUntil?: number): Promise<{ readAt: number }> {
  const res = await client.post<{ ok: boolean; readAt: number }>(
    `/chats/${chatId}/read`,
    readUntil !== undefined ? { readUntil } : {}
  );
  return res.data;
}

export async function deleteMessages(chatId: string, messageIds: string[], forEveryone: boolean): Promise<string[]> {
  const res = await client.delete<{ ok: boolean; deleted: string[] }>(`/chats/${chatId}/messages`, {
    data: { messageIds, forEveryone },
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

// ── Pin / Unpin ───────────────────────────────────────────────────────────────

export async function getPinnedMessages(chatId: string): Promise<import('../types').Message[]> {
  const res = await client.get(`/chats/${chatId}/messages/pinned`);
  return res.data;
}

export async function pinMessage(chatId: string, messageId: string): Promise<import('../types').Message> {
  const res = await client.post(`/chats/${chatId}/messages/${messageId}/pin`);
  return res.data;
}

export async function unpinMessage(chatId: string, messageId: string): Promise<void> {
  await client.delete(`/chats/${chatId}/messages/${messageId}/pin`);
}

// ✅ NEW: forward messages to a chat
export async function forwardMessages(chatId: string, messageIds: string[]): Promise<import('../types').Message[]> {
  const res = await client.post<import('../types').Message[]>(`/chats/${chatId}/messages/forward`, { messageIds });
  return res.data;
}

export async function pinChat(chatId: string): Promise<{ is_pinned: boolean; pin_order: number | null }> {
  const res = await client.post(`/chats/${chatId}/pin`);
  return res.data;
}

export async function muteChat(chatId: string): Promise<{ is_muted: boolean }> {
  const res = await client.post(`/chats/${chatId}/mute`);
  return res.data;
}

export async function updatePinOrder(orderedChatIds: string[]): Promise<void> {
  await client.post('/chats/pin-order', { orderedChatIds });
}

export async function editMessage(chatId: string, messageId: string, text: string): Promise<import('../types').Message> {
  const res = await client.patch<import('../types').Message>(`/chats/${chatId}/messages/${messageId}`, { text });
  return res.data;
}

// ── E5: Media gallery ─────────────────────────────────────────────────────────

export type MediaTab = 'media' | 'audio' | 'files' | 'stickers' | 'links';

export interface ChatMediaResult {
  items: import('../types').Message[];
  hasMore: boolean;
}

export async function getChatMedia(
  chatId: string,
  tab: MediaTab,
  before?: number,
  limit = 30,
): Promise<ChatMediaResult> {
  const res = await client.get<ChatMediaResult>(`/chats/${chatId}/media`, {
    params: { tab, limit, ...(before !== undefined ? { before } : {}) },
  });
  return res.data;
}

/** ✅ Assign or remove moderator role for a group member (admin only) */
export async function setMemberRole(chatId: string, userId: string, role: 'member' | 'moderator'): Promise<Chat> {
  const res = await client.patch<Chat>(`/chats/${chatId}/members/${userId}/role`, { role });
  return res.data;
}

// ── F1: Scheduled / time-capsule messages ────────────────────────────────────

export type SchedulePayload = {
  text?: string;
  attachment_url?: string;
  attachment_type?: string;
  attachment_name?: string;
  attachment_size?: number | null;
  attachment_duration?: number | null;
  attachment_meta?: string | null;
  reply?: {
    id: string;
    sender_id?: string | null;
    sender_username?: string | null;
    quoted_text?: string | null;
  } | null;
  deliver_at: number; // Unix ms
};

export async function scheduleMessage(chatId: string, payload: SchedulePayload): Promise<import('../types').Message> {
  const res = await client.post<import('../types').Message>(`/chats/${chatId}/messages/scheduled`, payload);
  return res.data;
}

export async function fetchScheduledMessages(chatId: string): Promise<import('../types').Message[]> {
  const res = await client.get<import('../types').Message[]>(`/chats/${chatId}/messages/scheduled`);
  return res.data;
}

export async function cancelScheduledMessage(chatId: string, msgId: string): Promise<void> {
  await client.delete(`/chats/${chatId}/messages/scheduled/${msgId}`);
}

export async function updateScheduledMessage(
  chatId: string,
  msgId: string,
  payload: { text?: string; deliver_at?: number },
): Promise<import('../types').Message> {
  const res = await client.patch<import('../types').Message>(
    `/chats/${chatId}/messages/scheduled/${msgId}`,
    payload,
  );
  return res.data;
}
