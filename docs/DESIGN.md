# Design spec

One look for every screen. The tokens live at the top of `src/console/console.css` (scoped under `.vc`);
the app shell in `index.html` copies the few it needs so the first paint matches. Anything new uses these
tokens and components. A value that is not in this file is a bug.

## Principles

- Quiet: white or carbon page, ink text, one accent (Vineyard wine) used for links, focus and the current item.
- Records first: titles, dates and numbers are the content. Decoration never competes with them.
- Short factual labels. No em dashes or en dashes in visible text ("to", "and", a comma or a colon instead).
- Vote marks and statuses are neutral (ink, gray). Color never says good or bad.
- Never ship an empty section: a section with nothing to show is not drawn.
- The home screen (`/`) stays as simple as it is.

## Type

Two families. Source Serif 4 for page titles and section headings; Inter for everything else.
Both load with every screen (`src/console/styles.ts`). Metric matched fallbacks (`Inter Fallback`,
`Source Serif Fallback`, built on Arial and Georgia with `size-adjust` and ascent/descent overrides) keep
lines the same height while the web fonts arrive, so text does not move when they swap in.

| Role | Token | Size | Weight | Line height | Notes |
| --- | --- | --- | --- | --- | --- |
| Page title (h1) | `--vc-fs-title` | clamp(32px, 4.4vw, 46px) | 520 serif | 1.1 | `text-wrap: balance`, tracking -0.03em |
| Section heading (h2) | `--vc-fs-h2` | clamp(20px, 2.6vw, 24px) | 540 serif | 1.25 | `text-wrap: balance` |
| Subheading (h3) | `--vc-fs-lg` | 18px | 600 sans | 1.35 | `text-wrap: balance` |
| Reading text | `--vc-fs-md` | 16px | 400 | 1.65 | record text, long paragraphs |
| Body | `--vc-fs-body` | 15px | 400 | 1.55 | `text-wrap: pretty` |
| UI | `--vc-fs-ui` | 14px | 500 | 1.45 | buttons, inputs, table cells |
| Small | `--vc-fs-sm` | 13px | 400 to 500 | 1.45 | meta lines, captions |
| Caption | `--vc-fs-xs` | 12px | 500 to 600 | 1.4 | chips, table headers |
| Eyebrow | `--vc-fs-micro` | 11px | 600 | 1.3 | uppercase, tracking 0.08em, labels only, never sentences |

Nothing is set under 11 px, with one exception: member names in the vote sheet header on phones are
10 px so six columns fit beside the titles. Titles hyphenate (`hyphens: auto`) instead of breaking
mid-word.

Numbers: every table, count, total and money figure uses `font-variant-numeric: tabular-nums` (class
`.vc-num`, and every table column after the first). The first column holds names and titles and keeps
proportional figures, because Inter's tabular hyphen spaces out record numbers like 2026-10. Money and counts in tables are right aligned; their header
is right aligned too. Large stand-alone figures (budget totals) use the serif at 500 with tabular figures, 1.45 to 2.4 rem; figures
inside tables and lists use Inter.

Headings never leave one word alone on the last line: h1 to h4 use `text-wrap: balance`, paragraphs and
list text use `text-wrap: pretty`.

## Spacing

An 8 px grid with a 4 px half step for the inside of small components.

| Token | px | Use |
| --- | --- | --- |
| `--vc-sp-1` | 4 | icon to label, chip inner gap |
| `--vc-sp-2` | 8 | between chips, between meta items |
| `--vc-sp-3` | 12 | table cell padding (block), card padding on phones (inner lists) |
| `--vc-sp-4` | 16 | card padding on phones, page side gutter on phones, stacked cards |
| `--vc-sp-5` | 24 | card padding from 768 px, between groups |
| `--vc-sp-6` | 32 | between sections on phones |
| `--vc-sp-7` | 48 | between sections from 768 px |
| `--vc-sp-8` | 64 | page bottom |

Page: content column 780 px (reading pages), 1040 px (wide lists), 1200 px (vote sheets); 16 px side gutter,
never horizontal page scroll. The page starts 24 px under the header; the title block has 16 px above and
24 px below it (the app shell in `index.html` uses the same values).

## Color

Tokens in both themes. Body text pairs pass WCAG AA (4.5:1) on `--vc-bg`, `--vc-surface` and `--vc-bg-2`.

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--vc-bg` | #ffffff | #0a0a0b | page |
| `--vc-bg-2` | #f5f5f6 | #111113 | sunken areas, table header |
| `--vc-ink` | #0b0b0d | #f5f5f6 | text |
| `--vc-ink-2` | #2b2c31 | #d6d6da | secondary text |
| `--vc-muted` | #5f6067 (6.3:1) | #a3a3ab (7.9:1) | meta text |
| `--vc-faint` | #6e6f76 (5.0:1) | #8a8a92 (5.8:1) | least important text that is still read |
| `--vc-line` / `--vc-line-2` | 8% / 14% ink | 8% / 13% white | borders, never text |
| `--vc-accent` | #7a2d52 (9:1) | #e6a9c6 (10:1) | links, focus ring, current item |

Decorative marks that are not text (dots, chart fills) may be lighter; anything a reader must read may not.

## Components

One of each. Class names are the only ones to use.

**Card** `.vc-card`: `--vc-surface` background, 1px `--vc-line` border, radius 16 px (`--vc-radius-lg`),
padding 16 px on phones and 24 px from 768 px. A linked card adds a `--vc-line-2` border on hover. No shadow
at rest.

**Chip**, two kinds:
- Filter chip `.vc-chip` (interactive): 32 px tall, radius 999, 12 px label at 520, `--vc-line-2` border.
  Selected: ink fill, page-color text. 8 px between chips.
- Label chip `.vc-tag` (static: a status, a type, a body): 24 px tall, radius 999, 12 px at 550,
  `--vc-surface-2` fill, `--vc-line` border, `--vc-ink-2` text. Status is always a neutral label chip.

**Table** `.vc` tables (vote sheets, budget, the city construction table, numbered indexes): 14 px cells,
12 px 600 header in `--vc-muted` on `--vc-bg-2`, cell padding 12 px by 12 px, 1 px `--vc-line` rules between
rows, no zebra striping except vote sheets (which need row tracking across many columns), tabular figures,
money right aligned. On phones a table that cannot fit becomes cards (one card per row, label above value)
or scrolls inside its own frame with the first column pinned; the page itself never scrolls sideways.

**Buttons**, 40 px tall (`--vc-h-control`), radius 999, 14 px label:
- Primary `.vc-primary`: ink fill, page-color text, 600. One per view.
- Secondary `.vc-secondary`: transparent, 1 px `--vc-line-2` border, ink text, 500.
- Ghost `.vc-ghost`: no border until hover, `--vc-ink-2` text, 500. Icon-only ghost is 36 px square.

**Input** `.vc-input` (and `select`, `textarea` in forms): 40 px tall, radius 12 px, 1 px `--vc-line-2`
border, `--vc-surface` fill, 14 px text (16 px on phones so iOS does not zoom).

**Focus**: every interactive element shows `outline: 2px solid var(--vc-accent); outline-offset: 2px` on
`:focus-visible`. No component removes it without drawing its own ring of the same color.

## Dates

One helper, `src/lib/dates.ts`. Every visible date goes through it.

- `formatDate`: **Oct 13, 2026**. Everywhere a date is shown.
- `formatDateTime`: **Oct 11, 2026, 4:15 AM** (Vineyard time), for "checked" and "updated" stamps.
- `formatWeekdayDate`: **Tue, Oct 13, 2026**, only where a calendar needs the weekday (meeting pages,
  calendar lists).
- `formatMonthDay`: **Oct 13**, only inside a grid already labeled with its year (vote sheet and attendance
  marks).
- `formatMonthYear`: **October 2026**, month headings in the calendar.

Dates copied from city pages and titles in other forms (10/5/2026, 11-05-2026, 2026-10-13) are rewritten by
`normalizeDatesInText`.

## States

- **Loading**: skeleton lines (`.vc-skeleton`) in the shape of what is coming, inside space reserved at the
  content's expected height. Never a sentence like "Loading...", except the map canvas label.
- **Empty**: one short sentence in `--vc-muted` saying what is not there ("No votes recorded for 2026."),
  never an empty frame or heading with nothing under it. A section with nothing is not drawn.
- **Error**: `.vc-error`: one sentence of what failed and a secondary button "Try again".

## Layout shift

- The app shell in `index.html` paints the header and the page title before scripts load, with the same
  sizes as the app.
- Images, maps and charts reserve their box (`aspect-ratio` or a fixed height) before they load.
- Late content (counts, chips) reserves its line with a min-height or a non-breaking placeholder.
- Fonts use the metric matched fallbacks above.
- Target CLS under 0.05 on every route at 390 and 1440 px.

## Print

`@media print` in `console.css`: no header, menu, filters, buttons or map; black on white; tables at full
width with every column; rows never split across pages; headings stay with what follows; links to source
documents print their address after the text.

## Head

Every route sets `document.title` ("Page | Vineyard Transparency Portal") and the meta description on
navigation (`src/lib/head.ts`). The share image (`public/og.png`, 1200 by 630) and the icons
(`favicon.svg`, `favicon-32.png`, `apple-touch-icon.png`, `icon-192.png`, `icon-512.png`) come from
`scripts/og/make.mjs`, which renders the wordmark in a browser.
