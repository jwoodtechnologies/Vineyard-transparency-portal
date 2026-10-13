import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fileForm, pdfWith } from './helpers/panel';
import { staffHarness } from './helpers/staff';
import { MAX_BATCH, bulkItems, bulkSummary, fileProblem, sendAll, type BulkItem } from '../src/console/staff/bulkLib';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const MB = 1024 * 1024;
const f = (name: string, size = 1000) => ({ name, size });

describe('choosing many files', () => {
  it('titles each file from its name and leaves out the ones that cannot go in, in a sentence', () => {
    const { items, left } = bulkItems([f('council_agenda_2026-10-07.pdf'), f('photo.jpg'), f('archive.zip'), f('huge.pdf', 30 * MB), f('big.csv', 2 * MB), f('empty.pdf', 0)]);
    expect(items.map((i) => i.title)).toEqual(['Council agenda 2026-10-07', 'Photo']);
    expect(items.every((i) => i.status === 'ready')).toBe(true);
    expect(left).toEqual([
      'archive.zip is not a PDF, picture, text or CSV file.',
      'huge.pdf is 30 MB. Files can be up to 25 MB.',
      'big.csv is 2.0 MB. Text and CSV files can be up to 1 MB.',
      'empty.pdf is empty.',
    ]);
    expect(fileProblem(f('minutes.PDF'))).toBe('');
  });

  it(`takes up to ${MAX_BATCH} at a time`, () => {
    const many = Array.from({ length: MAX_BATCH + 2 }, (_, i) => f(`doc${i}.pdf`));
    const r = bulkItems(many);
    expect(r.items).toHaveLength(MAX_BATCH);
    expect(r.left).toHaveLength(2);
    expect(r.left[0]).toMatch(/You can add up to 30 files at a time\.$/);
  });

  it('says how the batch went in one line', () => {
    expect(bulkSummary([{ status: 'ready' }, { status: 'ready' }])).toBe('2 files ready to add.');
    expect(bulkSummary([{ status: 'added' }, { status: 'adding' }, { status: 'ready' }])).toBe('Adding 2 of 3.');
    expect(bulkSummary([{ status: 'added' }, { status: 'added' }, { status: 'error' }])).toBe('2 files added, 1 did not go in.');
    expect(bulkSummary([{ status: 'added' }])).toBe('1 file added.');
  });
});

describe('adding several files to the records area', () => {
  let h: Awaited<ReturnType<typeof staffHarness>>;
  let clerk: { cookie: string };

  beforeEach(async () => {
    h = await staffHarness();
    const owner = await h.makeOwner();
    clerk = await h.addPerson(owner.cookie, { name: 'Pat Clerk', email: 'pat@vineyard.example', role: 'editor', areas: ['records'] });
  });

  it('sends each file in turn with the shared details, and a retry adds the one that failed', async () => {
    const names = ['agenda_one.pdf', 'agenda_two.pdf', 'agenda_three.pdf'];
    const files = await Promise.all(names.map(async (n, i) => new File([await pdfWith(`Planning Commission agenda number ${i + 1}`)], n)));
    let items: BulkItem[] = bulkItems(files).items;
    items[1] = { ...items[1], title: 'Planning Commission agenda, second' };
    const update = (key: string, patch: Partial<BulkItem>) => {
      items = items.map((x) => (x.key === key ? { ...x, ...patch } : x));
    };
    const seen: string[] = [];
    const send = async (item: BulkItem) => {
      seen.push(item.file.name);
      // The connection drops once, on the second file (the words are the ones the upload helper uses).
      if (seen.length === 2) throw new Error('The upload did not finish. Check your connection and try again.');
      const form = fileForm(new Uint8Array(await item.file.arrayBuffer()), item.file.name, { type: 'agenda', title: item.title, date: '2026-10-07', body: 'Posted for the October 7 meeting.' });
      const r = await h.call('POST', '/records/file', undefined, { cookie: clerk.cookie, form });
      if (r.status !== 201) throw new Error(r.body.error.message);
      return r.body.documentId as string;
    };

    const first = await sendAll(items, send, update);
    expect(first).toEqual({ added: 2, failed: 1 });
    expect(seen).toEqual(names);
    expect(items.map((i) => i.status)).toEqual(['added', 'error', 'added']);
    expect(items[1].message).toBe('The upload did not finish. Check your connection and try again.');
    expect(bulkSummary(items)).toBe('2 files added, 1 did not go in.');

    const again = await sendAll(items, send, update, true);
    expect(again).toEqual({ added: 1, failed: 0 });
    expect(seen).toEqual([...names, 'agenda_two.pdf']);
    expect(items.every((i) => i.status === 'added' && i.documentId)).toBe(true);
    expect(bulkSummary(items)).toBe('3 files added.');

    const docs = h.env.CATALOG_DB.db.prepare("SELECT title, document_type, document_date FROM documents WHERE source_id = 'portal-staff' ORDER BY title").all();
    expect(docs).toEqual([
      { title: 'Agenda one', document_type: 'agenda', document_date: '2026-10-07' },
      { title: 'Agenda three', document_type: 'agenda', document_date: '2026-10-07' },
      { title: 'Planning Commission agenda, second', document_type: 'agenda', document_date: '2026-10-07' },
    ]);
    const log = (await h.call('GET', '/audit', undefined, { cookie: clerk.cookie })).body.items as Array<{ action: string; area: string }>;
    expect(log.filter((e) => e.area === 'records' && e.action === 'added')).toHaveLength(3);
  });

  it('a file the server refuses keeps its plain sentence', async () => {
    const pdf = await pdfWith('Same file twice');
    const items = bulkItems([new File([pdf], 'a.pdf'), new File([pdf], 'b.pdf')]).items;
    const out: Record<string, Partial<BulkItem>> = {};
    await sendAll(
      items,
      async (item) => {
        const r = await h.call('POST', '/records/file', undefined, { cookie: clerk.cookie, form: fileForm(new Uint8Array(await item.file.arrayBuffer()), item.file.name, { type: 'other' }) });
        if (r.status !== 201) throw new Error(r.body.error.message);
        return r.body.documentId as string;
      },
      (key, patch) => (out[key] = { ...out[key], ...patch }),
    );
    expect(out[items[0].key].status).toBe('added');
    expect(out[items[1].key]).toMatchObject({ status: 'error', message: 'This file is already in the archive.' });
  });
});

describe('a file whose storage fails partway', () => {
  it('leaves nothing behind, so trying again adds it', async () => {
    const h = await staffHarness();
    const owner = await h.makeOwner();
    const clerk = await h.addPerson(owner.cookie, { name: 'Sam Clerk', email: 'sam@vineyard.example', role: 'editor', areas: ['records'] });
    const archive = (h.env as unknown as { ARCHIVE: { put: (...a: unknown[]) => Promise<unknown> } }).ARCHIVE;
    const put = archive.put.bind(archive);
    let fail = true;
    archive.put = async (...a: unknown[]) => {
      if (fail) {
        fail = false;
        throw new Error('storage dropped');
      }
      return put(...a);
    };
    const bytes = new Uint8Array(await pdfWith('Storage fails the first time'));
    const first = await h.call('POST', '/records/file', undefined, { cookie: clerk.cookie, form: fileForm(bytes, 'minutes.pdf', { type: 'minutes' }) });
    expect(first.status).toBe(500);
    expect(first.body.error.message).toBe('The record could not be saved. Try again.');
    expect(h.env.CATALOG_DB.db.prepare("SELECT count(*) AS n FROM documents WHERE source_id = 'portal-staff'").get()).toEqual({ n: 0 });
    const again = await h.call('POST', '/records/file', undefined, { cookie: clerk.cookie, form: fileForm(bytes, 'minutes.pdf', { type: 'minutes' }) });
    expect(again.status).toBe(201);
    expect(h.env.CATALOG_DB.db.prepare("SELECT count(*) AS n FROM documents WHERE source_id = 'portal-staff'").get()).toEqual({ n: 1 });
  });
});
