/**
 * A message that just names a part of the portal ("voting record", "staff directory", "map") is a
 * request to see it. The chat answers with what that part holds and a card that opens it here, on
 * the portal, never a search through old minutes for those words.
 */
export interface Section {
  id: 'votes' | 'people' | 'boards' | 'map' | 'services' | 'planning' | 'calendar' | 'records' | 'budget';
  path: string;
  label: string;
  hint: string;
  text: string;
}

const SECTIONS: Array<Section & { names: RegExp }> = [
  { id: 'votes', path: '/votes', label: 'Open voting records', hint: 'Every recorded vote, meeting by meeting', text: '', names: /^(?:voting records?|vote records?|votes?|voting|recorded votes?|roll calls?|how (?:they|council|the council) voted?|voting history)$/ },
  { id: 'people', path: '/people', label: 'Open the staff directory', hint: 'Mayor, council and city staff by department', text: 'The directory lists the mayor, the City Council and city staff by department, each with a title, phone and email from the city website.', names: /^(?:staff(?: directory| list)?|directory|people|employees|city staff|officials|contacts?|who works (?:here|there|for the city)|org(?:anization)? chart)$/ },
  { id: 'boards', path: '/boards', label: 'Open boards and commissions', hint: 'Current members, roles and meetings', text: 'Boards and commissions lists every body that meets, its current members with their roles, and its meetings.', names: /^(?:boards?(?: and commissions?)?|commissions?|committees?)$/ },
  { id: 'map', path: '/map', label: 'Open the map', hint: 'Roads, zoning, parks and capital projects', text: 'The map shows Vineyard roads, zoning, parks, snowplow routes and capital projects from the city GIS.', names: /^(?:maps?|city map|gis)$/ },
  { id: 'services', path: '/services', label: 'Open city services', hint: 'Forms, payments and how to do things', text: 'City services has the forms, payments and how-to pages from the city website, each opening here in the portal.', names: /^(?:services?|city services|forms?|pay(?:ments?)?)$/ },
  { id: 'planning', path: '/planning', label: 'Open the Planning Commission page', hint: 'Votes and attendance this year', text: 'The Planning Commission page tracks its votes and attendance since January 2026.', names: /^(?:planning(?: commission)?(?: votes?| voting records?| attendance)?)$/ },
  { id: 'calendar', path: '/meetings', label: 'Open the calendar', hint: 'Meetings, events and trash days', text: 'The calendar has every public meeting from the city agenda portal plus city events, recreation, library programs and trash days.', names: /^(?:calendar|events?|meetings?|schedule|upcoming meetings?)$/ },
  { id: 'records', path: '/records?c=meetings', label: 'Open agendas and minutes', hint: 'Every meeting, newest first', text: 'Agendas and minutes are listed by meeting, newest first, with the packet and attachments for each.', names: /^(?:agendas?(?: and minutes)?|minutes|records|documents|packets?)$/ },
];

const FILLER = /\b(?:please|pls|show|me|see|view|open|pull up|go to|take me to|find|get|give|i want|i need|can you|could you|the|a|an|our|my|your|vineyard|city council|council|council'?s|city|city'?s|page|tab|section|portal|website|site|for|of|on|to|up|whats|what'?s|what is|what are|where is|where are|tell me about|list of|all)\b/g;

/** The section a short message names, with any leftover words (a member's name, say) returned. */
export function sectionFor(message: string): { section: Section; rest: string } | null {
  const raw = message.toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!raw || raw.split(' ').length > 9) return null;
  const core = raw.replace(FILLER, ' ').replace(/\s+/g, ' ').trim();
  for (const s of SECTIONS) {
    if (s.names.test(core)) return { section: s, rest: '' };
  }
  // "Jacob Wood's voting record", "Lauret votes": the voting record with a name left over.
  const m = core.match(/^(.{2,40}?)(?:'s|s')?\s+(?:voting records?|vote records?|votes|voting history)$/) ?? core.match(/^(?:voting records?|vote records?|votes|voting history)\s+(.{2,40})$/);
  if (m) return { section: SECTIONS[0], rest: m[1].replace(/'s$/, '').trim() };
  return null;
}
