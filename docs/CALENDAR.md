# Calendar

`/calendar` (also `/meetings`) merges two public sources:

- **Public meetings** from the city's CivicClerk meeting portal (ingested into D1 by the crawler),
  with agendas, packets, minutes and video.
- **City calendar events** (Community, Recreation, Library, Utilities, and city-listed Meetings) from
  the public JSON that `vineyardutah.gov/calendar.php` itself loads on every visit.
  `GET /api/events?from=YYYY-MM-DD&to=YYYY-MM-DD` reads it through Cloudflare's cache (one fetch an
  hour at most), expands recurring events (`worker/lib/rrule.ts`: DAILY/WEEKLY/MONTHLY/YEARLY with
  INTERVAL, BYDAY, BYSETPOS, BYMONTHDAY, UNTIL, COUNT, RDATE, EXDATE), decodes descriptions and
  hides CMS training entries. Times are Vineyard local time as published.

City-calendar copies of meetings that CivicClerk already lists (same day and body) are dropped so
nothing appears twice. If the city site is down, the calendar still shows meetings.
