import client from './client';
import type { CallRecord, GlobalCallHistoryEntry } from '../types';

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

/** Cross-chat call log — every 1:1 call the current user took part in. */
export async function getGlobalCallHistory(
  limit = 30,
  before?: number,
): Promise<GlobalCallHistoryEntry[]> {
  const params: Record<string, string | number> = { limit };
  if (before) params.before = before;
  const res = await client.get('/calls/history', { params });
  return res.data.calls;
}
