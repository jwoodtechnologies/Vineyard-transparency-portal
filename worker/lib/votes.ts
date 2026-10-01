/**
 * Motions and votes from meeting minutes. Vineyard's minutes record each action in one of a few
 * set forms, and this reads them exactly, never guessing:
 *   2026:  "MOTION: Council Member Lauret motioned to approve ... Council Member Nair seconded the
 *           motion. Vote Yes: Council Members Holdaway, Lauret, McCumber, and Nair No: None.
 *           Motion carried 4-0."
 *   2016 to 2025: "Motion: COUNCILMEMBER FLAKE MOVED TO APPROVE ... COUNCILMEMBER WELSH SECONDED THE
 *           MOTION. ROLL CALL WENT AS FOLLOWS: MAYOR FULLMER, COUNCILMEMBERS FLAKE, RASMUSSEN AND
 *           WELSH VOTED YES. COUNCILMEMBER SIFUENTES VOTED NO. THE MOTION CARRIED."
 *   older: "... SECONDED THE MOTION. ALL WERE IN FAVOR. MOTION CARRIED UNANIMOUSLY."
 * When the minutes say only "all in favor" or "unanimously", the yes votes are the members the
 * minutes list as present, and the motion is marked so (inferred), never presented as a roll call.
 * Pure, so it is tested.
 */

export type VoteValue = 'yes' | 'no' | 'abstain' | 'absent' | 'recused';

export interface ParsedMotion {
  seq: number;
  item: string | null;
  text: string;
  mover: string | null;
  seconder: string | null;
  result: 'carried' | 'failed' | 'unknown';
  tally: string | null;
  /** The mayor broke a tie (2026 form of government). */
  tieBreak: boolean;
  unanimous: boolean;
  /** Votes taken from "all in favor" plus the attendance list, not a recorded roll call. */
  inferred: boolean;
  votes: Array<{ member: string; vote: VoteValue }>;
  refs: string[];
  /** Character offset in the text (used for the page). */
  at: number;
}

export interface ParsedMinutes {
  present: string[];
  absent: string[];
  /** Full names the minutes print for members ("Holdaway" -> "Jacob Holdaway"). */
  fullNames: Record<string, string>;
  /** The meeting date printed at the top of the minutes, when there is one. */
  date: string | null;
  /** Which body's minutes these are, from the heading. */
  body: 'city-council' | 'redevelopment-agency' | 'planning-commission' | null;
  motions: ParsedMotion[];
}

const TITLE = String.raw`(?:mayor pro tem(?:pore)?|deputy mayor|mayor|council ?members?|councilm[ae]n|councilwoman|councilors?|commissioners?|vice[- ]chair(?:man|woman|person)?|chair(?:man|woman|person)?|board ?members?|members?|director|mr\.?|mrs\.?|ms\.?|dr\.?)`;
const NAME = String.raw`([A-Z][A-Za-z'’-]+(?:\s+[A-Z][A-Za-z'’-]+)?)`;
const STOP = new Set(['the', 'and', 'none', 'all', 'motion', 'council', 'city', 'members', 'member', 'mayor', 'vote', 'yes', 'no', 'aye', 'nay', 'absent', 'abstain', 'present', 'roll', 'call', 'item', 'items', 'a', 'an', 'to', 'of', 'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december', 'approved', 'seconded', 'carried', 'passed', 'failed', 'staff', 'public', 'hearing', 'commission', 'committee', 'agency', 'board', 'chair', 'vice', 'secretary', 'clerk', 'recorder', 'planning', 'development']);

const titleCase = (w: string) => w.toLowerCase().replace(/(^|[\s'’-])([a-z])/g, (_, p: string, c: string) => p + c.toUpperCase()).replace(/^Mc([a-z])/, (_, c: string) => `Mc${c.toUpperCase()}`);

/** "Council Members Holdaway, Lauret, McCumber, and Nair" -> ["Holdaway", "Lauret", "McCumber", "Nair"]. */
export function namesIn(list: string): string[] {
  const cleaned = list
    .replace(new RegExp(`\\b${TITLE}\\b`, 'gi'), ',')
    .replace(/\b(voted|vote|votes|yes|no|aye|ayes|nay|nays|were|was|is|in favor|favor|absent|abstained|abstaining|abstain|excused|recused|present|also|none|n\/a)\b/gi, ',')
    .replace(/\band\b|&|;|\//gi, ',');
  const out: string[] = [];
  for (const part of cleaned.split(',')) {
    const w = part.replace(/[^A-Za-z'’\s-]/g, ' ').trim().split(/\s+/).filter(Boolean);
    if (!w.length) continue;
    const last = w[w.length - 1];
    if (last.length < 2 || STOP.has(last.toLowerCase())) continue;
    const name = titleCase(last.replace(/['’]s$/i, ''));
    if (!out.includes(name)) out.push(name);
  }
  return out.slice(0, 12);
}

/** Attendance at the top of the minutes: "Present: Mayor Zack Stratton, Councilmember Parker McCumber ...". */
/** "Daria Evans, Brad Fagg, and Nathan Steele" (a list with no titles) -> full names. */
function plainNames(s: string): string[] {
  const out: string[] = [];
  for (const part of s.replace(/\band\b|&|;/gi, ',').split(',')) {
    const w = part.replace(/\b(commissioners?|chair(?:man|woman|person)?|vice[- ]chair|alternate)\b/gi, ' ').replace(/[^A-Za-z'\u2019\s-]/g, ' ').trim().split(/\s+/).filter(Boolean);
    if (w.length < 2 || w.length > 3 || w.some((x) => !/^[A-Z]/.test(x) || STOP.has(x.toLowerCase()))) continue;
    out.push(w.map(titleCase).join(' '));
  }
  return out;
}

export function attendance(head: string): { present: string[]; absent: string[]; full: Record<string, string> } {
  const t = head.replace(/\s+/g, ' ');
  const p = t.match(/\b(?:present|in attendance|attending)\b:?\s*(.{0,700}?)(?=\b(?:absent|excused|staff present|staff|also present|others present|others|city staff|public present|guests|call to order|1\.\s|opening)\b|$)/i);
  const a = t.match(/\b(?:absent|excused)\b:?\s*(.{0,200}?)(?=\b(?:staff|also present|others|city staff|guests|call to order|1\.\s|opening)\b|$)/i);
  const officials = (s: string) => {
    const out: string[] = [];
    for (const m of s.matchAll(new RegExp(`\\b(mayor pro tem|deputy mayor|mayor|council ?member|councilm[ae]n|councilwoman|commissioner|chair(?:man|woman|person)?|vice[- ]chair|board ?member)\\s+${NAME}`, 'gi'))) {
      if (/deputy mayor/i.test(m[1])) continue;
      const n = namesIn(m[2]);
      if (n.length) out.push((/^mayor$/i.test(m[1]) ? 'Mayor ' : '') + n[n.length - 1]);
    }
    return out;
  };
  // A two-column table ("Present  Absent" then the names) does not say who sat in which column:
  // everyone listed is taken as present and nobody as absent.
  if (p && !officials(p[1]).length && /\bpresent\s+absent\b/i.test(t)) {
    const after = t.slice(t.search(/\bpresent\s+absent\b/i)).replace(/^present\s+absent/i, '').split(/\bstaff present\b|\bstaff\b|\bothers\b/i)[0];
    return { present: [...new Set(officials(after))], absent: [], full: {} };
  }
  const full: Record<string, string> = {};
  const listed = (s: string | undefined) => {
    if (!s) return [];
    const titled = officials(s);
    if (titled.length) return titled;
    // Planning Commission minutes: "Present: Daria Evans, Brad Fagg, ..." with no titles.
    return plainNames(s).map((n) => {
      const last = n.split(' ').pop() as string;
      full[last] = n;
      return last;
    });
  };
  const present = [...new Set(listed(p?.[1]))];
  const absent = a && !/^none\b/i.test(a[1].trim()) ? [...new Set(listed(a[1]))] : [];
  return { present, absent, full };
}

const LABEL = String.raw`(?:yes|ayes?|no|nays?|abstain\w*|abstentions?|recused|absent|excused)`;
const LABELED = new RegExp(String.raw`\b(${LABEL})\s*:\s*(.*?)(?=\s*\b${LABEL}\s*:|\.\s|\btie\b|\bmotion\b|$)`, 'gi');
const TIE_A = new RegExp(String.raw`\btie\b[^.]{0,40}?\b(?:resolved|broken|broke)\b[^.]{0,20}?\bmayor\s+${NAME}(?:'s)?\s+(?:vote\s+of\s+|voting\s+|voted\s+)?(yes|aye|no|nay)`, 'i');
const TIE_B = new RegExp(String.raw`\bmayor\s+${NAME}\s+voted\s+(yes|aye|no|nay)\s+to break the tie`, 'i');
const MOTION_START = new RegExp(String.raw`\bmotion:\s*|\b${TITLE}\s+${NAME}\s+(?:made a motion|moved|motioned|motions? to)\b`, 'gi');

function lastItem(before: string): string | null {
  // The agenda item heading closest before the motion: "5.4 Ordinance 2026-12 Plat Signatures".
  const lines = before.slice(-6000).split(/\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i].trim().match(/^(\d{1,2}(?:\.\d{1,2}){0,2})\.?\s+([A-Z][^\n]{3,600})$/);
    if (m && !/^\d+$/.test(m[2])) {
      // A heading run into its first sentence ("3. CLOSED SESSION The Chair and Board ...") keeps the heading.
      const head = m[2].replace(/\s+/g, ' ').trim();
      const caps = head.match(/^([A-Z0-9][A-Z0-9 &,'()/-]{3,}?)(?=\s+[A-Z][a-z])/);
      const label = caps ? caps[1] : head.split(/(?<=[a-z)])\.\s/)[0];
      return `${m[1]} ${label}`.slice(0, 160);
    }
  }
  return null;
}

/** The item a motion names itself: "approve item 5.4", "the Consent Items 5.1, 5.2 and 5.3". */
function itemFor(motion: string, flat: string): string | null {
  if (/\bconsent\b/i.test(motion)) return 'Consent items';
  const n = motion.match(/\b(?:items?\s+)?(\d{1,2}\.\d{1,2})\b(?!\s*(?:million|%|percent|acres?))/i);
  if (!n) return null;
  const esc = n[1].replace('.', '\\.');
  const line = flat.match(new RegExp(`(?:^|\\n)\\s*${esc}\\.?\\s+([A-Z][^\\n]{3,160})`));
  return line ? `${n[1]} ${line[1].replace(/\s+/g, ' ').trim()}`.slice(0, 180) : null;
}

/** Every motion in a set of minutes, with mover, seconder, result and each member's vote. */
export function parseMinutes(text: string, date: string | null = null): ParsedMinutes {
  const head = text.slice(0, 2500);
  const { present, absent, full: listedFull } = attendance(head);
  // Line-numbered minutes put a bare number on its own line; those are not part of the words.
  const flat = text.replace(/[‘’]/g, "'").replace(/[ \t]+/g, ' ').replace(/\n\s*\d{1,4}\s*(?=\n)/g, '\n');
  const starts: number[] = [];
  for (const m of flat.matchAll(MOTION_START)) {
    const at = m.index ?? 0;
    // "MOTION: Council Member X motioned" is one start, not two.
    if (starts.length && at - starts[starts.length - 1] < 40) continue;
    starts.push(at);
  }
  const voters2026 = !date || date >= '2026-01-01';
  const motions: ParsedMotion[] = [];
  starts.forEach((at, i) => {
    const end = Math.min(starts[i + 1] ?? flat.length, at + 2200);
    const seg = flat.slice(at, end).replace(/\s+/g, ' ');
    const mover = seg.match(new RegExp(`${TITLE}\\s+${NAME}\\s+(?:made a motion|moved|motioned|motions? to)`, 'i'));
    const wording = seg.match(/\b(?:made a motion|moved|motioned|motions?(?=\s+to\b))\s+(?:to\s+|that\s+|the\s+)?([\s\S]{3,900}?)(?=\.\s+(?:[A-Z][A-Za-z]*\s+){0,3}[A-Za-z'-]+\s+seconded|\.?\s+seconded by\b|\s+(?:council ?members?|councilm[ae]n|councilwoman|commissioners?|board ?members?|chair(?:man|woman|person)?|vice[- ]chair|mayor)\s+[A-Z][A-Za-z'-]+\s+seconded|\s+seconded\b|\.\s+(?:the )?motion (?:was )?seconded|\.\s+vote\b|\.\s+roll call|\.\s+all\b|$)/i);
    const seconder = seg.match(new RegExp(`${TITLE}\\s+${NAME}\\s+seconded`, 'i')) ?? seg.match(new RegExp(`seconded by\\s+${TITLE}?\\s*${NAME}`, 'i'));
    const votes: Array<{ member: string; vote: VoteValue }> = [];
    const add = (names: string[], vote: VoteValue) => names.forEach((n) => !votes.some((v) => v.member === n.replace(/^Mayor /, '')) && votes.push({ member: n.replace(/^Mayor /, ''), vote }));
    let inferred = false;
    // Labeled lists: "Vote Yes: A, B No: None", "Roll Call Vote. Yes: ... No: ... Recused: ... Absent: ..."
    const afterSecond = seg.slice(Math.max(0, seg.search(/seconded/i)));
    const labeled = [...afterSecond.matchAll(LABELED)];
    if (labeled.some((m) => /^(yes|ayes?)$/i.test(m[1]))) {
      for (const m of labeled) {
        const k = m[1].toLowerCase();
        add(namesIn(m[2]), /^(yes|aye)/.test(k) ? 'yes' : /^(no|nay)/.test(k) ? 'no' : /^abst/.test(k) ? 'abstain' : k === 'recused' ? 'recused' : 'absent');
      }
    } else {
      // Roll call form: "... VOTED YES. COUNCILMEMBER X VOTED NO. COUNCILMEMBER Y ABSTAINED."
      const rollAt = seg.search(/roll call|voted (?:yes|aye|no|nay)/i);
      if (rollAt >= 0) {
        const roll = seg.slice(rollAt).replace(/^roll call (?:vote\.?|went |was )?(?:as follows)?:?/i, '');
        for (const m of roll.matchAll(/([^.;:]*?)\s+(?:voted|vote)\s+(yes|aye|no|nay|in favor|against)\b/gi)) add(namesIn(m[1]), /^(no|nay|against)$/i.test(m[2]) ? 'no' : 'yes');
        for (const m of roll.matchAll(/([^.;:]*?)\s+(?:abstained|abstaining|chose to abstain)\b/gi)) add(namesIn(m[1]), 'abstain');
        for (const m of roll.matchAll(/([^.;:]*?)\s+(?:was|were)\s+(?:absent|excused)\b/gi)) add(namesIn(m[1]), 'absent');
        for (const m of roll.matchAll(/([^.;:]*?)\s+recused\b/gi)) add(namesIn(m[1]), 'recused');
      }
    }
    // "Tie Vote resolved by Mayor Stratton's vote of Yes."
    const tie = seg.match(TIE_A) ?? seg.match(TIE_B);
    if (tie) add(namesIn(tie[1]).slice(-1), /^(no|nay)$/i.test(tie[2]) ? 'no' : 'yes');
    const unanimous = /\bunanimous(?:ly)?\b|\ball (?:were |members? )?(?:present )?(?:voted )?in favor\b|\ball in favor\b|\bpassed unanimously\b/i.test(seg.slice(0, 1200));
    if (!votes.length && unanimous && present.length) {
      // Members present who vote: the council (and before 2026 the mayor, who voted then).
      add(
        present.filter((p) => !p.startsWith('Mayor ') || !voters2026).filter((p) => !absent.includes(p.replace(/^Mayor /, ''))),
        'yes',
      );
      inferred = true;
    }
    const res = seg.match(/\bmotion\s+(?:was\s+)?(carried|passed|approved|failed|died|denied|defeated|withdrawn)\b|\b(carried|failed)\s+(?:unanimously|\d)/i);
    const word = (res?.[1] ?? res?.[2] ?? '').toLowerCase();
    const yes = votes.filter((v) => v.vote === 'yes').length;
    const no = votes.filter((v) => v.vote === 'no').length;
    const result: ParsedMotion['result'] = /carried|passed|approved/.test(word) ? 'carried' : /failed|died|denied|defeated/.test(word) ? 'failed' : votes.length ? (yes > no ? 'carried' : 'failed') : 'unknown';
    const tally = seg.match(/\b(?:carried|passed|failed)\s+(?:by a vote of\s+)?(\d)\s*(?:-|–|to)\s*(\d)\b/i);
    const textOut = (wording?.[1] ?? '').replace(/\s+/g, ' ').trim();
    if (!mover && !votes.length && !res) return; // a stray "motion" with nothing recorded
    if (textOut.length < 4 && !votes.length) return;
    const refs = [...new Set([...seg.slice(0, 900).matchAll(/\b(resolution|ordinance)\s+(?:no\.?\s*)?((?:19|20)\d{2}\s*-\s*\d{1,3}[A-Z]?)/gi)].map((m) => `${titleCase(m[1])} ${m[2].replace(/\s+/g, '')}`))];
    motions.push({
      seq: motions.length + 1,
      item: itemFor(textOut, flat) ?? lastItem(flat.slice(0, at)),
      text: sentenceCase(textOut).slice(0, 700),
      mover: mover ? namesIn(mover[1])[0] ?? null : null,
      seconder: seconder ? namesIn(seconder[1])[0] ?? null : null,
      result,
      tally: tally ? `${tally[1]}-${tally[2]}` : null,
      tieBreak: Boolean(tie),
      unanimous: unanimous || (votes.length > 0 && no === 0 && votes.every((v) => v.vote !== 'abstain')),
      inferred,
      votes,
      refs,
      at,
    });
  });
  // One spelling per person in a document: minutes sometimes misspell a name once ("Rassmussen",
  // "Flaked"); the spelling used most (movers, seconders and roll calls first) wins.
  const count = new Map<string, number>();
  const bump = (n: string | null, w: number) => n && count.set(n, (count.get(n) ?? 0) + w);
  for (const m of motions) {
    bump(m.mover, 3);
    bump(m.seconder, 3);
    m.votes.forEach((v) => bump(v.member, m.inferred ? 1 : 2));
  }
  present.forEach((p) => bump(p.replace(/^Mayor /, ''), 1));
  const names = [...count.keys()];
  const canon = (n: string | null): string | null => {
    if (!n) return n;
    let best = n;
    for (const o of names) if (o !== n && o[0] === n[0] && Math.min(o.length, n.length) >= 4 && editDistance(o, n) <= 2 && (count.get(o) ?? 0) > (count.get(best) ?? 0)) best = o;
    return best;
  };
  for (const m of motions) {
    m.mover = canon(m.mover);
    m.seconder = canon(m.seconder);
    const seen = new Set<string>();
    m.votes = m.votes.map((v) => ({ ...v, member: canon(v.member) as string })).filter((v) => (seen.has(v.member) ? false : (seen.add(v.member), true)));
  }
  const fullNames: Record<string, string> = {};
  for (const [last, n] of Object.entries(listedFull)) fullNames[canon(last) as string] = n;
  for (const m of head.replace(/\s+/g, ' ').matchAll(new RegExp(`\\b(?:[Mm]ayor|MAYOR|[Cc]ouncil ?[Mm]ember|COUNCIL ?MEMBER|[Cc]ouncilm[ae]n|[Cc]ouncilwoman|[Cc]ommissioner|COMMISSIONER|[Cc]hair(?:man|woman|person)?|[Vv]ice[- ][Cc]hair|[Bb]oard ?[Mm]ember)\\s+([A-Z][A-Za-z'-]+)\\s+(?:[A-Z]\\.\\s+)?([A-Z][A-Za-z'-]+)\\b`, 'g'))) {
    const last = canon(titleCase(m[2])) as string;
    if (!STOP.has(m[1].toLowerCase()) && !fullNames[last]) fullNames[last] = `${titleCase(m[1])} ${last}`;
  }
  const headFlat = head.replace(/\s+/g, ' ');
  const dm = headFlat.slice(0, 600).match(new RegExp(`\\b(${MONTH_NAMES})\\s+(\\d{1,2}),?\\s+((?:19|20)\\d{2})\\b`, 'i'));
  const printed = dm ? isoDate(Number(dm[3]), MONTH_NAMES.split('|').indexOf(dm[1].toLowerCase()) + 1, Number(dm[2])) : null;
  const top = headFlat.slice(0, 400);
  const body = /redevelopment agency|\bRDA\b/i.test(top) ? 'redevelopment-agency' : /planning commission/i.test(top) ? 'planning-commission' : /(city|town) council/i.test(top) ? 'city-council' : null;
  return { present: [...new Set(present.map((p) => canon(p.replace(/^Mayor /, '')) as string))], absent: absent.map((a) => canon(a) as string), fullNames, date: printed, body, motions };
}

/** Old minutes are typed in capitals: "TO APPROVE THE CONSENT ITEMS" -> "To approve the consent items". */
function sentenceCase(s: string): string {
  const letters = s.replace(/[^A-Za-z]/g, '');
  if (!letters || letters.replace(/[^A-Z]/g, '').length / letters.length < 0.8) return s;
  const low = s.toLowerCase().replace(/\b(resolution|ordinance)\s+(\d)/g, (m) => m.replace(/^./, (c) => c.toUpperCase()));
  return low.charAt(0).toUpperCase() + low.slice(1);
}

function editDistance(a: string, b: string): number {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  const d = Array.from({ length: x.length + 1 }, (_, i) => [i, ...Array<number>(y.length).fill(0)]);
  for (let j = 1; j <= y.length; j++) d[0][j] = j;
  for (let i = 1; i <= x.length; i++) for (let j = 1; j <= y.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
  return d[x.length][y.length];
}

const MONTH_NAMES = 'january|february|march|april|may|june|july|august|september|october|november|december';
function isoDate(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return m >= 1 && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? dt.toISOString().slice(0, 10) : null;
}

export interface RosterEntry {
  name: string;
  role: 'Chair' | 'Vice Chair' | 'Alternate' | 'Member';
}

/**
 * The members a meeting's minutes list at the top, with their roles: "Chair Jarom Sidwell",
 * "Vice-Chair Elisabeth Shelley", "Commissioner Alternate Brooke Meyer", "Commissioner Daniel George".
 * Staff and the public are not members. Full names only (a bare last name is skipped).
 */
export function rosterFrom(head: string): RosterEntry[] {
  const t = head.replace(/\s+/g, ' ').split(/\b(?:staff present|staff:|city staff|also present|others present|public present)\b/i)[0];
  const out: RosterEntry[] = [];
  const re = /\b(Vice[- ]?Chair(?:person|man|woman)?|Chair(?:person|man|woman)?|Commissioner Alternate|Alternate Commissioner|Alternate|Commissioner|Board Member|Council ?member|Member)\s+((?:[A-Z][a-z'’]+(?:-[A-Z][a-z'’]+)?)(?:\s+[A-Z]\.)?\s+(?:[A-Z][a-z'’]+(?:-[A-Z][a-z'’]+)?|Mc[A-Z][a-z]+|[A-Z][a-z]+[A-Z][a-z]+))\b/g;
  for (const m of t.matchAll(re)) {
    const title = m[1].toLowerCase();
    const name = m[2].replace(/\s+[A-Z]\.\s+/, ' ');
    if (name.split(' ').some((w) => STOP.has(w.toLowerCase()))) continue;
    const role: RosterEntry['role'] = /alternate/.test(title) ? 'Alternate' : /vice/.test(title) ? 'Vice Chair' : /chair/.test(title) ? 'Chair' : 'Member';
    if (!out.some((x) => x.name === name)) out.push({ name, role });
  }
  return out;
}
