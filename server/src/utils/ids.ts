import { createHash, randomBytes } from 'crypto';

export function hashPin(pin: string): string {
  return createHash('sha256').update(pin).digest('hex');
}

export function verifyPin(pin: string, hash: string): boolean {
  return hashPin(pin) === hash;
}

export function generateRoomId(): string {
  const bytes = randomBytes(6);
  const base64 = bytes.toString('base64url').replace(/[^a-zA-Z0-9]/g, '');
  return `room_${base64}`;
}

export function generateUserId(): string {
  const bytes = randomBytes(8);
  return bytes.toString('base64url');
}

export function generateMessageId(): string {
  const bytes = randomBytes(6);
  return bytes.toString('base64url');
}
