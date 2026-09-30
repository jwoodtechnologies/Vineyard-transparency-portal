/** Runtime configuration derived from Vite env variables (see .env.example). */
export type DataMode = 'mock' | 'api';

function readMode(): DataMode {
  const raw = (import.meta.env.VITE_DATA_MODE ?? 'mock').toString().trim().toLowerCase();
  return raw === 'api' ? 'api' : 'mock';
}

function readTimeout(): number {
  const n = Number(import.meta.env.VITE_API_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : 20000;
}

export const config = {
  dataMode: readMode(),
  apiBaseUrl: (import.meta.env.VITE_API_BASE_URL ?? '').toString().replace(/\/+$/, ''),
  apiTimeoutMs: readTimeout(),
  siteName: 'Vineyard Transparency Portal',
  primarySourceSeed: 'https://www.vineyardutah.gov/transparency_portal/index.php',
  disclaimer:
    'Vineyard Transparency Portal is an independent public-records project and is not an official website of Vineyard City. Records displayed here originate from publicly available government sources.',
} as const;
