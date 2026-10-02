/** /people (directory) and /people/:slug (profile with recorded votes and records). */
import '@fontsource-variable/inter';
import '@fontsource-variable/source-serif-4';
import './console.css';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowUpRight, FileText, MessageSquare, Search, Vote } from 'lucide-react';
import { Frame } from './Chrome';
import { useJson } from './api';
import { TYPE_LABEL, formatDate } from './format';
import { PersonCard, PersonPhoto } from './PersonCard';
import { DocLink } from './DocLink';
import { usePeople, type Person, type PersonDetail, type PersonRecord } from './people';

function RecordRows({ rows }: { rows: PersonRecord[] }) {
  return (
    <ul className="vc-mdocs">
      {rows.map((r) => (
        <li key={r.documentId}>
          <DocLink id={r.documentId} page={r.page} className="vc-mdoc">
            <span className="vc-mdoc-icon" data-kind={['agenda', 'agenda_packet', 'minutes'].includes(r.type) ? r.type : 'other'}>
              <FileText size={15} strokeWidth={1.8} />
            </span>
            <span className="vc-mdoc-main">
              <span className="vc-mdoc-title">{r.title}</span>
              <span className="vc-mdoc-meta">{[TYPE_LABEL[r.type as keyof typeof TYPE_LABEL] ?? 'Record', formatDate(r.date), r.page ? `page ${r.page}` : null].filter(Boolean).join(' · ')}</span>
              {r.excerpt && <span className="vc-rec-snippet">{r.excerpt.replace(/\s+/g, ' ').slice(0, 240)}</span>}
            </span>
            <ArrowUpRight size={15} className="vc-mdoc-go" />
          </DocLink>
        </li>
      ))}
    </ul>
  );
}

function Profile({ slug }: { slug: string }) {
  const res = useJson<PersonDetail>(`/api/people/${encodeURIComponent(slug)}`);
  useEffect(() => {
    if (res.status === 'done') document.title = `${res.data.person.name} | Vineyard Transparency Portal`;
  }, [res]);
  if (res.status === 'loading') return <div className="vc-skeleton" aria-hidden="true"><span style={{ width: '60%' }} /><span style={{ width: '80%' }} /></div>;
  if (res.status === 'error') return <div className="vc-empty">That person is not in the city directory.</div>;
  const { person, records, votes } = res.data;
  const last = person.name.split(' ').pop();
  const asks = person.kind === 'elected'
    ? [`How has ${person.name} voted on development agreements and zoning?`, `What motions has ${person.name} made in City Council meetings?`, `What has ${person.name} said about the budget and taxes?`]
    : [`What does ${person.name} (${person.role}) do for Vineyard?`, `What records mention ${person.name}?`];
  return (
    <>
      <PersonCard person={person} />
      <div className="vc-person-asks">
        {person.kind === 'elected' && last && (
          <Link to={`/votes?member=${encodeURIComponent(person.name)}`} className="vc-chip">
            <Vote size={13} /> Full voting record
          </Link>
        )}
        {asks.map((q) => (
          <Link key={q} to={`/?q=${encodeURIComponent(q)}`} className="vc-chip">
            <MessageSquare size={13} /> {q}
          </Link>
        ))}
      </div>
      {votes.length > 0 && (
        <section className="vc-rec-topic">
          <h2 className="vc-rec-topic-title">Recorded motions and votes ({last})</h2>
          <RecordRows rows={votes} />
        </section>
      )}
      <section className="vc-rec-topic">
        <h2 className="vc-rec-topic-title">Records that mention {person.name}</h2>
        {records.length ? <RecordRows rows={records} /> : <div className="vc-empty">No indexed records mention this name yet. The archive is still loading.</div>}
      </section>
    </>
  );
}

function Item({ p }: { p: Person }) {
  return (
    <li>
      <Link to={`/people/${p.slug}`} className="vc-people-item">
        <PersonPhoto person={p} size={40} />
        <span className="vc-people-text">
          <span className="vc-people-name">{p.name}</span>
          <span className="vc-people-role">{p.role}</span>
        </span>
      </Link>
    </li>
  );
}

function Directory() {
  const people = usePeople();
  const [q, setQ] = useState('');
  useEffect(() => {
    document.title = 'People | Vineyard Transparency Portal';
  }, []);
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return people.filter((p) => p.current && p.kind !== 'board' && (!t || `${p.name} ${p.role} ${p.department ?? ''}`.toLowerCase().includes(t)));
  }, [people, q]);
  const council = shown.filter((p) => p.kind === 'elected');
  const staff = shown.filter((p) => p.kind === 'staff');
  const exec = (p: Person) => /official|executive/i.test(p.department ?? '') || /city manager|deputy mayor/i.test(p.role);
  const manager = staff.find((p) => /^city manager$/i.test(p.role)) ?? null;
  const executive = staff.filter((p) => p !== manager && exec(p));
  // Departments, each led by its director (or chief, or manager), largest title first.
  const rank = (r: string) => (/director|chief|city recorder|city attorney|city engineer/i.test(r) ? 0 : /manager|official/i.test(r) ? 1 : /lead|supervisor|senior|assistant city/i.test(r) ? 2 : 3);
  const depts = new Map<string, Person[]>();
  for (const p of staff.filter((x) => x !== manager && !exec(x))) {
    const d = (p.department ?? 'Other').replace(/'S\b/g, "'s");
    (depts.get(d) ?? depts.set(d, []).get(d)!).push(p);
  }
  const deptList = [...depts.entries()].map(([d, list]) => {
    const sorted = [...list].sort((a, b) => rank(a.role) - rank(b.role) || a.name.localeCompare(b.name));
    const head = rank(sorted[0].role) <= 1 ? sorted[0] : null;
    return { d, head, team: head ? sorted.slice(1) : sorted };
  });
  deptList.sort((a, b) => Number(!a.head) - Number(!b.head) || a.d.localeCompare(b.d));
  return (
    <>
      <form className="vc-rec-search" role="search" onSubmit={(e) => e.preventDefault()}>
        <Search size={16} strokeWidth={1.9} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search names, titles, departments" aria-label="Search people" />
      </form>
      {council.length > 0 && (
        <section className="vc-rec-group">
          <h2 className="vc-rec-month">Mayor and City Council</h2>
          <ul className="vc-people">
            {council.map((p) => (
              <Item key={p.slug} p={p} />
            ))}
          </ul>
        </section>
      )}
      {(manager || executive.length > 0) && (
        <section className="vc-rec-group">
          <h2 className="vc-rec-month">City administration</h2>
          <ul className="vc-people vc-org-top">
            {manager && <Item p={manager} />}
            {executive.map((p) => (
              <Item key={p.slug} p={p} />
            ))}
          </ul>
        </section>
      )}
      {deptList.length > 0 && (
        <section className="vc-rec-group">
          <h2 className="vc-rec-month">Departments</h2>
          <div className="vc-org">
            {deptList.map(({ d, head, team }) => (
              <details key={d} className="vc-org-dept" open={Boolean(q)}>
                <summary>
                  <span className="vc-org-name">{d}</span>
                  <span className="vc-org-sub">
                    {head ? `${head.name}, ${head.role}` : `${team.length} staff`}
                    {head && team.length ? ` · ${team.length} staff` : ''}
                  </span>
                </summary>
                <ul className="vc-people">
                  {head && <Item p={head} />}
                  {team.map((p) => (
                    <Item key={p.slug} p={p} />
                  ))}
                </ul>
              </details>
            ))}
          </div>
        </section>
      )}
      {people.length > 0 && (
        <p className="vc-person-asof vc-people-source">
          Names, titles, photos and contacts as the city website lists them.{' '}
          <a href="https://www.vineyardutah.gov/government/city_staff.php" target="_blank" rel="noopener noreferrer">
            View on city website
          </a>
        </p>
      )}
    </>
  );
}

export default function PeoplePage() {
  const { slug } = useParams();
  return (
    <Frame>
      {!slug && (
        <header className="vc-page-head">
          <h1 className="vc-page-title">People</h1>
        </header>
      )}
      {slug ? <Profile slug={slug} /> : <Directory />}
    </Frame>
  );
}
