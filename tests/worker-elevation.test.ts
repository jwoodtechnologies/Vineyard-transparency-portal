import { describe, expect, it, vi } from 'vitest';
import { epqsUrl, getElevation, MAX_ELEVATION_POINTS, parseElevationPoints, samplesUrl } from '../worker/lib/elevation';
import { HttpError } from '../worker/lib/http';

const line = (n: number) => Array.from({ length: n }, (_, i) => `${(-111.75 + i * 0.0002).toFixed(5)},40.30500`).join(';');
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const samples = (n: number, value = (i: number) => String(1381.85 + i)) => reply({ samples: Array.from({ length: n }, (_, i) => ({ locationId: i, value: value(i) })) });
const call = (n: number, fetcher: unknown) => getElevation(new URL(`https://x/api/map/elevation?p=${line(n)}`), fetcher as typeof fetch);

describe('elevation proxy', () => {
  it('reads all 50 points in one USGS getSamples request', async () => {
    const fetcher = vi.fn(async () => samples(MAX_ELEVATION_POINTS));
    const res = await call(MAX_ELEVATION_POINTS, fetcher);
    expect(res.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const url = new URL(String((fetcher.mock.calls[0] as unknown[])[0]));
    expect(url.origin + url.pathname).toBe('https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/getSamples');
    expect(JSON.parse(url.searchParams.get('geometry')!).points).toHaveLength(50);
    const body = (await res.json()) as { points: Array<{ elevation: number }> };
    expect(body.points).toHaveLength(50);
    expect(body.points[0].elevation).toBe(1381.85);
    expect(res.headers.get('cache-control')).toBe('public, max-age=86400');
  });

  it('falls back to one point query per point, never more than 50', async () => {
    const fetcher = vi.fn(async (u: string) => (u.startsWith('https://elevation.') ? reply({ error: { code: 500 } }) : reply({ value: '1381.858154297' })));
    const res = await call(MAX_ELEVATION_POINTS, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1 + MAX_ELEVATION_POINTS);
    expect(String((fetcher.mock.calls[1] as unknown[])[0])).toBe(epqsUrl(-111.75, 40.305));
    expect(((await res.json()) as { points: Array<{ elevation: number }> }).points[0].elevation).toBe(1381.86);
  });

  it('refuses more than 50 points without asking USGS anything', async () => {
    const fetcher = vi.fn(async () => samples(51));
    await expect(call(51, fetcher)).rejects.toMatchObject({ status: 400 });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('refuses points outside Vineyard and malformed points', () => {
    expect(() => parseElevationPoints('-74.0,40.7')).toThrow(HttpError);
    expect(() => parseElevationPoints('-111.75')).toThrow(HttpError);
    expect(() => parseElevationPoints('-111.75,40.3,9')).toThrow(HttpError);
    expect(() => parseElevationPoints(null)).toThrow(HttpError);
    expect(parseElevationPoints('-111.7512345,40.3054321')).toEqual([[-111.75123, 40.30543]]);
    expect(samplesUrl([[-111.75, 40.3]])).toContain('geometryType=esriGeometryMultipoint');
  });

  it('leaves out points USGS has no data for, and fails when it answers none', async () => {
    const some = vi.fn(async () => samples(2, (i) => (i ? 'NoData' : '1400')));
    const res = await call(2, some);
    expect(((await res.json()) as { points: Array<{ elevation: number | null }> }).points.map((p) => p.elevation)).toEqual([1400, null]);
    expect(res.headers.get('cache-control')).toBe('public, max-age=300');
    const none = vi.fn(async () => new Response('busy', { status: 503 }));
    await expect(call(2, none)).rejects.toMatchObject({ status: 502 });
  });
});
