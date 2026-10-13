/** The steps of the Budget screen: each edits one part of the draft. */
import { useState, type ReactNode } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { staff } from './api';
import { Alert, Field } from './ui';
import { Cell, DocPicker, FeaturePicker, MoneyBox, TableTools, WholeBox } from './BudgetParts';
import { TABLES, TOLERANCE, applyImport, blankRow, fromDraft, lineSums, newKey, usd, type Draft, type Group, type LineRow, type Project, type RevRow, type Series } from './budgetLib';

export interface StepProps {
  d: Draft;
  set: (fn: (d: Draft) => Draft) => void;
}

function Row({ children, onRemove, label, disabled, note }: { children: ReactNode; onRemove?: () => void; label: string; disabled?: boolean; note?: string }) {
  return (
    <li className="vs-brow">
      <div className="vs-bgrid">{children}</div>
      {onRemove && (
        <div className="vs-actions">
          <button type="button" className="vs-btn vs-btn-small vs-btn-quiet" onClick={onRemove} disabled={disabled} aria-label={`Remove ${label || 'this row'}`}>
            <Trash2 size={14} aria-hidden="true" /> Remove
          </button>
          {note && <span className="vs-hint">{note}</span>}
        </div>
      )}
    </li>
  );
}

const Add = ({ onClick, children }: { onClick: () => void; children: ReactNode }) => (
  <div className="vs-actions">
    <button type="button" className="vs-btn vs-btn-quiet" onClick={onClick}>
      <Plus size={16} aria-hidden="true" /> {children}
    </button>
  </div>
);

function GroupSelect({ value, groups, onChange }: { value: string; groups: Group[]; onChange: (k: string) => void }) {
  return (
    <Cell label="Chart group" wide>
      <select value={groups.some((g) => g.key === value) ? value : (groups[0]?.key ?? '')} onChange={(e) => onChange(e.target.value)}>
        {groups.map((g) => (
          <option key={g.key || g.name} value={g.key}>
            {g.name || 'Unnamed group'}
          </option>
        ))}
      </select>
    </Cell>
  );
}

const Sum = ({ children }: { children: ReactNode }) => <p className="vs-sum">{children}</p>;

// ---- basics

export function BasicsStep({ d, set }: StepProps) {
  const p = <K extends keyof Draft>(k: K, v: Draft[K]) => set((x) => ({ ...x, [k]: v }));
  const doc = (k: keyof Draft['docs'], id: string) => set((x) => ({ ...x, docs: { ...x.docs, [k]: id } }));
  return (
    <div className="vs-stack">
      <p className="vs-lede">Start with the facts printed on the budget the council adopted. These words and dates are what residents and the chat see.</p>
      <div className="vs-card vs-stack">
        <h2 className="vs-h2">The budget</h2>
        <div className="vs-pair">
          <Field label="Fiscal year" hint="The year it ends in, such as 2027 for July 2026 to June 2027.">
            {(id) => <input id={id} type="text" inputMode="numeric" value={d.fiscalYear || ''} onChange={(e) => p('fiscalYear', Number(e.target.value.replace(/\D/g, '').slice(0, 4)) || 0)} />}
          </Field>
          <Field label="Date the council adopted it">{(id) => <input id={id} type="date" value={d.adopted} onChange={(e) => p('adopted', e.target.value)} />}</Field>
        </div>
        <Field label="Adopting ordinance" hint="Such as Ordinance 2026-08.">
          {(id) => <input id={id} value={d.adoptionOrdinance} maxLength={60} onChange={(e) => p('adoptionOrdinance', e.target.value)} />}
        </Field>
        <DocPicker label="Adopting ordinance document" value={d.adoptionOrdinanceDoc} optional onChange={(v) => p('adoptionOrdinanceDoc', v)} />
        <DocPicker label="Budget book" value={d.docs.book} onChange={(v) => doc('book', v)} hint="The adopted budget document. The chat and the Budget page link to it." />
        <DocPicker label="Budget slides" value={d.docs.slides} onChange={(v) => doc('slides', v)} hint="The slides with the capital project lists." />
        <div className="vs-pair">
          <Field label="Tentative budget date" hint="Optional. The day the council saw it.">
            {(id) => <input id={id} type="date" value={d.tentativeDate} onChange={(e) => p('tentativeDate', e.target.value)} />}
          </Field>
        </div>
        <DocPicker label="Tentative budget" value={d.docs.tentative} optional onChange={(v) => doc('tentative', v)} />
      </div>
      <div className="vs-card vs-stack">
        <h2 className="vs-h2">Amendments</h2>
        <label className="vs-check">
          <input type="checkbox" checked={d.amendedYet} onChange={(e) => p('amendedYet', e.target.checked)} /> The council has amended this budget since it was adopted
        </label>
        {d.amendedYet ? (
          <>
            <div className="vs-pair">
              <Field label="What it is called" hint="Such as First Budget Amendment. Use the latest one.">
                {(id) => <input id={id} value={d.amendmentName} maxLength={60} onChange={(e) => p('amendmentName', e.target.value)} />}
              </Field>
              <Field label="Date of the latest amendment">{(id) => <input id={id} type="date" value={d.amended} onChange={(e) => p('amended', e.target.value)} />}</Field>
            </div>
            <Field label="Amending ordinance">{(id) => <input id={id} value={d.amendmentOrdinance} maxLength={60} onChange={(e) => p('amendmentOrdinance', e.target.value)} />}</Field>
            <DocPicker label="Amendment document" value={d.docs.amendment} optional onChange={(v) => doc('amendment', v)} />
            <DocPicker label="Amendment summary" value={d.docs.amendmentSummary} optional onChange={(v) => doc('amendmentSummary', v)} />
          </>
        ) : (
          <p className="vs-hint">Without an amendment, every department shows its adopted amount and the page says nothing about amendments.</p>
        )}
      </div>
    </div>
  );
}

// ---- revenue

function RevenueTable({ d, set, id, title }: StepProps & { id: 'revenue' | 'transfersIn'; title: string }) {
  const rows = d[id];
  const edit = (i: number, patch: Partial<RevRow>) => set((x) => ({ ...x, [id]: x[id].map((r, j) => (j === i ? { ...r, ...patch } : r)) }));
  return (
    <div className="vs-card vs-stack">
      <h2 className="vs-h2">{title}</h2>
      <TableTools spec={TABLES[id]} rows={rows} groups={d.revenueGroups} onApply={(imp) => set((x) => applyImport(x, id, imp))} />
      <ul className="vs-list">
        {rows.map((r, i) => (
          <Row key={i} label={r.name} onRemove={() => set((x) => ({ ...x, [id]: x[id].filter((_, j) => j !== i) }))}>
            <Cell label="Name" wide>
              <input value={r.name} maxLength={60} onChange={(e) => edit(i, { name: e.target.value })} />
            </Cell>
            <Cell label="Amount">
              <MoneyBox value={r.amount} onChange={(n) => edit(i, { amount: n })} />
            </Cell>
            <GroupSelect value={r.group} groups={d.revenueGroups} onChange={(group) => edit(i, { group })} />
          </Row>
        ))}
      </ul>
      {rows.length === 0 && <p className="vs-empty">No lines yet.</p>}
      <Add onClick={() => set((x) => ({ ...x, [id]: [...x[id], blankRow(id, x.revenueGroups[0]?.key ?? '') as unknown as RevRow] }))}>Add a line</Add>
    </div>
  );
}

export function RevenueStep(props: StepProps) {
  const s = lineSums(props.d);
  return (
    <div className="vs-stack">
      <p className="vs-lede">The General Fund's money coming in. Revenue is what the city collects; transfers in is money moved from other funds.</p>
      <RevenueTable {...props} id="revenue" title="Revenue" />
      <Sum>Revenue lines add up to {usd(s.revenue)}.</Sum>
      <RevenueTable {...props} id="transfersIn" title="Transfers in" />
      <Sum>Transfers in add up to {usd(s.transfersIn)}.</Sum>
    </div>
  );
}

// ---- spending

function SpendingTable({ d, set, id, title }: StepProps & { id: 'departments' | 'transfersOut'; title: string }) {
  const rows = d[id];
  const edit = (i: number, patch: Partial<LineRow>) => set((x) => ({ ...x, [id]: x[id].map((r, j) => (j === i ? { ...r, ...patch } : r)) }));
  return (
    <div className="vs-card vs-stack">
      <h2 className="vs-h2">{title}</h2>
      <TableTools spec={TABLES[id]} rows={rows} groups={d.spendGroups} onApply={(imp) => set((x) => applyImport(x, id, imp))} />
      <ul className="vs-list">
        {rows.map((r, i) => (
          <Row key={i} label={r.name} onRemove={() => set((x) => ({ ...x, [id]: x[id].filter((_, j) => j !== i) }))}>
            <Cell label="Name" wide>
              <input value={r.name} maxLength={60} onChange={(e) => edit(i, { name: e.target.value })} />
            </Cell>
            <Cell label="Last year">
              <MoneyBox value={r.prior} onChange={(n) => edit(i, { prior: n })} />
            </Cell>
            <Cell label="Adopted">
              <MoneyBox value={r.adopted} onChange={(n) => edit(i, d.amendedYet ? { adopted: n } : { adopted: n, amended: n })} />
            </Cell>
            {d.amendedYet && (
              <Cell label="After amendment">
                <MoneyBox value={r.amended} onChange={(n) => edit(i, { amended: n })} />
              </Cell>
            )}
            <GroupSelect value={r.group} groups={d.spendGroups} onChange={(group) => edit(i, { group })} />
          </Row>
        ))}
      </ul>
      {rows.length === 0 && <p className="vs-empty">No lines yet.</p>}
      <Add onClick={() => set((x) => ({ ...x, [id]: [...x[id], blankRow(id, x.spendGroups[0]?.key ?? '') as unknown as LineRow] }))}>Add a line</Add>
    </div>
  );
}

export function SpendingStep(props: StepProps) {
  const s = lineSums(props.d);
  return (
    <div className="vs-stack">
      <p className="vs-lede">What the General Fund pays for: each department, then money sent to other funds.</p>
      <SpendingTable {...props} id="departments" title="Departments" />
      <Sum>
        Departments add up to {usd(s.departmentsAdopted)} adopted{props.d.amendedYet ? ` and ${usd(s.departmentsAmended)} after the amendment` : ''}.
      </Sum>
      <SpendingTable {...props} id="transfersOut" title="Transfers out" />
      <Sum>
        Transfers out add up to {usd(s.transfersOutAdopted)} adopted{props.d.amendedYet ? ` and ${usd(s.transfersOutAmended)} after the amendment` : ''}.
      </Sum>
    </div>
  );
}

// ---- funds

export function FundsStep({ d, set }: StepProps) {
  const edit = (i: number, patch: Partial<Draft['funds'][number]>) => set((x) => ({ ...x, funds: x.funds.map((f, j) => (j === i ? { ...f, ...patch } : f)) }));
  return (
    <div className="vs-stack">
      <p className="vs-lede">Every fund and its revenue and sources, as the budget book lists them. The city budget is shown fund by fund, so the funds are never added together.</p>
      <div className="vs-card vs-stack">
        <h2 className="vs-h2">Funds</h2>
        <TableTools spec={TABLES.funds} rows={d.funds} onApply={(imp) => set((x) => applyImport(x, 'funds', imp))} />
        <ul className="vs-list">
          {d.funds.map((f, i) => (
            <Row
              key={i}
              label={f.name}
              disabled={f.key === 'general'}
              note={f.key === 'general' ? 'The General Fund stays.' : undefined}
              onRemove={() => set((x) => ({ ...x, funds: x.funds.filter((_, j) => j !== i) }))}
            >
              <Cell label="Name" wide>
                <input value={f.name} maxLength={60} onChange={(e) => edit(i, { name: e.target.value })} />
              </Cell>
              <Cell label="Total revenue and sources">
                <MoneyBox value={f.total} onChange={(n) => edit(i, { total: n })} />
              </Cell>
              <Cell label="What it pays for" wide>
                <input value={f.about} maxLength={220} onChange={(e) => edit(i, { about: e.target.value })} />
              </Cell>
            </Row>
          ))}
        </ul>
        <Add onClick={() => set((x) => ({ ...x, funds: [...x.funds, { key: '', name: '', about: '', total: 0 }] }))}>Add a fund</Add>
      </div>
    </div>
  );
}

// ---- totals

export function TotalsStep({ d, set }: StepProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const s = lineSums(d);
  const g = d.general;
  const put = (patch: Partial<Draft['general']>) => set((x) => ({ ...x, general: { ...x.general, ...patch } }));
  const putSide = (side: 'adopted' | 'amended', patch: Partial<Draft['general']['adopted']>) => set((x) => ({ ...x, general: { ...x.general, [side]: { ...x.general[side], ...patch } } }));
  const near = (typed: number, lines: number) => Math.abs(typed - lines) <= TOLERANCE;
  const hint = (typed: number, lines: number, what: string) => (near(typed, lines) ? undefined : `${what} add up to ${usd(lines)}, which is different.`);

  async function addUp() {
    setBusy(true);
    setError('');
    try {
      const r = await staff<{ totals: Draft['general'] }>('/budget/totals', { body: { book: fromDraft(d) } });
      set((x) => ({
        ...x,
        general: d.amendedYet ? r.totals : { ...r.totals, amended: { ...r.totals.adopted }, cutByAmendment: 0 },
        funds: x.funds.map((f) => (f.key === 'general' ? { ...f, total: r.totals.revenueTotal } : f)),
      }));
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add up the totals.');
    } finally {
      setBusy(false);
    }
  }

  const side = (which: 'adopted' | 'amended', label: string, dep: number, out: number) => (
    <div className="vs-card vs-stack">
      <h2 className="vs-h2">{label}</h2>
      <div className="vs-bgrid">
        <Cell label="Departments" hint={hint(g[which].departments, dep, 'The departments')}>
          <MoneyBox value={g[which].departments} onChange={(n) => putSide(which, { departments: n })} />
        </Cell>
        <Cell label="Transfers out" hint={hint(g[which].transfersOut, out, 'The transfers out')}>
          <MoneyBox value={g[which].transfersOut} onChange={(n) => putSide(which, { transfersOut: n })} />
        </Cell>
        <Cell
          label="Total spending"
          hint={near(g[which].total, g[which].departments + g[which].transfersOut) ? undefined : `Departments plus transfers out is ${usd(g[which].departments + g[which].transfersOut)}.`}
        >
          <MoneyBox value={g[which].total} onChange={(n) => putSide(which, { total: n })} />
        </Cell>
        <Cell label="Surplus" hint={near(g[which].surplus, g.revenueTotal - g[which].total) ? undefined : `Revenue minus spending is ${usd(g.revenueTotal - g[which].total)}.`}>
          <MoneyBox value={g[which].surplus} onChange={(n) => putSide(which, { surplus: n })} />
        </Cell>
      </div>
    </div>
  );

  return (
    <div className="vs-stack">
      <p className="vs-lede">The General Fund totals printed in the budget book. They must match the lines you entered, give or take a few dollars of the book's own rounding.</p>
      <div className="vs-card vs-stack">
        <p>Let the screen add the lines up, then check the numbers against the book.</p>
        <div className="vs-actions">
          <button type="button" className="vs-btn vs-btn-primary" disabled={busy} onClick={addUp}>
            {busy ? 'Adding up...' : 'Add up the totals from my lines'}
          </button>
        </div>
        {done && !error && (
          <p className="vs-ok" role="status">
            The totals now match your lines.
          </p>
        )}
        <Alert>{error}</Alert>
      </div>
      <div className="vs-card vs-stack">
        <h2 className="vs-h2">Revenue</h2>
        <div className="vs-bgrid">
          <Cell label="Revenue" hint={hint(g.revenueBeforeTransfers, s.revenue, 'The revenue lines')}>
            <MoneyBox value={g.revenueBeforeTransfers} onChange={(n) => put({ revenueBeforeTransfers: n })} />
          </Cell>
          <Cell label="Transfers in" hint={hint(g.transfersIn, s.transfersIn, 'The transfers in')}>
            <MoneyBox value={g.transfersIn} onChange={(n) => put({ transfersIn: n })} />
          </Cell>
          <Cell
            label="Total revenue"
            hint={near(g.revenueTotal, g.revenueBeforeTransfers + g.transfersIn) ? undefined : `Revenue plus transfers in is ${usd(g.revenueBeforeTransfers + g.transfersIn)}.`}
          >
            <MoneyBox value={g.revenueTotal} onChange={(n) => put({ revenueTotal: n })} />
          </Cell>
        </div>
      </div>
      {side('adopted', 'Spending as adopted', s.departmentsAdopted, s.transfersOutAdopted)}
      {d.amendedYet && (
        <>
          {side('amended', 'Spending after the amendment', s.departmentsAmended, s.transfersOutAmended)}
          <div className="vs-card vs-stack">
            <Cell
              label="Cut by the amendment"
              hint={near(g.cutByAmendment, g.adopted.total - g.amended.total) ? undefined : `Adopted minus amended spending is ${usd(g.adopted.total - g.amended.total)}.`}
            >
              <MoneyBox value={g.cutByAmendment} onChange={(n) => put({ cutByAmendment: n })} />
            </Cell>
          </div>
        </>
      )}
      <div className="vs-card vs-stack">
        <Cell label="Spending in the tentative budget" hint="Optional. Leave at zero if there was none.">
          <MoneyBox value={g.tentativeTotal} onChange={(n) => put({ tentativeTotal: n })} optionalZero />
        </Cell>
      </div>
    </div>
  );
}

// ---- projects

export function ProjectsStep({ d, set }: StepProps) {
  const [find, setFind] = useState('');
  const edit = (i: number, patch: Partial<Project>) => set((x) => ({ ...x, projects: x.projects.map((p, j) => (j === i ? { ...p, ...patch } : p)) }));
  const q = find.trim().toLowerCase();
  const shown = d.projects.map((p, i) => ({ p, i })).filter(({ p }) => !q || p.name.toLowerCase().includes(q) || p.dept.toLowerCase().includes(q));
  const total = d.projects.reduce((a, p) => a + p.amount, 0);
  const editFund = (i: number, name: string) => set((x) => ({ ...x, projectFunds: x.projectFunds.map((f, j) => (j === i ? { ...f, name } : f)) }));
  const usedBy = (key: string) => d.projects.filter((p) => p.fund === key).length;

  return (
    <div className="vs-stack">
      <p className="vs-lede">The capital projects in the budget. A project linked to the city's map shows there with its budget amount.</p>
      <div className="vs-card vs-stack">
        <h2 className="vs-h2">Where the money comes from</h2>
        <ul className="vs-list">
          {d.projectFunds.map((f, i) => (
            <Row
              key={i}
              label={f.name}
              disabled={usedBy(f.key) > 0}
              note={usedBy(f.key) > 0 ? `${usedBy(f.key)} project${usedBy(f.key) === 1 ? '' : 's'} use it.` : undefined}
              onRemove={() => set((x) => ({ ...x, projectFunds: x.projectFunds.filter((_, j) => j !== i) }))}
            >
              <Cell label="Name" wide>
                <input value={f.name} maxLength={60} onChange={(e) => editFund(i, e.target.value)} />
              </Cell>
            </Row>
          ))}
        </ul>
        <Add onClick={() => set((x) => ({ ...x, projectFunds: [...x.projectFunds, { key: newKey(), name: '' }] }))}>Add a funding source</Add>
      </div>
      <div className="vs-card vs-stack">
        <h2 className="vs-h2">Projects</h2>
        <TableTools spec={TABLES.projects} rows={d.projects} funds={d.projectFunds} onApply={(imp) => set((x) => applyImport(x, 'projects', imp))} />
        <div className="vs-search">
          <input type="search" value={find} placeholder="Find a project" aria-label="Find a project" onChange={(e) => setFind(e.target.value)} autoComplete="off" />
        </div>
        <ul className="vs-list">
          {shown.map(({ p, i }) => (
            <Row key={i} label={p.name} onRemove={() => set((x) => ({ ...x, projects: x.projects.filter((_, j) => j !== i) }))}>
              <Cell label="Project" wide>
                <input value={p.name} maxLength={160} onChange={(e) => edit(i, { name: e.target.value })} />
              </Cell>
              <Cell label="Paid from">
                <select value={p.fund} onChange={(e) => edit(i, { fund: e.target.value })}>
                  <option value="">Choose...</option>
                  {d.projectFunds.map((f) => (
                    <option key={f.key || f.name} value={f.key}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </Cell>
              <Cell label="Amount">
                <MoneyBox value={p.amount} onChange={(n) => edit(i, { amount: n })} />
              </Cell>
              <Cell label="Department">
                <input value={p.dept} maxLength={60} onChange={(e) => edit(i, { dept: e.target.value })} />
              </Cell>
              <Cell label="Slide page">
                <WholeBox value={p.page} min={1} max={999} onChange={(n) => edit(i, { page: n })} />
              </Cell>
              <FeaturePicker
                feature={p.feature}
                featureName={p.featureName}
                onChange={(feature, name) => set((x) => ({ ...x, projects: x.projects.map((r, j) => (j === i ? withFeature(r, feature, name) : r)) }))}
              />
            </Row>
          ))}
        </ul>
        {shown.length === 0 && <p className="vs-empty">{d.projects.length ? 'No project matches.' : 'No projects yet.'}</p>}
        <Add onClick={() => set((x) => ({ ...x, projects: [...x.projects, { fund: x.projectFunds[0]?.key ?? '', dept: '', name: '', amount: 0, page: 1 }] }))}>Add a project</Add>
        <Sum>
          {d.projects.length} project{d.projects.length === 1 ? '' : 's'}, {usd(total)} in all.
        </Sum>
      </div>
    </div>
  );
}

function withFeature(p: Project, feature: number | null, name: string): Project {
  const { feature: _f, featureName: _n, ...rest } = p; // eslint-disable-line @typescript-eslint/no-unused-vars
  return feature ? { ...rest, feature, ...(name ? { featureName: name } : {}) } : rest;
}

// ---- charts

function GroupsEditor({ title, groups, usedBy, onChange, hint }: { title: string; groups: Group[]; usedBy: (key: string) => number; onChange: (g: Group[]) => void; hint: string }) {
  return (
    <div className="vs-card vs-stack">
      <h2 className="vs-h2">{title}</h2>
      <p className="vs-hint">{hint}</p>
      <ul className="vs-list">
        {groups.map((g, i) => (
          <Row
            key={i}
            label={g.name}
            disabled={groups.length < 2}
            note={usedBy(g.key) ? `${usedBy(g.key)} line${usedBy(g.key) === 1 ? '' : 's'} move to the first group.` : undefined}
            onRemove={() => onChange(groups.filter((_, j) => j !== i))}
          >
            <Cell label="Group name" wide>
              <input value={g.name} maxLength={60} onChange={(e) => onChange(groups.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
            </Cell>
          </Row>
        ))}
      </ul>
      <Add onClick={() => onChange([...groups, { key: newKey(), name: '' }])}>Add a group</Add>
    </div>
  );
}

export function ChartsStep({ d, set }: StepProps) {
  const [years, setYears] = useState(d.historyYears.join(', '));
  const count = (rows: Array<{ group: string }>, key: string) => rows.filter((r) => r.group === key).length;
  const setSeries = (i: number, patch: Partial<Series>) => set((x) => ({ ...x, history: x.history.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));
  function changeYears(text: string) {
    setYears(text);
    const list = text
      .split(',')
      .map((y) => y.trim())
      .filter(Boolean)
      .slice(0, 10);
    set((x) => ({ ...x, historyYears: list, history: x.history.map((s) => ({ ...s, values: list.map((_, i) => s.values[i] ?? 0) })) }));
  }
  return (
    <div className="vs-stack">
      <p className="vs-lede">How the charts on the Budget page group and compare lines. Most years nothing here needs to change.</p>
      <GroupsEditor
        title="Spending chart groups"
        hint="Each department and transfer out sits in one group on the spending chart. Choose a line's group in the Spending step."
        groups={d.spendGroups}
        usedBy={(k) => count(d.departments, k) + count(d.transfersOut, k)}
        onChange={(spendGroups) => set((x) => ({ ...x, spendGroups }))}
      />
      <GroupsEditor
        title="Revenue chart groups"
        hint="Each revenue line and transfer in sits in one group on the revenue chart. Choose a line's group in the Revenue step."
        groups={d.revenueGroups}
        usedBy={(k) => count(d.revenue, k) + count(d.transfersIn, k)}
        onChange={(revenueGroups) => set((x) => ({ ...x, revenueGroups }))}
      />
      <div className="vs-card vs-stack">
        <h2 className="vs-h2">Five-year history</h2>
        <p className="vs-hint">The biggest General Fund lines over the years. Years are shown as you write them.</p>
        <Field label="Years" hint="Separate with commas, oldest first, such as FY23, FY24, FY25, FY26, FY27.">
          {(id) => <input id={id} value={years} onChange={(e) => changeYears(e.target.value)} />}
        </Field>
        <ul className="vs-list">
          {d.history.map((s, i) => (
            <Row key={i} label={s.name} onRemove={() => set((x) => ({ ...x, history: x.history.filter((_, j) => j !== i) }))}>
              <Cell label="Line" wide>
                <input value={s.name} maxLength={60} onChange={(e) => setSeries(i, { name: e.target.value })} />
              </Cell>
              <Cell label="Kind">
                <select value={s.kind} onChange={(e) => setSeries(i, { kind: e.target.value === 'spending' ? 'spending' : 'revenue' })}>
                  <option value="revenue">Revenue</option>
                  <option value="spending">Spending</option>
                </select>
              </Cell>
              {d.historyYears.map((y, k) => (
                <Cell key={k} label={y}>
                  <MoneyBox value={s.values[k] ?? 0} onChange={(n) => setSeries(i, { values: d.historyYears.map((_, m) => (m === k ? n : (s.values[m] ?? 0))) })} />
                </Cell>
              ))}
            </Row>
          ))}
        </ul>
        <Add onClick={() => set((x) => ({ ...x, history: [...x.history, { key: '', name: '', kind: 'revenue', values: x.historyYears.map(() => 0) }] }))}>Add a line</Add>
      </div>
    </div>
  );
}
