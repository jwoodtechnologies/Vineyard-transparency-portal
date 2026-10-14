/**
 * The new staff tour's steps (Tour.tsx draws them). Each step points at a real control on a staff screen,
 * marked with data-tour; a step for an area the person's account does not include is left out.
 */
import { AREA_NAME, canEditArea, canManageUsers, type Me } from './account';

export interface TourStep {
  id: string;
  title: string;
  body: string;
  /** The screen the step is on. */
  path: string;
  /** The control to spotlight: the element with this data-tour value. */
  target: string;
}

const list = (xs: string[]): string => (xs.length < 3 ? xs.join(' and ') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/** One line on the portal and what this account can change. */
export function welcomeLine(me: Me): string {
  const can = canManageUsers(me) ? 'every area, and staff accounts' : list(me.areas.map((a) => AREA_NAME[a] ?? a)) || 'nothing yet';
  return `The portal is the public archive of Vineyard records, meetings and votes. Your account can change ${can}.`;
}

/** The steps for this person, in order: only the ones their areas allow. */
export function tourSteps(me: Me): TourStep[] {
  const records = canEditArea(me, 'records');
  const assistant = ['map', 'notices', 'records'].some((a) => canEditArea(me, a));
  const steps: Array<TourStep | false> = [
    { id: 'welcome', title: 'Welcome', body: welcomeLine(me), path: '/staff', target: 'home' },
    records && {
      id: 'record',
      title: 'Add a record',
      body: 'Choose the file, its type and date, then Add. It becomes searchable, and the public chat can answer from it, within a few minutes.',
      path: '/staff/records',
      target: 'add-record',
    },
    records && {
      id: 'note',
      title: 'Add a note',
      body: 'Plain text for search and the chat, such as new office hours or a changed contact.',
      path: '/staff/records',
      target: 'add-note',
    },
    assistant && {
      id: 'assistant',
      title: 'Tell us what changed',
      body: 'Say what changed in your own words. The assistant proposes the change and waits for you to Publish.',
      path: '/staff',
      target: 'assistant',
    },
    records && { id: 'fix', title: 'Fix records', body: 'Correct a title or date, or hide a record.', path: '/staff/archive', target: 'fix' },
    { id: 'activity', title: 'Activity', body: 'Every change is logged here and can be undone.', path: '/staff/activity', target: 'activity' },
  ];
  return steps.filter((s): s is TourStep => Boolean(s));
}

/** The tour starts by itself only while the account has neither finished nor skipped it. */
export const tourDue = (me: Me | null): boolean => Boolean(me) && (me?.tour ?? null) === null;

const GAP = 12;
/** The ring's space around the control (Tour.tsx draws it). */
export const PAD = 6;
const MARGIN = 12;

export interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * Where the card goes: below the control when it fits, else above, else beside it, kept inside the screen.
 * On a narrow screen the card spans the width at the bottom, or at the top when the control is low down.
 */
export function placeCard(target: Box | null, card: { width: number; height: number }, view: { width: number; height: number }): { top: number; left: number; width: number } {
  const narrow = view.width < 640;
  const width = narrow ? view.width - 2 * MARGIN : Math.min(360, view.width - 2 * MARGIN);
  if (!target) return { top: Math.max(MARGIN, (view.height - card.height) / 2), left: (view.width - width) / 2, width };
  if (narrow) {
    const bottomTop = view.height - card.height - MARGIN;
    const clearBelow = target.top + target.height + PAD + GAP <= bottomTop;
    return { top: clearBelow ? bottomTop : MARGIN, left: MARGIN, width };
  }
  const clampX = (x: number) => Math.min(Math.max(MARGIN, x), view.width - width - MARGIN);
  const below = target.top + target.height + PAD + GAP;
  if (below + card.height <= view.height - MARGIN) return { top: below, left: clampX(target.left), width };
  const above = target.top - PAD - GAP - card.height;
  if (above >= MARGIN) return { top: above, left: clampX(target.left), width };
  const right = target.left + target.width + PAD + GAP;
  const top = Math.min(Math.max(MARGIN, target.top), view.height - card.height - MARGIN);
  if (right + width <= view.width - MARGIN) return { top, left: right, width };
  return { top, left: Math.max(MARGIN, target.left - PAD - GAP - width), width };
}

