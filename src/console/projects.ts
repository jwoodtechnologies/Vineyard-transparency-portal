/** Shapes and labels for GET /api/projects/detail, used by ProjectDetail. */

export interface ProjectVote {
  kind: 'budget' | 'project';
  label: string;
  number: string | null;
  date: string;
  body: string | null;
  result: string;
  documentId: string;
  page: number | null;
  votes: Array<{ member: string; vote: string }>;
}

export interface ProjectDetailData {
  key: string;
  name: string;
  budget: {
    total: number;
    adopted: string;
    documentId: string;
    documentTitle: string;
    lines: Array<{ name: string; fund: string; fundName: string; dept: string; amount: number; page: number }>;
  };
  status: { label: string; completion: string | null; asOf: string; source: 'construction' | 'budget'; sourceUrl: string | null; documentId: string | null };
  votes: ProjectVote[];
  documents: Array<{ id: string; title: string; type: string; typeLabel: string; date: string | null }>;
}

/** Which project: the city's map name, or the exact budget line. */
export type ProjectRef = { gis: string } | { fund: string; name: string };

export function projectDetailUrl(ref: ProjectRef): string {
  const q = new URLSearchParams('gis' in ref ? { gis: ref.gis } : { fund: ref.fund, name: ref.name });
  return `/api/projects/detail?${q.toString()}`;
}

export const VOTE_WORD: Record<string, string> = { yes: 'Yes', no: 'No', abstain: 'Abstained', recused: 'Recused', absent: 'Absent' };
export const ORDER: Record<string, number> = { yes: 0, no: 1, abstain: 2, recused: 3, absent: 4 };
export const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

/** "Jun 23, 2026" from an ISO date; a full timestamp is read in Vineyard time. */
export function dayLabel(iso: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  }
  const t = new Date(iso);
  return Number.isNaN(t.getTime()) ? '' : t.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Denver' });
}

/** "p. 4" or "pages 4 and 5". */
export function pagesLabel(pages: number[]): string {
  const u = [...new Set(pages)].sort((a, b) => a - b);
  if (u.length <= 1) return u.length ? `p. ${u[0]}` : '';
  return `pages ${u.slice(0, -1).join(', ')} and ${u[u.length - 1]}`;
}

/** "Passed 3-1": the count from the named votes, as the voting record shows it. */
export function voteOutcome(v: Pick<ProjectVote, 'result' | 'votes'>): string | null {
  const word = v.result === 'carried' ? 'Passed' : v.result === 'failed' ? 'Failed' : null;
  if (!word) return null;
  const n = (k: string) => v.votes.filter((x) => x.vote === k).length;
  return n('yes') + n('no') >= 2 ? `${word} ${n('yes')}-${n('no')}` : word;
}
