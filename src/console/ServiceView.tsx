/**
 * One city service, inside the portal: the city's own page for it (from the archive) to read here,
 * and the official form or portal to finish it when something has to be filed with the city.
 */
import './console.css';
import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowUpRight, FileText } from 'lucide-react';
import { Frame } from './Chrome';
import { useJson } from './api';
import { DIRECTORY } from './directory';

interface Hit {
  id: string;
  title: string;
  mimeType: string;
}

const ACTION: Record<string, string> = { form: 'Open the form', pay: 'Pay online', call: 'Call', mail: 'Send an email', page: 'Open on the city website', map: 'Open the map' };

export default function ServiceView() {
  const { id } = useParams();
  const entry = DIRECTORY.find((e) => e.id === id) ?? null;
  const hit = useJson<{ items: Hit[] }>(entry && /^https:/.test(entry.href) ? `/api/documents?url=${encodeURIComponent(entry.href)}` : null);
  const doc = hit.status === 'done' ? (hit.data.items[0] ?? null) : null;
  const text = useJson<Array<{ page: number; text: string }>>(doc && doc.mimeType === 'text/html' ? `/api/documents/${encodeURIComponent(doc.id)}/text` : null);
  const paras = useMemo(() => {
    if (text.status !== 'done') return [];
    return text.data
      .map((p) => p.text)
      .join('\n')
      .split(/\n\s*\n|\n(?=[A-Z])/)
      .map((x) => x.replace(/\s+/g, ' ').trim())
      .filter((x) => x.length > 2)
      .slice(0, 80);
  }, [text]);

  if (!entry) {
    return (
      <Frame>
        <Link to="/services" className="vc-back">
          <ArrowLeft size={15} /> City services
        </Link>
        <div className="vc-empty" style={{ marginTop: '2rem' }}>
          That service is not listed.
        </div>
      </Frame>
    );
  }
  const external = !/vineyardportal\.org/.test(entry.href);
  return (
    <Frame>
      <Link to="/services" className="vc-back">
        <ArrowLeft size={15} /> City services
      </Link>
      <header className="vc-page-head">
        <p className="vc-svc-kicker">{entry.group}</p>
        <h1 className="vc-page-title">{entry.label}</h1>
        {entry.hint && <p className="vc-page-sub">{entry.hint}</p>}
      </header>
      <a href={entry.href} className="vc-primary vc-svc-cta" target={external ? '_blank' : undefined} rel="noopener noreferrer">
        {ACTION[entry.kind] ?? 'Open'} <ArrowUpRight size={16} />
      </a>
      {doc && doc.mimeType !== 'text/html' && (
        <Link to={`/documents/${encodeURIComponent(doc.id)}`} className="vc-svc-doc">
          <FileText size={15} /> Read it here: {doc.title}
        </Link>
      )}
      {paras.length > 0 && (
        <article className="vc-svc-page">
          {paras.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
          <p className="vc-person-asof">From the city&apos;s page for this service.</p>
        </article>
      )}
    </Frame>
  );
}
