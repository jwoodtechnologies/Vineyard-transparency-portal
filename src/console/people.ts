/** People in the city directory, and finding them in a question. */
import { useEffect, useState } from 'react';
import { getJson } from './api';

export interface Person {
  slug: string;
  name: string;
  kind: 'elected' | 'staff' | 'board';
  role: string;
  title: string | null;
  department: string | null;
  term: string | null;
  email: string | null;
  phone: string | null;
  photo: string | null;
  sourceUrl: string;
  current: boolean;
  asOf: string;
}

export interface PersonRecord {
  documentId: string;
  title: string;
  type: string;
  date: string | null;
  page: number | null;
  excerpt: string;
}

export interface PersonDetail {
  person: Person;
  records: PersonRecord[];
  votes: PersonRecord[];
}

let cache: Promise<Person[]> | null = null;

export function loadPeople(): Promise<Person[]> {
  cache ??= getJson<{ people: Person[] }>('/api/people')
    .then((r) => r.people ?? [])
    .catch(() => {
      cache = null;
      return [];
    });
  return cache;
}

export function usePeople(): Person[] {
  const [people, setPeople] = useState<Person[]>([]);
  useEffect(() => {
    let live = true;
    void loadPeople().then((p) => live && setPeople(p));
    return () => {
      live = false;
    };
  }, []);
  return people;
}

/** Words that are also last names here and must not match on their own. */
const COMMON = new Set(['price', 'wood', 'green', 'king', 'james', 'jones', 'thomas', 'adams', 'davis', 'smith', 'tyler', 'dye', 'baty', 'jackson']);

/**
 * People a question is about: a full name ("Jacob Wood", "Zack Stratton"), a title with a last
 * name ("Mayor Stratton", "Councilmember Holdaway"), or a distinctive last name on its own.
 */
export function peopleIn(question: string, people: Person[]): Person[] {
  const q = ` ${question.toLowerCase().replace(/[^a-z0-9' -]+/g, ' ')} `;
  const found: Person[] = [];
  const add = (p: Person) => !found.includes(p) && found.push(p);
  const current = people.filter((p) => p.current);
  for (const p of current) if (q.includes(` ${p.name.toLowerCase()} `)) add(p);
  for (const p of current) {
    const last = p.name.split(/\s+/).pop()!.toLowerCase();
    if (new RegExp(`\\b(mayor|council ?(member|man|woman)|councilor|deputy mayor|director|manager|recorder|mr|mrs|ms)\\s+${last}\\b`).test(q)) add(p);
  }
  if (!found.length) {
    for (const p of current) {
      const parts = p.name.toLowerCase().split(/\s+/);
      const last = parts[parts.length - 1];
      const first = parts[0];
      const sameLast = current.filter((x) => x.name.toLowerCase().endsWith(` ${last}`)).length;
      if (last.length >= 5 && !COMMON.has(last) && sameLast === 1 && q.includes(` ${last} `)) add(p);
      else if (q.includes(` ${first} ${last.slice(0, 3)}`) && last.length >= 3) add(p);
    }
  }
  // A title asked about ("the city recorder", "finance director", "deputy mayor"): whoever holds it.
  if (!found.length) {
    for (const p of current) {
      for (const t of [p.role, p.title].filter(Boolean) as string[]) {
        const role = t.toLowerCase().replace(/[^a-z0-9 /-]+/g, ' ').replace(/\s+/g, ' ').trim();
        if (role.length >= 6 && !/^(council member|member|staff)$/.test(role) && role.split('/').some((r) => r.trim().length >= 6 && q.includes(` ${r.trim()} `))) add(p);
      }
    }
  }
  if (!found.length && / (the )?mayor('s)? /.test(q) && !/deputy mayor|mayor pro tem/.test(q)) {
    const mayor = current.find((p) => p.kind === 'elected' && /^mayor$/i.test(p.role));
    if (mayor) add(mayor);
  }
  // Elected officials first, then staff; at most two cards.
  return found.sort((a, b) => (a.kind === 'elected' ? 0 : 1) - (b.kind === 'elected' ? 0 : 1)).slice(0, 2);
}

export const roleLine = (p: Person) => [p.role, p.kind === 'staff' && p.department && p.department !== p.role ? p.department : null].filter(Boolean).join(' · ');
