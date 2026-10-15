import { describe, expect, it } from 'vitest';
import { getStreetviewConfig, streetviewToken } from '../worker/lib/streetview';
import { DEFAULT_GOOGLE_CAP, googleAvailable, googleCap, googleKey, openGoogle } from '../worker/lib/googleSv';
import { testEnv } from './helpers/d1';

const KEY = 'AIzaSyD-test_key_0123456789abcdefghijklm';

describe('street view config route', () => {
  it('serves the token from the Worker variable, trimmed, cached five minutes', async () => {
    const res = await getStreetviewConfig({ ...testEnv(), MAPILLARY_TOKEN: '  MLY|1234567890|abcdef0123456789 \n' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ token: 'MLY|1234567890|abcdef0123456789', google: false });
    expect(res.headers.get('cache-control')).toBe('public, max-age=300');
    expect(res.headers.get('content-type')).toContain('application/json');
  });

  it('answers null when the variable is missing, empty or not a token', async () => {
    for (const v of [undefined, '', '   ', 'has spaces in it ok', '<script>alert(1)</script>', 'x'.repeat(201)]) {
      expect(await (await getStreetviewConfig({ ...testEnv(), MAPILLARY_TOKEN: v })).json()).toEqual({ token: null, google: false });
    }
    expect(streetviewToken(null)).toBeNull();
  });

  it('offers Google only while the key is set and never puts the key in the config', async () => {
    const env = { ...testEnv(), GOOGLE_MAPS_KEY: ` ${KEY} ` };
    const res = await getStreetviewConfig(env);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ token: null, google: true });
    expect(text).not.toContain('AIza');
    expect(await (await getStreetviewConfig({ ...testEnv(), GOOGLE_MAPS_KEY: 'bad key!' })).json()).toMatchObject({ google: false });
    expect(await (await getStreetviewConfig({ ...env, GOOGLE_SV_DAILY_CAP: '0' })).json()).toMatchObject({ google: false });
  });
});

describe('Google Street View daily cap', () => {
  it('reads the cap and the key', () => {
    expect(googleCap(undefined)).toBe(DEFAULT_GOOGLE_CAP);
    expect(DEFAULT_GOOGLE_CAP).toBe(150);
    expect(googleCap(' 40 ')).toBe(40);
    expect(googleCap('0')).toBe(0);
    for (const v of ['', '-3', '1.5', 'many', '99999']) expect(googleCap(v)).toBe(DEFAULT_GOOGLE_CAP);
    expect(googleKey(KEY)).toBe(KEY);
    expect(googleKey('short')).toBeNull();
  });

  it('counts each open, hands out the key, and stops for the day at the cap', async () => {
    const env = { ...testEnv(), GOOGLE_MAPS_KEY: KEY, GOOGLE_SV_DAILY_CAP: '3' };
    const day = new Date('2026-10-15T12:00:00Z');
    for (let i = 1; i <= 3; i++) {
      const r = await openGoogle(env, day);
      expect(r.status).toBe(200);
      expect(await r.json()).toEqual({ key: KEY, used: i, cap: 3 });
    }
    const over = await openGoogle(env, day);
    expect(over.status).toBe(429);
    const body = (await over.json()) as Record<string, unknown>;
    expect(body.error).toBe('cap');
    expect(JSON.stringify(body)).not.toContain('AIza');
    // The config stops offering it today (the count is kept in D1, so every Worker sees it).
    expect(await googleAvailable(env, day)).toBe(false);
    expect(await googleAvailable(env, new Date('2026-10-16T00:00:01Z'))).toBe(true);
    // A new day starts again from one.
    expect(await (await openGoogle(env, new Date('2026-10-16T08:00:00Z'))).json()).toMatchObject({ used: 1 });
  });

  it('refuses to open without a key, and with a cap of 0', async () => {
    await expect(openGoogle({ ...testEnv() })).rejects.toMatchObject({ status: 404 });
    expect((await openGoogle({ ...testEnv(), GOOGLE_MAPS_KEY: KEY, GOOGLE_SV_DAILY_CAP: '0' })).status).toBe(429);
  });
});
