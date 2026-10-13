/**
 * Adding many files at once on the staff Records screen. Each file goes to the same route as a single
 * add (/records/file), one at a time, so the server's limits and checks apply to every file unchanged.
 */
import { MAX_FILE_BYTES, sizeLabel, titleFromFile } from './recordsLib';

export type BulkStatus = 'ready' | 'adding' | 'added' | 'error';

export interface BulkItem<F extends { name: string; size: number } = File> {
  key: string;
  file: F;
  title: string;
  status: BulkStatus;
  /** Why it did not go in, in a plain sentence. */
  message: string;
  documentId: string | null;
}

/** The most files one batch takes. The server takes 40 uploads a minute from one person. */
export const MAX_BATCH = 30;
/** Text and CSV files are read whole, so they are smaller (the server holds the same limit). */
export const MAX_TEXT_BYTES = 1024 * 1024;

const ACCEPTED = /\.(pdf|png|jpe?g|txt|csv)$/i;

/** Why a file cannot be added, before anything is sent; empty when it can. */
export function fileProblem(f: { name: string; size: number }): string {
  if (!ACCEPTED.test(f.name)) return `${f.name} is not a PDF, picture, text or CSV file.`;
  if (f.size <= 0) return `${f.name} is empty.`;
  if (f.size > MAX_FILE_BYTES) return `${f.name} is ${sizeLabel(f.size)}. Files can be up to 25 MB.`;
  if (/\.(txt|csv)$/i.test(f.name) && f.size > MAX_TEXT_BYTES) return `${f.name} is ${sizeLabel(f.size)}. Text and CSV files can be up to 1 MB.`;
  return '';
}

let seq = 0;

/** The files that can go in, each with a title from its name, and a sentence for each one left out. */
export function bulkItems<F extends { name: string; size: number }>(files: F[], already = 0): { items: BulkItem<F>[]; left: string[] } {
  const items: BulkItem<F>[] = [];
  const left: string[] = [];
  for (const file of files) {
    const problem = fileProblem(file);
    if (problem) left.push(problem);
    else if (already + items.length >= MAX_BATCH) left.push(`${file.name} was left out. You can add up to ${MAX_BATCH} files at a time.`);
    else items.push({ key: `f${++seq}`, file, title: titleFromFile(file.name) || file.name, status: 'ready', message: '', documentId: null });
  }
  return { items, left };
}

/**
 * Sends each waiting item in turn (the ones marked ready, or with `retry` the ones that failed). `update`
 * is called as each one starts and ends, so the list on screen follows along.
 */
export async function sendAll<F extends { name: string; size: number }>(
  items: BulkItem<F>[],
  send: (item: BulkItem<F>) => Promise<string | null>,
  update: (key: string, patch: Partial<BulkItem<F>>) => void,
  retry = false,
): Promise<{ added: number; failed: number }> {
  let added = 0;
  let failed = 0;
  for (const item of items) {
    if (item.status !== (retry ? 'error' : 'ready')) continue;
    update(item.key, { status: 'adding', message: '' });
    try {
      const documentId = await send(item);
      update(item.key, { status: 'added', documentId });
      added++;
    } catch (e) {
      update(item.key, { status: 'error', message: e instanceof Error && e.message ? e.message : 'This file could not be added. Try again.' });
      failed++;
    }
  }
  return { added, failed };
}

/** One line on how the batch went. */
export function bulkSummary(items: Array<Pick<BulkItem, 'status'>>): string {
  const n = (s: BulkStatus) => items.filter((i) => i.status === s).length;
  const files = (k: number) => `${k} ${k === 1 ? 'file' : 'files'}`;
  const [ready, adding, added, failed] = [n('ready'), n('adding'), n('added'), n('error')];
  if (adding) return `Adding ${added + failed + 1} of ${items.length}.`;
  if (!added && !failed) return `${files(ready)} ready to add.`;
  const parts = [`${files(added)} added`];
  if (failed) parts.push(`${failed} did not go in`);
  if (ready) parts.push(`${ready} still to add`);
  return `${parts.join(', ')}.`;
}

export const STATUS_WORD: Record<BulkStatus, string> = { ready: 'Ready', adding: 'Adding', added: 'Added', error: 'Not added' };
