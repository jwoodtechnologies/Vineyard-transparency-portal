import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, ExternalLink, History, RotateCcw } from 'lucide-react';
import { staff, when } from './api';
import { Alert } from './ui';
import { useStaffData } from './useStaff';
import { BasicsStep, ChartsStep, FundsStep, ProjectsStep, RevenueStep, SpendingStep, TotalsStep, type StepProps } from './BudgetSteps';
import { STEPS, fromDraft, isDirty, stepOfProblem, toDraft, type Book, type Draft, type StepId } from './budgetLib';

interface VersionRow {
  version: number;
  created_at: string;
  created_by: string | null;
  note: string;
  summary: string | null;
}

interface Overview {
  active: number;
  book: Book;
  builtIn: Book;
  versions: VersionRow[];
  noteMin: number;
  noteMax: number;
}

interface Check {
  /** The budget this answer is about. */
  key: string;
  ok: boolean;
  errors: string[];
  summary?: string;
}

function Versions({ o, onDone, onError }: { o: Overview; onDone: (s: string) => void; onError: (s: string) => void }) {
  const [asking, setAsking] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  async function restore(version: number) {
    setBusy(true);
    onError('');
    try {
      await staff('/budget/restore', { body: { version } });
      setAsking(null);
      onDone(version === 0 ? 'The built-in budget is on the portal again, saved as a new version.' : `Version ${version} is on the portal again, saved as a new version.`);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not restore that version.');
    } finally {
      setBusy(false);
    }
  }

  const entry = (version: number, title: string, sub: string, note?: string) => (
    <li key={version} className="vs-person" data-off={version !== o.active}>
      <div className="vs-row">
        <div className="vs-row-main">
          <p className="vs-row-title">{title}</p>
          <p className="vs-row-sub">{sub}</p>
          {note && <p className="vs-row-sub">{note}</p>}
        </div>
        {version === o.active && <span className="vs-badge">On the portal</span>}
      </div>
      {version !== o.active && (
        <div className="vs-actions">
          {asking === version ? (
            <>
              <button type="button" className="vs-btn vs-btn-small vs-btn-primary" disabled={busy} onClick={() => restore(version)}>
                Yes, put this back
              </button>
              <span className="vs-hint">Changes you have not saved are lost.</span>
              <button type="button" className="vs-btn vs-btn-small vs-btn-quiet" onClick={() => setAsking(null)}>
                Keep what is there
              </button>
            </>
          ) : (
            <button type="button" className="vs-btn vs-btn-small vs-btn-quiet" onClick={() => setAsking(version)}>
              <RotateCcw size={14} aria-hidden="true" /> Put this back on the portal
            </button>
          )}
        </div>
      )}
    </li>
  );

  return (
    <ul className="vs-list" aria-label="Saved versions of the budget">
      {o.versions.map((v) => entry(v.version, `Version ${v.version}`, `${when(v.created_at)}${v.created_by ? ` by ${v.created_by}` : ''}`, `${v.note}${v.summary ? ` (${v.summary})` : ''}`))}
      {entry(0, 'The built-in budget', 'The figures the portal started with, keyed from the adopted budget book.')}
    </ul>
  );
}

function SaveStep({ d, set, base, saved, onSaved, jump, min, max }: StepProps & { base: Draft; saved: Book; onSaved: (version: number) => void; jump: (s: StepId) => void; min: number; max: number }) {
  const book = useMemo(() => fromDraft(d), [d]);
  const key = useMemo(() => JSON.stringify(book), [book]);
  const dirty = useMemo(() => isDirty(d, base), [d, base]);
  const [check, setCheck] = useState<Check | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fixing, setFixing] = useState(false);

  useEffect(() => {
    if (!dirty) return;
    let live = true;
    const t = setTimeout(() => {
      staff<{ ok: boolean; errors: string[]; summary?: string }>('/budget/check', { body: { book: JSON.parse(key) } }).then(
        (r) => live && setCheck({ key, ok: r.ok, errors: r.errors ?? [], summary: r.summary }),
        (e: Error) => live && setCheck({ key, ok: false, errors: [e.message] }),
      );
    }, 300);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [key, dirty]);

  const current = check && check.key === key ? check : null;
  const totalsOff = current?.errors.some((e) => e.startsWith('Totals:')) ?? false;
  const noteOk = note.trim().length >= min;

  async function addUp() {
    setFixing(true);
    try {
      const r = await staff<{ totals: Draft['general'] }>('/budget/totals', { body: { book } });
      set((x) => ({
        ...x,
        general: x.amendedYet ? r.totals : { ...r.totals, amended: { ...r.totals.adopted }, cutByAmendment: 0 },
        funds: x.funds.map((f) => (f.key === 'general' ? { ...f, total: r.totals.revenueTotal } : f)),
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add up the totals.');
    } finally {
      setFixing(false);
    }
  }

  async function save() {
    setBusy(true);
    setError('');
    try {
      const r = await staff<{ ok: boolean; errors?: string[]; version?: number }>('/budget/save', { body: { book, note: note.trim() } });
      if (!r.ok) {
        setCheck({ key, ok: false, errors: r.errors ?? ['The budget did not pass the checks.'] });
        setBusy(false);
        return;
      }
      onSaved(r.version ?? 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
      setBusy(false);
    }
  }

  if (!dirty) {
    return (
      <div className="vs-card vs-stack">
        <h2 className="vs-h2">Nothing to save</h2>
        <p>You have not changed anything yet. Make your changes in the other steps, then come back here to save them.</p>
        <p className="vs-hint">The budget on the portal now is the one in {saved.fiscalYear ? `fiscal year ${saved.fiscalYear}` : 'the last saved version'}.</p>
      </div>
    );
  }

  return (
    <div className="vs-stack">
      <div className="vs-card vs-stack">
        <h2 className="vs-h2">Check</h2>
        {!current && (
          <p className="vs-hint" role="status">
            Checking your changes...
          </p>
        )}
        {current && current.ok && (
          <p className="vs-ok" role="status">
            Everything adds up. {current.summary ? `This will change: ${current.summary}.` : ''}
          </p>
        )}
        {current && !current.ok && (
          <div role="alert" className="vs-error">
            <p>
              <strong>Fix these before you save:</strong>
            </p>
            <ul className="vs-problems">
              {current.errors.map((e) => (
                <li key={e}>
                  {e}{' '}
                  <button type="button" className="vs-link" onClick={() => jump(stepOfProblem(e))}>
                    Go there
                  </button>
                </li>
              ))}
            </ul>
            {totalsOff && (
              <div className="vs-actions">
                <button type="button" className="vs-btn vs-btn-small vs-btn-quiet" disabled={fixing} onClick={addUp}>
                  {fixing ? 'Adding up...' : 'Add up the totals for me'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      <div className="vs-card vs-stack">
        <h2 className="vs-h2">Save</h2>
        <div className="vs-field">
          <label htmlFor="vs-budget-note">What changed, and where did the numbers come from?</label>
          <textarea id="vs-budget-note" value={note} maxLength={max} onChange={(e) => setNote(e.target.value)} placeholder="Amendment 2, Ordinance 2026-14, adopted December 9" />
          <p className="vs-hint">Kept with this version so anyone can see why it changed. {Math.max(0, max - note.length)} characters left.</p>
        </div>
        <Alert>{error}</Alert>
        <div className="vs-actions">
          <button type="button" className="vs-btn vs-btn-primary" disabled={busy || !noteOk || !current?.ok} onClick={save}>
            {busy ? 'Saving...' : 'Save to the portal'}
          </button>
        </div>
        {!noteOk && <p className="vs-hint">Write at least a few words in the note to save.</p>}
        <p className="vs-hint">Saving puts these figures on the Budget page, in the chat's budget answers and on the map's project list. Visitors see the change within a minute. Every version is kept, so you can go back.</p>
      </div>
    </div>
  );
}

function Editor({ o, onSaved }: { o: Overview; onSaved: (version: number) => void }) {
  const base = useMemo(() => toDraft(o.book), [o.book]);
  const [d, setD] = useState<Draft>(base);
  const [step, setStep] = useState<StepId>('basics');
  const top = useRef<HTMLDivElement>(null);
  const dirty = isDirty(d, base);
  const set = (fn: (x: Draft) => Draft) => setD(fn);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const go = (s: StepId) => {
    setStep(s);
    requestAnimationFrame(() => top.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  };
  const at = STEPS.findIndex((s) => s.id === step);
  const props: StepProps = { d, set };

  return (
    <div className="vs-stack" ref={top}>
      <nav className="vs-steps" aria-label="Steps">
        {STEPS.map((s, i) => (
          <button key={s.id} type="button" aria-current={s.id === step ? 'step' : undefined} onClick={() => go(s.id)}>
            <span>{i + 1}</span> {s.label}
          </button>
        ))}
      </nav>
      {dirty && (
        <p className="vs-note" role="status">
          You have unsaved changes.{' '}
          <button type="button" className="vs-link" onClick={() => setD(base)}>
            Discard them
          </button>
        </p>
      )}
      {step === 'basics' && <BasicsStep {...props} />}
      {step === 'revenue' && <RevenueStep {...props} />}
      {step === 'spending' && <SpendingStep {...props} />}
      {step === 'funds' && <FundsStep {...props} />}
      {step === 'totals' && <TotalsStep {...props} />}
      {step === 'projects' && <ProjectsStep {...props} />}
      {step === 'more' && <ChartsStep {...props} />}
      {step === 'save' && <SaveStep {...props} base={base} saved={o.book} onSaved={onSaved} jump={go} min={o.noteMin} max={o.noteMax} />}
      <div className="vs-actions vs-stepper">
        <button type="button" className="vs-btn vs-btn-quiet" disabled={at <= 0} onClick={() => go(STEPS[at - 1].id)}>
          <ArrowLeft size={16} aria-hidden="true" /> Back
        </button>
        {at < STEPS.length - 1 && (
          <button type="button" className="vs-btn vs-btn-primary" onClick={() => go(STEPS[at + 1].id)}>
            Next: {STEPS[at + 1].label} <ArrowRight size={16} aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}

/** The budget: every figure on the Budget page, in the chat's budget answers and on the map's project list. */
export default function Budget() {
  const q = useStaffData<Overview>('/budget/book');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [showVersions, setShowVersions] = useState(false);
  const banner = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (notice) banner.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [notice]);
  const o = q.data;
  const now = o?.versions.find((v) => v.version === o.active);

  return (
    <section className="vs-stack vs-budget" aria-labelledby="vs-budget">
      <div>
        <h1 id="vs-budget" className="vs-title">
          Budget
        </h1>
        <p className="vs-lede">
          Change any figure in the city budget. The Budget page, the chat's budget answers and the map's project list all use what you save here. Work through the steps, then save. Every version is
          kept.
        </p>
      </div>

      {notice && (
        <p className="vs-ok" role="status" ref={banner}>
          {notice}
        </p>
      )}
      <Alert>{error || q.error}</Alert>

      {!o && !q.error && <p className="vs-hint">Loading the budget...</p>}
      {o && (
        <>
          <div className="vs-card vs-stack">
            <h2 className="vs-h2">On the portal now</h2>
            <p>
              {o.active === 0 ? (
                <>The built-in budget for fiscal year {o.book.fiscalYear}. No changes have been saved yet.</>
              ) : (
                <>
                  Version {o.active} for fiscal year {o.book.fiscalYear}
                  {now ? `, saved ${when(now.created_at)}${now.created_by ? ` by ${now.created_by}` : ''}` : ''}.
                </>
              )}
            </p>
            {now && <p className="vs-hint">{now.note}</p>}
            <div className="vs-actions">
              <a className="vs-btn vs-btn-small vs-btn-quiet" href="/budget" target="_blank" rel="noreferrer">
                <ExternalLink size={14} aria-hidden="true" /> See the Budget page
              </a>
              <button type="button" className="vs-btn vs-btn-small vs-btn-quiet" aria-expanded={showVersions} onClick={() => setShowVersions(!showVersions)}>
                <History size={14} aria-hidden="true" /> {showVersions ? 'Hide the versions' : 'See earlier versions'}
              </button>
            </div>
            {showVersions && (
              <Versions
                o={o}
                onError={setError}
                onDone={(s) => {
                  setNotice(s);
                  setShowVersions(false);
                  q.reload();
                }}
              />
            )}
          </div>
          <Editor
            key={`${o.active}:${o.versions[0]?.created_at ?? ''}`}
            o={o}
            onSaved={(version) => {
              setNotice(`Saved as version ${version}. Visitors see it within a minute.`);
              setError('');
              q.reload();
            }}
          />
        </>
      )}
    </section>
  );
}
