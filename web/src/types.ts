export type User = {
  id: string;
  phone?: string | null;
  email?: string | null;
  username?: string | null;
  display_name?: string | null;
  avatar_url?: string | null;
  bio?: string | null;
  birth_date?: string | null;
  hide_bio?: boolean;
  hide_birth_date?: boolean;
  no_group_add?: boolean;
  created_at?: number;
  last_seen_at?: number | null;
  has_password?: boolean;
};

export type Message = {
  id: string;
  chat_id: string;
  sender_id: string;
  text: string;
  created_at: number;
  deleted_at?: number | null;
  attachment_url?: string | null;
  attachment_type?: string | null;
  attachment_name?: string | null;
  attachment_size?: number | null;
  liked_by?: string[];
  is_system?: boolean;
};

export type Chat = {
  id: string;
  type: 'direct' | 'group';
  name?: string | null;
  description?: string | null;
  avatar_url?: string | null;   // ✅ group avatar
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
