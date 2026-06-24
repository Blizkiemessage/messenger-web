import client from './client';

/** Доступен ли LLM-слой помощника на сервере. */
export async function getAssistantStatus(): Promise<{ aiEnabled: boolean }> {
  return (await client.get<{ aiEnabled: boolean }>('/assistant/status')).data;
}

/**
 * LLM-маршрутизатор: вернуть id подходящего интента из каталога (или null).
 * Каталог — компактный (id+вопрос) из assistant/faq.ts (единый источник).
 */
export async function askAssistant(
  question: string,
  intents: { id: string; question: string }[],
): Promise<{ intentId: string | null }> {
  return (await client.post<{ intentId: string | null }>('/assistant/ask', { question, intents })).data;
}
