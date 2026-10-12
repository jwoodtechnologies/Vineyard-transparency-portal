/** Shapes and small helpers for the staff Updates screen. */

export interface UpdateItem {
  id: string;
  documentId: string | null;
  title: string;
  date: string | null;
  text: string;
  topic: string;
  topicLabel: string | null;
  postedBy: string | null;
  updatedAt: string;
}

export interface UpdatesReply {
  items: UpdateItem[];
  today: string;
  projects: Array<{ key: string; name: string }>;
  topics: Array<{ id: string; label: string }>;
}

export interface UpdateDraft {
  title: string;
  text: string;
  date: string;
  topic: string;
}

export const TEXT_MAX = 20_000;

export const emptyUpdate = (today: string): UpdateDraft => ({ title: '', text: '', date: today, topic: '' });

export const draftOf = (u: UpdateItem): UpdateDraft => ({ title: u.title, text: u.text, date: u.date ?? '', topic: u.topic });

/** The same checks the server makes. Empty means fine. */
export function checkUpdate(d: UpdateDraft): string {
  if (!d.text.trim()) return 'Write the update.';
  if (d.text.length > TEXT_MAX) return `Keep the update under ${TEXT_MAX.toLocaleString('en-US')} characters.`;
  if (d.date && !/^\d{4}-\d{2}-\d{2}$/.test(d.date)) return 'Choose the date.';
  return '';
}

/** The first couple of lines of an update, cut at a word, for the list. */
export function excerpt(text: string, max = 180): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 20))}...`;
}

const flat = (s: string) => s.replace(/\s+/g, ' ').trim();

/** What to show under an update's headline: the rest of the text when the headline is just its first line, so the same words are not shown twice. */
export function detail(title: string, text: string, max = 180): string {
  const [first = '', ...rest] = text.trim().split('\n');
  return flat(first) === flat(title) ? excerpt(rest.join(' '), max) : excerpt(text, max);
}
