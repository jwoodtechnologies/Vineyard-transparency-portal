/**
 * Email-free account recovery. Each person gets a sheet of single-use recovery codes when they finish
 * setting up their account. A code opens the same "set up a new sign-in" step an administrator's reset
 * link opens, so a lost passkey or forgotten password never needs an email service.
 *
 * A code is 16 characters from a 31-character alphabet with no look-alikes (about 79 bits). Only
 * sha256 of the code salted with the person's id is stored, and a code is spent the moment it is used.
 */
import type { Env } from '../env';
import { sha256 } from '../panel/auth';

export const CODES_PER_SET = 8;
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const LENGTH = 16;

/** One random code, drawn without modulo bias. */
function rawCode(): string {
  const limit = 256 - (256 % ALPHABET.length);
  let out = '';
  while (out.length < LENGTH) {
    for (const b of crypto.getRandomValues(new Uint8Array(32))) {
      if (b < limit && out.length < LENGTH) out += ALPHABET[b % ALPHABET.length];
    }
  }
  return out;
}

/** "K7QM-4XWD-9TZC-2HNR": the form people see and print. */
export const formatCode = (raw: string): string => raw.replace(/(.{4})(?=.)/g, '$1-');

/** What a person typed, reduced to the code itself, or null when it cannot be one. */
export function normalizeCode(input: unknown): string | null {
  if (typeof input !== 'string' || input.length > 60) return null;
  const s = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return s.length === LENGTH && [...s].every((c) => ALPHABET.includes(c)) ? s : null;
}

const hashFor = (userId: string, code: string) => sha256(`vtp-recovery:${userId}:${code}`);

/** A fresh sheet of codes: the plain codes to show once, and the statements that replace the old sheet. */
export async function newCodeSet(env: Env, userId: string): Promise<{ codes: string[]; statements: D1PreparedStatement[] }> {
  const raws = Array.from({ length: CODES_PER_SET }, rawCode);
  const now = new Date().toISOString();
  const statements = [env.CATALOG_DB.prepare('DELETE FROM staff_recovery WHERE user_id = ?').bind(userId)];
  for (const r of raws) statements.push(env.CATALOG_DB.prepare('INSERT INTO staff_recovery (code_hash, user_id, created_at) VALUES (?, ?, ?)').bind(await hashFor(userId, r), userId, now));
  return { codes: raws.map(formatCode), statements };
}

export async function codesLeft(env: Env, userId: string): Promise<number> {
  const r = await env.CATALOG_DB.prepare('SELECT count(*) AS n FROM staff_recovery WHERE user_id = ?').bind(userId).first<{ n: number }>();
  return Number(r?.n ?? 0);
}

/** Spends one code. True only for the single request that removed it. */
export async function spendCode(env: Env, userId: string, code: string): Promise<boolean> {
  const row = await env.CATALOG_DB.prepare('DELETE FROM staff_recovery WHERE code_hash = ? AND user_id = ? RETURNING code_hash')
    .bind(await hashFor(userId, code), userId)
    .first();
  return Boolean(row);
}
