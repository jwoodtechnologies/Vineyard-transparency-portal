/**
 * The places inside the staff portal. Each content area (records, votes, people, map, budget,
 * notices, site) gets one screen here; a person only sees the ones their account includes.
 */
import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import type { Me } from './api';
import { canEditArea, canManageUsers } from './api';

export interface Section {
  path: string;
  label: string;
  blurb: string;
  /** Content area that gates this screen, if any. */
  area?: string;
  /** Only owners and administrators. */
  managers?: boolean;
  /** Shown on the home screen as a tile. */
  tile: boolean;
  Component: LazyExoticComponent<ComponentType>;
}

export const SECTIONS: Section[] = [
  { path: 'records', label: 'Records', blurb: 'Add agendas, minutes, reports and other documents.', area: 'records', tile: true, Component: lazy(() => import('./Records')) },
  { path: 'people', label: 'People', blurb: 'Add staff, choose what each person can edit, turn accounts off.', managers: true, tile: true, Component: lazy(() => import('./People')) },
  { path: 'activity', label: 'Activity', blurb: 'See every change and undo a mistake.', tile: true, Component: lazy(() => import('./Activity')) },
];

export function visibleSections(user: Me): Section[] {
  return SECTIONS.filter((s) => (!s.managers || canManageUsers(user)) && (!s.area || canEditArea(user, s.area)));
}
