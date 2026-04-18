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

/** Permanently delete the current user's account */
export async function deleteAccount(): Promise<void> {
  await client.delete('/users/me');
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
