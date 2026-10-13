import { beforeEach, describe, expect, it, vi } from 'vitest';
import { staffHarness } from './helpers/staff';

vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

type H = Awaited<ReturnType<typeof staffHarness>>;
type Book = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
let h: H;
let data: typeof import('../worker/lib/budgetData');
let store: typeof import('../worker/lib/budgetStore');
let answer: typeof import('../worker/ai/budgetAnswer');
let publicApi: typeof import('../worker/api/budget');
let plan: typeof import('../worker/lib/capitalPlan');
let owner: { cookie: string };
let analyst: { cookie: string };
let other: { cookie: string };

beforeEach(async () => {
  h = await staffHarness();
  data = await import('../worker/lib/budgetData');
  store = await import('../worker/lib/budgetStore');
  answer = await import('../worker/ai/budgetAnswer');
  publicApi = await import('../worker/api/budget');
  plan = await import('../worker/lib/capitalPlan');
  store.resetBudgetLoader();
  data.applyBudgetBook(null);
  owner = await h.makeOwner();
  analyst = await h.addPerson(owner.cookie, { name: 'Dana Finance', email: 'dana@vineyard.example', role: 'editor', areas: ['budget'] });
  other = await h.addPerson(owner.cookie, { name: 'Vic Voter', email: 'vic@vineyard.example', role: 'editor', areas: ['votes'] });
});

const get = (path: string, who = analyst) => h.call('GET', path, undefined, { cookie: who.cookie });
const post = (path: string, body: unknown, who = analyst) => h.call('POST', path, body, { cookie: who.cookie });
const live = async (): Promise<Book> => (await get('/budget/book')).body.book as Book;
const publicBudget = async () => (await (await publicApi.getBudget(h.env as never)).json()) as Book;

/** A version of the budget with Sales tax $10,000 higher, every total added up so the checks pass. */
async function withMoreSalesTax(): Promise<Book> {
  const book = await live();
  const line = (book.revenue as Array<{ name: string; amount: number }>).find((r) => r.name === 'Sales tax')!;
  line.amount += 10_000;
  const { totals } = (await post('/budget/totals', { book })).body as { totals: Book };
  book.general = totals;
  book.funds.find((f: { key: string }) => f.key === 'general').total = totals.revenueTotal;
  return book;
}

describe('who can change the budget', () => {
  it('needs the budget area', async () => {
    expect((await get('/budget/book', other)).status).toBe(403);
    expect((await post('/budget/save', { book: await live(), note: 'Some change here' }, other)).status).toBe(403);
    expect((await get('/budget/book')).status).toBe(200);
  });
});

describe('the budget screen starts from the live budget', () => {
  it('hands over the live budget, the built-in one and an empty version list', async () => {
    const r = await get('/budget/book');
    expect(r.body.active).toBe(0);
    expect(r.body.versions).toEqual([]);
    expect(r.body.book.fiscalYear).toBe(2027);
    expect(r.body.builtIn.general.amended.total).toBe(data.GENERAL.amended.total);
  });
});

describe('saving a version', () => {
  it('needs a note saying what changed', async () => {
    const book = await withMoreSalesTax();
    expect((await post('/budget/save', { book })).status).toBe(400);
    expect((await post('/budget/save', { book, note: 'short' })).status).toBe(400);
  });

  it('shows the new figure on the public budget and in the chat answer at once', async () => {
    const before = (await publicBudget()).revenue.find((r: { name: string }) => r.name === 'Sales tax').amount as number;
    const book = await withMoreSalesTax();
    const saved = await post('/budget/save', { book, note: 'Amendment 2, Ordinance 2026-14' });
    expect(saved.status).toBe(201);
    expect(saved.body).toMatchObject({ ok: true, version: 1 });
    expect(saved.body.summary).toContain('revenue lines: 1 changed');
    const after = await publicBudget();
    expect(after.revenue.find((r: { name: string }) => r.name === 'Sales tax').amount).toBe(before + 10_000);
    expect(after.general.revenueTotal).toBe(book.general.revenueTotal);
    const text = answer
      .budgetAnswer(answer.budgetIntent('How much is the sales tax revenue?')!)
      .sentences.map((s) => s.text)
      .join(' ');
    expect(text).toContain(`$${(before + 10_000).toLocaleString('en-US')}`);
    const versions = (await get('/budget/book')).body;
    expect(versions.active).toBe(1);
    expect(versions.versions[0]).toMatchObject({ version: 1, created_by: 'Dana Finance', note: 'Amendment 2, Ordinance 2026-14' });
  });

  it('is picked up by another isolate that has only the old budget', async () => {
    const book = await withMoreSalesTax();
    await post('/budget/save', { book, note: 'Amendment 2, Ordinance 2026-14' });
    const want = (await publicBudget()).revenue.find((r: { name: string }) => r.name === 'Sales tax').amount;
    // A fresh isolate: built-in budget, nothing loaded.
    data.applyBudgetBook(null);
    store.resetBudgetLoader();
    expect(data.REVENUE.find((r) => r.name === 'Sales tax')!.amount).not.toBe(want);
    await store.ensureBudgetBook(h.env as never);
    expect(data.REVENUE.find((r) => r.name === 'Sales tax')!.amount).toBe(want);
  });

  it('refuses a budget whose totals do not match its lines, in plain sentences', async () => {
    const book = await live();
    book.revenue.find((r: { name: string }) => r.name === 'Sales tax').amount += 50_000;
    const r = await post('/budget/save', { book, note: 'Trying a wrong total' });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(false);
    expect(r.body.errors.join(' ')).toMatch(/Totals: revenue before transfers says \$15,834,792 but the revenue lines add up to \$15,884,792/);
    // Nothing was saved.
    expect((await get('/budget/book')).body.active).toBe(0);
  });

  it('names the table and row of each mistake', async () => {
    const book = await live();
    book.departments[2].adopted = 'lots';
    book.departments[3].name = book.departments[4].name;
    book.projects[0].fund = 'nowhere';
    const r = await post('/budget/check', { book });
    expect(r.body.ok).toBe(false);
    const all = (r.body.errors as string[]).join('\n');
    expect(all).toMatch(/Departments, row 3 \(.+\): the adopted amount must be a whole number of dollars\./);
    expect(all).toMatch(/Departments, row 5 \(.+\): ".+" is used twice\./);
    expect(all).toMatch(/Capital projects, row 1 \(.+\): choose where the money comes from\./);
  });

  it('checks without saving and says what would change', async () => {
    const book = await withMoreSalesTax();
    const r = await post('/budget/check', { book });
    expect(r.body).toMatchObject({ ok: true });
    expect(r.body.summary).toContain('revenue lines: 1 changed');
    expect((await get('/budget/book')).body.active).toBe(0);
  });

  it('strips markup from names and notes', async () => {
    const book = await withMoreSalesTax();
    book.funds[1].about = '<b>Water</b> and sewer <script>alert(1)</script>';
    const r = await post('/budget/save', { book, note: '<i>Amendment 2</i> adopted' });
    expect(r.status).toBe(201);
    const v = (await get('/budget/book')).body;
    expect(v.versions[0].note).toBe('Amendment 2 adopted');
    expect(JSON.stringify(v.book.funds[1].about)).not.toContain('<');
  });
});

describe('a budget that has not been amended', () => {
  it('uses the adopted figures everywhere and says so in the chat', async () => {
    const book = await live();
    book.amended = book.adopted;
    const r = await post('/budget/save', { book, note: 'Back to the adopted budget as is' });
    expect(r.status).toBe(201);
    expect(data.budgetAmended()).toBe(false);
    expect(data.GENERAL.amended).toEqual(data.GENERAL.adopted);
    expect(data.GENERAL.cutByAmendment).toBe(0);
    expect(data.DEPARTMENTS.every((d) => d.amended === d.adopted)).toBe(true);
    const say = (q: string) =>
      answer
        .budgetAnswer(answer.budgetIntent(q)!)
        .sentences.map((s) => s.text)
        .join(' ');
    expect(say('When was the budget amended?')).toMatch(/has not been amended since the City Council adopted it on June 23, 2026/);
    expect(say('How much is the police department budget?')).not.toMatch(/Amendment/);
    expect(say('What is the total city budget?')).toContain('as adopted');
    const facts = (await import('../worker/lib/budgetFacts')).budgetFacts();
    expect(facts).toContain('has not been amended');
    expect(facts).not.toContain('Ordinance 2026-10');
  });
});

describe('versions', () => {
  it('restores the built-in budget as a new version, and undo goes back', async () => {
    const book = await withMoreSalesTax();
    const base = (await publicBudget()).revenue.find((r: { name: string }) => r.name === 'Sales tax').amount as number;
    await post('/budget/save', { book, note: 'Amendment 2, Ordinance 2026-14' });
    const changed = (await publicBudget()).revenue.find((r: { name: string }) => r.name === 'Sales tax').amount as number;
    expect(changed).toBe(base + 10_000);
    const restored = await post('/budget/restore', { version: 0 });
    expect(restored.body).toMatchObject({ ok: true, version: 2 });
    expect((await publicBudget()).revenue.find((r: { name: string }) => r.name === 'Sales tax').amount).toBe(base);
    const list = (await get('/budget/book')).body;
    expect(list.active).toBe(2);
    expect(list.versions.map((v: { version: number }) => v.version)).toEqual([2, 1]);
    // Undo the restore: version 1 is the budget again.
    const entries = ((await get('/audit?limit=10')).body.items as Array<{ id: number; summary: string; undoable: boolean; undone_at: string | null }>).filter((e) =>
      e.summary.startsWith('Restored budget version'),
    );
    expect(entries[0].undoable).toBe(true);
    expect((await post('/audit/undo', { id: entries[0].id })).status).toBe(200);
    expect((await get('/budget/book')).body.active).toBe(1);
    expect((await publicBudget()).revenue.find((r: { name: string }) => r.name === 'Sales tax').amount).toBe(base + 10_000);
  });

  it('undoes a save back to the built-in budget', async () => {
    const book = await withMoreSalesTax();
    await post('/budget/save', { book, note: 'Amendment 2, Ordinance 2026-14' });
    const e = ((await get('/audit?limit=5')).body.items as Array<{ id: number; summary: string }>).find((x) => x.summary.startsWith('Saved budget version'))!;
    expect((await post('/audit/undo', { id: e.id })).status).toBe(200);
    expect((await get('/budget/book')).body.active).toBe(0);
    expect(data.REVENUE.find((r) => r.name === 'Sales tax')!.amount).toBe(data.builtInBudgetBook().revenue.find((r) => r.name === 'Sales tax')!.amount);
  });

  it('opens an earlier version and says when one is missing', async () => {
    const book = await withMoreSalesTax();
    await post('/budget/save', { book, note: 'Amendment 2, Ordinance 2026-14' });
    const v1 = await get('/budget/version?v=1');
    expect(v1.status).toBe(200);
    expect(v1.body.book.general.revenueTotal).toBe(book.general.revenueTotal);
    expect((await get('/budget/version?v=0')).status).toBe(200);
    expect((await get('/budget/version?v=9')).status).toBe(404);
    expect((await post('/budget/restore', { version: 9 })).status).toBe(404);
  });

  it('records each change in the activity log', async () => {
    const book = await withMoreSalesTax();
    await post('/budget/save', { book, note: 'Amendment 2, Ordinance 2026-14' });
    const items = (await get('/audit?limit=5')).body.items as Array<{ area: string; summary: string }>;
    expect(items[0]).toMatchObject({ area: 'budget', summary: 'Saved budget version 1: Amendment 2, Ordinance 2026-14' });
  });
});

describe('totals', () => {
  it('adds up the lines for the staff screen', async () => {
    const book = await live();
    const { totals } = (await post('/budget/totals', { book })).body as { totals: Book };
    expect(Math.abs(totals.revenueBeforeTransfers - data.GENERAL.revenueBeforeTransfers)).toBeLessThanOrEqual(5);
    expect(Math.abs(totals.adopted.total - data.GENERAL.adopted.total)).toBeLessThanOrEqual(5);
    expect(totals.tentativeTotal).toBe(data.GENERAL.tentativeTotal);
  });
});

describe('links from capital projects to the map', () => {
  it('follows the project lines a saved version carries', async () => {
    const book = await live();
    const first = book.projects[0];
    const wasMapped = plan.FY27_PROJECT_IDS.includes(first.feature ?? -1);
    expect(plan.FY27_PROJECT_IDS.length).toBeGreaterThan(10);
    // Unlink one project and link another to a new map feature.
    const keep = book.projects.find((p: { feature?: number }) => !p.feature);
    expect(keep).toBeTruthy();
    delete first.feature;
    delete first.featureName;
    keep.feature = 777;
    keep.featureName = 'Test project on the city map';
    const r = await post('/budget/save', { book, note: 'Linked a project to the map' });
    expect(r.status).toBe(201);
    expect(plan.FY27_PROJECT_IDS).toContain(777);
    expect(plan.FY27_PROJECTS_WHERE).toContain('777');
    if (wasMapped) expect(plan.FY27_PROJECT_IDS).not.toContain(book.projects[0].feature);
    expect(plan.budgetForFeature(777)?.items[0].name).toBe(keep.name);
    // Going back to the built-in budget puts the original links back.
    await post('/budget/restore', { version: 0 });
    expect(plan.FY27_PROJECT_IDS).not.toContain(777);
  });

  it('rejects a map feature number that is not a whole number', async () => {
    const book = await live();
    book.projects[0].feature = 'abc';
    const r = await post('/budget/check', { book });
    expect(r.body.ok).toBe(false);
    expect(r.body.errors.join(' ')).toMatch(/map feature number must be a whole number/);
  });
});

describe('finding documents to link', () => {
  it('searches the archive by title or code', async () => {
    const now = '2027-06-22T00:00:00.000Z';
    await h.env.CATALOG_DB.prepare(
      "INSERT INTO documents (id, slug, title, document_type, document_date, source_id, created_at, updated_at, first_seen_at, last_seen_at) VALUES ('doc_aaaaaaaaaaaaaaaa', 'fy-28-final-budget', 'FY 28 Final Budget', 'budget', '2027-06-22', 'civicclerk', ?, ?, ?, ?)",
    )
      .bind(now, now, now, now)
      .run();
    const hit = await get('/budget/documents?q=FY%2028');
    expect(hit.body.items).toEqual([expect.objectContaining({ id: 'doc_aaaaaaaaaaaaaaaa', title: 'FY 28 Final Budget' })]);
    const byId = await get('/budget/documents?q=doc_aaaaaaaaaaaaaaaa');
    expect(byId.body.items).toHaveLength(1);
  });
});
