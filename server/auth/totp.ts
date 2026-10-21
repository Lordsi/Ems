import * as OTPAuth from 'otpauth';
import QRCode from 'qrcode';

function totp(secretBase32: string, label = 'user', issuer = 'EMS') {
  return new OTPAuth.TOTP({ issuer, label, algorithm: 'SHA1', digits: 6, period: 30, secret: OTPAuth.Secret.fromBase32(secretBase32) });
}

export function generateTotpSecret(): string {
  return new OTPAuth.Secret({ size: 20 }).base32;
}

export async function totpEnrollment(secretBase32: string, label: string, issuer: string) {
  const uri = totp(secretBase32, label, issuer).toString();
  const qrDataUrl = await QRCode.toDataURL(uri, { margin: 1, width: 220 });
  return { uri, qrDataUrl };
}

export function verifyTotp(secretBase32: string, code: string): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  return totp(secretBase32).validate({ token: code, window: 1 }) !== null;
}

export function currentTotp(secretBase32: string): string {
  return totp(secretBase32).generate();
}
