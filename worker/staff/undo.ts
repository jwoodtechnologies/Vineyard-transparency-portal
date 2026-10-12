/**
 * One-click undo for staff changes. Each kind of edit registers how to put its "before" back; the
 * activity log shows an Undo button only for entries whose kind has one.
 */
import type { Env } from '../env';
import type { AuditRow, StaffUser } from './core';

/** Restores the state before the logged change and returns a short sentence for the log. */
export type Undoer = (env: Env, user: StaffUser, entry: AuditRow) => Promise<string>;

const undoers = new Map<string, Undoer>();

export function registerUndo(entity: string, fn: Undoer): void {
  undoers.set(entity, fn);
}

export const undoerFor = (entity: string): Undoer | undefined => undoers.get(entity);
export const canUndoEntity = (entity: string): boolean => undoers.has(entity);
