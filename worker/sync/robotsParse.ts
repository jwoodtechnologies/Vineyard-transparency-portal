/** robots.txt parsing and matching (RFC 9309), pure and unit-tested. */

const TOKEN = 'vineyardtransparencyportal';

export interface Rule {
  allow: boolean;
  path: string;
}

/** Pure: the rules that apply to this crawler from a robots.txt body. */
export function parseRobots(body: string): Rule[] {
  const groups: Array<{ agents: string[]; rules: Rule[] }> = [];
  let current: { agents: string[]; rules: Rule[] } | null = null;
  let lastWasAgent = false;
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if ((key === 'allow' || key === 'disallow') && current) {
      lastWasAgent = false;
      if (key === 'disallow' && !value) continue;
      current.rules.push({ allow: key === 'allow', path: value });
    } else lastWasAgent = false;
  }
  const own = groups.filter((g) => g.agents.some((a) => a !== '*' && TOKEN.includes(a)));
  const chosen = own.length ? own : groups.filter((g) => g.agents.includes('*'));
  return chosen.flatMap((g) => g.rules);
}

function matches(path: string, pattern: string): boolean {
  const re = new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$')}`);
  return re.test(path);
}

/** Pure: may this path be fetched under these rules. */
export function allowedBy(rules: Rule[], pathWithQuery: string): boolean {
  let best: Rule | null = null;
  for (const r of rules) {
    if (!matches(pathWithQuery, r.path)) continue;
    if (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow)) best = r;
  }
  return best ? best.allow : true;
}

