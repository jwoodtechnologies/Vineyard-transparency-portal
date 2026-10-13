import { describe, expect, it } from 'vitest';
import { EMPTY_NOTICE, checkNotice, draftOf, geometryOf, noticeBody, parseLatLng, pointsOf, whereLine, type NoticeItem } from '../src/console/staff/noticesLib';

const ok = { ...EMPTY_NOTICE, message: 'City Hall is closed Monday.' };
const item = (over: Partial<NoticeItem> = {}): NoticeItem => ({
  id: 'ntc_1',
  tone: 'info',
  message: 'Main Street closed',
  linkUrl: null,
  linkLabel: null,
  startsOn: null,
  endsOn: null,
  shown: true,
  onBar: true,
  place: null,
  status: 'showing',
  createdAt: '2026-10-12T00:00:00Z',
  createdBy: 'Pat',
  updatedAt: '2026-10-12T00:00:00Z',
  updatedBy: 'Pat',
  ...over,
});

describe('notice form checks', () => {
  it('accepts a plain notice for the top bar', () => expect(checkNotice(ok)).toBe(''));

  it('needs somewhere to show', () => {
    expect(checkNotice({ ...ok, onBar: false, onMap: false })).toMatch(/where the notice shows/);
    expect(checkNotice({ ...ok, onBar: false, onMap: true, placeTitle: 'Main Street closed', shape: 'Point', points: [[-111.75, 40.31]] })).toBe('');
  });

  it('asks for a name and enough points when the notice is on the map', () => {
    const onMap = { ...ok, onMap: true, shape: 'LineString' as const };
    expect(checkNotice(onMap)).toMatch(/Name the place/);
    expect(checkNotice({ ...onMap, placeTitle: 'Main Street closed' })).toMatch(/at least 2 points/);
    expect(
      checkNotice({
        ...onMap,
        placeTitle: 'Main Street closed',
        shape: 'Polygon',
        points: [
          [-111.75, 40.31],
          [-111.74, 40.31],
        ],
      }),
    ).toMatch(/at least 3 points/);
    expect(checkNotice({ ...onMap, placeTitle: 'Fireworks', shape: 'Point' })).toMatch(/place the spot/);
    expect(
      checkNotice({
        ...onMap,
        placeTitle: 'Main Street closed',
        points: [
          [-111.75, 40.31],
          [-111.74, 40.31],
        ],
      }),
    ).toBe('');
  });
});

describe('places', () => {
  it('writes a spot, a line and an area as GeoJSON, closing the area', () => {
    const a: [number, number] = [-111.75, 40.31];
    const b: [number, number] = [-111.74, 40.31];
    const c: [number, number] = [-111.74, 40.32];
    expect(geometryOf('Point', [a, b])).toEqual({ type: 'Point', coordinates: a });
    expect(geometryOf('LineString', [a])).toBeNull();
    expect(geometryOf('LineString', [a, b])).toEqual({ type: 'LineString', coordinates: [a, b] });
    expect(geometryOf('Polygon', [a, b, c])).toEqual({ type: 'Polygon', coordinates: [[a, b, c, a]] });
    expect(geometryOf('Polygon', [a, b])).toBeNull();
    expect(geometryOf('Polygon', [a, b], true)).toEqual({ type: 'LineString', coordinates: [a, b] });
  });

  it('reads a stored place back into the same points', () => {
    const a: [number, number] = [-111.75, 40.31];
    const b: [number, number] = [-111.74, 40.31];
    const c: [number, number] = [-111.74, 40.32];
    expect(pointsOf({ type: 'Point', coordinates: a })).toEqual({ shape: 'Point', points: [a] });
    expect(pointsOf({ type: 'LineString', coordinates: [a, b] })).toEqual({ shape: 'LineString', points: [a, b] });
    expect(pointsOf({ type: 'Polygon', coordinates: [[a, b, c, a]] })).toEqual({ shape: 'Polygon', points: [a, b, c] });
  });

  it('sends nothing for the place when the notice is not on the map, and the whole place when it is', () => {
    const line = {
      type: 'LineString' as const,
      coordinates: [
        [-111.75, 40.31],
        [-111.74, 40.31],
      ],
    };
    const placed = item({ place: { title: 'Main Street closed', kind: 'closure', geometry: line }, onBar: false });
    const d = draftOf(placed);
    expect(d).toMatchObject({ onBar: false, onMap: true, placeTitle: 'Main Street closed', placeKind: 'closure', shape: 'LineString' });
    expect(noticeBody(d)).toMatchObject({ onBar: false, place: { title: 'Main Street closed', kind: 'closure', geometry: line } });
    expect(noticeBody({ ...d, onMap: false })).toMatchObject({ place: null });
    expect(noticeBody(draftOf(item()))).toMatchObject({ onBar: true, place: null });
  });

  it('says where a notice shows', () => {
    const geometry = { type: 'Point' as const, coordinates: [-111.75, 40.31] };
    expect(whereLine({ onBar: true, place: null })).toBe('Top of every page');
    expect(whereLine({ onBar: false, place: { title: 'x', kind: 'other', geometry } })).toBe('On the map only');
    expect(whereLine({ onBar: true, place: { title: 'x', kind: 'other', geometry } })).toBe('Top of every page and on the map');
  });
});

describe('typed locations', () => {
  it('reads latitude then longitude in the ways people copy them', () => {
    expect(parseLatLng('40.3085, -111.7517')).toEqual([-111.7517, 40.3085]);
    expect(parseLatLng('40.3085 -111.7517')).toEqual([-111.7517, 40.3085]);
    expect(parseLatLng('  40.3085°, -111.7517° ')).toEqual([-111.7517, 40.3085]);
    expect(parseLatLng('40.30851234567, -111.75171234567')).toEqual([-111.751712, 40.308512]);
  });

  it('refuses anything that is not a place in Vineyard', () => {
    for (const bad of ['', 'Main Street', '40.3085', '40.3085, -111.7517, 5', '-111.7517, 40.3085', '41.9, -111.75', '40.3085, 111.7517']) expect(parseLatLng(bad)).toBeNull();
  });
});
