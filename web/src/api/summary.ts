import axios from 'axios';

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
  const { data } = await axios.get<SummaryResult>(`/api/chats/${chatId}/summary`, {
    params: { period, format, _t: Date.now() },
  });
  return data;
}
