/**
 * Questions about a city or library service that have one right answer: where to get a library card,
 * what the bookmobile is. Answered straight from the library's own website (vineyard.lib.utah.gov),
 * with no AI call, so the answer never drifts. The button to the official page comes from the portal's
 * service directory. Facts checked October 2, 2026.
 */
export interface ServiceAnswer {
  text: string;
  followUps: string[];
}

const LIBRARY_CONTACT = "The Vineyard Library is at 125 S Main Street, and its phone number is 801-226-1929.";

/** Questions about permits, codes, jobs or one named project are not "what is being built". */
const NOT_CONSTRUCTION = /\b(permits?|codes?|standards?|fees?|inspections?|noise|hours|licen[cs]es?|contractors?|bids?|rfp|jobs?|employ\w*|apply|applications?|zoning|adu|remodel|1200 north|overpass|skate|beach|slide hill|lift station|connector|rail)\b/i;

const ANSWERS: Array<{ match: RegExp; not?: RegExp; answer: ServiceAnswer }> = [
  {
    match: /\b(construction|road ?work|road closures?|lane closures?|detours?)\b[^.?!]*\b(happening|going on|ongoing|current(ly)?|right now|this (week|month)|updates?|status|schedule|around town|in vineyard|projects?)\b|\b(what('?s| is)|any|current|ongoing)\b[^.?!]*\b(construction|road ?work|road closures?|lane closures?|detours?)\b|\bchip ?seal\w*\b|\bpavement preservation\b|\b(center street|holdaway|lakeside park|620 east|400 south)\b[^.?!]*\b(construction|closed|closures?|work|signal|crosswalk|beacon|lanes?)\b/i,
    not: NOT_CONSTRUCTION,
    answer: {
      text: "The city's most recent construction update is dated August 21, 2026. It covers the Vineyard Regional Trail Enhancements: striping at Lakeside Park and 400 South is complete, crews were installing traffic poles, lights and landscaping through August, and the Center Street and Holdaway Road intersection was getting its south sidewalk, ADA ramps and signal poles. The city's updates describe intermittent lane closures on Center Street, Monday to Friday, 7 a.m. to 7 p.m. Pavement preservation (chip seal) was scheduled for July 29 and 30 and August 11 to 15. The Construction page has each project's timeline, closures and map, and the project hotline is 385-557-2586.",
      followUps: ['What projects are funded this year?', 'Show me the city map'],
    },
  },
  {
    match: /\bbook ?mobiles?\b|\bmobile library\b/i,
    answer: {
      text: "The bookmobile is a mobile library run by the Utah State Library. It carries about 5,000 items that are rotated often, including picture books, fiction, non-fiction, videos, CDs and DVDs. You need a library card to check things out. The schedule and stops are on the state's bookmobile site, linked below, and the Vineyard Library can help at 801-226-1929.",
      followUps: ['How do I get a library card?', 'What are the library hours?'],
    },
  },
  {
    match: /\b(library|libraries)\b[^.?!]*\b(card|cards|membership|sign ?up|register|registration)\b|\b(card|cards|membership|sign ?up|register)\b[^.?!]*\b(library|libraries)\b|\bget a (library )?card\b/i,
    not: /\b(fee|reimburse|reimbursement|rec center)\b/i,
    answer: {
      text: `You can apply for a Vineyard Library card online on the library's website. Use the button below to open the sign-up page. ${LIBRARY_CONTACT}`,
      followUps: ['Tell me about the bookmobile', 'What are the library hours?'],
    },
  },
];

/** The fixed answer for a service question, or null when the question needs the records. */
export function serviceAnswer(question: string): ServiceAnswer | null {
  const q = question.trim();
  if (!q || q.length > 240) return null;
  for (const a of ANSWERS) if (a.match.test(q) && !(a.not && a.not.test(q))) return a.answer;
  return null;
}
