import { config } from '@/config/env';
import type { DataAdapter } from './DataAdapter';

let adapterPromise: Promise<DataAdapter> | null = null;

/**
 * Returns the active data adapter. The mock adapter (and its demo dataset) is loaded lazily so a
 * production (`api`) build never ships demo records in its main bundle.
 */
export function getAdapter(): Promise<DataAdapter> {
  if (!adapterPromise) {
    adapterPromise =
      config.dataMode === 'api'
        ? import('./ProductionApiAdapter').then((m) => new m.ProductionApiAdapter(config.apiBaseUrl, config.apiTimeoutMs))
        : import('./MockDataAdapter').then((m) => new m.MockDataAdapter());
  }
  return adapterPromise;
}

/** Test hook: replace the adapter (e.g. with a stub). */
export function setAdapterForTesting(adapter: DataAdapter | null): void {
  adapterPromise = adapter ? Promise.resolve(adapter) : null;
}

export type { DataAdapter } from './DataAdapter';
export { DataError, isDataError } from './errors';
