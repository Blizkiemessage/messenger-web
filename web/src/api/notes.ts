import client from './client';
import type { SharedNote } from '../types';

export async function getChatNotes(chatId: string): Promise<SharedNote[]> {
  const res = await client.get(`/chats/${chatId}/notes`);
  return res.data;
}

export async function createNote(chatId: string, title?: string): Promise<SharedNote> {
  const res = await client.post(`/chats/${chatId}/notes`, { title: title || 'Заметка' });
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
