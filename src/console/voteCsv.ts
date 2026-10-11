/** The vote sheet as CSV rows: one row per motion, with each member's recorded vote (blank when none is recorded). */
import type { CsvValue } from './csv';
import { cellMark, motionTally, STATUS_WORD, type Mark, type Seat, type SheetRow } from './votes';

const MARK_WORD: Record<Mark, string> = {
  yes: 'Yes',
  no: 'No',
  abstain: 'Abstained',
  recused: 'Recused',
  absent: 'Absent',
  unseated: '',
  nonvoting: '',
  unrecorded: '',
};

const lower = (s: string) => s.toLowerCase();

export function voteCsvRows(rows: SheetRow[], seats: Seat[], mayor: string | null): CsvValue[][] {
  const head: CsvValue[] = ['Date', 'Body', 'Title', 'Number', 'Result', 'Tally', ...seats.map((s) => s.name)];
  const body = rows
    .filter((r) => !r.pending && !r.canceled)
    .map((r): CsvValue[] => [
      (r.m.date ?? '').slice(0, 10),
      r.m.bodyName ?? r.m.bodyId ?? '',
      r.full || r.title,
      r.m.refs.join('; '),
      STATUS_WORD[r.status],
      motionTally(r.m) ?? '',
      ...seats.map((s) => MARK_WORD[cellMark(r.m, s, mayor !== null && lower(s.name) === lower(mayor))]),
    ]);
  return [head, ...body];
}
