import client from './client';
import { type User } from '../types';

export async function getMe(): Promise<User> {
  const res = await client.get<User>('/users/me');
  return res.data;
}

export async function updateMe(payload: {
  username?: string | null;
  display_name?: string | null;
  avatar_url?: string | null;
  bio?: string | null;
  birth_date?: string | null;
  hide_bio?: boolean;
  hide_birth_date?: boolean;
  no_group_add?: boolean;
  hide_avatar?: boolean;
  avatar_exceptions?: string;
}): Promise<User> {
  const res = await client.patch<User>('/users/me', payload);
  return res.data;
}

export async function getUserById(id: string): Promise<User> {
  const res = await client.get<User>(`/users/${id}`);
  return res.data;
}

export async function searchUsers(q: string): Promise<User[]> {
  const query = q.trim();
  if (query.length < 2) return [];
  const res = await client.get<User[]>('/users/search', { params: { q: query } });
  return res.data;
}

