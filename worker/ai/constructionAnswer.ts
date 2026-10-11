/**
 * Current construction, answered from the city's Construction Projects page as last stored by the
 * five-minute check. The answer quotes the page's "at a glance" table row by row and says when the
 * page was read, so "right now" questions never get an old summary.
 */
import type { Env } from '../env';
import { findGlance, glanceText } from '../lib/glance';

export { glanceText };
import { latestSnapshot, WATCHED_PAGES } from '../sync/city';

export async function constructionAnswer(env: Env): Promise<{ text: string; followUps: string[] } | null> {
  const snap = await latestSnapshot(env, 'construction');
  const page = WATCHED_PAGES.find((p) => p.id === 'construction')!;
  if (!snap.current) {
    return { text: `The portal has not stored a copy of the city's Construction Projects page yet. The page is ${page.url}`, followUps: ['What projects are funded this year?'] };
  }
  const tables = JSON.parse(String(snap.current.tables_json ?? '[]'));
  const text = glanceText(findGlance(tables), String(snap.current.retrieved_at), String(snap.current.text ?? ''));
  return { text, followUps: ['What projects are funded this year?', 'Show me the city map'] };
}
