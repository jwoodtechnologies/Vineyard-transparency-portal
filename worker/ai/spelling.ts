/**
 * Common misspellings and spoken-word slips in questions about Vineyard records, fixed before the
 * archive is searched ("grammar request" is a GRAMA records request). Pure.
 */
const FIXES: Array<[RegExp, string]> = [
  [/\bgram+[ae]r?\s+(request|form|requests)\b/gi, 'GRAMA records $1'],
  [/\b(gramma|grahma|grama|gramah)\b/gi, 'GRAMA'],
  [/\bfoia\b/gi, 'GRAMA records request'],
  [/\bvin[ey]+ard\b/gi, 'Vineyard'],
  [/\bvinyard\b/gi, 'Vineyard'],
  [/\bminuets\b/gi, 'minutes'],
  [/\bord[ia]n[ae]n?ces?\b/gi, (m: string) => (m.toLowerCase().endsWith('s') ? 'ordinances' : 'ordinance')] as unknown as [RegExp, string],
  [/\bordinace(s?)\b/gi, 'ordinance$1'],
  [/\bresolu(s|t)ion(s?)\b/gi, 'resolution$2'],
  [/\bcouncel\b/gi, 'council'],
  [/\bcounsil\b/gi, 'council'],
  [/\bbudjet\b/gi, 'budget'],
  [/\bpermitt?s?\b/gi, (m: string) => (m.toLowerCase().endsWith('s') ? 'permits' : 'permit')] as unknown as [RegExp, string],
  [/\bzoneing\b/gi, 'zoning'],
  [/\brecorders office\b/gi, "Recorder's office"],
  [/\bmayers?\b/gi, 'mayor'],
  [/\bstratten\b/gi, 'Stratton'],
  [/\blaurette?\b/gi, 'Lauret'],
  [/\bcomission\b/gi, 'commission'],
  [/\bagend(er|ah)s?\b/gi, 'agenda'],
  [/\butilites\b/gi, 'utilities'],
  [/\bwater qualty\b/gi, 'water quality'],
];

export function fixSpelling(q: string): string {
  let out = q;
  for (const [re, to] of FIXES) out = typeof to === 'function' ? out.replace(re, to as unknown as (m: string) => string) : out.replace(re, to);
  return out;
}
