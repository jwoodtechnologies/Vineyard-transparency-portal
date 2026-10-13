/**
 * City phone numbers the assistant writes into its answers, with any change staff made in the staff portal (Phone numbers and
 * quick links). Read at most once a minute per worker; until the first read, and whenever a read fails, the built-in numbers
 * are used, so an answer always has a number.
 */
import type { Env } from '../env';
import { contactsFrom, type ContactsContent } from '../../src/lib/cityServices';
import { readContent } from './siteContent';

interface Phones {
  cityHall: string;
  police: string;
}

const builtIn = (): Phones => {
  const l = contactsFrom(null);
  return { cityHall: l.cityHall.hint ?? '801-226-1929', police: l.police.hint ?? '801-798-5600' };
};

let phones: Phones = builtIn();
let readAt = 0;

/** Phones from what staff saved, or the built-in ones. */
export function phonesFrom(content: ContactsContent | null | undefined): Phones {
  const l = contactsFrom(content ?? null);
  const b = builtIn();
  return { cityHall: l.cityHall.hint ?? b.cityHall, police: l.police.hint ?? b.police };
}

/** Brings the numbers up to date. Cheap when called often: one small read a minute at most, and never throws. */
export async function refreshCityFacts(env: Env, now = Date.now()): Promise<void> {
  if (now - readAt < 60_000) return;
  readAt = now;
  try {
    const stored = await readContent(env, 'contacts');
    phones = phonesFrom((stored?.value as ContactsContent | undefined) ?? null);
  } catch {
    // Keep the last numbers.
  }
}

export const cityHallPhone = (): string => phones.cityHall;
export const policePhone = (): string => phones.police;

/** For tests: forget what was read. */
export function resetCityFacts(): void {
  phones = builtIn();
  readAt = 0;
}
