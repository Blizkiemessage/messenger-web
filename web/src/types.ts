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
  attachment_size?: number | null;
  liked_by?: string[];
  reactions?: MessageReaction[];
  is_system?: boolean;
  is_pinned?: boolean;
  forwarded_from_user_id?: string | null;
  forwarded_from_username?: string | null;
  reply?: MessageReply | null;
  poll_id?: string | null;
  poll?: Poll | null;
};

export type Chat = {
  id: string;
  type: 'direct' | 'group';
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
};

export type AuthResponse = {
  token: string;
  user: User;
  isNew?: boolean;
};

/** @deprecated use AuthResponse */
export type AuthVerifyResponse = AuthResponse;
