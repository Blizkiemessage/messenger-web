import client from './client';
import i18n from '../i18n';

export type SummaryPeriod = 'all' | '1h' | '6h' | '24h' | '3d' | '7d' | '30d' | 'unread';
export type SummaryFormat = 'short' | 'normal' | 'detailed';

export type SummaryResult = {
  summary: string;
  messageCount: number;
  fromCache: boolean;
};

export async function getChatSummary(
  chatId: string,
  period: SummaryPeriod = 'all',
  format: SummaryFormat = 'normal',
): Promise<SummaryResult> {
  // _t busts any browser-level GET cache for this endpoint
  const { data } = await client.get<SummaryResult>(`/chats/${chatId}/summary`, {
    params: { period, format, _t: Date.now() },
  });
  // Guard: if server returned error JSON ({error:...}) with 200, surface it
  if (!data || typeof (data as any).summary !== 'string') {
    const msg = (data as any)?.error || `${i18n.t('modals:aiSummary.unknownError')}: ${JSON.stringify(data)}`;
    throw new Error(msg);
  }
  return data;
}
