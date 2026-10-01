/** Roads in a question and whether it asks about their construction status. Pure, so it is tested. */
export const ROAD_STATUS = /\b(construction|constructing|under construction|being (built|worked on|done)|work(ing)? on|closed|closure|closing|reopen\w*|open again|detour|done|finish\w*|complete\w*|how long|when will|status|progress|widen\w*|repav\w*|torn up|digging|project)\b/i;
/** Roads named in a question: "575 South", "400 S", "Geneva Road", "Center Street". */
export function roadsIn(text: string): string[] {
  const out: string[] = [];
  const dir: Record<string, string> = { n: 'North', s: 'South', e: 'East', w: 'West' };
  for (const m of text.matchAll(/\b(\d{3,4})\s+(north|south|east|west|n|s|e|w)\b\.?/gi)) {
    const d = m[2].length === 1 ? dir[m[2].toLowerCase()] : m[2][0].toUpperCase() + m[2].slice(1).toLowerCase();
    out.push(`${m[1]} ${d}`);
  }
  for (const m of text.matchAll(/\b((?:[A-Z][a-z]+ ){0,2}[A-Z][a-z]+) (Road|Rd|Street|St|Parkway|Pkwy|Drive|Dr|Boulevard|Blvd|Connector|Lane|Ln|Avenue|Ave)\b/g)) {
    if (/^(the|a|an|on|at|of|in|and|is|isn't|city|main office|north|south|east|west)$/i.test(m[1])) continue;
    out.push(`${m[1]} ${m[2]}`);
  }
  return [...new Set(out)];
}
