import client from './client';
import type { Poll, User } from '../types';

export type CreatePollData = {
  question: string;
  options: { id: string; text: string }[];
  allow_multiple: boolean;
  is_anonymous: boolean;
  is_quiz: boolean;
  correct_option_id?: string | null;
};

export async function createPoll(chatId: string, data: CreatePollData): Promise<{ poll: Poll; message: unknown }> {
  const res = await client.post('/polls', { chat_id: chatId, ...data });
  return res.data;
}

export async function votePoll(pollId: string, optionIds: string[]): Promise<{ poll: Poll }> {
  const res = await client.post(`/polls/${pollId}/vote`, { option_ids: optionIds });
  return res.data;
}

export async function retractVote(pollId: string): Promise<{ poll: Poll }> {
  const res = await client.delete(`/polls/${pollId}/vote`);
  return res.data;
}

export async function getPollVoters(pollId: string, optionId: string): Promise<User[]> {
  const res = await client.get(`/polls/${pollId}/voters/${optionId}`);
  return res.data.voters;
}
