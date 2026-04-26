import client from './client';
import type { CallRecord } from '../types';

export async function getCallHistory(
  chatId: string,
  limit = 30,
  before?: number,
): Promise<CallRecord[]> {
  const params: Record<string, string | number> = { limit };
  if (before) params.before = before;
  const res = await client.get(`/calls/history/${chatId}`, { params });
  return res.data.calls;
}
