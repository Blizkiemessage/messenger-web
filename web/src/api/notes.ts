import client from './client';
import type { SharedNote } from '../types';
import i18n from '../i18n';

export async function getChatNotes(chatId: string): Promise<SharedNote[]> {
  const res = await client.get(`/chats/${chatId}/notes`);
  return res.data;
}

export async function createNote(chatId: string, title?: string): Promise<SharedNote> {
  // The backend requires a non-empty title (NOT NULL) and would otherwise
  // fall back to its own hardcoded Russian default — send a localized one
  // from here instead, so a quick "New note" is titled in the UI's language.
  const res = await client.post(`/chats/${chatId}/notes`, { title: title || i18n.t('notes:panel.untitled') });
  return res.data;
}

export async function updateNote(
  chatId: string,
  noteId: string,
  data: { title?: string; content?: string },
): Promise<SharedNote> {
  const res = await client.put(`/chats/${chatId}/notes/${noteId}`, data);
  return res.data;
}

export async function updateNoteSettings(
  chatId: string,
  noteId: string,
  data: {
    edit_mode: 'all' | 'restricted';
    edit_exceptions: string[];
    visibility: 'public' | 'private';
    visibility_exceptions: string[];
  },
): Promise<SharedNote> {
  const res = await client.patch(`/chats/${chatId}/notes/${noteId}/settings`, data);
  return res.data;
}

export async function deleteNote(chatId: string, noteId: string): Promise<void> {
  await client.delete(`/chats/${chatId}/notes/${noteId}`);
}
