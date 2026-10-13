/** MapLibre for the staff place picker: loaded only when a staff member opens it, so the rest of the staff portal stays light. */
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

type Lib = typeof import('maplibre-gl');
let lib: Promise<Lib> | null = null;

export function loadMapLibre(): Promise<Lib> {
  lib ??= (async () => {
    await import('maplibre-gl/dist/maplibre-gl.css');
    const ml = await import('maplibre-gl');
    ml.setWorkerUrl(workerUrl);
    return ml;
  })().catch((e) => {
    lib = null;
    throw e;
  });
  return lib;
}
