import axios from 'axios';

export type SummaryResult = {
  summary: string;
  messageCount: number;
  fromCache: boolean;
};

export async function getChatSummary(chatId: string): Promise<SummaryResult> {
  const { data } = await axios.get<SummaryResult>(`/api/chats/${chatId}/summary`);
  return data;
}
