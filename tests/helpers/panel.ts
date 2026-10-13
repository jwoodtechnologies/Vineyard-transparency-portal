/** Shared helpers for the private panel tests: a request to the panel, a software passkey, the owner and invited accounts. */
import { expect } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { testEnv } from './d1';
import { PANEL_PREFIX, createInvite, handlePanel } from '../../worker/panel/routes';
import { newSetupCode } from '../../worker/panel/auth';
import { HttpError } from '../../worker/lib/http';

export type TestEnv = ReturnType<typeof testEnv>;
export const ORIGIN = 'https://vineyardportal.org';
export const RP = 'vineyardportal.org';
export const enc = new TextEncoder();
export const b64u = (b: ArrayBuffer | Uint8Array) => {
  let s = '';
  for (const x of b instanceof Uint8Array ? b : new Uint8Array(b)) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

export const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82, 1, 2, 3, 4]);
export const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70]);

export async function pdfWith(text: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([600, 400]);
  page.drawText(text, { x: 40, y: 300, size: 14, font: await doc.embedFont(StandardFonts.Helvetica) });
  return doc.save();
}

/** Calls the handler and turns an HttpError into the response the Worker would send. */
export async function call(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof HttpError) return new Response(JSON.stringify({ error: { message: e.message } }), { status: e.status });
    throw e;
  }
}

export function panel(env: TestEnv, method: string, route: string, opts: { body?: unknown; form?: FormData; cookie?: string; ip?: string } = {}) {
  const headers: Record<string, string> = { 'x-vtp-panel': '1', 'cf-connecting-ip': opts.ip ?? '10.0.0.1' };
  if (opts.cookie) headers.cookie = `vtp_k=${opts.cookie}`;
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  const url = new URL(`${ORIGIN}${PANEL_PREFIX}${route}`);
  return call(() => handlePanel(env, new Request(url, { method, headers, body }), url));
}

export const cookieOf = (r: Response) => /vtp_k=([^;]*)/.exec(r.headers.get('set-cookie') ?? '')?.[1] ?? '';

export function rawToDer(raw: Uint8Array): Uint8Array {
  const int = (b: Uint8Array) => {
    let i = 0;
    while (i < b.length - 1 && b[i] === 0) i++;
    let v = b.slice(i);
    if (v[0] & 0x80) v = new Uint8Array([0, ...v]);
    return new Uint8Array([0x02, v.length, ...v]);
  };
  const r = int(raw.slice(0, 32));
  const s = int(raw.slice(32));
  return new Uint8Array([0x30, r.length + s.length, ...r, ...s]);
}

export async function authData(counter = 0): Promise<Uint8Array> {
  const rp = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(RP)));
  return new Uint8Array([...rp, 0x05, 0, 0, 0, counter]);
}

export interface Device {
  id: string;
  keys: CryptoKeyPair;
}

/** A software authenticator: makes the registration body the panel page would send. */
export async function register(challenge: string, extra: Record<string, unknown> = {}): Promise<{ device: Device; body: Record<string, unknown> }> {
  const keys = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const id = b64u(crypto.getRandomValues(new Uint8Array(20)));
  const clientDataJSON = b64u(enc.encode(JSON.stringify({ type: 'webauthn.create', challenge, origin: ORIGIN })));
  const spki = (await crypto.subtle.exportKey('spki', keys.publicKey)) as ArrayBuffer;
  return { device: { id, keys }, body: { id, clientDataJSON, authenticatorData: b64u(await authData()), publicKey: b64u(spki), alg: -7, name: 'Test', ...extra } };
}

export async function signIn(env: TestEnv, device: Device, ip = '10.0.0.9'): Promise<Response> {
  const { challenge } = (await (await panel(env, 'POST', '/api/passkey/login/options', { body: {}, ip })).json()) as { challenge: string };
  const client = enc.encode(JSON.stringify({ type: 'webauthn.get', challenge, origin: ORIGIN }));
  const ad = await authData();
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', client));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, device.keys.privateKey, new Uint8Array([...ad, ...hash])));
  return panel(env, 'POST', '/api/passkey/login', { body: { id: device.id, clientDataJSON: b64u(client), authenticatorData: b64u(ad), signature: b64u(rawToDer(sig)) }, ip });
}

export async function setupOwner(env: TestEnv): Promise<string> {
  const code = await newSetupCode(env);
  const r = await panel(env, 'POST', '/api/setup', { body: { code, email: 'owner@example.org', password: 'correct horse battery' } });
  expect(r.status).toBe(200);
  return cookieOf(r);
}

export async function addOwnerPasskey(env: TestEnv, cookie: string): Promise<Device> {
  const o = (await (await panel(env, 'POST', '/api/passkey/register/options', { body: {}, cookie })).json()) as { challenge: string };
  const { device, body } = await register(o.challenge);
  const r = await panel(env, 'POST', '/api/passkey/register', { body, cookie });
  expect(r.status, await r.clone().text()).toBe(200);
  return device;
}

/**
 * An uploader invite as the panel made them before new accounts moved to the staff portal. The panel
 * refuses new invites now; links and accounts made earlier keep working, and these tests cover them.
 */
export async function invite(env: TestEnv, ownerCookie: string, name = 'Sam'): Promise<string> {
  expect(ownerCookie).toBeTruthy();
  return (await createInvite(env, { id: 1, name: 'Owner', role: 'owner' }, name, 'uploader')).token;
}

export async function accept(env: TestEnv, token: string, name = 'Sam', ip = '10.0.1.1'): Promise<{ res: Response; device?: Device }> {
  const o = await panel(env, 'POST', '/api/invite/options', { body: { token }, ip });
  if (o.status !== 200) return { res: o };
  const { challenge } = (await o.json()) as { challenge: string };
  const { device, body } = await register(challenge, { token, name });
  return { res: await panel(env, 'POST', '/api/invite/accept', { body, ip }), device };
}

export async function uploaderSession(env: TestEnv, ownerCookie: string, name = 'Sam', ip = '10.0.1.1'): Promise<string> {
  const { res } = await accept(env, await invite(env, ownerCookie, name), name, ip);
  expect(res.status).toBe(200);
  return cookieOf(res);
}

export function fileForm(bytes: Uint8Array, name: string, fields: Record<string, string> = {}): FormData {
  const fd = new FormData();
  fd.append('file', new File([bytes], name));
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return fd;
}
