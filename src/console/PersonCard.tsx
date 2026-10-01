/** A person's card: photo, role, term and contact as the city lists them, linking to their profile. */
import { Link } from 'react-router-dom';
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

export function PersonCard({ person }: { person: Person }) {
  return (
    <div className="vc-person-card">
      <PersonPhoto person={person} />
      <div className="vc-person-main">
        <Link to={`/people/${person.slug}`} className="vc-person-name">
          {person.name}
          <ChevronRight size={15} />
        </Link>
        <span className="vc-person-role">{roleLine(person)}</span>
        {person.term && <span className="vc-person-term">Term {person.term}</span>}
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
