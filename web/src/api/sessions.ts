import client from './client';

export type Session = {
  id: string;
  created_at: number;
  last_used_at: number;
  device: string;
  is_current: boolean;
};

export async function getSessions(): Promise<Session[]> {
  const res = await client.get<Session[]>('/sessions');
  return res.data;
}

export async function revokeSession(sessionId: string): Promise<void> {
  await client.delete(`/sessions/${sessionId}`);
}

export async function revokeAllOtherSessions(): Promise<void> {
  await client.delete('/sessions');
}
