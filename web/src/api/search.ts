import client from './client';
import type { User } from '../types';

export type ChatSearchResult = {
  id: string;
  type: 'direct' | 'group';
  name: string;
  avatar_url: string | null;
  partner_id: string | null;
  partner_username: string | null;
};

export type MessageSearchResult = {
  id: string;
  chat_id: string;
  chat_type: 'direct' | 'group';
  chat_name: string;
  text: string;
  sender_display_name: string;
  sender_username: string | null;
  created_at: number;
};

export type GlobalSearchResult = {
  users: User[];
  chats: ChatSearchResult[];
  messages: MessageSearchResult[];
};

export async function globalSearch(q: string): Promise<GlobalSearchResult> {
  const query = q.trim();
  if (query.length < 2) return { users: [], chats: [], messages: [] };
  const res = await client.get<GlobalSearchResult>('/search', { params: { q: query } });
  return res.data;
}
