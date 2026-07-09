/**
 * systemEvent.ts — переводит структурные системные сообщения об изменениях в
 * группе (attachment_type === 'system_event') в текст на текущем языке UI.
 * Params (targetName/userName/newAdminName/actorRole) — уже публично видимые
 * всем участникам чата данные (не приватный контент), приходят в plain
 * attachment_meta с бэкенда (см. backend/src/utils/systemEvents.js).
 */
import type { TFunction } from 'i18next';

const KIND_KEY: Record<string, string> = {
  member_removed: 'systemEvent.memberRemoved',
  group_closed: 'systemEvent.groupClosed',
  member_left: 'systemEvent.memberLeft',
  admin_transferred: 'systemEvent.adminTransferred',
  role_promoted: 'systemEvent.rolePromoted',
  role_demoted: 'systemEvent.roleDemoted',
  avatar_changed: 'systemEvent.avatarChanged',
};

interface SystemEventMeta {
  kind?: string;
  actorRole?: string;
  targetName?: string;
  userName?: string;
  newAdminName?: string;
}

/** Возвращает переведённый текст системного сообщения, либо fallback (исходный m.text), если kind неизвестен/meta нет. */
export function renderSystemEventText(t: TFunction, attachmentMeta: string | null | undefined, fallback: string): string {
  if (!attachmentMeta) return fallback;
  let meta: SystemEventMeta;
  try {
    meta = JSON.parse(attachmentMeta);
  } catch {
    return fallback;
  }
  const key = meta.kind ? KIND_KEY[meta.kind] : undefined;
  if (!key) return fallback;
  const actorLabel = meta.actorRole ? t(`chat:systemEvent.roleLabel.${meta.actorRole}`) : undefined;
  return t(`chat:${key}`, { ...meta, actorLabel });
}
