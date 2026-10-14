/**
 * Who a staff account is and what it may change, with no browser code, so plain tests can use it too
 * (api.ts re-exports all of it).
 */
export type Role = 'owner' | 'admin' | 'editor';

export interface Me {
  id: string;
  email: string;
  name: string;
  department: string | null;
  role: Role;
  areas: string[];
  /** The new staff tour: null until finished ('done') or skipped; 'before' for accounts made before it. */
  tour?: string | null;
}

export const canEditArea = (user: Me, area: string): boolean => user.role !== 'editor' || user.areas.includes(area);
export const canManageUsers = (user: Me): boolean => user.role !== 'editor';

export const AREA_NAME: Record<string, string> = {
  records: 'Records and meetings',
  votes: 'Votes',
  people: 'People and boards',
  map: 'Map and projects',
  budget: 'Budget',
  notices: 'Events and notices',
  site: 'Site pages and links',
  submissions: 'Resident submissions',
  accounts: 'Accounts',
};
