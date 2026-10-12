/**
 * Under a record: its paper trail (GET /api/documents/:id/trail). The meeting it came from, every other file on
 * the same agenda item ("Attachments"), every other record of that meeting in agenda order ("From this
 * meeting"), and the record's details (its original file name among them) in a collapsed section.
 */
import { Link } from 'react-router-dom';
import { CalendarDays, ChevronRight, FileText } from 'lucide-react';
import type { DocumentDetail, DocumentSummary, DocumentTrail } from '@/types/models';
import { DocLink } from './DocLink';
import { labelsOf } from './recordLabels';
import { formatDate, sourceLabel } from './format';
import { meetingHref } from './meetings';
import { normalizeDatesInText } from '@/lib/dates';

const MAIN_KIND = new Set(['agenda', 'agenda_packet', 'minutes']);

function TrailList({ docs, showItem }: { docs: DocumentSummary[]; showItem: boolean }) {
  return (
    <ul className="vc-mdocs">
      {docs.map((d) => {
        const lb = labelsOf(d);
        const meta = [showItem && lb.item ? `Item ${lb.item}` : null, lb.type, d.pageCount ? `${d.pageCount} ${d.pageCount === 1 ? 'page' : 'pages'}` : null].filter(Boolean);
        return (
          <li key={d.id}>
            <DocLink id={d.id} className="vc-mdoc">
              <span className="vc-mdoc-icon" data-kind={MAIN_KIND.has(d.documentType) ? d.documentType : 'other'}>
                <FileText size={15} strokeWidth={1.8} />
              </span>
              <span className="vc-mdoc-main">
                <span className="vc-mdoc-title">{lb.title}</span>
                <span className="vc-mdoc-meta">{meta.join(' · ')}</span>
              </span>
              <ChevronRight size={16} className="vc-mdoc-go" />
            </DocLink>
          </li>
        );
      })}
    </ul>
  );
}

const sizeText = (n: number | null) => (n == null ? null : n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1000))} KB`);

/** The record's details, folded away: what the file was called when filed, its size and pages, where it came from. */
export function RecordDetails({ doc }: { doc: DocumentDetail }) {
  const rows: Array<[string, string]> = [];
  if (doc.fileName) rows.push(['Original file name', doc.fileName]);
  if (doc.pageCount) rows.push(['Pages', String(doc.pageCount)]);
  const size = sizeText(doc.fileSize);
  if (size) rows.push(['File size', size]);
  const src = sourceLabel(doc.sourceId, doc.documentType, doc.date);
  if (src) rows.push(['Source', src]);
  if (doc.documentNumber) rows.push(['Number', doc.documentNumber]);
  if (!rows.length) return null;
  return (
    <details className="vc-doc-details">
      <summary>Details</summary>
      <dl>
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

export function PaperTrail({ trail }: { trail: DocumentTrail | null }) {
  if (!trail?.meeting) return null;
  const m = trail.meeting;
  const item = trail.item;
  return (
    <section className="vc-trail" aria-label="Paper trail">
      <p className="vc-trail-meeting">
        <Link to={meetingHref(m)} className="vc-secondary">
          <CalendarDays size={15} strokeWidth={1.8} /> Meeting page: {normalizeDatesInText(m.title)}
          {m.date ? `, ${formatDate(m.date)}` : ''}
        </Link>
      </p>
      {trail.attachments.length > 0 && (
        <>
          <h2 id="attachments" className="vc-trail-h">
            Attachments <span className="vc-count">{trail.attachments.length}</span>
          </h2>
          <p className="vc-trail-sub">{item?.number ? `Filed with agenda item ${item.number}${item.title ? `, ${item.title}` : ''}.` : item?.title ? `Filed with the agenda item ${item.title}.` : 'Filed with the same agenda item.'}</p>
          <TrailList docs={trail.attachments} showItem={false} />
        </>
      )}
      {trail.meeting_docs.length > 0 && (
        <>
          <h2 id="from-meeting" className="vc-trail-h">
            From this meeting <span className="vc-count">{trail.meeting_docs.length}</span>
          </h2>
          <p className="vc-trail-sub">In agenda order.</p>
          <TrailList docs={trail.meeting_docs} showItem />
        </>
      )}
    </section>
  );
}
