/**
 * The records home: one tile per topic (src/lib/recordTopics.ts) with how many records it holds and
 * the newest one's date, from one edge-cached call (GET /api/records/topics). A topic with no
 * records has no tile. Each tile opens the filtered list; "Browse all records" keeps the full list
 * and search one tap away.
 */
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronRight, Search } from 'lucide-react';
import { Frame } from './Chrome';
import { RssLink } from './RssLink';
import { useJson } from './api';
import { formatDate } from './format';
import { setHead } from '@/lib/head';
import { ErrorNote } from './ErrorNote';

interface TopicCount {
  id: string;
  label: string;
  hint: string;
  notice: string | null;
  index: string | null;
  count: number;
  newest: string | null;
  newestYear: number | null;
}

const INDEX_LABEL: Record<string, string> = { ordinances: 'Ordinances by number', resolutions: 'Resolutions by number', 'rda-resolutions': 'RDA resolutions by number' };

export function RecordsHome() {
  const load = useJson<{ topics: TopicCount[] }>('/api/records/topics');
  const navigate = useNavigate();
  const [draft, setDraft] = useState('');
  useEffect(() => {
    setHead('Records');
  }, []);
  const topics = load.status === 'done' ? load.data.topics : [];
  const indexes = topics.filter((t) => t.index);

  return (
    <Frame>
      <header className="vc-page-head">
        <h1 className="vc-page-title">Records</h1>
      </header>
      <form
        className="vc-rec-search"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          const q = draft.trim();
          navigate(q ? `/records?q=${encodeURIComponent(q)}` : '/records?all=1');
        }}
      >
        <Search size={16} strokeWidth={1.9} />
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Search all records" aria-label="Search all records" enterKeyHint="search" />
      </form>

      {load.status === 'loading' && (
        // Card-shaped placeholders in the same grid, so the links below do not move when the topics arrive.
        <ul className="vc-topics" aria-hidden="true">
          {Array.from({ length: 12 }, (_, i) => (
            <li key={i}>
              <div className="vc-topic vc-topic-wait vc-skeleton">
                <span style={{ width: '62%' }} />
                <span style={{ width: '84%' }} />
              </div>
            </li>
          ))}
        </ul>
      )}
      {load.status === 'error' && <ErrorNote>The record topics could not be loaded.</ErrorNote>}
      {topics.length > 0 && (
        <ul className="vc-topics">
          {topics.map((t) => (
            <li key={t.id}>
              <Link to={`/records?topic=${encodeURIComponent(t.id)}`} className="vc-topic" data-resident={t.id === 'resident' ? 'true' : undefined}>
                <span className="vc-topic-label">{t.label}</span>
                <span className="vc-topic-count">{t.count.toLocaleString()}</span>
                <span className="vc-topic-hint">{t.notice ?? t.hint}</span>
                {(t.newest || t.newestYear) && <span className="vc-topic-newest">Newest {formatDate(t.newest) ?? t.newestYear}</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}

      <div className="vc-rec-links">
        <Link to="/records?all=1" className="vc-rec-index-link">
          Browse all records <ChevronRight size={14} />
        </Link>
        {indexes.map((t) => (
          <Link key={t.index} to={`/records/${t.index}`} className="vc-rec-index-link">
            {INDEX_LABEL[t.index!]} <ChevronRight size={14} />
          </Link>
        ))}
      </div>
      <RssLink href="/feeds/records.xml" title="Newest records feed (RSS)" />
    </Frame>
  );
}
