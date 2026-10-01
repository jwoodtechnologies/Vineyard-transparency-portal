/**
 * The date a resolution or ordinance was adopted, from its own text, in its numbered year.
 * "PASSED AND ADOPTED this 10th day of May, 1989" wins (the last such phrase: the signature block);
 * otherwise "adopted ... May 10, 1989". Null when the text does not say, so a record is never given
 * a made-up day. Mirrors ingest/adapters/municode.py adoption_date.
 */
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const M = MONTHS.join('|');
const DAY_OF = new RegExp(`\\b(\\d{1,2})\\s*(?:st|nd|rd|th)?\\s+day\\s+of\\s+(${M})\\s*,?\\s*(\\d{4})`, 'gi');
const MDY = new RegExp(`\\b(${M})\\s+(\\d{1,2})\\s*(?:st|nd|rd|th)?\\s*,?\\s*(\\d{4})\\b`, 'gi');
const ADOPT = /\b(adopted|passed|approved|dated|effective|signed)\b/i;

function iso(y: string, month: string, d: string): string | null {
  const m = MONTHS.indexOf(month.toLowerCase()) + 1;
  const day = Number(d);
  if (!m || day < 1) return null;
  const dt = new Date(Date.UTC(Number(y), m - 1, day));
  if (dt.getUTCMonth() !== m - 1) return null;
  return dt.toISOString().slice(0, 10);
}

export function adoptionDate(text: string | null | undefined, year: number | null | undefined): string | null {
  if (!text || !year) return null;
  let best: string | null = null;
  for (const m of text.matchAll(DAY_OF)) if (Number(m[3]) === year) best = iso(m[3], m[2], m[1]) ?? best;
  if (best) return best;
  for (const m of text.matchAll(MDY)) {
    const at = m.index ?? 0;
    if (Number(m[3]) === year && ADOPT.test(text.slice(Math.max(0, at - 90), at))) best = iso(m[3], m[1], m[2]) ?? best;
  }
  return best;
}
