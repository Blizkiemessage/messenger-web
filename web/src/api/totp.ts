import client from './client';

export interface TotpSetupResponse {
  secret: string;
  uri: string;
  qrDataUrl: string;
}

export interface TotpConfirmResponse {
  ok: boolean;
  backupCodes: string[];
}

/** Initiate 2FA setup: get QR code, URI and raw secret */
export async function totpSetup(): Promise<TotpSetupResponse> {
  const res = await client.post<TotpSetupResponse>('/totp/setup');
  return res.data;
}

/** Confirm setup: verify code against pending secret, enable 2FA, get backup codes */
export async function totpConfirm(code: string): Promise<TotpConfirmResponse> {
  const res = await client.post<TotpConfirmResponse>('/totp/confirm', { code });
  return res.data;
}

/** Disable 2FA. Requires a valid TOTP code or backup code. */
export async function totpDisable(code: string): Promise<void> {
  await client.delete('/totp/disable', { data: { code } });
}

/** Regenerate backup codes. Requires a valid 6-digit TOTP code. */
export async function totpRegenerateBackup(code: string): Promise<{ backupCodes: string[] }> {
  const res = await client.post<{ backupCodes: string[] }>('/totp/regenerate-backup', { code });
  return res.data;
}
