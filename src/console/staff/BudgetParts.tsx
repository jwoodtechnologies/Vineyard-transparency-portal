/** Small pieces the Budget screen is built from: amount boxes, the document and map pickers, and spreadsheet import. */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Download, FileSpreadsheet, Search, X } from 'lucide-react';
import { staff } from './api';
import { Alert } from './ui';
import { exportRows, importRows, moneyOf, showMoney, usd, type Group, type Imported, type TableSpec } from './budgetLib';

/** A labelled box inside a row card. The label wraps the box, so it stays attached on a phone. */
export function Cell({ label, wide, hint, children }: { label: string; wide?: boolean; hint?: string; children: ReactNode }) {
  return (
    <label className={wide ? 'vs-bf vs-bf-wide' : 'vs-bf'}>
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

/** A dollar amount. Shows commas when you leave it and takes "$1,234" or "1234" while you type. */
export function MoneyBox({ value, onChange, label, optionalZero }: { value: number; onChange: (n: number) => void; label?: string; optionalZero?: boolean }) {
  const [text, setText] = useState<string | null>(null);
  const shown = text ?? (optionalZero && value === 0 ? '' : showMoney(value));
  const bad = text !== null && text.trim() !== '' && moneyOf(text) === null;
  return (
    <input
      type="text"
      inputMode="numeric"
      autoComplete="off"
      className="vs-money"
      aria-label={label}
      aria-invalid={bad || undefined}
      value={shown}
      onFocus={(e) => {
        // The text stays as it is shown, so the selection below holds and the next thing typed replaces the amount.
        setText(e.currentTarget.value);
        e.currentTarget.select();
      }}
      onChange={(e) => {
        setText(e.target.value);
        const n = e.target.value.trim() === '' ? 0 : moneyOf(e.target.value);
        if (n !== null) onChange(n);
      }}
      onBlur={() => setText(null)}
    />
  );
}

/** A whole number such as a page or a year. */
export function WholeBox({ value, onChange, label, min = 0, max = 99999 }: { value: number; onChange: (n: number) => void; label?: string; min?: number; max?: number }) {
  const [text, setText] = useState<string | null>(null);
  return (
    <input
      type="text"
      inputMode="numeric"
      autoComplete="off"
      aria-label={label}
      value={text ?? (value ? String(value) : '')}
      onFocus={() => setText(value ? String(value) : '')}
      onChange={(e) => {
        const t = e.target.value.replace(/[^\d]/g, '');
        setText(t);
        const n = Number(t);
        onChange(t === '' ? 0 : Math.min(max, Math.max(min, n)));
      }}
      onBlur={() => setText(null)}
    />
  );
}

// ---- documents

interface DocHit {
  id: string;
  title: string;
  date: string | null;
  type: string | null;
}

/** Choose a document from the archive by name; shows what is chosen now. */
export function DocPicker({ label, value, onChange, optional, hint }: { label: string; value: string; onChange: (id: string) => void; optional?: boolean; hint?: string }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<DocHit[] | null>(null);
  const [current, setCurrent] = useState<DocHit | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    if (!value) {
      queueMicrotask(() => live && setCurrent(null));
      return;
    }
    staff<{ items: DocHit[] }>(`/budget/documents?q=${encodeURIComponent(value)}`).then(
      (r) => live && setCurrent(r.items.find((d) => d.id === value) ?? null),
      () => live && setCurrent(null),
    );
    return () => {
      live = false;
    };
  }, [value]);

  useEffect(() => {
    if (!open) return;
    let live = true;
    const t = setTimeout(() => {
      staff<{ items: DocHit[] }>(`/budget/documents?q=${encodeURIComponent(q.trim())}`).then(
        (r) => live && (setHits(r.items), setError('')),
        (e: Error) => live && setError(e.message),
      );
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q, open]);

  const typed = /^doc_[0-9a-f]{16}$/.test(q.trim()) ? q.trim() : '';

  return (
    <div className="vs-field vs-doc">
      <span className="vs-doc-label" id={`${id}-l`}>
        {label}
      </span>
      <div className="vs-doc-now" aria-labelledby={`${id}-l`}>
        {value ? (
          <>
            <span className="vs-doc-title">{current ? current.title : value}</span>
            {current && <span className="vs-hint">{[current.date, current.type].filter(Boolean).join(' · ')}</span>}
          </>
        ) : (
          <span className="vs-hint">{optional ? 'None chosen' : 'Not chosen yet'}</span>
        )}
      </div>
      <div className="vs-actions">
        <button type="button" className="vs-btn vs-btn-small vs-btn-quiet" aria-expanded={open} onClick={() => setOpen(!open)}>
          <Search size={14} aria-hidden="true" /> {value ? 'Change' : 'Choose'}
        </button>
        {value && optional && (
          <button type="button" className="vs-btn vs-btn-small vs-btn-quiet" onClick={() => onChange('')}>
            <X size={14} aria-hidden="true" /> Clear
          </button>
        )}
      </div>
      {open && (
        <div className="vs-pickbox">
          <input
            type="search"
            value={q}
            placeholder="Search by title, such as FY 28 Final Budget"
            aria-label={`Search documents for ${label}`}
            onChange={(e) => setQ(e.target.value)}
            autoComplete="off"
          />
          <Alert>{error}</Alert>
          <ul className="vs-pick" aria-label="Documents found">
            {typed && !hits?.some((h) => h.id === typed) && (
              <li>
                <button
                  type="button"
                  onClick={() => {
                    onChange(typed);
                    setOpen(false);
                  }}
                >
                  <strong>Use the code {typed}</strong>
                </button>
              </li>
            )}
            {hits?.map((h) => (
              <li key={h.id}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(h.id);
                    setCurrent(h);
                    setOpen(false);
                    setQ('');
                  }}
                >
                  <strong>{h.title}</strong>
                  <span>{[h.date, h.type].filter(Boolean).join(' · ')}</span>
                </button>
              </li>
            ))}
            {hits && !hits.length && !typed && <li className="vs-empty">No documents match. Try fewer words, or paste the document code.</li>}
          </ul>
        </div>
      )}
      {hint && <p className="vs-hint">{hint}</p>}
    </div>
  );
}

// ---- the city's map

interface MapFeature {
  id: number;
  name: string;
}

/** Links a capital project to a project on the city's Capital Improvement Plan map: search by name, or type the number. */
export function FeaturePicker({ feature, featureName, onChange }: { feature?: number; featureName?: string; onChange: (feature: number | null, name: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [list, setList] = useState<{ items: MapFeature[]; unavailable: boolean } | null>(null);
  const [typed, setTyped] = useState('');
  const asked = useRef(false);

  useEffect(() => {
    if (!open || asked.current) return;
    asked.current = true;
    let live = true;
    staff<{ items: MapFeature[]; unavailable: boolean }>('/budget/features').then(
      (r) => live && setList(r),
      () => live && setList({ items: [], unavailable: true }),
    );
    return () => {
      live = false;
    };
  }, [open]);

  const matches = (list?.items ?? []).filter((f) => !q.trim() || f.name.toLowerCase().includes(q.trim().toLowerCase()) || String(f.id) === q.trim()).slice(0, 8);
  const number = Number(typed);
  const typedOk = /^\d{1,5}$/.test(typed) && number > 0;

  return (
    <div className="vs-bf vs-bf-wide vs-feature">
      <span>Shows on the map as</span>
      {feature ? (
        <p className="vs-feature-now">
          <strong>{featureName || `Map project ${feature}`}</strong> <span className="vs-hint">(number {feature})</span>
        </p>
      ) : (
        <p className="vs-hint">Not on the map. Link it to a project on the city's map so residents can find it there.</p>
      )}
      <div className="vs-actions">
        <button type="button" className="vs-btn vs-btn-small vs-btn-quiet" aria-expanded={open} onClick={() => setOpen(!open)}>
          {feature ? 'Change the link' : 'Link to the map'}
        </button>
        {feature ? (
          <button type="button" className="vs-btn vs-btn-small vs-btn-quiet" onClick={() => onChange(null, '')}>
            Remove the link
          </button>
        ) : null}
      </div>
      {open && (
        <div className="vs-pickbox">
          {list === null && <p className="vs-hint">Loading the city's map projects...</p>}
          {list?.unavailable && <p className="vs-hint">The city's map did not answer. Type the project number below instead.</p>}
          {list && !list.unavailable && (
            <>
              <input type="search" value={q} placeholder="Search the map projects by name" aria-label="Search the city's map projects" onChange={(e) => setQ(e.target.value)} autoComplete="off" />
              <ul className="vs-pick" aria-label="Map projects found">
                {matches.map((f) => (
                  <li key={f.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onChange(f.id, f.name);
                        setOpen(false);
                      }}
                    >
                      <strong>{f.name}</strong>
                      <span>Number {f.id}</span>
                    </button>
                  </li>
                ))}
                {!matches.length && <li className="vs-empty">No map project matches.</li>}
              </ul>
            </>
          )}
          <div className="vs-inline">
            <input type="text" inputMode="numeric" value={typed} placeholder="Or type its number" aria-label="Map project number" onChange={(e) => setTyped(e.target.value.replace(/[^\d]/g, ''))} />
            <button
              type="button"
              className="vs-btn vs-btn-quiet"
              disabled={!typedOk}
              onClick={() => {
                onChange(number, list?.items.find((f) => f.id === number)?.name ?? '');
                setTyped('');
                setOpen(false);
              }}
            >
              Use this number
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- spreadsheets

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob(['﻿', text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Download the table as a spreadsheet, or replace it with rows pasted or uploaded from one. */
export function TableTools({
  spec,
  rows,
  funds,
  groups,
  onApply,
}: {
  spec: TableSpec;
  rows: ReadonlyArray<object>;
  funds?: Array<{ key: string; name: string }>;
  groups?: Group[];
  onApply: (rows: Imported['rows']) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [read, setRead] = useState<Imported | null>(null);

  function readIt(from = text) {
    setRead(importRows(spec, from, funds));
  }
  function pickFile(file: File | undefined) {
    if (!file) return;
    if (file.size > 2_000_000) return setRead({ rows: [], problems: ['That file is too large to read here.'], columns: [] });
    if (/\.xlsx?$/i.test(file.name))
      return setRead({ rows: [], problems: ['Excel files cannot be read here. In Excel choose Save As, then CSV, or copy the cells and paste them below.'], columns: [] });
    file.text().then(
      (t) => {
        setText(t);
        readIt(t);
      },
      () => setRead({ rows: [], problems: ['That file could not be read.'], columns: [] }),
    );
  }

  return (
    <div className="vs-tools">
      <div className="vs-actions">
        <button type="button" className="vs-btn vs-btn-small vs-btn-quiet" aria-expanded={open} onClick={() => setOpen(!open)}>
          <FileSpreadsheet size={14} aria-hidden="true" /> Import from a spreadsheet
        </button>
        <button type="button" className="vs-btn vs-btn-small vs-btn-quiet" onClick={() => download(`${spec.id}.csv`, exportRows(spec, rows, funds, groups))}>
          <Download size={14} aria-hidden="true" /> Download as a spreadsheet
        </button>
      </div>
      {open && (
        <div className="vs-pickbox">
          <p className="vs-hint">
            Copy the rows from your spreadsheet, headings first ({spec.columns.map((c) => c.label).join(', ')}), and paste them here. Or choose a CSV file. This replaces the rows now in{' '}
            {spec.label.toLowerCase()}; nothing is saved until you save the budget.
          </p>
          <textarea
            value={text}
            aria-label={`Rows for ${spec.label}`}
            placeholder={`${spec.columns.map((c) => c.label).join('\t')}`}
            onChange={(e) => {
              setText(e.target.value);
              setRead(null);
            }}
          />
          <div className="vs-actions">
            <button type="button" className="vs-btn vs-btn-small vs-btn-primary" disabled={!text.trim()} onClick={() => readIt()}>
              Read the rows
            </button>
            <label className="vs-btn vs-btn-small vs-btn-quiet vs-filebtn">
              Choose a CSV file
              <input type="file" accept=".csv,.tsv,.txt,text/csv,text/plain" className="vs-sr" onChange={(e) => pickFile(e.target.files?.[0])} />
            </label>
          </div>
          {read && (
            <div role="status" className="vs-read">
              {read.problems.length > 0 && (
                <ul className="vs-error" role="alert">
                  {read.problems.slice(0, 8).map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                  {read.problems.length > 8 && <li>And {read.problems.length - 8} more.</li>}
                </ul>
              )}
              {read.rows.length > 0 && (
                <>
                  <p className="vs-ok">
                    {read.rows.length} row{read.rows.length === 1 ? '' : 's'} read. The first few:
                  </p>
                  <ul className="vs-preview-rows">
                    {read.rows.slice(0, 5).map((r, i) => (
                      <li key={i}>
                        <strong>{String(r.name)}</strong>
                        {read.columns
                          .filter((c) => c.kind === 'money' && typeof r[c.key] === 'number')
                          .map((c) => ` · ${c.label} ${usd(Number(r[c.key]))}`)
                          .join('')}
                      </li>
                    ))}
                  </ul>
                  <div className="vs-actions">
                    <button
                      type="button"
                      className="vs-btn vs-btn-small vs-btn-primary"
                      disabled={read.problems.length > 0}
                      onClick={() => {
                        onApply(read.rows);
                        setOpen(false);
                        setText('');
                        setRead(null);
                      }}
                    >
                      Replace {spec.label.toLowerCase()} with these {read.rows.length} rows
                    </button>
                  </div>
                  {read.problems.length > 0 && <p className="vs-hint">Fix the rows above in your spreadsheet and paste again.</p>}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
