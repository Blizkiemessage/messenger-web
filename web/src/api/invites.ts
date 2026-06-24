import client from './client';
import { type Chat } from '../types';

export interface InvitePayload {
  token: string;
  link: string;
  qr: string | null;   // data:image/png;base64,... или null
  used_count: number;
}

export interface InviteInviter {
  id: string;
  username: string | null;
  display_name: string;
  avatar_url: string | null;
}

/** Моя постоянная ссылка-приглашение (создаётся при первом запросе). */
export async function getMyInvite(): Promise<InvitePayload> {
  return (await client.get<InvitePayload>('/invites/me')).data;
}

/** Отозвать старую ссылку и выпустить новую. */
export async function regenerateInvite(): Promise<InvitePayload> {
  return (await client.post<InvitePayload>('/invites/me/regenerate')).data;
}

/** Публично: инфа о пригласившем (для баннера на экране входа). */
export async function resolveInvite(token: string): Promise<{ inviter: InviteInviter }> {
  return (await client.get(`/invites/${encodeURIComponent(token)}/resolve`)).data;
}

/** Принять приглашение (друзья + ЛС). Требует входа. */
export async function acceptInvite(
  token: string,
): Promise<{ self?: boolean; chatId?: string; chat?: Chat; inviter?: InviteInviter }> {
  return (await client.post(`/invites/${encodeURIComponent(token)}/accept`)).data;
}
