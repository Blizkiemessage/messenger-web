import client from './client';
import { type AuthResponse } from '../types';

/** Login with username or email + password */
export async function authLoginPassword(login: string, password: string): Promise<AuthResponse> {
  const res = await client.post<AuthResponse>('/auth/login', { login, password });
  return res.data;
}

/** Step 1: initiate email-verified registration. Returns { email } on success. */
export async function authRegister(
  username: string,
  email: string,
  password: string,
): Promise<{ email: string }> {
  const res = await client.post<{ email: string }>('/auth/register', { username, email, password });
  return res.data;
}

/** Step 2: verify OTP and complete registration. Returns full AuthResponse. */
export async function authVerifyEmail(email: string, otp: string): Promise<AuthResponse> {
  const res = await client.post<AuthResponse>('/auth/verify-email', { email, otp });
  return res.data;
}

/** Set or change password for the current user */
export async function authSetPassword(
  newPassword: string,
  currentPassword?: string,
): Promise<void> {
  await client.patch('/auth/password', { newPassword, currentPassword });
}

/** Log out: clears the HttpOnly session cookie on the server */
export async function authLogout(): Promise<void> {
  await client.post('/auth/logout');
}

/** Permanently delete the current user's account — requires password (+ TOTP/backup code if 2FA is enabled) */
export async function deleteAccount(password: string, code?: string): Promise<void> {
  await client.delete('/users/me', { data: { password, code } });
}

/** Send a password reset link to the given email */
export async function authForgotPassword(email: string): Promise<{ sent: boolean }> {
  const res = await client.post<{ sent: boolean }>('/auth/forgot-password', { email });
  return res.data;
}

/** Verify reset token and set a new password */
export async function authResetPassword(
  id: string,
  token: string,
  newPassword: string,
): Promise<void> {
  await client.post('/auth/reset-password', { id, token, newPassword });
}

/**
 * Exchange a refresh token for a new short-lived access token.
 * Sends the refresh token in the body so cross-origin (Vercel → Amvera)
 * deployments work even when browsers block the HttpOnly refresh cookie.
 */
export async function authRefresh(refreshToken: string): Promise<{ token: string }> {
  const res = await client.post<{ token: string }>('/auth/refresh', { refreshToken });
  return res.data;
}

/**
 * Second step of login when 2FA is enabled.
 * pendingToken is the short-lived JWT returned by /auth/login in the response body.
 * Sending it in the body avoids cross-origin third-party cookie blocking
 * (Chrome incognito / Privacy Sandbox) that breaks the old cookie-based flow.
 * code can be a 6-digit TOTP code or a backup code (XXXXXX-XXXXXX).
 */
export async function authTotpVerify(code: string, pendingToken: string): Promise<AuthResponse> {
  const res = await client.post<AuthResponse>('/auth/totp-verify', { code, pendingToken });
  return res.data;
}
