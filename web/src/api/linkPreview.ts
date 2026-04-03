import client from './client';

export type LinkPreview = {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
};

export async function getLinkPreview(url: string): Promise<LinkPreview> {
  const res = await client.get<LinkPreview>('/link-preview', { params: { url } });
  return res.data;
}
