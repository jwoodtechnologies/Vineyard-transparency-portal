import { describe, expect, it } from 'vitest';
import { MAX_VERTICES, readPlace } from '../worker/lib/mapShape';

describe('readPlace', () => {
  it('keeps a point, a line and an area, rounded to six places', () => {
    expect(readPlace({ type: 'Point', coordinates: [-111.7512345678, 40.3098765432] })).toEqual({ type: 'Point', coordinates: [-111.751235, 40.309877] });
    expect(
      readPlace({
        type: 'LineString',
        coordinates: [
          [-111.75, 40.3],
          [-111.74, 40.31],
        ],
      }),
    ).toEqual({
      type: 'LineString',
      coordinates: [
        [-111.75, 40.3],
        [-111.74, 40.31],
      ],
    });
    expect(
      readPlace({
        type: 'Polygon',
        coordinates: [
          [
            [-111.75, 40.3],
            [-111.74, 40.3],
            [-111.74, 40.31],
          ],
        ],
      }),
    ).toEqual({
      type: 'Polygon',
      coordinates: [
        [
          [-111.75, 40.3],
          [-111.74, 40.3],
          [-111.74, 40.31],
          [-111.75, 40.3],
        ],
      ],
    });
  });

  it('drops repeated points and accepts an outline that is already closed', () => {
    expect(
      readPlace({
        type: 'LineString',
        coordinates: [
          [-111.75, 40.3],
          [-111.75, 40.3],
          [-111.74, 40.31],
        ],
      }),
    ).toEqual({
      type: 'LineString',
      coordinates: [
        [-111.75, 40.3],
        [-111.74, 40.31],
      ],
    });
    const closed = readPlace({
      type: 'Polygon',
      coordinates: [
        [
          [-111.75, 40.3],
          [-111.74, 40.3],
          [-111.74, 40.31],
          [-111.75, 40.3],
        ],
      ],
    });
    expect(closed).toMatchObject({ type: 'Polygon' });
    expect((closed as { coordinates: number[][][] }).coordinates[0]).toHaveLength(4);
  });

  it('says what is wrong in a sentence', () => {
    for (const bad of [null, 'x', {}, { type: 'Circle' }, { type: 'Point', coordinates: [] }, { type: 'Point', coordinates: [-111.75, Number.NaN] }, { type: 'Point', coordinates: [0, 0] }]) {
      expect(typeof readPlace(bad)).toBe('string');
    }
    expect(
      readPlace({
        type: 'LineString',
        coordinates: [
          [-111.75, 40.3],
          [-111.75, 40.3],
        ],
      }),
    ).toMatch(/two different points/);
    expect(
      readPlace({
        type: 'Polygon',
        coordinates: [
          [
            [-111.75, 40.3],
            [-111.74, 40.3],
          ],
        ],
      }),
    ).toMatch(/three different points/);
    expect(readPlace({ type: 'Polygon', coordinates: [] })).toMatch(/one outline/);
    expect(readPlace({ type: 'LineString', coordinates: Array.from({ length: MAX_VERTICES + 1 }, (_, i) => [-111.75 + i * 0.0001, 40.3]) })).toMatch(/at most/);
  });
});
