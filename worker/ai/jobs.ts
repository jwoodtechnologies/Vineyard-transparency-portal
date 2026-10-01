/**
 * "Is the city hiring?", "What jobs are open?": answered live from the city's official job site
 * (vineyardutah.applicantpro.com), never from old records. No AI call. Cached for 30 minutes.
 */
export const JOBS_PAGE = 'https://vineyardutah.applicantpro.com/jobs/';
const FEED = `https://vineyardutah.applicantpro.com/core/jobs/18590?getParams=${encodeURIComponent(JSON.stringify({ isInternal: 0 }))}`;

export function isJobsQuestion(q: string): boolean {
  return /\b(jobs?|hiring|careers?|job openings?|openings|employment|work for the city|positions? (open|available)|apply to work|now hiring)\b/i.test(q) && !/\b(job creation|jobs? (created|report)|employment rate|unemployment)\b/i.test(q);
}

interface Job {
  title: string;
  url: string;
  type: string | null;
}

let memo: { at: number; jobs: Job[] } | null = null;

export async function openJobs(): Promise<Job[] | null> {
  if (memo && Date.now() - memo.at < 30 * 60_000) return memo.jobs;
  const r = await fetch(FEED, { headers: { accept: 'application/json', 'user-agent': 'VineyardTransparencyPortal/1.0 (+https://vineyardportal.org)' }, cf: { cacheTtl: 1800, cacheEverything: true } } as RequestInit).catch(() => null);
  if (!r?.ok) return null;
  const body = (await r.json().catch(() => null)) as { success?: boolean; data?: { jobs?: Array<Record<string, unknown>> } } | null;
  if (!body?.success || !Array.isArray(body.data?.jobs)) return null;
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const jobs = body.data!.jobs!.map((j) => {
    const id = j.id ?? j.jobId ?? j.job_id;
    const title = str(j.title) ?? str(j.jobTitle) ?? str(j.job_title) ?? 'Open position';
    const url = str(j.jobUrl) ?? str(j.url) ?? str(j.applyUrl) ?? (id ? `https://vineyardutah.applicantpro.com/jobs/${id}` : JOBS_PAGE);
    const type = str(j.employmentType) ?? str(j.employment_type) ?? null;
    return { title, url: /^https:\/\/vineyardutah\.applicantpro\.com\//.test(url) ? url : JOBS_PAGE, type };
  });
  memo = { at: Date.now(), jobs };
  return jobs;
}

export function jobsText(jobs: Job[]): string {
  if (!jobs.length) return "Vineyard City has no job openings posted right now, according to the city's official job site. You can sign up there for job alerts.";
  const list = jobs.slice(0, 10).map((j) => `${j.title}${j.type ? ` (${j.type})` : ''}`).join('; ');
  return `Vineyard City has ${jobs.length} ${jobs.length === 1 ? 'job opening' : 'job openings'} posted on its official job site right now: ${list}${jobs.length > 10 ? '; and more' : ''}.`;
}
