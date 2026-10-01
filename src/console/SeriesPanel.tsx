/** Every year's edition of a recurring report (water quality, audits, budgets), newest first. */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { FileText } from 'lucide-react';
import type { AnswerSeries } from './types';

export function SeriesPanel({ series }: { series: AnswerSeries }) {
  const [all, setAll] = useState(false);
  const shown = all ? series.items : series.items.slice(0, 8);
  return (
    <section className="vc-series" aria-label={series.label}>
      <p className="vc-series-label">{series.label}</p>
      <div className="vc-series-list">
        {shown.map((it) => (
          <Link key={it.id} to={`/documents/${encodeURIComponent(it.id)}`} className="vc-series-item">
            <span className="vc-series-year">{it.year ?? ''}</span>
            <span className="vc-series-title">
              <FileText size={13} strokeWidth={1.9} /> {it.title}
            </span>
          </Link>
        ))}
      </div>
      {series.items.length > 8 && !all && (
        <button type="button" className="vc-ghost vc-series-more" onClick={() => setAll(true)}>
          Show all {series.items.length}
        </button>
      )}
    </section>
  );
}
