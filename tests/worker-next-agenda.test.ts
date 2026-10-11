import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../worker/api/events', () => ({ loadCity: vi.fn(async () => []) }));

import { bodyOf, isNextAgendaQuestion, isScheduleQuestion } from '../worker/ai/scheduleIntent';

type NextAgenda = { meetingId: string | null; agendaDocIds: string[]; schedule: { text: string; event: { meetingId: string | null } } };
// Loaded by path at run time: the module uses Worker types this test project does not compile.
const WORKER_SCHEDULE = '../worker/ai/schedule';
const load = async () => (await import(/* @vite-ignore */ WORKER_SCHEDULE)) as { AGENDA_NOT_POSTED: string; nextAgenda: (env: never, q: string) => Promise<NextAgenda | null> };

type Call = { sql: string; args: unknown[] };

/** A D1 stand-in: answers by the SQL it is given, and records every query with its bound values. */
function fakeDb(meeting: Record<string, unknown> | null, agendaDocs: string[]) {
  const calls: Call[] = [];
  const db = {
    prepare(sql: string) {
      const call: Call = { sql, args: [] };
      calls.push(call);
      const stmt = {
        bind(...args: unknown[]) {
          call.args = args;
          return stmt;
        },
        async first() {
          if (/FROM meetings/.test(sql)) return meeting;
          return null;
        },
        async all() {
          if (/FROM documents d JOIN meetings/.test(sql)) return { results: agendaDocs.map((id) => ({ id })) };
          return { results: [] };
        },
      };
      return stmt;
    },
  };
  return { env: { CATALOG_DB: db } as never, calls };
}

describe('next meeting agenda questions', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-11T18:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('detects the question and its body', () => {
    const q = 'When is the next Planning Commission meeting and what is on the agenda';
    expect(isNextAgendaQuestion(q)).toBe(true);
    expect(isScheduleQuestion(q)).toBe(false);
    expect(bodyOf(q)).toMatchObject({ label: 'Planning Commission', like: '%Planning Commission%' });
    expect(isNextAgendaQuestion("What's on the agenda for the next City Council meeting?")).toBe(true);
    expect(isNextAgendaQuestion('What will be discussed at the upcoming RDA meeting?')).toBe(true);
    expect(isNextAgendaQuestion('When is the next council meeting?')).toBe(false);
    expect(isNextAgendaQuestion('When is the next council election and who are the candidates?')).toBe(false);
    expect(isNextAgendaQuestion('What was on the agenda last week?')).toBe(false);
  });

  it('reports no agenda when the next meeting has none posted', async () => {
    const { AGENDA_NOT_POSTED, nextAgenda } = await load();
    const { env, calls } = fakeDb({ id: 'pc-2026-11-04', title: 'Planning Commission', meeting_date: '2026-11-04', start_time: '18:00', location: 'Vineyard City Hall' }, []);
    const r = await nextAgenda(env, 'When is the next Planning Commission meeting and what is on the agenda');
    expect(r?.meetingId).toBe('pc-2026-11-04');
    expect(r?.agendaDocIds).toEqual([]);
    expect(r?.schedule.text).toBe("The next Planning Commission meeting is Wednesday, November 4, 2026 at 6:00 pm at Vineyard City Hall, according to the city's meeting portal.");
    expect(`${r?.schedule.text} ${AGENDA_NOT_POSTED}`).toMatch(/The agenda for this meeting is not posted yet\.$/);
    // The meeting is found by body, and agenda records only by that meeting id and that body.
    expect(calls.find((c) => /FROM meetings/.test(c.sql))?.args[0]).toBe('%Planning Commission%');
    const docs = calls.find((c) => /FROM documents d JOIN meetings/.test(c.sql))!;
    expect(docs.sql).toMatch(/d\.meeting_id = \?/);
    expect(docs.sql).toMatch(/LIKE \?/);
    expect(docs.args.slice(0, 4)).toEqual(['pc-2026-11-04', '%Planning Commission%', 'agenda', 'agenda_packet']);
  });

  it("returns that meeting's own agenda records when posted", async () => {
    const { nextAgenda } = await load();
    const { env } = fakeDb({ id: 'pc-2026-11-04', title: 'Planning Commission', meeting_date: '2026-11-04', start_time: '18:00', location: null }, ['doc-agenda']);
    const r = await nextAgenda(env, 'What is on the agenda for the next Planning Commission meeting?');
    expect(r?.agendaDocIds).toEqual(['doc-agenda']);
    expect(r?.schedule.event.meetingId).toBe('pc-2026-11-04');
  });

  it('returns null when no meeting is scheduled', async () => {
    const { nextAgenda } = await load();
    const { env } = fakeDb(null, []);
    expect(await nextAgenda(env, 'What is on the agenda for the next Planning Commission meeting?')).toBeNull();
  });

  it('uses no dashes in what it says', async () => {
    const { AGENDA_NOT_POSTED } = await load();
    expect(AGENDA_NOT_POSTED).not.toMatch(/[–—]/);
  });
});
