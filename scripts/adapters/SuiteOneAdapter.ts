/**
 * SuiteOneAdapter — meeting portal at https://vineyardut.suiteonemedia.com/ (SuiteOne Media).
 *
 * STATUS: UNVERIFIED. The live portal could not be inspected from the development environment
 * (egress to the host was blocked), so this adapter is written defensively from general
 * knowledge of meeting portals and makes NO assumptions about:
 *   - specific CSS classes or table layouts
 *   - sequential or guessable meeting IDs (IDs are only ever read from real links)
 *   - URL formats (patterns below are heuristics, applied to links actually present on the page)
 *
 * Strategy:
 *   1. Fetch the landing page. Collect "listing" links on the same host (archive / past meetings /
 *      year / pagination) up to maxDepth to reach older meetings.
 *   2. Collect "meeting" links: same host, URL or link text suggests an event/meeting AND carries an
 *      identifier or a date. Fetch each meeting page (bounded by maxPages).
 *   3. On each meeting page, every document link (agenda, packet, minutes, transcript, attachment)
 *      becomes a candidate tied to a CandidateMeeting; audio/video links are recorded as media.
 *
 * TODO(verify against live site):
 *   - [ ] Does the landing page render meetings server-side, or via a JSON API? If JS-rendered,
 *         locate the JSON endpoint in the browser network tab and add a fetch here (preferred over
 *         HTML scraping). health() reports "degraded" when the page has no links.
 *   - [ ] Confirm which query parameter/path segment carries the meeting identifier and add it to
 *         MEETING_ID_PARAMS.
 *   - [ ] Confirm how agenda vs. packet vs. minutes are labelled (link text / file names).
 *   - [ ] Confirm how archived years/pages are navigated (LISTING_TEXT).
 *   - [ ] Confirm where the body name (e.g. council vs. commission) appears on meeting pages.
 */
import { checkSourceHealth } from '../lib/health';
import { collapseWhitespace } from '../lib/html';
import { extractDates } from '../lib/metadata';
import { hostMatches, hostOf, normalizeUrl } from '../lib/url';
import type { CandidateMeeting, CandidateMeetingRef, SourceHealthRecord } from '../lib/types';
import { classify, externalIdFromUrl, fetchHtmlPage, mergeCandidates, sameHost, toCandidate, type FetchedPage } from './common';
import { emptyResult, type AdapterContext, type AdapterDiscoveryResult, type SourceAdapter } from './types';

const MEETING_URL = /(meeting|event|agenda|calendar|session)/i;
const MEETING_TEXT = /(meeting|council|commission|board|committee|session|hearing|agenda)/i;
const LISTING_TEXT = /\b(archive[sd]?|past|previous|older|more|next|all meetings|view all|upcoming|\b(19|20)\d{2}\b)/i;
const MEETING_ID_PARAMS = ['id', 'eventid', 'event_id', 'meetingid', 'meeting_id', 'mid'];
const BODY_TEXT = /\b([A-Z][A-Za-z&.' ]{2,60}\b(?:Council|Commission|Board|Committee|Agency|Authority))\b/;

export class SuiteOneAdapter implements SourceAdapter {
  readonly id = 'suiteone' as const;
  readonly description = 'SuiteOne Media meeting portal: meetings, agendas, packets, minutes, media.';
  readonly verification = 'unverified' as const;

  canHandle(url: string): boolean {
    const host = hostOf(url);
    return host !== null && hostMatches(host, 'suiteonemedia.com');
  }

  private isMeetingLink(ctx: AdapterContext, url: string, text: string): boolean {
    if (!sameHost(url, ctx.source.baseUrl)) return false;
    const hasId = externalIdFromUrl(url, MEETING_ID_PARAMS) !== null;
    const hasDate = extractDates(text).length > 0;
    return (MEETING_URL.test(url) || MEETING_TEXT.test(text)) && (hasId || hasDate);
  }

  private async crawl(ctx: AdapterContext): Promise<{ meetingPages: Array<{ url: string; text: string; page: FetchedPage | null }>; result: AdapterDiscoveryResult }> {
    const result = emptyResult();
    const norm = (u: string) => normalizeUrl(u, { stripParams: ctx.config.crawlPolicy.stripQueryParams }) ?? u;
    const listingQueue: Array<{ url: string; depth: number }> = [{ url: ctx.source.baseUrl, depth: 0 }];
    const seenListings = new Set<string>([norm(ctx.source.baseUrl)]);
    const meetingLinks = new Map<string, { url: string; text: string }>();
    let fetched = 0;

    while (listingQueue.length && fetched < ctx.maxPages) {
      const { url, depth } = listingQueue.shift() as { url: string; depth: number };
      const page = await fetchHtmlPage(ctx, url, result.errors);
      fetched += 1;
      if (!page) {
        if (depth === 0) result.status = 'error';
        continue;
      }
      for (const link of page.links) {
        if (!link.url) continue;
        const c = classify(ctx, link, page.url);
        if (!c || c.linkKind === 'denied') continue;
        if (c.linkKind === 'document') {
          const candidate = toCandidate(ctx, link, page.url, c);
          if (candidate) result.candidates.push(candidate);
        } else if (this.isMeetingLink(ctx, link.url, link.text)) {
          meetingLinks.set(norm(link.url), { url: link.url, text: link.text });
        } else if (depth < ctx.maxDepth && sameHost(link.url, ctx.source.baseUrl) && LISTING_TEXT.test(link.text) && !seenListings.has(norm(link.url))) {
          seenListings.add(norm(link.url));
          listingQueue.push({ url: link.url, depth: depth + 1 });
        }
      }
    }

    const meetingPages: Array<{ url: string; text: string; page: FetchedPage | null }> = [];
    for (const m of meetingLinks.values()) {
      if (fetched >= ctx.maxPages) {
        result.notes.push(`maxPages (${ctx.maxPages}) reached; ${meetingLinks.size - meetingPages.length} meeting pages not fetched`);
        break;
      }
      meetingPages.push({ ...m, page: await fetchHtmlPage(ctx, m.url, result.errors) });
      fetched += 1;
    }
    return { meetingPages, result };
  }

  private meetingFrom(ctx: AdapterContext, entry: { url: string; text: string; page: FetchedPage | null }): CandidateMeeting {
    const headings = entry.page ? [entry.page.title ?? '', ...entry.page.headings] : [];
    const texts = [entry.text, ...headings].map(collapseWhitespace).filter(Boolean);
    const date = texts.map((t) => extractDates(t)[0]?.iso).find(Boolean) ?? null;
    const bodyName = texts.map((t) => BODY_TEXT.exec(t)?.[1]?.trim()).find(Boolean) ?? null;
    return {
      sourceId: ctx.source.id,
      externalId: externalIdFromUrl(entry.url, MEETING_ID_PARAMS),
      title: entry.page?.headings[0] ?? (entry.text || entry.page?.title) ?? null,
      date,
      bodyName,
      url: entry.url,
      documentUrls: [],
      mediaUrls: [],
    };
  }

  async discoverDocuments(ctx: AdapterContext): Promise<AdapterDiscoveryResult> {
    if (!ctx.source.baseUrl) return { ...emptyResult('not_configured'), notes: ['No baseUrl configured.'] };
    const { meetingPages, result } = await this.crawl(ctx);
    for (const entry of meetingPages) {
      const meeting = this.meetingFrom(ctx, entry);
      const ref: CandidateMeetingRef = { externalId: meeting.externalId, title: meeting.title, date: meeting.date, bodyName: meeting.bodyName, url: meeting.url };
      for (const link of entry.page?.links ?? []) {
        const c = classify(ctx, link, entry.url);
        if (!c || !link.url) continue;
        if (c.linkKind === 'media') meeting.mediaUrls.push(link.url);
        if (c.linkKind === 'document') {
          const candidate = toCandidate(ctx, link, entry.url, c, { meeting: ref });
          if (candidate) {
            result.candidates.push(candidate);
            meeting.documentUrls.push(link.url);
          }
        }
      }
      result.meetings.push(meeting);
    }
    result.candidates = mergeCandidates(result.candidates);
    result.notes.push(`${result.meetings.length} meeting pages parsed (heuristic, unverified structure)`);
    if (result.status === 'ok' && !result.meetings.length) {
      result.notes.push('No meeting links recognised. The portal may be JavaScript-rendered or its structure differs from the heuristics — see TODOs in SuiteOneAdapter.ts.');
    }
    return result;
  }

  async discoverMeetings(ctx: AdapterContext): Promise<CandidateMeeting[]> {
    return (await this.discoverDocuments(ctx)).meetings;
  }

  health(ctx: AdapterContext, previous: SourceHealthRecord | null): Promise<SourceHealthRecord> {
    return checkSourceHealth(ctx.http, ctx.source, previous, {
      now: ctx.now,
      expectedLinkPattern: /(meeting|event|agenda|minutes)/i,
      expectedLinkDescription: 'meeting/agenda links',
    });
  }
}
