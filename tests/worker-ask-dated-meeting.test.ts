import { describe, expect, it } from 'vitest';
import { testEnv } from './helpers/d1';
import { handleAsk, namesMeetingDay, RAG_SYSTEM_PROMPT, reprintedMinutes } from '../worker/ai/rag';
import { meetingDateIn } from '../worker/ai/meetingVotes';
import { SearchRepository } from '../worker/search/SearchRepository';
import type { Env } from '../worker/env';

// Type-checked with the Worker project (tsconfig.worker.json): it runs the real ask handler over a real
// (in-memory) catalog and search shard, with Workers AI stood in for.
//
// Nightly suite case followup-sep8-public-comment, turn 3: "who spoke during public comment at that
// meeting?" after two turns about the September 8 City Council meeting. The answer once gave Jared
// Tamez's comment on Senate Bill 284, from another meeting's minutes, without naming any meeting.

const today = new Date(Date.now() - 6 * 3600_000).toISOString().slice(0, 10);
const SEPT8 = meetingDateIn('September 8', today)!;
const YEAR = SEPT8.slice(0, 4);
const AUG25 = `${YEAR}-08-25`;

const TAMEZ = 'Jared Tamez, a resident, expressed concern that Senate Bill 284 would limit local control of zoning.';
const FOX = 'PUBLIC COMMENTS Mayor Stratton opened public comment. Dana Fox, a resident, spoke in favor of the 300 West parking and striping plan. Mayor Stratton closed public comment.';

const convo = [
  { role: 'user', content: 'what did the city council vote on at the September 8 meeting' },
  { role: 'assistant', content: `The City Council recorded 3 motions at its September 8, ${YEAR} meeting.` },
  { role: 'user', content: 'did anyone vote no that night?' },
  { role: 'assistant', content: `Every recorded motion at the September 8, ${YEAR} City Council meeting passed, with no No votes.` },
];

async function seed(withSept8Minutes: boolean) {
  const env = testEnv();
  env.CATALOG_DB.db.exec('ALTER TABLE quota_usage ADD COLUMN ai_neurons REAL NOT NULL DEFAULT 0');
  const now = new Date().toISOString();
  const meeting = (id: string, date: string) =>
    env.CATALOG_DB.db
      .prepare(`INSERT INTO meetings (id, slug, title, government_body_id, government_body_name, meeting_type, meeting_date, source_id, created_at, updated_at) VALUES (?, ?, 'City Council Meeting', 'city-council', 'City Council', 'regular', ?, 'civicclerk', ?, ?)`)
      .run(id, id, date, now, now);
  meeting('mtg_cc_1442', SEPT8);
  meeting('mtg_cc_1431', AUG25);
  const repo = new SearchRepository(env);
  const doc = async (id: string, title: string, type: string, date: string, meetingId: string, text: string) => {
    env.CATALOG_DB.db
      .prepare(
        `INSERT INTO documents (id, slug, title, document_type, document_date, year, government_body_id, government_body_name, meeting_id, source_id, created_at, updated_at, first_seen_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, 'city-council', 'City Council', ?, 'civicclerk', ?, ?, ?, ?)`,
      )
      .run(id, id, title, type, date, Number(date.slice(0, 4)), meetingId, now, now, now, now);
    await repo.replaceDocument(0, { documentId: id, title, documentType: type, documentNumber: null, documentDate: date, year: Number(date.slice(0, 4)), governmentBodyId: 'city-council', sourceId: 'civicclerk', meetingId, categories: [], currency: 'historical' }, [
      { id: `${id}:1`, pageStart: 1, pageEnd: 1, sectionTitle: null, text },
    ]);
  };
  // Another meeting's minutes, and the same minutes reprinted in the September 8 packet for approval.
  await doc('doc_aug25_minutes', `08.25.${YEAR} City Council Minutes`, 'minutes', AUG25, 'mtg_cc_1431', `PUBLIC COMMENTS ${TAMEZ}`);
  await doc('doc_sep8_packet', `09.08.${YEAR} City Council Packet`, 'agenda_packet', SEPT8, 'mtg_cc_1442', `Minutes of the City Council meeting held August 25, ${YEAR}. PUBLIC COMMENTS ${TAMEZ}`);
  if (withSept8Minutes) await doc('doc_sep8_minutes', `09.08.${YEAR} City Council Minutes`, 'minutes', SEPT8, 'mtg_cc_1442', FOX);
  return env;
}

/** Workers AI: the reranker keeps the order, and the answer is `write(user message)`; every answer prompt is kept. */
function ai(write: (user: string) => string, seen: string[]) {
  return {
    run: async (_model: string, input: Record<string, unknown>) => {
      if (typeof input.query === 'string') return { response: (input.contexts as unknown[]).map((_, i) => ({ id: i, score: 0.9 - i * 0.001 })) };
      const msgs = (input.messages ?? []) as Array<{ role: string; content: string }>;
      if (msgs[0]?.content.startsWith(RAG_SYSTEM_PROMPT.slice(0, 60))) {
        seen.push(msgs.map((m) => m.content).join('\n'));
        return { response: write(msgs[msgs.length - 1].content) };
      }
      return { response: 'not json' };
    },
  };
}

const sourceWith = (user: string, needle: string) => {
  for (const m of user.matchAll(/\[(\d+)\][^\n]*\n<<<\n([\s\S]*?)\n>>>/g)) if (m[2].includes(needle)) return Number(m[1]);
  return 0;
};

/** A model that answers from whatever source holds a public comment speaker. */
const writer = (user: string) => {
  const fox = sourceWith(user, 'Dana Fox');
  if (fox) return `Dana Fox, a resident, spoke in favor of the 300 West parking and striping plan [${fox}].`;
  const tamez = sourceWith(user, 'Jared Tamez');
  if (tamez) return `Jared Tamez, a resident, expressed concern that Senate Bill 284 would limit local control of zoning [${tamez}].`;
  return 'NO_RECORD';
};

async function ask(env: Env, body: unknown) {
  const req = new Request('https://example.test/api/ask', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': `t${Math.random()}` }, body: JSON.stringify(body) });
  const res = await handleAsk(env, req);
  return res.json() as Promise<{ question: string; answer: string; engine: string; citations: Array<{ documentId: string }>; section?: { path: string; label: string } }>;
}

describe('a question about one dated meeting reads only that meeting', () => {
  it('answers public comment from the September 8 minutes, names the meeting, and never reads the reprinted August 25 minutes', async () => {
    const env = await seed(true);
    const seen: string[] = [];
    const r = await ask({ ...env, AI: ai(writer, seen) } as unknown as Env, { question: 'who spoke during public comment at that meeting?', conversation: convo });
    expect(r.question).toBe(`Who spoke during public comment at the September 8, ${YEAR} City Council meeting?`);
    expect(r.answer).toContain('Dana Fox');
    expect(r.answer).not.toContain('Tamez');
    expect(r.answer).toContain(`September 8, ${YEAR} City Council meeting`);
    expect(r.citations.map((c) => c.documentId)).toEqual(['doc_sep8_minutes']);
    expect(seen.join('\n')).not.toContain('Tamez');
    expect(r.answer).not.toMatch(/[–—]/);
  });

  it('says so and gives the meeting card when the meeting records hold no answer', async () => {
    const env = await seed(false);
    const seen: string[] = [];
    const r = await ask({ ...env, AI: ai(writer, seen) } as unknown as Env, { question: 'who spoke during public comment at that meeting?', conversation: convo });
    expect(r.answer).toBe(`Nothing in the agenda or packet of the September 8, ${YEAR} City Council meeting answers that, and its minutes are not posted yet. Its records and video are on the meeting page.`);
    expect(r.answer).not.toMatch(/couldn't find|unavailable|unable to/i);
    expect(r.answer).not.toContain('Tamez');
    expect(r.section?.path).toBe('/meetings/mtg_cc_1442');
    expect(r.citations).toEqual([]);
    expect(seen).toEqual([]);
  });

  it('applies to a question that names the date and body itself', async () => {
    const env = await seed(true);
    const seen: string[] = [];
    const r = await ask({ ...env, AI: ai(writer, seen) } as unknown as Env, { question: `Who spoke during public comment at the September 8, ${YEAR} City Council meeting?` });
    expect(r.answer).toContain('Dana Fox');
    expect(r.answer).not.toContain('Tamez');
  });

  it('tells reprinted minutes and the meeting day apart', () => {
    expect(reprintedMinutes({ documentType: 'agenda_packet', text: `Minutes of the meeting held August 25, ${YEAR}. ${TAMEZ}` }, SEPT8)).toBe(true);
    expect(reprintedMinutes({ documentType: 'agenda_packet', text: `Approval of the August 25, ${YEAR} minutes at the September 8, ${YEAR} meeting` }, SEPT8)).toBe(false);
    expect(reprintedMinutes({ documentType: 'minutes', text: `Minutes of August 25, ${YEAR}` }, SEPT8)).toBe(false);
    expect(reprintedMinutes({ documentType: 'agenda', text: '7. Public comment' }, SEPT8)).toBe(false);
    expect(namesMeetingDay(`At the Sept. 8 meeting, Dana Fox spoke.`, SEPT8)).toBe(true);
    expect(namesMeetingDay(`At the 9/8/${YEAR} meeting`, SEPT8)).toBe(true);
    expect(namesMeetingDay('Dana Fox spoke.', SEPT8)).toBe(false);
  });
});
