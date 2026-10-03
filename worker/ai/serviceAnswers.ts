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

const ANSWERS: Array<{ match: RegExp; not?: RegExp; answer: ServiceAnswer }> = [
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
