/**
 * Current construction, answered from the city's Construction Projects page as last stored by the
 * five-minute check. The answer quotes the page's "at a glance" table row by row and says when the
 * page was read, so "right now" questions never get an old summary.
 */
import type { Env } from '../env';
import { glanceText } from '../lib/glance';
import { getConstruction } from '../api/construction';

export { glanceText };
import { WATCHED_PAGES } from '../sync/city';

export async function constructionAnswer(env: Env): Promise<{ text: string; followUps: string[] } | null> {
  const page = WATCHED_PAGES.find((p) => p.id === 'construction')!;
  const res = await getConstruction(env);
  const c = (await res.json()) as { available: boolean; asOf?: string; glance?: Parameters<typeof glanceText>[0]; text?: string };
  if (!c.available || !c.asOf) {
    return { text: `The portal has not stored a readable copy of the city's Construction Projects page yet. The page is ${page.url}`, followUps: ['What projects are funded this year?'] };
  }
  return { text: glanceText(c.glance ?? null, c.asOf, c.text ?? ''), followUps: ['What projects are funded this year?', 'Show me the city map'] };
}
