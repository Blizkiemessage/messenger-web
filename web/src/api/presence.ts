import client from './client';
import { type User } from '../types';

export type PresenceStatus = 'free' | 'busy' | 'dnd' | null;

export interface SetPresencePayload {
  status: PresenceStatus;
  note?: string | null;
  /** Unix ms timestamp after which the status auto-clears. null = no expiry. */
  expires_at?: number | null;
}

/** Set or clear the current user's presence intention status. */
export async function setPresenceStatus(payload: SetPresencePayload): Promise<User> {
  const res = await client.patch<User>('/users/me/status', payload);
  return res.data;
}
