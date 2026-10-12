/** Browser side of passkeys: create one, or sign in with one. The server does all the checking. */

export const passkeysSupported = (): boolean =>
  typeof window !== 'undefined' && Boolean(window.PublicKeyCredential) && Boolean(navigator.credentials) && typeof AuthenticatorAttestationResponse !== 'undefined' && 'getPublicKey' in AuthenticatorAttestationResponse.prototype;

const toB64 = (buf: ArrayBuffer): string => {
  let s = '';
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const toBuf = (s: string): ArrayBuffer => {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
};

/** A short label so a person can tell their passkeys apart in the list. */
export function deviceName(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android phone';
  if (/Windows/.test(ua)) return 'Windows computer';
  if (/Mac/.test(ua)) return 'Mac';
  if (/CrOS/.test(ua)) return 'Chromebook';
  return 'This device';
}

export interface CreateOptions {
  challenge: string;
  rpId: string;
  userId: string;
  email: string;
  name: string;
  exclude?: string[];
}

export interface PasskeyCreated {
  id: string;
  clientDataJSON: string;
  authenticatorData: string;
  publicKey: string;
  alg: number;
  name: string;
}

/** Turns the browser's refusal messages into plain sentences. */
function explain(e: unknown): Error {
  const name = (e as { name?: string })?.name;
  if (name === 'NotAllowedError' || name === 'AbortError') return new Error('The passkey step was cancelled or timed out. Try again.');
  if (name === 'InvalidStateError') return new Error('This device already has a passkey for your account.');
  if (name === 'NotSupportedError') return new Error('This device or browser cannot make a passkey. Use a password instead.');
  return e instanceof Error ? e : new Error('The passkey step did not work. Try again.');
}

export async function createPasskey(o: CreateOptions): Promise<PasskeyCreated> {
  let cred: Credential | null;
  try {
    cred = await navigator.credentials.create({
      publicKey: {
        challenge: toBuf(o.challenge),
        rp: { name: 'Vineyard Transparency Portal', id: o.rpId },
        user: { id: toBuf(o.userId), name: o.email, displayName: o.name },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },
          { type: 'public-key', alg: -257 },
        ],
        excludeCredentials: (o.exclude ?? []).map((id) => ({ type: 'public-key' as const, id: toBuf(id) })),
        authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
        attestation: 'none',
        timeout: 120_000,
      },
    });
  } catch (e) {
    throw explain(e);
  }
  const pk = cred as PublicKeyCredential | null;
  const r = pk?.response as AuthenticatorAttestationResponse | undefined;
  const key = r?.getPublicKey?.();
  if (!pk || !r || !key) throw new Error('This browser cannot make a passkey. Use a password instead.');
  return {
    id: pk.id,
    clientDataJSON: toB64(r.clientDataJSON),
    authenticatorData: toB64(r.getAuthenticatorData()),
    publicKey: toB64(key),
    alg: r.getPublicKeyAlgorithm(),
    name: deviceName(),
  };
}

export interface PasskeyAnswer {
  id: string;
  clientDataJSON: string;
  authenticatorData: string;
  signature: string;
}

export async function getPasskey(o: { challenge: string; rpId: string }): Promise<PasskeyAnswer> {
  let cred: Credential | null;
  try {
    cred = await navigator.credentials.get({ publicKey: { challenge: toBuf(o.challenge), rpId: o.rpId, userVerification: 'required', timeout: 120_000 } });
  } catch (e) {
    throw explain(e);
  }
  const pk = cred as PublicKeyCredential | null;
  const r = pk?.response as AuthenticatorAssertionResponse | undefined;
  if (!pk || !r) throw new Error('No passkey was chosen.');
  return { id: pk.id, clientDataJSON: toB64(r.clientDataJSON), authenticatorData: toB64(r.authenticatorData), signature: toB64(r.signature) };
}
