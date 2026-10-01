/**
 * The conversation brain: before anything else reads a message, the model looks at the recent
 * turns and the new message and decides whether it is a follow-up or a new question, rewrites it
 * as one complete standalone question, and lists anything the resident stated as fact (so the
 * answer can acknowledge it as theirs, never as a record). One small call (a few Neurons); on any
 * problem the message is used as typed.
 */
import { aiText } from './answer';

type AiRunner = { run: (model: string, input: Record<string, unknown>) => Promise<unknown> };
type Env = { AI?: unknown };
type Turn = { role: 'user' | 'assistant'; content: string };

export const REWRITE_MODEL = '@cf/qwen/qwen3-30b-a3b-fp8';

export interface Rewrite {
  followUp: boolean;
  standalone: string;
  facts: string[];
}

const PROMPT = [
  "You read a resident's conversation with the Vineyard, Utah public records assistant and prepare the latest message for a records search.",
  'Decide whether the latest message is a FOLLOW-UP that depends on the conversation (it refers back with it, that, this, he, she, they, there, those, "what about", "and", "why", "when", "how long", a correction such as "no, I meant X", or a bare "?" or "explain"), or a NEW question about something different. A message that names its own subject (a different road, person, topic or document) is new, even if it is short.',
  'Return only JSON, no other text: {"followUp": true or false, "standalone": "...", "facts": ["..."]}',
  'standalone: the latest message as one complete question that makes sense with no conversation. For a follow-up, put in what it refers to (the road, project, person, meeting, document or topic from the conversation). For a bare "?" or "explain", ask for more detail about the previous question. For a new question, return it as written. Keep every name, number, road, date and year exactly. Never answer the question.',
  'facts: things the resident states as fact in the latest message (for example "David Lauret said 575 South should reopen October 15"), each as a short sentence starting "You said". Use [] when the message states nothing.',
].join('\n');

/** Parses and checks the model's output; null when it is unusable. */
export function parseRewrite(out: string, question: string): Rewrite | null {
  const body = out.replace(/<think>[\s\S]*?<\/think>/g, '');
  const m = body.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let j: { followUp?: unknown; standalone?: unknown; facts?: unknown };
  try {
    j = JSON.parse(m[0]);
  } catch {
    return null;
  }
  const standalone = typeof j.standalone === 'string' ? j.standalone.replace(/\s+/g, ' ').trim() : '';
  if (standalone.length < 3 || standalone.length > 400) return null;
  const followUp = j.followUp === true;
  const facts = (Array.isArray(j.facts) ? j.facts : [])
    .filter((f): f is string => typeof f === 'string')
    .map((f) => f.replace(/\s+/g, ' ').trim())
    .filter((f) => f.length >= 8 && f.length <= 300 && /^you (said|mentioned|shared|noted|stated)\b/i.test(f))
    .slice(0, 3);
  // A new question keeps the resident's own words.
  return { followUp, standalone: followUp ? standalone : question, facts };
}

export async function rewriteQuestion(env: Env, question: string, conversation: Turn[]): Promise<Rewrite | null> {
  const turns = conversation.slice(-4);
  if (!turns.some((t) => t.role === 'user')) return null;
  const convo = turns.map((t) => `${t.role === 'user' ? 'Resident' : 'Assistant'}: ${t.content.replace(/\s+/g, ' ').slice(0, t.role === 'user' ? 400 : 600)}`).join('\n');
  try {
    const run = (env.AI as unknown as AiRunner).run(REWRITE_MODEL, {
      messages: [
        { role: 'system', content: `${PROMPT}\n/no_think` },
        { role: 'user', content: `Conversation so far:\n${convo}\n\nLatest message: ${question}` },
      ],
      max_tokens: 200,
      temperature: 0,
    });
    const out = aiText(await Promise.race([run, new Promise<never>((_, r) => setTimeout(() => r(new Error('timeout')), 4500))]));
    return parseRewrite(out, question);
  } catch {
    return null;
  }
}

/** The answer's acknowledgment of what the resident shared, marked as theirs. */
export function factsLine(facts: string[]): string {
  if (!facts.length) return '';
  const said = facts.map((f) => f.replace(/[.\s]+$/, '')).join('; ');
  return `${said}. That comes from you, not from a city record, so it is noted here as what you shared.`;
}
