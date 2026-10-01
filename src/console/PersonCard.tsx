/** A person's card: photo, role, term and contact as the city lists them, linking to their profile. */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getJson } from './api';
import { ChevronRight, Mail, Phone, UserRound } from 'lucide-react';
import { roleLine, type Person } from './people';

export function PersonPhoto({ person, size = 56 }: { person: Person; size?: number }) {
  return person.photo ? (
    <img className="vc-person-photo" src={person.photo} alt={`Photo of ${person.name}`} width={size} height={size} loading="lazy" style={{ width: size, height: size }} />
  ) : (
    <span className="vc-person-photo vc-person-noimg" style={{ width: size, height: size }} aria-hidden="true">
      <UserRound size={size * 0.45} strokeWidth={1.6} />
    </span>
  );
}

/** The first year city records name this person (cached per page view). */
const sinceCache = new Map<string, Promise<number | null>>();
function useSince(slug: string, known?: number | null): number | null {
  const [since, setSince] = useState<number | null>(known ?? null);
  useEffect(() => {
    if (known != null) return;
    let live = true;
    let p = sinceCache.get(slug);
    if (!p) {
      p = getJson<{ person: { since?: number | null } }>(`/api/people/${encodeURIComponent(slug)}`)
        .then((r) => r.person.since ?? null)
        .catch(() => null);
      sinceCache.set(slug, p);
    }
    void p.then((v) => live && setSince(v));
    return () => {
      live = false;
    };
  }, [slug, known]);
  return since;
}

export function PersonCard({ person, label }: { person: Person & { since?: number | null }; label?: string }) {
  const since = useSince(person.slug, person.since);
  return (
    <div className="vc-person-card" data-contact={label ? 'true' : undefined}>
      {label && <span className="vc-person-label">{label}</span>}
      <PersonPhoto person={person} />
      <div className="vc-person-main">
        <Link to={`/people/${person.slug}`} className="vc-person-name">
          {person.name}
          <ChevronRight size={15} />
        </Link>
        <span className="vc-person-role">{roleLine(person)}</span>
        {person.term && <span className="vc-person-term">Term {person.term}</span>}
        {since && <span className="vc-person-term">In city records since {since}</span>}
        <span className="vc-person-contact">
          {person.email && (
            <a href={`mailto:${person.email}`}>
              <Mail size={13} /> {person.email}
            </a>
          )}
          {person.phone && (
            <a href={`tel:+1${person.phone.replace(/\D/g, '')}`}>
              <Phone size={13} /> {person.phone}
            </a>
          )}
          {/* The city lists no direct line: City Hall's main number reaches them. */}
          {!person.email && !person.phone && person.current && (
            <a href="tel:+18012261929">
              <Phone size={13} /> City Hall 801-226-1929
            </a>
          )}
        </span>
        <span className="vc-person-asof">
          {person.current ? '' : 'Former · '}
          <a href={person.sourceUrl} target="_blank" rel="noopener noreferrer">
            Listed on the city website
          </a>
        </span>
      </div>
    </div>
  );
}
