import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createProofSource, sha256, solveProof } from '../src/console/staff/sha';

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const node = (s: string | Uint8Array) => createHash('sha256').update(s).digest('hex');

describe('browser SHA-256 for the bot check', () => {
  it('matches the standard hash for short, block-edge and long inputs', () => {
    const enc = new TextEncoder();
    for (const s of ['', 'abc', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(63), 'x'.repeat(64), 'x'.repeat(65), 'x'.repeat(1000), 'Vineyard Transparency Portal']) {
      expect(hex(sha256(enc.encode(s)))).toBe(node(s));
    }
    const bytes = new Uint8Array(300).map((_, i) => (i * 37) & 0xff);
    expect(hex(sha256(bytes))).toBe(node(bytes));
  });

  it('finds a nonce the server will accept', async () => {
    const id = 'AbCdEfGhIjKlMnOpQrStUvWx';
    for (const bits of [8, 12, 17]) {
      const nonce = await solveProof(id, bits);
      const digest = createHash('sha256').update(`${id}:${nonce}`).digest();
      let zeros = 0;
      for (const b of digest) {
        if (b === 0) zeros += 8;
        else {
          zeros += Math.clz32(b) - 24;
          break;
        }
      }
      expect(zeros).toBeGreaterThanOrEqual(bits);
      expect(nonce).toMatch(/^[0-9a-z]{1,24}$/);
    }
  });

  it('keeps one solved challenge ready and starts the next after it is used', async () => {
    let issued = 0;
    const source = createProofSource(async () => ({ id: `challenge${String(++issued).padStart(14, '0')}`, bits: 6 }));
    source.warm();
    const a = await source.take();
    expect(a.id).toBe('challenge00000000000001');
    await new Promise((r) => setTimeout(r, 20));
    expect(issued).toBe(2);
    const b = await source.take();
    expect(b.id).not.toBe(a.id);
  });
});
