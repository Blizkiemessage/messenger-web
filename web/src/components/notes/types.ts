/**
 * notes/types.ts — block model for the rich note editor.
 */
export type TextBlock    = { id: string; type: 'text'; text: string };
export type ImageBlock   = { id: string; type: 'image'; url: string; name: string; size?: number };
export type VideoBlock_  = { id: string; type: 'video'; url: string; name: string; size?: number };
export type FileBlock    = { id: string; type: 'file';  url: string; name: string; size?: number };
export type GifBlock     = { id: string; type: 'gif';   url: string };
export type StickerBlock = { id: string; type: 'sticker'; url: string; packId?: string; itemId?: string };
export type NoteBlock    = TextBlock | ImageBlock | VideoBlock_ | FileBlock | GifBlock | StickerBlock;
