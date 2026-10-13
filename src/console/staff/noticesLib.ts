/** Shapes and small helpers for the staff Notices screen. */

export type NoticeStatus = 'showing' | 'scheduled' | 'ended' | 'hidden';

export type Shape = 'Point' | 'LineString' | 'Polygon';
/** [longitude, latitude], the order GeoJSON uses. */
export type LngLat = [number, number];

export interface NoticeKind {
  key: string;
  label: string;
}

export interface NoticePlace {
  title: string;
  kind: string;
  geometry: { type: Shape; coordinates: unknown };
}

export interface NoticeItem {
  id: string;
  tone: 'info' | 'alert';
  message: string;
  linkUrl: string | null;
  linkLabel: string | null;
  startsOn: string | null;
  endsOn: string | null;
  shown: boolean;
  onBar: boolean;
  place: NoticePlace | null;
  status: NoticeStatus;
  createdAt: string;
  createdBy: string | null;
  updatedAt: string;
  updatedBy: string | null;
}

export const MESSAGE_MAX = 280;

export const STATUS_LABEL: Record<NoticeStatus, string> = { showing: 'Showing now', scheduled: 'Scheduled', ended: 'Ended', hidden: 'Hidden' };

export interface NoticeDraft {
  message: string;
  tone: 'info' | 'alert';
  linkUrl: string;
  linkLabel: string;
  startsOn: string;
  endsOn: string;
  /** Shown in the bar at the top of every page. */
  onBar: boolean;
  /** Drawn on the map. */
  onMap: boolean;
  placeTitle: string;
  placeKind: string;
  shape: Shape;
  points: LngLat[];
}

export const EMPTY_NOTICE: NoticeDraft = {
  message: '',
  tone: 'info',
  linkUrl: '',
  linkLabel: '',
  startsOn: '',
  endsOn: '',
  onBar: true,
  onMap: false,
  placeTitle: '',
  placeKind: 'closure',
  shape: 'LineString',
  points: [],
};

/** The color each kind of placed notice has on the public map. */
export const KIND_COLOR: Record<string, string> = { closure: '#e03131', detour: '#1c7ed6', work: '#e8590c', event: '#ae3ec9', other: '#495057' };
export const DEFAULT_KINDS: NoticeKind[] = [
  { key: 'closure', label: 'Road closure' },
  { key: 'detour', label: 'Detour' },
  { key: 'work', label: 'Construction' },
  { key: 'event', label: 'Event' },
  { key: 'other', label: 'Notice' },
];

export const SHAPE_LABEL: Record<Shape, string> = { Point: 'A spot', LineString: 'A road or path', Polygon: 'An area' };
/** The fewest points each shape needs. */
export const SHAPE_MIN: Record<Shape, number> = { Point: 1, LineString: 2, Polygon: 3 };
export const PLACE_TITLE_MAX = 80;

/** The shape and its points from stored GeoJSON (an area's closing point is left off). */
export function pointsOf(g: NoticePlace['geometry']): { shape: Shape; points: LngLat[] } {
  if (g.type === 'Point') return { shape: 'Point', points: [g.coordinates as LngLat] };
  if (g.type === 'LineString') return { shape: 'LineString', points: g.coordinates as LngLat[] };
  const ring = ((g.coordinates as LngLat[][])[0] ?? []).slice(0, -1);
  return { shape: 'Polygon', points: ring };
}

/** GeoJSON for the points picked so far, or null until there are enough to draw. An unfinished area shows as a line. */
export function geometryOf(shape: Shape, points: LngLat[], partial = false): NoticePlace['geometry'] | null {
  if (shape === 'Point') return points.length ? { type: 'Point', coordinates: points[0] } : null;
  if (shape === 'LineString') return points.length >= 2 ? { type: 'LineString', coordinates: points } : null;
  if (points.length >= 3) return { type: 'Polygon', coordinates: [[...points, points[0]]] };
  return partial && points.length === 2 ? { type: 'LineString', coordinates: points } : null;
}

export const draftOf = (n: NoticeItem): NoticeDraft => {
  const placed = n.place ? pointsOf(n.place.geometry) : null;
  return {
    message: n.message,
    tone: n.tone,
    linkUrl: n.linkUrl ?? '',
    linkLabel: n.linkLabel ?? '',
    startsOn: n.startsOn ?? '',
    endsOn: n.endsOn ?? '',
    onBar: n.onBar,
    onMap: Boolean(n.place),
    placeTitle: n.place?.title ?? '',
    placeKind: n.place?.kind ?? 'closure',
    shape: placed?.shape ?? 'LineString',
    points: placed?.points ?? [],
  };
};

/** What the server takes for a notice, from the form. */
export function noticeBody(d: NoticeDraft): Record<string, unknown> {
  const geometry = d.onMap ? geometryOf(d.shape, d.points) : null;
  return {
    message: d.message,
    tone: d.tone,
    linkUrl: d.linkUrl,
    linkLabel: d.linkLabel,
    startsOn: d.startsOn,
    endsOn: d.endsOn,
    onBar: d.onBar,
    place: geometry ? { title: d.placeTitle, kind: d.placeKind, geometry } : null,
  };
}

/** Vineyard and a little around it: [west, south, east, north]. The server checks the same box. */
export const PLACE_BOUNDS: readonly [number, number, number, number] = [-111.83, 40.24, -111.64, 40.38];

/** "40.3085, -111.7517" (latitude first, as maps and phones write it) as a point, or null when it is not a place in Vineyard. */
export function parseLatLng(text: string): LngLat | null {
  const nums = text.replace(/[°]/g, ' ').match(/-?\d+(?:\.\d+)?/g);
  if (!nums || nums.length !== 2) return null;
  const [lat, lng] = nums.map(Number);
  const [w, s, e, n] = PLACE_BOUNDS;
  if (lng < w || lng > e || lat < s || lat > n) return null;
  return [Math.round(lng * 1e6) / 1e6, Math.round(lat * 1e6) / 1e6];
}

/** Where a notice shows, in words. */
export function whereLine(n: Pick<NoticeItem, 'onBar' | 'place'>): string {
  if (n.onBar && n.place) return 'Top of every page and on the map';
  return n.place ? 'On the map only' : 'Top of every page';
}

/** The same checks the server makes. Empty means fine. */
export function checkNotice(d: NoticeDraft): string {
  const message = d.message.replace(/\s+/g, ' ').trim();
  if (!message) return 'Write the notice.';
  if (message.length > MESSAGE_MAX) return `Keep the notice under ${MESSAGE_MAX} characters.`;
  const link = d.linkUrl.trim();
  if (link) {
    try {
      const u = new URL(link.includes('://') ? link : `https://${link}`);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') return 'That web address does not look right.';
    } catch {
      return 'That web address does not look right.';
    }
  }
  if (d.startsOn && d.endsOn && d.endsOn < d.startsOn) return 'The last day is before the first day.';
  if (!d.onBar && !d.onMap) return 'Choose where the notice shows: the top of every page, the map, or both.';
  if (d.onMap) {
    if (!d.placeTitle.trim()) return 'Name the place, such as "Main Street closed".';
    if (d.points.length < SHAPE_MIN[d.shape]) {
      return d.shape === 'Point' ? 'Tap the map to place the spot.' : `Tap the map to add at least ${SHAPE_MIN[d.shape]} points.`;
    }
  }
  return '';
}

/** "Shows Oct 12 to Oct 14", "Shows from Oct 12", "Shows until Oct 14" or "No end date". */
export function whenLine(n: Pick<NoticeItem, 'startsOn' | 'endsOn'>, day: (iso: string) => string): string {
  if (n.startsOn && n.endsOn) return n.startsOn === n.endsOn ? `Shows ${day(n.startsOn)} only` : `Shows ${day(n.startsOn)} to ${day(n.endsOn)}`;
  if (n.startsOn) return `Shows from ${day(n.startsOn)}`;
  if (n.endsOn) return `Shows until ${day(n.endsOn)}`;
  return 'No end date';
}
