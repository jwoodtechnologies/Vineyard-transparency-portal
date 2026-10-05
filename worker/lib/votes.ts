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
  /** For a consent motion: each consent item it approved ("5.1 Approval of the August 11 minutes"). */
  items: string[];
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
export function namesIn(list: string, known: string[] = []): string[] {
  const cleaned = list
    .replace(new RegExp(`\\b${TITLE}\\b`, 'gi'), ',')
    .replace(/\b(voted|vote|votes|yes|no|aye|ayes|nay|nays|were|was|is|in favor|favor|absent|abstained|abstaining|abstain|excused|recused|present|also|none|n\/a)\b/gi, ',')
    .replace(/\band\b|&|;|\//gi, ',');
  const out: string[] = [];
  for (const part of cleaned.split(',')) {
    const w = part.replace(/[^A-Za-z'’\s-]/g, ' ').trim().split(/\s+/).filter(Boolean);
    if (!w.length) continue;
    // "McCumber Holdaway and Lauret": two members listed with no comma between them (both are on the attendance list).
    const members = w.filter((x) => known.some((k) => k.toLowerCase() === x.toLowerCase()));
    if (members.length > 1) {
      for (const x of members) {
        const name = titleCase(x);
        if (!out.includes(name)) out.push(name);
      }
      continue;
    }
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
  const p = t.match(/(?<!\bstaff\s)(?<!\balso\s)\b(?:present|in attendance|attending)\b:?\s*(.{0,700}?)(?=\b(?:absent|excused|staff present|staff|also present|also attending|others present|others|city staff|public present|guests|call to order|1\.\s|opening)\b|$)/i);
  const a = t.match(/\b(?:absent|excused)\b:?\s*(.{0,200}?)(?=\b(?:staff|also present|also attending|others|city staff|guests|call to order|1\.\s|opening)\b|$)/i);
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

/** Lines that start narrative or a new part of the minutes, never the rest of a heading that wrapped. */
const NOT_HEADING_TAIL = /^(?:\d{1,2}(?:\.\d{1,2}){0,2}\.?\s|motion\b|vote\b|roll call\b|page \d|items?\s|council\b|mayor\b|board\b|chair\b|commission(?:er)?\b|mr\.|ms\.|mrs\.|dr\.|staff\b|public\b|present\b|absent\b|call to order\b|adjourn|this item\b|moved\b|none\b|no\s|there\b|discussed\b|interim\b|deputy\b|senior\b|long range\b|chief\b|finance\b|administrative\b|planner\b|planning (?:technician|manager|director|commission)\b|city (?:manager|recorder|attorney|staff)\b|at the request\b|the\s)/i;
const SENTENCE_VERB = /\b(?:was|were|will|provided|presented|discussed|explained|stated|asked|noted|reported|updated|introduced|outlined|led|gave|raised|recognized|congratulated|requests?|requested|requesting|proposes?|considered|reviewed|received|recommended|heard|approved|presents?)\b/i;

/**
 * An agenda heading with the lines it wrapped onto. The minutes break a long heading at the page width
 * ("5.4. Approve Ordinance 2026-07 Amending Municipal Code for the Planning" and then, on the next line,
 * "Department (Anthony Fletcher)"), so the heading on its own line is only the start of its name.
 */
export function headingAt(lines: string[], at: number): string {
  let head = (lines[at] ?? '').replace(/\s+/g, ' ').trim();
  let i = at;
  for (let step = 0; step < 3; step++) {
    const open = /\([^)]*$/.test(head);
    const short = !open && head.length < 68;
    if (!open && /[).:;!?]$/.test(head)) break;
    let j = i + 1;
    while (j < lines.length && !lines[j].trim() && j - i < 3) j++;
    const next = (lines[j] ?? '').replace(/\s+/g, ' ').trim();
    if (!next || next.length > 110) break;
    // A short heading is joined only to a fragment that closes with the presenter in brackets ("Responsibilities and Duties (Mayor Stratton)").
    if (short && !(next.length <= 60 && /\)$/.test(next) && !/\.\s/.test(next) && !NOT_HEADING_TAIL.test(next) && !SENTENCE_VERB.test(next))) break;
    if (!open && (NOT_HEADING_TAIL.test(next) || (SENTENCE_VERB.test(next) && !/\)$/.test(next)))) break;
    const first = next.split(/\.\s+(?=[A-Z])/)[0] ?? next;
    head = `${head} ${first}`.trim();
    i = j;
    if (first !== next) break;
  }
  return head;
}

function lastItem(before: string): string | null {
  // The agenda item heading closest before the motion: "5.4 Ordinance 2026-12 Plat Signatures".
  const lines = before.slice(-6000).split(/\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i].trim().match(/^(\d{1,2}(?:\.\d{1,2}){0,2})\.?\s+([A-Z][^\n]{3,600})$/);
    if (m && !/^\d+$/.test(m[2])) {
      // A heading run into its first sentence ("3. CLOSED SESSION The Chair and Board ...") keeps the heading.
      const head = headingAt(lines, i).replace(/^\d{1,2}(?:\.\d{1,2}){0,2}\.?\s+/, '').replace(/\s+/g, ' ').trim();
      const caps = head.match(/^([A-Z0-9][A-Z0-9 &,'()/-]{3,}?)(?=\s+[A-Z][a-z])/);
      const label = caps ? caps[1] : head.split(/(?<=[a-z)])\.\s/)[0];
      return `${m[1]} ${label}`.slice(0, 220);
    }
  }
  return null;
}

/**
 * The consent items a consent motion covers: the numbered lines under the last CONSENT heading
 * before the motion, narrowed to the numbers the motion names, without any it removed.
 */
export function consentItems(before: string, motion: string): string[] {
  // The last CONSENT heading that is followed by the numbered list (not a later sentence such as "Items 5.4 and 5.5 were removed from the Consent Items").
  let at = -1;
  for (const h of before.matchAll(/\bconsent\s+(?:items|agenda|calendar)\b/gi)) if (/^[\s\S]{0,600}?\n\s*\d{1,2}\.\d{1,2}\.?\s+[A-Z]/.test(before.slice((h.index ?? 0) + h[0].length))) at = h.index ?? 0;
  if (at < 0) return [];
  const section = before.slice(at);
  const out: Array<[string, string]> = [];
  const rows = section.split('\n');
  for (let k = 0; k < rows.length; k++) {
    const m = rows[k].match(/^\s*(\d{1,2}\.\d{1,2})\.?\s+([A-Z][^\n]{3,220})/);
    if (!m) continue;
    const title = headingAt(rows, k).replace(/^\d{1,2}\.\d{1,2}\.?\s+/, '').replace(/\s+/g, ' ').replace(/\s*\((?:[A-Z][a-z]+ ?){1,3}\)\s*$/, '').trim();
    if (/^(motion|vote|yes|no)\b/i.test(title)) continue;
    if (!out.some(([n]) => n === m[1])) out.push([m[1], title.slice(0, 220)]);
  }
  const named = [...motion.matchAll(/\b(\d{1,2}\.\d{1,2})\b/g)].map((m) => m[1]);
  const removed = (motion.match(/\b(?:remov\w*|except|exclud\w*|pull\w*|without)\b(?:[^.]|\.(?=\d))*/i)?.[0] ?? '').match(/\d{1,2}\.\d{1,2}/g) ?? ([] as string[]);
  const keep = out.filter(([n]) => !removed.includes(n) && (!named.length || named.includes(n) || removed.length));
  return keep.map(([n, t]) => `${n} ${t}`).slice(0, 20);
}

/** The item a motion names itself: "approve item 5.4", "the Consent Items 5.1, 5.2 and 5.3". */
function itemFor(motion: string, flat: string): string | null {
  if (/\bconsent\b/i.test(motion)) return 'Consent items';
  const n = motion.match(/\b(?:items?\s+)?(\d{1,2}\.\d{1,2})\b(?!\s*(?:million|%|percent|acres?))/i);
  if (!n) return null;
  const esc = n[1].replace('.', '\\.');
  const lines = flat.split('\n');
  const at = lines.findIndex((l) => new RegExp(`^\\s*${esc}\\.?\\s+[A-Z][^\\n]{3,160}`).test(l));
  if (at < 0) return null;
  return `${n[1]} ${headingAt(lines, at).replace(/^\d{1,2}\.\d{1,2}\.?\s+/, '').replace(/\s+/g, ' ').trim()}`.slice(0, 220);
}

/** The agenda heading that names a resolution or ordinance a motion adopts ("Adopt Resolution 202603" is item 5.1 "Approve Resolution 2026-03 ..."). */
function itemByRef(motion: string, flat: string): { num: string; heading: string | null } | null {
  const m = motion.match(/\b(?:resolution|ordinance)\s+u?((?:19|20)\d{2})\s*-?\s*(\d{2,3})\b/i);
  if (!m) return null;
  const num = `${m[1]}-${m[2]}`;
  const re = new RegExp(`\\b${num}\\b`);
  const lines = flat.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const h = lines[i].trim().match(/^(\d{1,2}\.\d{1,2})\.?\s+[A-Z]/);
    if (!h) continue;
    const full = headingAt(lines, i).replace(/^\d{1,2}\.\d{1,2}\.?\s+/, '').replace(/\s+/g, ' ').trim();
    if (re.test(full) && !/\bminutes\b/i.test(full)) return { num, heading: `${h[1]} ${full}`.slice(0, 220) };
  }
  return { num, heading: null };
}

/** Every motion in a set of minutes, with mover, seconder, result and each member's vote. */
const PAGE_HEADER = /^(?:page \d+ of \d+|.*\b(?:city council|planning commission|redevelopment agency)\b.*\b(?:agenda|minutes|summary)\b.*)$/i;

/**
 * Some minutes set a sub-item number on a line of its own. The title then sits below the number ("10.2." over "ARCH Commission ..."),
 * above it ("Approve ARCH Grant Extension Request (Brian Vawdrey)" over "10.1."), or runs through it ("... (Anthony" / "10.2. Fletcher and David Herring)").
 * Each is written back as one line, "10.2. Title", so everything that reads headings sees the same thing.
 */
export function joinNumbers(text: string): string {
  const lines = text.split('\n');
  const out: string[] = [];
  const lastIndex = () => {
    for (let k = out.length - 1; k >= 0 && out.length - k <= 4; k--) if (out[k].trim()) return k;
    return -1;
  };
  const headingLike = (v: string) =>
    v.length >= 6 && v.length <= 150 && /^[A-Z0-9"“]/.test(v) && v !== v.toUpperCase() && !/[.!?:]$/.test(v) && !/^\d{1,2}(?:\.\d{1,2})*\.?\s/.test(v) && !PAGE_HEADER.test(v) && !/^(?:motion|yes|no|vote|roll call)\b/i.test(v);
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*(\d{1,2}\.\d{1,2})\.?\s*(.*)$/.exec(lines[i]);
    if (!m) {
      out.push(lines[i]);
      continue;
    }
    const num = m[1];
    let rest = m[2].trim();
    let next = i + 1;
    while (next < lines.length && next - i <= 3 && !lines[next].trim()) next++;
    const nx = (lines[next] ?? '').trim();
    const pi = lastIndex();
    const prev = pi >= 0 ? out[pi].trim() : '';
    // A heading that opened a bracket above the number and closes it after the number.
    if (prev && /\([^)]*$/.test(prev) && !/^\d{1,2}\./.test(prev) && prev.length <= 150) {
      const tail = rest || (/\)$/.test(nx) ? nx : '');
      if (tail && /\)$/.test(tail)) {
        out[pi] = `${num}. ${prev} ${tail}`;
        if (!rest) i = next;
        continue;
      }
    }
    if (rest) {
      out.push(lines[i]);
      continue;
    }
    // The title above the number, with the description under it.
    if (headingLike(prev) && (nx.length > 60 || /[.]$/.test(nx) || PAGE_HEADER.test(nx))) {
      out[pi] = `${num}. ${prev}`;
      continue;
    }
    if (nx && !PAGE_HEADER.test(nx)) {
      rest = nx;
      out.push(`${num}. ${rest}`);
      i = next;
      continue;
    }
    out.push(lines[i]);
  }
  return out.join('\n');
}

export function parseMinutes(text: string, date: string | null = null): ParsedMinutes {
  const head = text.slice(0, 2500);
  const { present, absent, full: listedFull } = attendance(head);
  const known = [...present, ...absent].map((n) => n.replace(/^Mayor /, ''));
  const listed = (list: string) => namesIn(list, known);
  // Line-numbered minutes put a bare number on its own line; those are not part of the words.
  let flat = text
    .replace(/[‘’]/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\d{1,4}\s*(?=\n)/g, '\n')
    // A page footer in the middle of a sentence ("Page 5 of 7; March 24, 2026, City Council Minutes").
    .replace(/^ ?Page \d+ of \d+;.*$/gim, '');
  flat = joinNumbers(flat);
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
    const mover = seg.match(new RegExp(`${TITLE}\\s+${NAME}\\s+(?:made a motion|moved|motioned|nominated|motions? to)`, 'i'));
    const wording = seg.match(/\b(made a motion|moved|motioned|nominated|motions?(?=\s+to\b))\s+(?:to\s+|that\s+|the\s+)?([\s\S]{3,900}?)(?=\.\s+(?:[A-Z][A-Za-z]*\s+){0,3}[A-Za-z'-]+\s+seconded|\.?\s+seconded by\b|\s+(?:council ?members?|councilm[ae]n|councilwoman|commissioners?|board ?members?|chair(?:man|woman|person)?|vice[- ]chair|mayor)\s+[A-Z][A-Za-z'-]+\s+seconded|\s+seconded\b|\.\s+(?:the )?motion (?:was )?seconded|\.\s+vote\b|\.\s+roll call|\.\s+all\b|$)/i);
    const seconder = seg.match(new RegExp(`${TITLE}\\s+${NAME}\\s+seconded`, 'i')) ?? seg.match(new RegExp(`seconded by\\s+${TITLE}?\\s*${NAME}`, 'i'));
    const votes: Array<{ member: string; vote: VoteValue }> = [];
    const add = (names: string[], vote: VoteValue) => names.forEach((n) => !votes.some((v) => v.member === n.replace(/^Mayor /, '')) && votes.push({ member: n.replace(/^Mayor /, ''), vote }));
    let inferred = false;
    // A "Yes: ... No: ..." roll printed in the minutes is the record itself; a typo in the printed tally does not overrule it.
    let printedRoll = false;
    // Labeled lists: "Vote Yes: A, B No: None", "Roll Call Vote. Yes: ... No: ... Recused: ... Absent: ..."
    const afterSecond = seg.slice(Math.max(0, seg.search(/seconded/i)));
    const labeled = [...afterSecond.matchAll(LABELED)];
    if (labeled.some((m) => /^(yes|ayes?)$/i.test(m[1]))) {
      printedRoll = labeled.some((m) => /^(no|nays?)$/i.test(m[1]));
      for (const m of labeled) {
        const k = m[1].toLowerCase();
        add(listed(m[2]), /^(yes|aye)/.test(k) ? 'yes' : /^(no|nay)/.test(k) ? 'no' : /^abst/.test(k) ? 'abstain' : k === 'recused' ? 'recused' : 'absent');
      }
    } else {
      // Roll call form: "... VOTED YES. COUNCILMEMBER X VOTED NO. COUNCILMEMBER Y ABSTAINED."
      const voteAt = seg.search(/roll call|voted (?:yes|aye|no|nay|in favor|agains\w*)/i);
      // "Mayor Pro Temp Wood and councilmembers McCumber, Holdaway and Lauret voted in favor." names the voters before the verb,
      // so a sentence of that kind is read from its first word.
      const sentenceAt = seg.lastIndexOf('. ', voteAt) < 0 ? 0 : seg.lastIndexOf('. ', voteAt) + 2;
      const rollAt = voteAt > 0 && !/^roll call/i.test(seg.slice(voteAt)) ? sentenceAt : voteAt;
      if (rollAt >= 0) {
        const roll = seg.slice(rollAt).replace(/^roll call (?:vote\.?|went |was )?(?:as follows)?:?/i, '');
        for (const m of roll.matchAll(/([^.;:]*?)\s+(?:voted|vote)\s+(yes|aye|no|nay|in favor|agains\w*)\b/gi)) add(listed(m[1]), /^(no|nay|agains)/i.test(m[2]) ? 'no' : 'yes');
        for (const m of roll.matchAll(/([^.;:]*?)\s+(?:abstained|abstaining|chose to abstain)\b/gi)) add(listed(m[1]), 'abstain');
        for (const m of roll.matchAll(/([^.;:]*?)\s+(?:was|were)\s+(?:absent|excused|not\s+(?:in\s+attendance|present))\b/gi)) add(listed(m[1]), 'absent');
        for (const m of roll.matchAll(/([^.;:]*?)\s+recused\b/gi)) add(listed(m[1]), 'recused');
      }
    }
    // "Tie Vote resolved by Mayor Stratton's vote of Yes."
    const tie = seg.match(TIE_A) ?? seg.match(TIE_B);
    if (tie) add(namesIn(tie[1]).slice(-1), /^(no|nay)$/i.test(tie[2]) ? 'no' : 'yes');
    // "passed 3-2", "passed with a vote of THREE (3) TO TWO (2)".
    const tally = seg.match(/\b(?:carried|passed|failed|vote of)\s+(?:(?:with|by)\s+a\s+vote\s+of\s+)?(?:[a-z]+\s+)?\(?(\d)\)?\s*(?:-|–|to)\s*(?:[a-z]+\s+)?\(?(\d)\)?/i);
    const unanimous = /\bun[a-z]{1,3}mous(?:ly)?\b|\ball (?:were |members? )?(?:present )?(?:voted )?in favor\b|\ball in favor\b|\bpassed unanimously\b/i.test(seg.slice(0, 1200));
    if (!votes.length && unanimous && present.length) {
      // Members present who vote: the council (and before 2026 the mayor, who voted then).
      add(
        present.filter((p) => !p.startsWith('Mayor ') || !voters2026).filter((p) => !absent.includes(p.replace(/^Mayor /, ''))),
        'yes',
      );
      inferred = true;
    }
    if (!inferred && votes.length) {
      // A tally that does not match the names read means the names were not read right: say nothing rather than something wrong.
      // Only names on the attendance list are counted: a word mangled by the scan ("Counéil") is not a voter.
      const counted = votes.filter((v) => !known.length || known.includes(v.member));
      const y = counted.filter((v) => v.vote === 'yes').length;
      const n = counted.filter((v) => v.vote === 'no').length;
      if (tally && !printedRoll && (y !== Number(tally[1]) || n !== Number(tally[2]))) votes.length = 0;
      // "Passed unanimously" with the mover or seconder missing from the list (a typo in the minutes): they voted yes.
      else if (unanimous && votes.every((v) => v.vote === 'yes')) {
        for (const who of [mover && namesIn(mover[1])[0], seconder && namesIn(seconder[1])[0]]) {
          if (who && !votes.some((v) => v.member === who) && !absent.includes(who)) votes.push({ member: who, vote: 'yes' });
        }
      }
    }
    const res = seg.match(/\bmotion\s+(?:was\s+)?(carried|passed|approved|failed|died|denied|defeated|withdrawn)\b|\b(carried|failed)\s+(?:unanimously|\d)/i);
    const word = (res?.[1] ?? res?.[2] ?? '').toLowerCase();
    const yes = votes.filter((v) => v.vote === 'yes').length;
    const no = votes.filter((v) => v.vote === 'no').length;
    const result: ParsedMotion['result'] = /carried|passed|approved/.test(word) ? 'carried' : /failed|died|denied|defeated/.test(word) ? 'failed' : votes.length ? (yes > no ? 'carried' : 'failed') : 'unknown';
    // "Councilmember Holdaway nominated Councilmember Wood to serve as Mayor Pro Temp" is a motion to nominate.
    const textOut = `${/^nominated$/i.test(wording?.[1] ?? '') ? 'nominate ' : ''}${wording?.[2] ?? ''}`.replace(/\s+/g, ' ').trim();
    if (!mover && !votes.length && !res) return; // a stray "motion" with nothing recorded
    if (textOut.length < 4 && !votes.length) return;
    const refs = [...new Set([...seg.slice(0, 900).matchAll(/\b(resolution|ordinance)\s+(?:no\.?\s*)?((?:19|20)\d{2}\s*-\s*\d{1,3}[A-Z]?)/gi)].map((m) => `${titleCase(m[1])} ${m[2].replace(/\s+/g, '')}`))];
    motions.push({
      seq: motions.length + 1,
      item: (() => {
        const found = itemFor(textOut, flat) ?? lastItem(flat.slice(0, at));
        if (found === 'Consent items') return found;
        const ref = itemByRef(textOut, flat);
        return ref?.heading && !found?.includes(ref.num) ? ref.heading : found;
      })(),
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
      items: /\bconsent\b/i.test(textOut) ? consentItems(flat.slice(Math.max(0, at - 8000), at), textOut) : [],
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
  // A name printed with a title ("RDA Board Member Parker McCumber") wins over a name from a plain list
  // (the public who signed in), so a visitor who shares a member's last name is never taken for the member.
  const fullNames: Record<string, string> = {};
  const titled: Record<string, string> = {};
  for (const m of head.replace(/\s+/g, ' ').matchAll(new RegExp(`\\b(?:[Mm]ayor|MAYOR|[Cc]ouncil ?[Mm]ember|COUNCIL ?MEMBER|[Cc]ouncilm[ae]n|[Cc]ouncilwoman|[Cc]ommissioner|COMMISSIONER|[Cc]hair(?:man|woman|person)?|[Vv]ice[- ][Cc]hair|[Bb]oard ?[Mm]ember)\\s+([A-Z][A-Za-z'-]+)\\s+(?:[A-Z]\\.\\s+)?([A-Z][A-Za-z'-]+)\\b`, 'g'))) {
    const last = canon(titleCase(m[2])) as string;
    if (!STOP.has(m[1].toLowerCase()) && !titled[last]) titled[last] = `${titleCase(m[1])} ${last}`;
  }
  for (const [last, n] of Object.entries(listedFull)) if (!titled[canon(last) as string]) fullNames[canon(last) as string] = n;
  Object.assign(fullNames, titled);
  const headFlat = head.replace(/\s+/g, ' ');
  const dm = headFlat.slice(0, 600).match(new RegExp(`\\b(${MONTH_NAMES})\\s+(\\d{1,2}),?\\s+((?:19|20)\\d{2})\\b`, 'i'));
  // Drafts with numbered lines carry the date only in the page footer ("Page 1 of 5; May 12, 2026, City Council ...").
  const fm = dm ?? text.slice(0, 12000).replace(/\s+/g, ' ').match(new RegExp(`\\bPage\\s+\\d+\\s+of\\s+\\d+[;,.]?\\s+(${MONTH_NAMES})\\s+(\\d{1,2}),?\\s+((?:19|20)\\d{2})\\b`, 'i'));
  const printed = fm ? isoDate(Number(fm[3]), MONTH_NAMES.split('|').indexOf(fm[1].toLowerCase()) + 1, Number(fm[2])) : null;
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
