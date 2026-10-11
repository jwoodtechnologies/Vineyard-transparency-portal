/**
 * One funded capital project's records, from GET /api/projects/detail: its budget lines with the
 * slide page, its status with an as of date, the votes behind it with each member's vote, and
 * related archive records. Used on the /map project card, on /construction and on /budget.
 * Every part is hidden when it has nothing to show; nothing here is typed by hand.
 */
import { ArrowUpRight, FileText } from 'lucide-react';
import { DocLink } from './DocLink';
import { useJson } from './api';
import { memberTitle, useMemberNames } from './votes';
import { dayLabel, ORDER, pagesLabel, projectDetailUrl, USD, voteOutcome, VOTE_WORD, type ProjectDetailData, type ProjectRef, type ProjectVote } from './projects';

function VoteBlock({ v }: { v: ProjectVote }) {
  const nameOf = useMemberNames();
  const titled = (m: string) => memberTitle(nameOf(m).name, nameOf(m).person?.role);
  const roll = [...v.votes].sort((a, b) => (ORDER[a.vote] ?? 9) - (ORDER[b.vote] ?? 9) || titled(a.member).localeCompare(titled(b.member)));
  const meta = [v.body, dayLabel(v.date), v.number, voteOutcome(v)].filter(Boolean).join(' · ');
  return (
    <li className="vc-pd-vote">
      <p className="vc-pd-vote-label">{v.label}</p>
      {meta && <p className="vc-pd-meta">{meta}</p>}
      {roll.length > 0 && (
        <ul className="vc-pd-roll" aria-label="How each member voted">
          {roll.map((r) => (
            <li key={r.member} data-vote={r.vote}>
              {titled(r.member)}: <b>{VOTE_WORD[r.vote] ?? r.vote}</b>
            </li>
          ))}
        </ul>
      )}
      <DocLink id={v.documentId} page={v.page} className="vc-pd-link">
        <FileText size={12} /> Minutes{v.page ? ` p. ${v.page}` : ''}
      </DocLink>
    </li>
  );
}

/**
 * `budget`: "full" lists each budget line with its slide page; "source" shows only a one line
 * source under the block (the host already shows the amount); "none" leaves the budget out.
 */
export function ProjectDetail({ project, budget = 'full' }: { project: ProjectRef; budget?: 'full' | 'source' | 'none' }) {
  const load = useJson<ProjectDetailData>(projectDetailUrl(project));
  if (load.status === 'loading')
    return (
      <div className="vc-skeleton" aria-hidden="true">
        <span style={{ width: '70%' }} />
        <span style={{ width: '90%' }} />
        <span style={{ width: '55%' }} />
      </div>
    );
  if (load.status === 'error') return null;
  const d = load.data;
  const b = d.budget;
  const pages = b.lines.map((l) => l.page);
  const s = d.status;
  return (
    <div className="vc-pd">
      {budget === 'full' && b.lines.length > 0 && (
        <section className="vc-pd-sec" aria-label="Budget">
          <h3 className="vc-pd-h">FY 2027 budget</h3>
          {b.lines.length > 1 && <p className="vc-pd-total">{USD.format(b.total)}</p>}
          <ul className="vc-pd-lines">
            {b.lines.map((l) => (
              <li key={`${l.fund}|${l.name}`}>
                <span className="vc-pd-amt">{USD.format(l.amount)}</span>
                <span className="vc-pd-meta">
                  {l.fundName}
                  {b.lines.length > 1 ? `, ${l.name}` : ''}
                </span>
                <DocLink id={b.documentId} page={l.page} className="vc-pd-link">
                  {b.documentTitle}, p. {l.page}
                </DocLink>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="vc-pd-sec" aria-label="Status">
        <h3 className="vc-pd-h">Status</h3>
        <p className="vc-pd-status">{s.label}</p>
        <p className="vc-pd-meta">
          {[s.completion ? `Expected completion: ${s.completion}` : null, dayLabel(s.asOf) ? `As of ${dayLabel(s.asOf)}` : null].filter(Boolean).join(' · ')}
          {s.source === 'construction' && s.sourceUrl && (
            <>
              {' · '}
              <a href={s.sourceUrl} target="_blank" rel="noopener noreferrer" className="vc-pd-inline">
                City construction page <ArrowUpRight size={11} />
              </a>
            </>
          )}
          {s.source === 'budget' && s.documentId && (
            <>
              {' · '}
              <DocLink id={s.documentId} className="vc-pd-inline">
                FY 27 Final Budget
              </DocLink>
            </>
          )}
        </p>
      </section>

      {[
        { kind: 'budget', one: 'Funding vote', many: 'Funding votes' },
        { kind: 'project', one: 'Related vote', many: 'Related votes' },
      ].map(({ kind, one, many }) => {
        // The budget adoption is the vote that funded the line; votes naming the project (contracts,
        // grants, earlier phases) are related records and are never presented as its funding.
        const list = d.votes.filter((v) => v.kind === kind);
        if (!list.length) return null;
        return (
          <section key={kind} className="vc-pd-sec" aria-label={many}>
            <h3 className="vc-pd-h">{list.length === 1 ? one : many}</h3>
            <ul className="vc-pd-votes">
              {list.map((v) => (
                <VoteBlock key={`${v.documentId}|${v.date}|${v.label}`} v={v} />
              ))}
            </ul>
          </section>
        );
      })}

      {d.documents.length > 0 && (
        <section className="vc-pd-sec" aria-label="Related records">
          <h3 className="vc-pd-h">Related records</h3>
          <ul className="vc-pd-docs">
            {d.documents.map((doc) => (
              <li key={doc.id}>
                <DocLink id={doc.id} className="vc-pd-doc">
                  {doc.title}
                </DocLink>
                <span className="vc-pd-meta">{[doc.typeLabel, doc.date ? dayLabel(doc.date) : null].filter(Boolean).join(' · ')}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {budget === 'source' && pages.length > 0 && (
        <p className="vc-pd-source">
          Source:{' '}
          <DocLink id={b.documentId} page={Math.min(...pages)} className="vc-pd-inline">
            {b.documentTitle}, {pagesLabel(pages)}
          </DocLink>
        </p>
      )}
    </div>
  );
}
