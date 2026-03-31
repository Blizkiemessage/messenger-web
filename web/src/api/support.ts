import client from './client';

export async function sendSupportReport(
  subject: string,
  description: string,
  image?: File,
): Promise<void> {
  const form = new FormData();
  form.append('subject', subject);
  form.append('description', description);
  if (image) form.append('image', image);
  await client.post('/support', form);
}
