import {
  startRegistration,
  startAuthentication,
} from '@simplewebauthn/browser';
import apiClient from './client';
import { type User } from '../types';

export interface PasskeyCredential {
  id:          string;
  device_name: string | null;
  created_at:  number;
}

export interface AuthResult {
  user:         User;
  sessionId:    string | null;
  token:        string;
  refreshToken: string;
}

export async function passkeyRegister(deviceName?: string): Promise<string> {
  const optRes  = await apiClient.post('/webauthn/register/options');
  const attResp = await startRegistration({ optionsJSON: optRes.data });
  const verRes  = await apiClient.post('/webauthn/register/verify', {
    response:   attResp,
    deviceName: deviceName ?? null,
  });
  return verRes.data.credentialId as string;
}

export async function passkeyAuthenticate(username?: string): Promise<AuthResult> {
  const optRes  = await apiClient.post('/webauthn/auth/options', { username: username ?? null });
  const assResp = await startAuthentication({ optionsJSON: optRes.data });
  const verRes  = await apiClient.post('/webauthn/auth/verify', { response: assResp });
  return verRes.data as AuthResult;
}

export async function listPasskeys(): Promise<PasskeyCredential[]> {
  const res = await apiClient.get('/webauthn/credentials');
  return res.data as PasskeyCredential[];
}

export async function renamePasskey(id: string, name: string): Promise<void> {
  await apiClient.patch(`/webauthn/credentials/${encodeURIComponent(id)}`, { name });
}

export async function deletePasskey(id: string): Promise<void> {
  await apiClient.delete(`/webauthn/credentials/${encodeURIComponent(id)}`);
}

export function isWebAuthnSupported(): boolean {
  return typeof window !== 'undefined' && !!window.PublicKeyCredential;
}
