import { describe, expect, it } from 'vitest';
import { getStreetviewConfig, streetviewToken } from '../worker/lib/streetview';

describe('street view config route', () => {
  it('serves the token from the Worker variable, trimmed, cached five minutes', async () => {
    const res = getStreetviewConfig({ MAPILLARY_TOKEN: '  MLY|1234567890|abcdef0123456789 \n' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ token: 'MLY|1234567890|abcdef0123456789' });
    expect(res.headers.get('cache-control')).toBe('public, max-age=300');
    expect(res.headers.get('content-type')).toContain('application/json');
  });

  it('answers null when the variable is missing, empty or not a token', async () => {
    for (const v of [undefined, '', '   ', 'has spaces in it ok', '<script>alert(1)</script>', 'x'.repeat(201)]) {
      expect(await getStreetviewConfig({ MAPILLARY_TOKEN: v }).json()).toEqual({ token: null });
    }
    expect(streetviewToken(null)).toBeNull();
  });
});
