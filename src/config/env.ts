/** Runtime configuration derived from Vite env variables (see .env.example). */
/** The portal always reads the production API; there is no bundled demo dataset. */
export type DataMode = 'api';

function readTimeout(): number {
  const n = Number(import.meta.env.VITE_API_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : 20000;
}

export const config = {
  dataMode: 'api' as DataMode,
  apiBaseUrl: (import.meta.env.VITE_API_BASE_URL ?? '').toString().replace(/\/+$/, ''),
  apiTimeoutMs: readTimeout(),
  siteName: 'Vineyard Transparency Portal',
  primarySourceSeed: 'https://www.vineyardutah.gov/transparency_portal/index.php',
  disclaimer:
    'Vineyard Transparency Portal is an independent public-records project and is not an official website of Vineyard City. Records displayed here originate from publicly available government sources.',
} as const;
