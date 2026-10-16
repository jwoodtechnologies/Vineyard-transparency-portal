/**
 * The nearest point on any road to a place, for standing the street view camera on the street when its pin
 * lands inside a building. Pure; longitude and latitude in, meters compared.
 */
export type RoadLine = { coords: Array<[number, number]> };

export function nearestRoadPoint(roads: RoadLine[], p: [number, number], maxM: number): [number, number] | null {
  const kx = 111320 * Math.cos((p[1] * Math.PI) / 180);
  const ky = 110540;
  const box = maxM / Math.min(kx, ky);
  let best: { q: [number, number]; d: number } | null = null;
  for (const r of roads) {
    const c = r.coords;
    for (let i = 0; i + 1 < c.length; i++) {
      const a = c[i],
        b = c[i + 1];
      if (Math.max(Math.abs(a[0] - p[0]), Math.abs(b[0] - p[0])) > box * 4 && Math.max(Math.abs(a[1] - p[1]), Math.abs(b[1] - p[1])) > box * 4) continue;
      const ax = (a[0] - p[0]) * kx,
        ay = (a[1] - p[1]) * ky,
        bx = (b[0] - p[0]) * kx,
        by = (b[1] - p[1]) * ky;
      const dx = bx - ax,
        dy = by - ay;
      const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
      const qx = ax + t * dx,
        qy = ay + t * dy;
      const d = Math.hypot(qx, qy);
      if (d <= maxM && (!best || d < best.d)) best = { q: [p[0] + qx / kx, p[1] + qy / ky], d };
    }
  }
  return best?.q ?? null;
}
