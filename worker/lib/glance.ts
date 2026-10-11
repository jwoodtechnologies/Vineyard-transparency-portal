/** Pure helpers for the city's Construction Projects page table (unit-tested). */

export interface GlanceTable {
  heading: string | null;
  headers: string[];
  rows: Array<Record<string, string>>;
}

export type Table = { caption: string | null; heading: string | null; headers: string[]; rows: string[][] };

/** The "AT A GLANCE" table, or failing that the first table with Project and Status columns. */
export function findGlance(tables: Table[]): GlanceTable | null {
  const named = tables.find((t) => /at\s+a\s+glance/i.test(`${t.caption ?? ''} ${t.heading ?? ''}`));
  const t = named ?? tables.find((x) => x.headers.some((h) => /project/i.test(h)) && x.headers.some((h) => /status/i.test(h)));
  if (!t || !t.headers.length) return null;
  const rows = t.rows
    .filter((r) => r.some((c) => c.trim()))
    .map((r) => Object.fromEntries(t.headers.map((h, i) => [h, (r[i] ?? '').trim()])));
  return { heading: t.caption ?? t.heading, headers: t.headers, rows };
}

/** "October 11, 2026" in Vineyard time. */
export function denverDate(iso: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(iso));
}

function pick(row: Record<string, string>, re: RegExp): string {
  const k = Object.keys(row).find((h) => re.test(h));
  return k ? row[k].trim() : '';
}

/** Pure: the answer text for a glance table read at `asOf`. */
export function glanceText(glance: GlanceTable | null, asOf: string, pageText: string): string {
  const head = `As of ${denverDate(asOf)}, the city's Construction Projects page`;
  if (!glance || !glance.rows.length) {
    const first = pageText.split('\n').filter((l) => l.trim()).slice(0, 4).join(' ');
    return `${head} does not have a project table. It reads: ${first.slice(0, 700)}`;
  }
  const lines = glance.rows.map((r) => {
    const project = pick(r, /project/i) || Object.values(r)[0] || '';
    const parts = [project];
    const where = pick(r, /location/i);
    if (where) parts.push(where);
    const status = pick(r, /status/i);
    const done = pick(r, /complet/i);
    const type = pick(r, /type/i);
    return `${parts.join(', ')}${type ? ` (${type})` : ''}: ${[status ? `status ${status}` : '', done ? `expected completion ${done}` : ''].filter(Boolean).join(', ') || 'no status listed'}.`;
  });
  return `${head} lists ${glance.rows.length} project${glance.rows.length === 1 ? '' : 's'}:\n${lines.join('\n')}`;
}

