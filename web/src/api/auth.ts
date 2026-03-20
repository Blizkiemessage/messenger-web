import client from './client';
import { type AuthResponse } from '../types';

/** Username-only login (creates account if not exists) */
export async function authLogin(username: string): Promise<AuthResponse> {
  const res = await client.post<AuthResponse>('/auth/login', { username });
  return res.data;
}

/** Login with username + password */
export async function authLoginPassword(username: string, password: string): Promise<AuthResponse> {
  const res = await client.post<AuthResponse>('/auth/login', { username, password });
  return res.data;
}

/** Register a new account with username + password */
export async function authRegister(username: string, password: string): Promise<AuthResponse> {
  const res = await client.post<AuthResponse>('/auth/register', { username, password });
  return res.data;
}

/** Set or change password for the current user */
export async function authSetPassword(
  newPassword: string,
  currentPassword?: string,
): Promise<void> {
  await client.patch('/auth/password', { newPassword, currentPassword });
}

/** Permanently delete the current user's account */
export async function deleteAccount(): Promise<void> {
  await client.delete('/users/me');
}
