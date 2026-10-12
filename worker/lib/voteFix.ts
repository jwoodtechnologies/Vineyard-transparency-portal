/**
 * Staff corrections to the votes list survive the automatic reading of minutes. A motion is recognized across
 * re-reads by where it happened and what it said, so a motion staff changed or removed is not read back in.
 * Pure: no imports.
 */

/** A stable identity for a motion: body, meeting date and the first words of its wording. */
export function motionFingerprint(body: string | null | undefined, date: string | null | undefined, text: string | null | undefined): string {
  const words = String(text ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .slice(0, 80);
  return `${body ?? ''}|${String(date ?? '').slice(0, 10)}|${words}`;
}
