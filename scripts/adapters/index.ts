/** Adapter registry: pick by the source's configured adapter id, else by canHandle(url). */
import type { AdapterId } from '../lib/types';
import { StateAuditorAdapter, TransparentUtahAdapter } from './FinancialPortalAdapter';
import { GenericHtmlAdapter } from './GenericHtmlAdapter';
import { MunicipalCodeAdapter } from './MunicipalCodeAdapter';
import { SuiteOneAdapter } from './SuiteOneAdapter';
import { UtahPmnAdapter } from './UtahPmnAdapter';
import type { SourceAdapter } from './types';

export type { AdapterContext, AdapterDiscoveryResult, SourceAdapter } from './types';

export function createAdapters(): SourceAdapter[] {
  // Order matters for canHandle(): specific adapters first, generic last.
  return [
    new SuiteOneAdapter(),
    new UtahPmnAdapter(),
    new TransparentUtahAdapter(),
    new StateAuditorAdapter(),
    new MunicipalCodeAdapter(),
    new GenericHtmlAdapter(),
  ];
}

export function adapterFor(adapters: SourceAdapter[], adapterId: AdapterId | undefined, url: string): SourceAdapter {
  const byId = adapterId ? adapters.find((a) => a.id === adapterId) : undefined;
  if (byId) return byId;
  return adapters.find((a) => a.canHandle(url)) ?? (adapters.find((a) => a.id === 'generic-html') as SourceAdapter);
}
