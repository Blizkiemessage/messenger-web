/**
 * api/dataAssistant.ts — Этап D: ассистент по данным чатов («второй мозг»).
 *
 * Строго opt-in + платный энтайтлмент. Сервер дешифрует переписку только в
 * памяти, отвечает с обязательными источниками-пруфами (deep-links фронт строит
 * сам из sources).
 */
import client from './client';

export interface DataAssistantStatus {
  /** Фича включена и сконфигурирована на сервере (есть LLM). */
  configured: boolean;
  /** Пользователю выдан платный доступ. */
  entitled: boolean;
  /** Пользователь явно включил ассистента (opt-in). */
  optin: boolean;
  /** Разрешено читать текст сообщений (иначе — только структурные данные). */
  readMessages: boolean;
  /** Доступны все чаты (иначе — только allowChats). */
  scopeAll: boolean;
  /** Allowlist чатов (когда scopeAll=false). */
  allowChats: string[];
}

export interface DataSource {
  kind: 'message' | 'profile';
  chatId: string | null;
  messageId?: string;
  userId?: string;
  label: string;
  snippet: string;
  createdAt?: number;
}

export interface DataAnswer {
  reply: string;
  covered: boolean;
  sources: DataSource[];
  mode: 'structural' | 'semantic' | 'none';
}

export interface DataSettingsPatch {
  optin?: boolean;
  readMessages?: boolean;
  scopeAll?: boolean;
  allowChats?: string[];
}

export async function getDataStatus(): Promise<DataAssistantStatus> {
  return (await client.get<DataAssistantStatus>('/assistant/data/status')).data;
}

export async function updateDataSettings(patch: DataSettingsPatch): Promise<DataAssistantStatus> {
  return (await client.put<DataAssistantStatus>('/assistant/data/settings', patch)).data;
}

export async function askDataAssistant(question: string): Promise<DataAnswer> {
  return (await client.post<DataAnswer>('/assistant/data/ask', { question })).data;
}
