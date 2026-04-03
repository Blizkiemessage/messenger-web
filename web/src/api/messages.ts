import client from './client';
import type { User } from '../types';

export type MessageReader = {
  user: User;
  read_at: number;
};

export async function getMessageReaders(chatId: string, msgId: string): Promise<MessageReader[]> {
  const res = await client.get<MessageReader[]>(`/chats/${chatId}/messages/${msgId}/readers`);
  return res.data;
}
