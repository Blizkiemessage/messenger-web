import client from './client';

// ── Типы ──────────────────────────────────────────────────────────────────────

export type ScheduleType = 'daily' | 'weekdays' | 'weekly';
export type OrderMode = 'shuffle' | 'sequential';

export interface DailyPromptConfig {
  exists?: boolean;
  enabled: boolean;
  send_time: number;                 // минут от полуночи (0..1439)
  timezone: string;                  // IANA, напр. 'Europe/Moscow'
  schedule: { type: ScheduleType; days?: number[] }; // days: 0=вс..6=сб
  source: { banks: string[]; use_builtin: boolean | number; use_custom: boolean | number };
  order_mode: OrderMode;
  push_enabled: boolean;
  push_text: string | null;
  last_sent_date?: string | null;
}

export interface DailyPromptBank { id: string; label: string; count: number; }
export interface CustomQuestion { id: string; text: string; sort_order: number; created_by?: string; created_at: number; }

export interface DailyPromptInstance {
  id: string; category: string | null; date_key: string;
  message_id: string | null; answer_count: number; created_at: number; text: string;
}

export interface DailyPromptAnswer {
  id: string; instance_id: string; chat_id: string; user_id: string;
  text: string;
  attachment_url: string | null; attachment_type: string | null; attachment_name: string | null;
  attachment_meta: string | null; attachment_size: number | null; attachment_duration: number | null;
  voice_waveform: string | null; created_at: number;
}

export interface DailyPromptGet {
  config: DailyPromptConfig;
  banks: DailyPromptBank[];
  questions: CustomQuestion[];
  streak: number;
  today: DailyPromptInstance | null;
  canManage: boolean;
}

// ── Конфиг / управление ────────────────────────────────────────────────────────

export async function getDailyPrompt(chatId: string): Promise<DailyPromptGet> {
  const res = await client.get<DailyPromptGet>(`/chats/${chatId}/daily-prompt`);
  return res.data;
}

export async function updateDailyPrompt(
  chatId: string,
  patch: Partial<DailyPromptConfig>,
): Promise<DailyPromptConfig> {
  const res = await client.put<{ config: DailyPromptConfig }>(`/chats/${chatId}/daily-prompt`, patch);
  return res.data.config;
}

export async function addDailyQuestion(chatId: string, text: string): Promise<CustomQuestion> {
  const res = await client.post<CustomQuestion>(`/chats/${chatId}/daily-prompt/questions`, { text });
  return res.data;
}

export async function deleteDailyQuestion(chatId: string, questionId: string): Promise<void> {
  await client.delete(`/chats/${chatId}/daily-prompt/questions/${questionId}`);
}

export async function askDailyNow(chatId: string): Promise<{ message: any }> {
  const res = await client.post<{ message: any }>(`/chats/${chatId}/daily-prompt/ask-now`);
  return res.data;
}

// ── Архив / ответы ──────────────────────────────────────────────────────────────

export async function listDailyInstances(
  chatId: string,
  before?: number,
): Promise<{ items: DailyPromptInstance[]; hasMore: boolean }> {
  const res = await client.get(`/chats/${chatId}/daily-prompt/instances`, {
    params: before ? { before } : undefined,
  });
  return res.data;
}

export async function getDailyThread(
  chatId: string,
  instanceId: string,
): Promise<{ instance: DailyPromptInstance; answers: DailyPromptAnswer[] }> {
  const res = await client.get(`/chats/${chatId}/daily-prompt/instances/${instanceId}`);
  return res.data;
}

export async function addDailyAnswer(
  chatId: string,
  instanceId: string,
  payload: {
    text?: string;
    attachment_url?: string; attachment_type?: string; attachment_name?: string;
    attachment_meta?: string; attachment_size?: number; attachment_duration?: number;
    voice_waveform?: string;
  },
): Promise<{ answer: DailyPromptAnswer; answer_count: number; streak: number }> {
  const res = await client.post(`/chats/${chatId}/daily-prompt/instances/${instanceId}/answers`, payload);
  return res.data;
}

export async function deleteDailyAnswer(chatId: string, answerId: string): Promise<void> {
  await client.delete(`/chats/${chatId}/daily-prompt/answers/${answerId}`);
}
