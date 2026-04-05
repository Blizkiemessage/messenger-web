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
  hide_email?: boolean;
  hide_bio?: boolean;
  hide_birth_date?: boolean;
  no_group_add?: boolean;
  hide_avatar?: boolean;
  avatar_exceptions?: string;
  hide_last_seen?: boolean;
  theme?: string;
  accent_color?: string;
}): Promise<User> {
  const res = await client.patch<User>('/users/me', payload);
  return res.data;
}

export async function getUserById(id: string): Promise<User> {
  const res = await client.get<User>(`/users/${id}`);
  return res.data;
}

/** Step 1: send OTP to new email address */
export async function requestEmailChange(email: string): Promise<{ email: string }> {
  const res = await client.post<{ email: string }>('/users/me/request-email-change', { email });
  return res.data;
}

/** Step 2: verify OTP and update email. Returns updated user. */
export async function verifyEmailChange(email: string, otp: string): Promise<User> {
  const res = await client.post<User>('/users/me/verify-email-change', { email, otp });
  return res.data;
}

export async function searchUsers(q: string): Promise<User[]> {
  const query = q.trim();
  if (query.length < 1) return [];
  const res = await client.get<User[]>('/users/search', { params: { q: query } });
  return res.data;
}

export async function blockUser(id: string): Promise<{ is_blocked: boolean }> {
  const res = await client.post<{ is_blocked: boolean }>(`/users/${id}/block`);
  return res.data;
}

export async function setAlias(id: string, alias: string): Promise<{ alias: string }> {
  const res = await client.post<{ alias: string }>(`/users/${id}/alias`, { alias });
  return res.data;
}

export async function deleteAlias(id: string): Promise<{ alias: null }> {
  const res = await client.delete<{ alias: null }>(`/users/${id}/alias`);
  return res.data;
}
