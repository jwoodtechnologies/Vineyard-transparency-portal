/**
 * The sign-in bot check, browser side. The server hands out a challenge id; the page finds a short
 * nonce so that SHA-256("<id>:<nonce>") begins with the required number of zero bits. It runs while
 * the person types, in small slices so the page never stutters, and nothing is shown or clicked.
 *
 * The hash is written out here (rather than using crypto.subtle) because it is called hundreds of
 * thousands of times and a plain synchronous loop is several times faster than awaiting a promise.
 */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const INIT = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];

const w = new Uint32Array(64);
const h = new Uint32Array(8);

/** Runs the compression function over one 64-byte block held in `block`, updating `h`. */
function compress(block: Uint8Array, offset: number): void {
  for (let i = 0; i < 16; i++) {
    const j = offset + i * 4;
    w[i] = (block[j] << 24) | (block[j + 1] << 16) | (block[j + 2] << 8) | block[j + 3];
  }
  for (let i = 16; i < 64; i++) {
    const a = w[i - 15];
    const b = w[i - 2];
    const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
    const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
    w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
  }
  let a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
  for (let i = 0; i < 64; i++) {
    const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
    const ch = (e & f) ^ (~e & g);
    const t1 = (hh + S1 + ch + K[i] + w[i]) | 0;
    const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
    const maj = (a & b) ^ (a & c) ^ (b & c);
    const t2 = (S0 + maj) | 0;
    hh = g;
    g = f;
    f = e;
    e = (d + t1) | 0;
    d = c;
    c = b;
    b = a;
    a = (t1 + t2) | 0;
  }
  h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
}

/** SHA-256 of any bytes. */
export function sha256(msg: Uint8Array): Uint8Array {
  const padded = new Uint8Array(Math.ceil((msg.length + 9) / 64) * 64);
  padded.set(msg);
  padded[msg.length] = 0x80;
  const bits = msg.length * 8;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bits / 0x100000000));
  view.setUint32(padded.length - 4, bits >>> 0);
  h.set(INIT);
  for (let o = 0; o < padded.length; o += 64) compress(padded, o);
  const out = new Uint8Array(32);
  const ov = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) ov.setUint32(i * 4, h[i] >>> 0);
  return out;
}

const encoder = new TextEncoder();

/**
 * Finds a nonce for the challenge. Messages here are one block (id, colon, short nonce), so each
 * try is a single compression with the nonce written into a reused buffer.
 */
export async function solveProof(id: string, bits: number): Promise<string> {
  const prefix = encoder.encode(`${id}:`);
  const block = new Uint8Array(64);
  block.set(prefix);
  let n = 0;
  let sliceStart = performance.now();
  for (;;) {
    const nonce = n.toString(36);
    const len = prefix.length + nonce.length;
    if (len > 55) throw new Error('Proof of work challenge too long.');
    for (let i = 0; i < nonce.length; i++) block[prefix.length + i] = nonce.charCodeAt(i);
    block[len] = 0x80;
    for (let i = len + 1; i < 62; i++) block[i] = 0;
    const bitLen = len * 8;
    block[62] = bitLen >>> 8;
    block[63] = bitLen & 0xff;
    h.set(INIT);
    compress(block, 0);
    if (Math.clz32(h[0]) >= bits) return nonce;
    n++;
    if ((n & 1023) === 0 && performance.now() - sliceStart > 20) {
      await new Promise<void>((r) => setTimeout(r, 0));
      sliceStart = performance.now();
    }
  }
}

export interface Proof {
  id: string;
  nonce: string;
}

/** Keeps one solved challenge ready, so the sign-in button never waits. */
export function createProofSource(fetchChallenge: () => Promise<{ id: string; bits: number }>) {
  let pending: Promise<Proof> | null = null;
  let startedAt = 0;
  const start = () => {
    startedAt = Date.now();
    const p = (async () => {
      const c = await fetchChallenge();
      return { id: c.id, nonce: await solveProof(c.id, c.bits) };
    })();
    p.catch(() => {
      if (pending === p) pending = null;
    });
    pending = p;
    return p;
  };
  const stale = () => !pending || Date.now() - startedAt > 8 * 60_000;
  return {
    warm(): void {
      if (stale()) start();
    },
    /** A solved challenge, then begins the next one in the background. */
    async take(): Promise<Proof> {
      const p = stale() ? start() : pending!;
      try {
        return await p;
      } finally {
        pending = null;
        setTimeout(() => start(), 0);
      }
    },
  };
}
