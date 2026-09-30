import { createHash } from 'node:crypto';

export function sha256Hex(data: Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Short, stable id fragment derived from a string (not a security boundary). */
export function shortId(value: string, length = 16): string {
  return sha256Hex(value).slice(0, length);
}
