/**
 * GET /api/streetview/config → { token }: the Mapillary client token the map's street photo viewer uses,
 * or null when MAPILLARY_TOKEN is not set (the viewer then offers only the 3D street view). The token is a
 * client token meant to be used from browsers; it lives only in the Worker's dashboard variable, never in
 * the repository. Browsers keep the answer five minutes. `google` says whether the Google Street View mode
 * can be opened now (worker/lib/googleSv.ts), and googleState why not; the Google key itself is handed out
 * only when the mode is opened.
 */
import { json } from './http';
import { googleState } from './googleSv';

/** A Mapillary client token: "MLY|" then digits, a bar and hex, or anything else short and plain. */
const TOKEN = /^[A-Za-z0-9|_-]{10,200}$/;

export function streetviewToken(v: string | undefined | null): string | null {
  const t = (v ?? '').trim();
  return TOKEN.test(t) ? t : null;
}

export async function getStreetviewConfig(env: { MAPILLARY_TOKEN?: string; GOOGLE_MAPS_KEY?: string; GOOGLE_SV_DAILY_CAP?: string; CATALOG_DB: D1Database }): Promise<Response> {
  const state = await googleState(env);
  // googleState says why Google is not offered (no-key, key-format, off, cap, storage); never the key.
  return json({ token: streetviewToken(env.MAPILLARY_TOKEN), google: state === 'ok', googleState: state }, { cache: 'public, max-age=300' });
}
