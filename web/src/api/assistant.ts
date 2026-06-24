import client from './client';
import { type AssistantKbItem } from '../assistant/faq';

/** Доступен ли LLM-слой помощника на сервере. */
export async function getAssistantStatus(): Promise<{ aiEnabled: boolean }> {
  return (await client.get<{ aiEnabled: boolean }>('/assistant/status')).data;
}

export interface AssistantAnswer {
  reply: string;
  covered: boolean;
  relatedIds: string[];
}

/**
 * Сгенерировать ответ помощника по базе знаний (LLM). Кнопки-навигации фронт
 * резолвит сам по relatedIds (deep-links всегда валидны).
 */
export async function askAssistant(
  question: string,
  kb: AssistantKbItem[],
): Promise<AssistantAnswer> {
  return (await client.post<AssistantAnswer>('/assistant/ask', { question, kb })).data;
}
