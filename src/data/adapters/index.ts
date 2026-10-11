import { config } from '@/config/env';
import type { DataAdapter } from './DataAdapter';

let adapterPromise: Promise<DataAdapter> | null = null;

/** Returns the active data adapter: the production API, loaded lazily. */
export function getAdapter(): Promise<DataAdapter> {
  if (!adapterPromise) {
    adapterPromise = import('./ProductionApiAdapter').then((m) => new m.ProductionApiAdapter(config.apiBaseUrl, config.apiTimeoutMs));
  }
  return adapterPromise;
}

/** Test hook: replace the adapter (e.g. with a stub). */
export function setAdapterForTesting(adapter: DataAdapter | null): void {
  adapterPromise = adapter ? Promise.resolve(adapter) : null;
}

export type { DataAdapter } from './DataAdapter';
export { DataError, isDataError } from './errors';
