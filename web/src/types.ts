export type User = {
  id: string;
  phone?: string | null;
  email?: string | null;
  username?: string | null;
  display_name?: string | null;
  avatar_url?: string | null;
  bio?: string | null;
  birth_date?: string | null;
  hide_email?: boolean;
  hide_bio?: boolean;
  hide_birth_date?: boolean;
  no_group_add?: boolean;
  hide_avatar?: boolean;           // ✅ hide avatar from others
  avatar_exceptions?: string;      // ✅ JSON array of user IDs who can still see it
  hide_last_seen?: boolean;        // ✅ hide last seen time from others
  theme?: 'dark' | 'light';        // ✅ persisted appearance setting
  accent_color?: string;            // ✅ persisted accent color
  created_at?: number;
  last_seen_at?: number | null;
  has_password?: boolean;
  totp_enabled?: boolean;      // ✅ E1: two-factor auth enabled
  // F3: presence intention status
  presence_status?: 'free' | 'busy' | 'dnd' | null;
  presence_note?: string | null;
  presence_expires_at?: number | null;
  is_blocked?: boolean;        // viewer has blocked this user
  blocked_by_them?: boolean;   // this user has blocked the viewer
  alias?: string | null;       // viewer's custom nickname for this user
  role?: 'member' | 'moderator' | 'admin'; // role in a group chat context
};

export type MessageReply = {
  id: string;
  sender_id?: string | null;
  sender_username?: string | null;
  text?: string | null;
};

export type MessageReaction = {
  userId: string;
  emoji: string;
};

export type PollOption = {
  id: string;
  text: string;
  vote_count: number;
  percentage: number;
  voters?: string[] | null; // usernames; null for anonymous polls
};

export type Poll = {
  id: string;
  question: string;
  options: PollOption[];
  allow_multiple: boolean;
  is_anonymous: boolean;
  is_quiz: boolean;
  correct_option_id?: string | null;
  closed_at?: number | null;
  total_votes: number;
  my_votes: string[]; // option IDs this viewer voted for
};

export type Message = {
  id: string;
  chat_id: string;
  sender_id: string;
  text: string;
  created_at: number;
  deleted_at?: number | null;
  edited_at?: number | null;
  attachment_url?: string | null;
  attachment_type?: string | null;
  attachment_name?: string | null;
  attachment_meta?: string | null;
  attachment_size?: number | null;
  attachment_duration?: number | null;
  liked_by?: string[];
  reactions?: MessageReaction[];
  is_system?: boolean;
  is_pinned?: boolean;
  forwarded_from_user_id?: string | null;
  forwarded_from_username?: string | null;
  reply?: MessageReply | null;
  poll_id?: string | null;
  poll?: Poll | null;
  /** F1: when the message is scheduled for delivery (Unix ms). null = immediate. */
  deliver_at?: number | null;
  /** F1: false = pending delivery, true = delivered and visible. */
  is_delivered?: boolean;
  /** Optimistic-send flag: message is in-flight, not yet confirmed by server. */
  _pending?: boolean;
  /** Optimistic-send flag: send failed; user can tap to retry. */
  _error?: boolean;
};

export type Chat = {
  id: string;
  type: 'direct' | 'group' | 'saved';
  name?: string | null;
  description?: string | null;
  avatar_url?: string | null;
  created_at: number;
  members: User[];
  last_message?: Message | null;
  unread_count?: number;
  partner_last_read_at?: number;
  creator_id?: string | null;
  is_closed?: boolean;
  is_pinned?: boolean;
  pin_order?: number | null;
  is_muted?: boolean;
};

export type AuthResponse = {
  /** JWT is now stored in HttpOnly cookie — not returned in body */
  user: User;
  sessionId: string;
  isNew?: boolean;
};

/** @deprecated use AuthResponse */
export type AuthVerifyResponse = AuthResponse;

// ── Stickers & GIF types ─────────────────────────────────────────────────────

export type StickerPack = {
  id: string;
  owner_id: string | null;
  type: 'sticker' | 'emoji';
  name: string;
  description: string | null;
  cover_url: string | null;
  is_public: boolean;
  is_animated: boolean;
  price: number;
  is_deleted: boolean;
  created_at: number;
  updated_at: number;
  // joined fields
  item_count?: number;
  user_sort_order?: number;
  installed_at?: number;
};

export type StickerPackItem = {
  id: string;
  pack_id: string;
  file_url: string;
  thumb_url: string | null;
  emoji_hint: string | null;
  keywords: string[] | null;
  sort_order: number;
  created_at: number;
};

export type UserGif = {
  id: string;
  owner_id: string;
  file_url: string;
  thumb_url: string;
  title: string | null;
  keywords: string[] | null;
  is_public: boolean;
  is_deleted: boolean;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  created_at: number;
};

export type ContentReport = {
  id: string;
  reporter_id: string | null;
  content_type: 'sticker_pack' | 'user_gif';
  content_id: string;
  reason?: string | null;
  resolved: boolean;
  created_at: number;
};

export type UserCreationQuota = {
  user_id: string;
  packs_created: number;
  gifs_created: number;
  free_packs_limit: number;
  free_gifs_limit: number;
  extra_packs: number;
  extra_gifs: number;
};

export type Purchase = {
  id: string;
  user_id: string | null;
  type: 'pack' | 'quota_packs' | 'quota_gifs';
  pack_id?: string | null;
  amount: number;
  created_at: number;
};

// ── E3: WebRTC Calls ──────────────────────────────────────────────────────────

export type CallType = 'audio' | 'video';

export type CallStatus =
  | 'idle'        // No active call
  | 'calling'     // Outgoing call, waiting for callee
  | 'incoming'    // Incoming call, waiting for user to respond
  | 'connecting'  // Call accepted, WebRTC handshake in progress
  | 'active'      // Call connected
  | 'ended';      // Call just ended (shown briefly before resetting to idle)

export type CallRecord = {
  id: string;
  chat_id: string;
  caller_id: string;
  callee_id: string;
  call_type: CallType;
  status: 'pending' | 'active' | 'ended' | 'rejected' | 'missed';
  started_at: number | null;
  ended_at: number | null;
  duration: number | null;
  created_at: number;
  caller_username?: string | null;
  caller_display_name?: string | null;
  callee_username?: string | null;
  callee_display_name?: string | null;
};

// ── GIF (Giphy) ───────────────────────────────────────────────────────────────

export type GifResult = {
  id: string;
  url: string;
  preview: string;
  width: number;
  height: number;
  title: string;
};
