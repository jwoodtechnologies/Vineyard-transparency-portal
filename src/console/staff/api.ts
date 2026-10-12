/** Typed access to the staff API. Every write carries the header the server checks. */

export class StaffError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function staff<T>(path: string, init: { method?: 'GET' | 'POST'; body?: unknown } = {}): Promise<T> {
  const method = init.method ?? (init.body === undefined ? 'GET' : 'POST');
  const headers: Record<string, string> = { accept: 'application/json' };
  if (method === 'POST') {
    headers['x-vtp-staff'] = '1';
    headers['content-type'] = 'application/json';
  }
  let res: Response;
  try {
    res = await fetch(`/api/staff${path}`, { method, headers, credentials: 'same-origin', cache: 'no-store', body: method === 'POST' ? JSON.stringify(init.body ?? {}) : undefined });
  } catch {
    throw new StaffError('Could not reach the portal. Check your connection and try again.', 0);
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* an empty or non-JSON body */
  }
  if (!res.ok) {
    const message = (data as { error?: { message?: string } } | null)?.error?.message;
    throw new StaffError(message ?? 'Something went wrong. Try again.', res.status);
  }
  return data as T;
}

/** A form upload (a file with its details). The browser sets the multipart boundary itself. */
export async function staffUpload<T>(path: string, form: FormData): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/staff${path}`, { method: 'POST', headers: { accept: 'application/json', 'x-vtp-staff': '1' }, credentials: 'same-origin', cache: 'no-store', body: form });
  } catch {
    throw new StaffError('The upload did not finish. Check your connection and try again.', 0);
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* an empty or non-JSON body */
  }
  if (!res.ok) {
    const message = (data as { error?: { message?: string } } | null)?.error?.message;
    throw new StaffError(message ?? 'The file could not be added. Try again.', res.status);
  }
  return data as T;
}

export type Role = 'owner' | 'admin' | 'editor';

export interface Me {
  id: string;
  email: string;
  name: string;
  department: string | null;
  role: Role;
  areas: string[];
}

export interface AreaInfo {
  key: string;
  label: string;
}

export interface StaffState {
  user: Me | null;
  setupOpen: boolean;
  areas: AreaInfo[];
}

export const ROLE_LABEL: Record<Role, string> = { owner: 'Owner', admin: 'Administrator', editor: 'Editor' };

export const canEditArea = (user: Me, area: string): boolean => user.role !== 'editor' || user.areas.includes(area);
export const canManageUsers = (user: Me): boolean => user.role !== 'editor';

/** "Today 2:14 PM", "Yesterday 9:02 AM" or "Oct 3, 2:14 PM". */
export function when(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((start(new Date()) - start(d)) / 86_400_000);
  if (days === 0) return `Today ${time}`;
  if (days === 1) return `Yesterday ${time}`;
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric', ...(days > 300 ? { year: 'numeric' } : {}) })}, ${time}`;
}

export interface AuditItem {
  id: number;
  at: string;
  user_name: string | null;
  area: string;
  action: string;
  summary: string;
  undone_at: string | null;
  undone_by: string | null;
  undoable: boolean;
}

export const AREA_NAME: Record<string, string> = {
  records: 'Records and meetings',
  votes: 'Votes',
  people: 'People and boards',
  map: 'Map and projects',
  budget: 'Budget',
  notices: 'Events and notices',
  site: 'Site pages and links',
  accounts: 'Accounts',
};

