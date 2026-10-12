/** Shapes and small helpers for the staff People and boards screen. */

export type PersonKind = 'elected' | 'staff' | 'board';

export interface DirPerson {
  slug: string;
  name: string;
  kind: PersonKind;
  role: string;
  department: string | null;
  boards: string[];
  term: string | null;
  email: string | null;
  phone: string | null;
  current: boolean;
  manual: boolean;
  hasPhoto: boolean;
}

export interface DirOptions {
  departments: string[];
  boards: string[];
  boardRoles: string[];
}

export const KIND_CHOICES: Array<{ value: PersonKind; label: string; hint: string }> = [
  { value: 'elected', label: 'Council', hint: 'The Mayor or a Council Member.' },
  { value: 'staff', label: 'Staff', hint: 'A city employee, with their job title and department.' },
  { value: 'board', label: 'Board', hint: 'A member of a board or commission.' },
];

export const KIND_NOUN: Record<PersonKind, string> = { elected: 'Council', staff: 'Staff', board: 'Board member' };
export const ELECTED_ROLES = ['Mayor', 'Council Member'];

/** One line under a name: "City Manager · Executive", "Chair · Planning Commission". */
export function personLine(p: Pick<DirPerson, 'kind' | 'role' | 'department' | 'boards'>): string {
  if (p.kind === 'board') return [p.role, p.boards.join(', ')].filter(Boolean).join(' · ');
  if (p.kind === 'elected') return p.role;
  return [p.role, p.department].filter(Boolean).join(' · ');
}

/** What the form sends to the server for a person. */
export interface PersonDraft {
  kind: PersonKind;
  name: string;
  role: string;
  department: string;
  boards: string[];
  term: string;
  email: string;
  phone: string;
}

export const EMPTY_PERSON: PersonDraft = { kind: 'staff', name: '', role: '', department: '', boards: [], term: '', email: '', phone: '' };

export function draftOf(p: DirPerson): PersonDraft {
  return { kind: p.kind, name: p.name, role: p.role, department: p.kind === 'staff' ? (p.department ?? '') : '', boards: p.boards, term: p.term ?? '', email: p.email ?? '', phone: p.phone ?? '' };
}

/** The same checks the server makes, so a mistake is caught before saving. Empty means fine. */
export function checkPerson(d: PersonDraft, adding: boolean): string {
  if (adding && (d.name.trim().length < 3 || !d.name.trim().includes(' '))) return 'Write the full name, first and last.';
  if (d.kind === 'elected' && !ELECTED_ROLES.includes(d.role)) return 'Choose Mayor or Council Member.';
  if (d.kind === 'staff' && !d.role.trim()) return 'Write their job title.';
  if (d.kind === 'board' && !d.role.trim()) return 'Choose their role on the board.';
  if (d.kind === 'board' && d.boards.length === 0) return 'Choose at least one board.';
  if (d.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email.trim())) return 'That email address does not look right.';
  if (d.phone.trim() && !/^[0-9 ()+.\-xX]{7,40}$/.test(d.phone.trim())) return 'That phone number does not look right.';
  return '';
}
