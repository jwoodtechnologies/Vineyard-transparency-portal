/**
 * GET /api/streetview/config → { token }: the Mapillary client token the map's street photo viewer uses,
 * or null when MAPILLARY_TOKEN is not set (the viewer then offers only the 3D street view). The token is a
 * client token meant to be used from browsers; it lives only in the Worker's dashboard variable, never in
 * the repository. Browsers keep the answer five minutes.
 */
import { json } from './http';

/** A Mapillary client token: "MLY|" then digits, a bar and hex, or anything else short and plain. */
const TOKEN = /^[A-Za-z0-9|_-]{10,200}$/;

export function streetviewToken(v: string | undefined | null): string | null {
  const t = (v ?? '').trim();
  return TOKEN.test(t) ? t : null;
}

export function getStreetviewConfig(env: { MAPILLARY_TOKEN?: string }): Response {
  return json({ token: streetviewToken(env.MAPILLARY_TOKEN) }, { cache: 'public, max-age=300' });
}
