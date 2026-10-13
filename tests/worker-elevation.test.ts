import { describe, expect, it, vi } from 'vitest';
import { epqsUrl, getElevation, MAX_ELEVATION_POINTS, parseElevationPoints } from '../worker/lib/elevation';
import { HttpError } from '../worker/lib/http';

const line = (n: number) => Array.from({ length: n }, (_, i) => `${(-111.75 + i * 0.0002).toFixed(5)},40.30500`).join(';');
const usgs = (value: unknown) => new Response(JSON.stringify({ location: {}, value }), { status: 200, headers: { 'content-type': 'application/json' } });

describe('elevation proxy', () => {
  it('reads each point from the USGS point service, at most 50 per call', async () => {
    const fetcher = vi.fn(async () => usgs('1381.858154297'));
    const res = await getElevation(new URL(`https://x/api/map/elevation?p=${line(MAX_ELEVATION_POINTS)}`), fetcher as unknown as typeof fetch);
    expect(res.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(50);
    expect(String((fetcher.mock.calls[0] as unknown[])[0])).toBe(epqsUrl(-111.75, 40.305));
    const body = (await res.json()) as { points: Array<{ elevation: number }> };
    expect(body.points).toHaveLength(50);
    expect(body.points[0].elevation).toBe(1381.86);
    expect(res.headers.get('cache-control')).toBe('public, max-age=86400');
  });

  it('refuses more than 50 points without asking USGS anything', async () => {
    const fetcher = vi.fn(async () => usgs(1));
    await expect(getElevation(new URL(`https://x/api/map/elevation?p=${line(51)}`), fetcher as unknown as typeof fetch)).rejects.toMatchObject({ status: 400 });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('refuses points outside Vineyard and malformed points', () => {
    expect(() => parseElevationPoints('-74.0,40.7')).toThrow(HttpError);
    expect(() => parseElevationPoints('-111.75')).toThrow(HttpError);
    expect(() => parseElevationPoints('-111.75,40.3,9')).toThrow(HttpError);
    expect(() => parseElevationPoints(null)).toThrow(HttpError);
    expect(parseElevationPoints('-111.7512345,40.3054321')).toEqual([[-111.75123, 40.30543]]);
  });

  it('leaves out points USGS has no data for, and fails when it answers none', async () => {
    let n = 0;
    const some = vi.fn(async () => (n++ ? usgs(-1000000) : usgs(1400)));
    const res = await getElevation(new URL(`https://x/api/map/elevation?p=${line(2)}`), some as unknown as typeof fetch);
    const body = (await res.json()) as { points: Array<{ elevation: number | null }> };
    expect(body.points.map((p) => p.elevation)).toEqual([1400, null]);
    expect(res.headers.get('cache-control')).toBe('public, max-age=300');
    const none = vi.fn(async () => new Response('busy', { status: 503 }));
    await expect(getElevation(new URL(`https://x/api/map/elevation?p=${line(2)}`), none as unknown as typeof fetch)).rejects.toMatchObject({ status: 502 });
  });
});
