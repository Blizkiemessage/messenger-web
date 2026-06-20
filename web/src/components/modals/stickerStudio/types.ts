import { type StickerPackItem } from '../../../types';

export type StudioTab = 'my-packs' | 'create';
export type WizardStep = 1 | 2 | 3;

export interface PendingItem {
  file: File;
  preview: string;
  emojiHint: string;
  keywords: string;
  uploading: boolean;
  uploaded?: StickerPackItem;
  error?: string;
}
