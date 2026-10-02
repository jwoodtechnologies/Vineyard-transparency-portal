/**
 * Action bubbles under an answer: the official form, portal, phone number or map view that goes
 * with the question. Map bubbles open the portal's own map already focused on the project, road,
 * park or area the answer is about.
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, ClipboardList, CreditCard, Mail, Map as MapIcon, Phone } from 'lucide-react';
import type { ConsoleAnswer } from './types';
import type { MapLayerInfo } from './api';
import { getJson } from './api';
import { LINKS, STAFF, type ServiceLink } from './services';
import { DIRECTORY, directoryFor } from './directory';

/** Keep in step with DATA_VERSION in MapPage so both read the same cached layer data. */
const MAP_DATA_VERSION = 5;

interface Bubble {
  key: string;
  label: string;
  hint?: string;
  href: string;
  kind: ServiceLink['kind'];
  internal?: boolean;
}

const WORD: Record<string, string> = { north: 'n', south: 's', east: 'e', west: 'w', street: 'st', road: 'rd', avenue: 'ave', drive: 'dr', lane: 'ln', boulevard: 'blvd', parkway: 'pkwy' };
const norm = (t: string) =>
  t
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => WORD[w] ?? w)
    .join(' ');

const GENERIC = new Set('the and for with what where when who how does did will are was were this that there project projects map show city vineyard about status update plan plans capital improvement construction built building happening going located location open see new current'.split(' '));

const titleCase = (s: string) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase());

type Names = { projects: string[]; parks: string[] };
let namesPromise: Promise<Names> | null = null;

/** Current capital project and park names from the map layers (edge cached). */
function loadNames(): Promise<Names> {
  namesPromise ??= getJson<{ layers: MapLayerInfo[] }>(`/api/map/layers?v=${MAP_DATA_VERSION}`)
    .then(async ({ layers }) => {
      const pick = async (key: string, field: string) => {
        const info = layers.find((l) => l.key === key);
        if (!info) return [];
        const pages = await Promise.all(
          Array.from({ length: Math.min(info.pages, 4) }, (_, i) => getJson<{ features: Array<{ properties?: Record<string, unknown> }> }>(`/api/map/layers/${key}?page=${i}&v=${MAP_DATA_VERSION}`)),
        );
        const set = new Set<string>();
        for (const p of pages) for (const f of p.features ?? []) {
          const v = String(f.properties?.[field] ?? '').trim();
          if (v.length >= 4) set.add(v);
        }
        return [...set];
      };
      const [projects, parks] = await Promise.all([pick('projects', 'Project_Name'), pick('parks', 'NAME')]);
      return { projects, parks };
    })
    .catch(() => {
      namesPromise = null;
      return { projects: [], parks: [] };
    });
  return namesPromise;
}

const MAPPY = /\b(map|where|located|location|project|construction|road|street|widen|intersection|park|trail|rda|redevelopment|zon(e|ing)|parcel|subdivision|capital)\b/i;

/** Questions that are not about a place, even when they name one. */
const NOT_MAP = /\b(vote[sd]?|voting|meeting|minutes|agenda|budget|tax|salary|who|when|ordinance|resolution|code says|allowed|mayor|council ?members?|appoint|fee|rate|cost|paid|pay)\b/i;

const AREA_LAYERS: Array<[RegExp, string, string]> = [
  [/\bura\b|urban renewal/i, 'ura', 'Urban renewal areas'],
  [/\bzon(e|ing)\b/i, 'zoning', 'Zoning'],
  [/\bland use|general plan\b/i, 'landuse', 'Land use'],
  [/\bsubdivision/i, 'subdivisions', 'Subdivisions'],
  [/\btrails?\b|\bbike (lane|path)/i, 'trails', 'Trails and bike paths'],
  [/\bsnow ?plow|snow removal/i, 'snowplow', 'Snowplow routes'],
  [/\bevacuat/i, 'evaczones,evacroutes', 'Evacuation zones'],
  [/\bcrossing guard|school crossing/i, 'crossings', 'School crossings'],
  [/\bcapital (project|improvement)|\bcip\b/i, 'projects', 'Capital projects'],
  [/\bparcels?\b/i, 'parcels', 'Parcels'],
];

const NUM_ROAD = /\b(\d{3,4})\s+(north|south|east|west|n|s|e|w)\b/gi;
const NAMED_ROAD = /\b((?:[A-Z][a-z]+ ){0,2}[A-Z][a-z]+) (Road|Rd|Street|St|Parkway|Pkwy|Drive|Dr|Boulevard|Blvd|Connector|Lane|Ln|Avenue|Ave)\b/g;
const NOT_ROAD = /^(the|a|an|on|at|of|in|and|main office|wall|city)$/i;

function mapBubbles(question: string, answerText: string, names: Names): Bubble[] {
  const out: Bubble[] = [];
  const seen = new Set<string>();
  const add = (focus: string, label: string, hint: string) => {
    if (seen.has(focus) || out.length >= 3) return;
    seen.add(focus);
    out.push({ key: `map:${focus}`, label, hint, href: `/map?focus=${encodeURIComponent(focus)}`, kind: 'map', internal: true });
  };
  const hay = norm(`${question} ${answerText}`);
  const roadish = /\b(road|roads|street|streets|traffic|intersection|widen|widening|lane|lanes|parking|striping|construction|route|where)\b/i.test(question);

  const q = norm(question);

  // Projects named in the question first, then in the answer; longest names first so
  // "Center Street Widening Phase 2" wins over "Center Street".
  const projects = [...names.projects].sort((a, b) => b.length - a.length);
  for (const pass of roadish || /\bprojects?\b|construction|built|building/i.test(question) ? [q, hay] : [q]) for (const p of projects) if (pass.includes(norm(p))) add(`project:${p}`, p, 'Show on map');
  // "the Geneva Road widening project" names a project by a few of its words.
  const asked = q.split(' ').filter((w) => w.length > 2 && !GENERIC.has(w));
  if (asked.length >= 2) {
    for (const p of projects) {
      const words = new Set(norm(p).split(' '));
      if (asked.filter((w) => words.has(w)).length >= Math.max(2, asked.length - 1)) add(`project:${p}`, p, 'Show on map');
    }
  }
  for (const p of names.parks) if (hay.includes(norm(p))) add(`park:${p}`, p, 'Show on map');

  for (const text of roadish ? [question, answerText] : [question]) {
    for (const m of text.matchAll(NUM_ROAD)) add(`road:${m[1]} ${m[2][0].toUpperCase()}`, `${m[1]} ${titleCase(m[2])}`, 'Show road on map');
    for (const m of text.matchAll(NAMED_ROAD)) {
      if (NOT_ROAD.test(m[1])) continue;
      add(`road:${m[1]} ${m[2]}`, `${m[1]} ${m[2]}`, 'Show road on map');
    }
  }

  for (const [re, layers, label] of AREA_LAYERS) {
    if (out.length >= 3) break;
    if (re.test(question) && !seen.has(`layers:${layers}`)) {
      seen.add(`layers:${layers}`);
      out.push({ key: `layers:${layers}`, label, hint: 'Open on map', href: `/map?layers=${layers}`, kind: 'map', internal: true });
    }
  }
  if (!out.length && /\bmap\b|\bwhere (is|are)\b/i.test(question)) out.push({ key: 'map', label: 'Open the city map', href: '/map', kind: 'map', internal: true });
  return out;
}

function serviceBubbles(question: string, hasCard = false): Bubble[] {
  const q = question;
  const out: Bubble[] = [];
  const add = (l: ServiceLink, key: string) => out.push({ key, ...l });
  if (/\b(code enforcement|violations?|complain\w*|report(ing)? (a |an )?(concern|problem|issue)|concerns?|nuisances?|weeds?|junk|graffiti|pot ?holes?|abandoned|illegal(ly)? park\w*|noise|noisy|loud|barking|trash (in|on)|overgrown|unsafe)\b/i.test(q)) add(LINKS.concern, 'concern');
  if (/\b(street ?lights?|light (is )?out|lights? out)\b/i.test(q)) add(LINKS.streetlight, 'streetlight');
  if (/\b(utilit(y|ies)|water bill|sewer|garbage|trash (service|pickup|can)|recycl|pay (my )?bill|bill pay|autopay|storm ?water fee)\b/i.test(q)) {
    add(LINKS.payBill, 'pay');
    add(LINKS.billing, 'billing');
    if (/\b(start|new|set ?up|connect|moving in|move in)\b/i.test(q)) add(LINKS.startService, 'start');
    if (/\b(stop|cancel|terminat|disconnect|moving out|move out)\b/i.test(q)) add(LINKS.stopService, 'stop');
  }
  if (/\b(permits?|inspections?|build(ing)? (a|an)|remodel|fence|shed|solar|adu)\b/i.test(q)) add(LINKS.permits, 'permits');
  if (/\b(police|sheriff|non.?emergency|crime|suspicious)\b/i.test(q)) add(LINKS.police, 'police');
  if (/\b(fire (department|station)|ems|ambulance)\b/i.test(q)) add(LINKS.fire, 'fire');
  if (/\b(power outage|electric(ity)?|rocky mountain power)\b/i.test(q)) add(LINKS.power, 'power');
  if (/\b(gas (leak|service)|natural gas|dominion|enbridge)\b/i.test(q)) add(LINKS.gas, 'gas');
  if (/\b(budget|general fund|capital projects?|city spend\w*|tax revenue|property tax|sales tax|fiscal (year )?(20)?27|fy ?27)\b/i.test(q)) out.push({ key: 'budget', label: 'See the budget', hint: 'Fiscal year 2027, in pictures', href: '/budget', kind: 'page', internal: true });

  // Every form, portal and report the city links from its Transparency Portal, when asked for.
  for (const e of directoryFor(q)) if (!out.some((b) => b.href === e.href)) out.push({ key: `dir:${e.id}`, label: e.label, hint: e.hint, href: e.href, kind: e.kind });

  const contactish = /\b(contact|phone|call|email|reach|who (do|should) i|who is|who's|staff|city hall|office hours|hours|address)\b/i.test(q);
  // A staff card already shows who to contact: no second bubble for the same person.
  const people = hasCard ? [] : STAFF.filter((s) => s.match.test(q));
  for (const s of people.slice(0, 2)) {
    if (s.email) out.push({ key: `mail:${s.name}`, label: s.name, hint: `${s.title} · ${s.email}`, href: `mailto:${s.email}`, kind: 'mail' });
    else if (s.phone && s.phone !== '801-226-1929') out.push({ key: `tel:${s.name}`, label: s.name, hint: `${s.title} · ${s.phone}`, href: `tel:+1${s.phone.replace(/\D/g, '')}`, kind: 'call' });
    else out.push({ key: `staff:${s.name}`, label: s.name, hint: s.title, href: LINKS.cityHall.href, kind: 'call' });
  }
  if (contactish || people.length || out.some((b) => b.key === 'concern' || b.key === 'billing')) {
    if (!out.some((b) => b.href === LINKS.cityHall.href)) add(LINKS.cityHall, 'cityhall');
    if (contactish) {
      add(LINKS.contact, 'contact');
      add(LINKS.staff, 'staff');
    }
  }
  return out;
}

const ICON = { form: ClipboardList, pay: CreditCard, call: Phone, mail: Mail, page: ArrowUpRight, map: MapIcon } as const;

function answerText(a: ConsoleAnswer): string {
  return a.paragraphs.length ? a.paragraphs.map((p) => p.segments.map((s) => s.text).join(' ')).join(' ') : a.answer;
}

export function QuickLinks({ answer }: { answer: ConsoleAnswer }) {
  const question = answer.question ?? '';
  const text = answerText(answer);
  const services = serviceBubbles(question, Boolean(answer.contact || answer.people?.length));
  // Map bubbles only when the question is about a place: a road, project, park, area or "where".
  // Questions about votes, meetings, people, money or law get none, whatever the answer mentions.
  const wantsMap = answer.mode !== 'conversation' && (/\bmap\b|\bwhere\b|\blocated\b/i.test(question) || (MAPPY.test(question) && !NOT_MAP.test(question)) || new RegExp(NUM_ROAD.source, 'i').test(question));
  const [names, setNames] = useState<Names | null>(null);
  useEffect(() => {
    if (!wantsMap) return;
    let live = true;
    void loadNames().then((n) => live && setNames(n));
    return () => {
      live = false;
    };
  }, [wantsMap]);

  const maps = wantsMap ? mapBubbles(question, text, names ?? { projects: [], parks: [] }) : [];
  // Cards open here in the portal wherever the portal has the page: a service opens its own page
  // (with the official form one tap further), the staff directory opens People.
  const all = [...services, ...maps].slice(0, 7).map((b): Bubble => {
    if (b.internal || !b.href.startsWith('http')) return b;
    if (b.href === LINKS.staff.href) return { ...b, href: '/people', internal: true };
    const entry = DIRECTORY.find((e) => e.href === b.href);
    return entry ? { ...b, href: `/services/${entry.id}`, internal: true } : b;
  });
  // A message that just names a part of the portal already has its own card.
  if (!all.length || answer.section) return null;

  return (
    <nav className="vc-quick" aria-label="Related actions">
      {all.map((b) => {
        const Icon = ICON[b.kind];
        const body = (
          <>
            <span className="vc-quick-icon" data-kind={b.kind}>
              <Icon size={14} strokeWidth={2} />
            </span>
            <span className="vc-quick-text">
              <span className="vc-quick-label">{b.label}</span>
              {b.hint && <span className="vc-quick-hint">{b.hint}</span>}
            </span>
          </>
        );
        return b.internal ? (
          <Link key={b.key} to={b.href} className="vc-quick-item">
            {body}
          </Link>
        ) : (
          <a key={b.key} href={b.href} className="vc-quick-item" {...(b.href.startsWith('http') ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
            {body}
          </a>
        );
      })}
    </nav>
  );
}
