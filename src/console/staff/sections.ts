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
  /** What the home tile says when it should read as an action (the tab keeps the short label). */
  tileTitle?: string;
  /** Hidden from the home tiles for people who are not owners or administrators. */
  managersTile?: boolean;
  Component: LazyExoticComponent<ComponentType>;
}

export const SECTIONS: Section[] = [
  { path: 'records', label: 'Records', blurb: 'Add agendas, minutes, reports and other documents.', area: 'records', tile: true, Component: lazy(() => import('./Records')) },
  { path: 'votes', label: 'Votes', blurb: 'Correct how a vote was recorded, add one the minutes missed, or take one down.', area: 'votes', tile: true, Component: lazy(() => import('./Votes')) },
  {
    path: 'projects',
    label: 'Map projects',
    blurb: 'Fix the name, group or description of any funded project on the map.',
    area: 'map',
    tile: true,
    Component: lazy(() => import('./Projects')),
  },
  {
    path: 'services',
    label: 'Service links',
    blurb: 'Fix, hide or add the service buttons and city phone numbers residents tap.',
    area: 'site',
    tile: true,
    Component: lazy(() => import('./Services')),
  },
  { path: 'budget', label: 'Budget', blurb: 'Update the budget figures, totals and capital projects.', area: 'budget', tile: true, Component: lazy(() => import('./Budget')) },
  {
    path: 'notices',
    label: 'Notices',
    tileTitle: 'Post a notice',
    blurb: 'Show a closure or alert at the top of every public page, and on the map if you want.',
    area: 'notices',
    tile: true,
    Component: lazy(() => import('./Notices')),
  },
  {
    path: 'events',
    label: 'Events',
    tileTitle: 'Add an event',
    blurb: 'Put a community event, special meeting or closure day on the public calendar.',
    area: 'notices',
    tile: true,
    Component: lazy(() => import('./Events')),
  },
  {
    path: 'updates',
    label: 'Updates',
    tileTitle: 'Post an update',
    blurb: 'Share a finished project or a change to a service. It is listed on the Records page.',
    area: 'notices',
    tile: true,
    Component: lazy(() => import('./Updates')),
  },
  { path: 'directory', label: 'Directory', blurb: 'Keep the Mayor and Council, city staff and board members up to date.', area: 'people', tile: true, Component: lazy(() => import('./Directory')) },
  {
    path: 'submissions',
    label: 'Submissions',
    tileTitle: 'Review submissions',
    blurb: 'Approve or reject what residents sent, and hide or remove anything already public.',
    area: 'submissions',
    tile: true,
    Component: lazy(() => import('./Submissions')),
  },
  { path: 'people', label: 'Accounts', blurb: 'Add staff, choose what each person can edit, turn accounts off.', managers: true, tile: true, Component: lazy(() => import('./People')) },
  { path: 'activity', label: 'Activity', blurb: 'See every change and undo a mistake.', tile: true, managersTile: true, Component: lazy(() => import('./Activity')) },
];

export function visibleSections(user: Me): Section[] {
  return SECTIONS.filter((s) => (!s.managers || canManageUsers(user)) && (!s.area || canEditArea(user, s.area)));
}
