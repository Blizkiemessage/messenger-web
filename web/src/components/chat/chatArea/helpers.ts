/**
 * chatArea/helpers.ts — pure helpers/constants for ChatArea.
 */

// ── Max chars per message — split at last word boundary ──────────────────────
export const MAX_MSG_CHARS = 4000;

// Stable empty array so the typingUsers selector doesn't create a new reference
// on every render (which would cause an infinite re-render loop).
export const EMPTY_TYPING: string[] = [];

export function splitMessage(text: string): string[] {
  if (text.length <= MAX_MSG_CHARS) return [text];
  const parts: string[] = [];
  let remaining = text;
  while (remaining.length > MAX_MSG_CHARS) {
    // Find last space within the limit
    let cutAt = remaining.lastIndexOf(' ', MAX_MSG_CHARS);
    if (cutAt <= 0) cutAt = MAX_MSG_CHARS; // no space found — hard cut
    parts.push(remaining.slice(0, cutAt));
    remaining = remaining.slice(cutAt).trimStart();
  }
  if (remaining.length > 0) parts.push(remaining);
  return parts;
}
