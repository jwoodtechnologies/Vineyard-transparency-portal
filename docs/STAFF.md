# Staff portal

City staff sign in at `vineyardportal.org/staff` to keep the portal current. Nothing on the public site links to it, and its pages are marked noindex.

## Accounts

Everyone has their own named account. A department is only a label; what a person can change is set by role and areas.

- **Owner**: every area, and who may sign in. At least one owner is always active.
- **Admin**: every area, and can add and manage editors.
- **Editor**: only the areas they were given. Areas: records and meetings, votes, people and boards, map and projects, budget, events and notices (notices, events and updates), site pages and links.

An owner or admin adds a person (name, email, department, role, areas). The Accounts screen offers starting points so nobody has to tick boxes: **Social media specialist** (notices, events and updates only), **City recorder or clerk** (records, votes, people and boards) and **Finance** (budget), or "Choose the areas myself". A preset only fills in the department and areas, and both can still be changed before the account is created. The presets live in `src/console/staff/presets.ts`.

The portal then shows a one-time sign-in link, valid for 7 days. The link carries its token after the `#`, so it never reaches a server log. Nothing is emailed: the administrator copies the link, copies it as a ready-made message, or opens it in their own email app. The person opens it and chooses a passkey (fastest) or a password of at least 12 characters, then saves their recovery codes. A link works once, and a link for a person who has already signed in is refused. Turning an account off signs it out at once, removes its recovery codes, and cannot be undone by any link; only an administrator can turn it back on. "Reset sign-in" removes every passkey, password, recovery code and open session and makes a new link.

"Single use" accounts are limited ones: an editor with one area (the social media preset) can post notices, events and updates and cannot see or change anything else, and their sign-in link can be used only once.

## First owner

While no staff owner exists, `/staff/setup` accepts the email and password of the existing private owner panel. That proves the person is the portal owner and opens the same account setup as any invited person. After the first owner exists, setup closes for good.

Last resort if every owner is locked out and has lost their recovery codes: delete the owner row from `staff_users` in the D1 console. Setup opens again and the owner panel email and password prove who is asking.

## Recovery without email

The portal sends no email, so there is no emailed reset link and no email service to pay for or connect. Each person is given 8 recovery codes when they finish their account.

- A code is 16 characters from an alphabet with no look-alike letters (about 79 bits), shown once, and stored only as a salted hash in `staff_recovery`.
- On the sign-in page, "Lost your passkey or forgot your password?" opens `/staff/recover`. Email plus any unused code burns that code and opens the usual "set up a new sign-in" step, valid for 15 minutes. The old passkeys and password are removed only once the new sign-in is saved, and a fresh set of codes is issued.
- Codes can be copied, downloaded or printed. People are asked to tick that they saved them before continuing.
- Under Your account a person can make a new set at any time. It needs their current password, or a fresh passkey check if they have no password. A new set cancels the old one.
- Someone with no codes left and no way in asks an owner or admin for "Reset sign-in", which makes a new link.
- Recovery has its own attempt limits and the same proof of work as sign-in, and wrong email and wrong code give the same answer. The owner panel password cannot be used to recover a staff account.

## Sign-in protection

- A small proof of work runs in the browser while the person types. Nothing is clicked or read, and VPNs are not penalized. It gets harder after repeated failures from one address.
- A hidden field that people never see catches simple bots.
- 8 failed attempts from one address, or 6 for one email, lock sign-in for 15 minutes. Wrong email and wrong password take the same time and give the same answer.
- Sessions last 12 hours, are stored hashed, and are sent as an HttpOnly, Secure, SameSite=Strict cookie scoped to `/api/staff`. Every change request must come from the staff page itself.
- If a session ends while someone is typing, a "Your session ended" box opens over the page. They sign in again there and what they typed is still on the page.

## Activity log

Every change is written to `staff_audit` with the person, the area, a sentence, and the before and after values. The Activity screen shows it (editors see only their own areas), and a change that registered an undo can be put back with one tap (`worker/staff/undo.ts`). Publishing moves the archive data version (`worker/lib/dataVersion.ts`), so public pages refresh within moments.

## Records

Anyone with the records area adds agendas, minutes, reports and other documents at `/staff/records`: a file (PDF, picture, text or CSV, up to 25 MB), a note, or a link. A file gets a type, a date, an optional meeting and a short description; the type is suggested from the file name. Whatever is added is stored, indexed for search and chat, and shown on the public site at once. Minutes are also read for votes by the same cron that reads the city's own minutes, so the Votes page follows within about ten minutes.

Staff can change the details of anything added (including items added from the owner panel) and remove it. A change or an add can be undone from Activity; a removal cannot, because the stored file is deleted. The server side is `worker/staff/records.ts`, which reuses the storage, indexing and size rules of `worker/contrib/staff.ts`. Uploads reach it as a form, which the router passes to the module unread (`worker/staff/routes.ts`).

## Votes

Anyone with the votes area opens `/staff/votes`, picks a meeting (or searches by the wording of a motion), and sees every motion read from that meeting's minutes. A motion can be corrected (its agenda item, wording, who moved and seconded, Carried or Failed, and how each member voted), a motion the minutes missed can be added, and one that should not be listed can be removed. The form checks the result against the votes before saving: a motion cannot be Carried with more No than Yes, or Failed with more Yes than No.

The public Votes page, each member's totals, the boards pages and the chat answers all read the same two tables (`motions`, `motion_votes`), so a correction shows everywhere at once. The server side is `worker/staff/votes.ts`.

A motion staff touch is marked `manual`. The minutes reader (`worker/api/votes.ts`) skips a manual motion when it reads the minutes again, and a removed motion is remembered in `vote_tombstones` by a fingerprint of its original wording (`worker/lib/voteFix.ts`), so neither a correction nor a removal is undone by the next read. A vote added before the minutes were available gives way to the minutes once they are read. Every change can be undone from Activity.

## People and boards

Anyone with the people area opens `/staff/directory`. It lists the Mayor and Council, city staff and board members. Staff can add a person, change a title, department, term, email, phone or board seats, and take someone off the list when they leave (and put them back). A taken-off person is hidden from the People and Boards pages, and their past votes and records stay. A council member's name is fixed, because it is how their votes are found in the minutes. Only one person can be Mayor at a time. Photos still come from the city website.

The city website is still read every day. A person staff added or changed is marked `manual` in the `people` table, and that read (`upsertPeople` in `worker/api/people.ts`) leaves them exactly as staff set them: it does not overwrite them, hide them, or bring back someone staff took off. Board members are placed by the board names in their `department` list, matched to the portal's boards by `boardIdFor` in `worker/api/boards.ts`. A term that ends with a past year hides a board member unless the minutes show them still serving. Every change can be undone from Activity. The sitting council is cached for ten minutes on each server, so a change to who sits on it can take up to ten minutes to reach vote totals everywhere; the People and Boards pages follow at once. The server side is `worker/staff/people.ts`.

The login accounts screen is `/staff/people`, labeled Accounts, and is for owners and admins only.

## Notices, events and updates

All three belong to the events and notices area.

**Notices** (`/staff/notices`) are short messages at the top of every public page, such as an office closure or a change to a meeting (`worker/staff/notices.ts`, public list at `GET /api/notices`). A notice is up to 280 characters, can carry a link, can be an alert (a warm color, shown first) or plain information, and can have a first and last day. Up to three show at once, and a resident can close one for their visit; a notice staff change comes back for them. Hiding a notice keeps it on file so it can be shown again.

A notice can also go on the map, such as a road closure, a detour, a work zone or an event. Staff mark it as a spot, a road or path, or an area by tapping the map (each tap adds a point, a dot can be dragged, and a latitude and longitude can be typed instead; the numbered list under the map works without it). They give it a short name and a kind. The shape must fall inside the Vineyard area (`worker/lib/mapShape.ts`). A notice can show in the top bar, on the map, or both. On the public map it is the "Closures and notices" layer (`worker/api/mapAlerts.ts`, `GET /api/map/layers/alerts`), colored by kind with its own legend, and it is listed only while at least one placed notice is showing. It follows the notice's first and last days and the Hide switch, so a closure leaves the map on its last day without anyone removing it.

**Events** (`/staff/events`) add a community event, a special meeting or a closure day to the portal calendar (`worker/staff/events.ts`, table in `worker/api/siteEvents.ts`). They are merged with the city calendar's events by `GET /api/events` and look the same there, with the same category groups. An event can be all day, run over several days, have a place, details and a link. If the city's own calendar cannot be reached for six seconds, the events staff added still show.

**Updates** (`/staff/updates`) post a short note such as "We finished the 400 North signal" (`worker/staff/updates.ts`, using the same storage and indexing as the owner panel's Updates tab in `worker/contrib/updates.ts`). An update is a record of its own: searchable, cited by the assistant, listed on the Records page and, when it names a funded project, shown on that project's card under the map. A removed update can be put back from Activity under the same id, with the same words.

Every change to a notice, event or update is in Activity and can be undone. Public pages follow within moments; a reader's browser may keep the previous copy for up to a minute.

## Budget

Anyone with the budget area opens `/staff/budget`. The Budget page, the assistant's budget answers, the project cards and the map's project list all read one budget, held in `worker/lib/budgetData.ts` as live bindings. The figures in that file are the built-in budget (every value keyed from the adopted budget book with its source noted). Staff save a newer budget as a numbered version in the `budget_versions` table (`worker/staff/budget.ts`, `worker/lib/budgetStore.ts`); the Worker applies the active version (`ensureBudgetBook`, run at the start of each request and compared with the archive's data version, so it reads the database only after a change) and every reader sees the same figures. Version 0 is the built-in budget. A save adds a version, a restore saves a copy of the chosen version as a new one, and the 60 newest versions are kept.

The screen works in steps: basics (fiscal year, adoption and amendment details, the budget documents, picked by searching the archive), revenue, spending, funds, totals, capital projects (each can be linked to a project on the city's Capital Improvement Plan map, which is what puts it on the map with its amount), chart groups and history, then check and save. Each table can be imported from a pasted spreadsheet or a CSV file (columns matched by heading, a preview, plain-sentence problems) and downloaded as a CSV. "Add up the totals" fills the General Fund totals from the lines. A save needs a note saying what changed and where the numbers came from. The server (`worker/lib/budgetBook.ts`) checks every row and every total (a typed total may differ from its lines by $5 for the book's own rounding) and answers in sentences that name the table and row. A budget with no amendment has no "after amendment" figures: they are the adopted ones, and the page and the assistant say nothing about an amendment. Nothing derived from the budget is typed twice: the map links (`worker/lib/capitalPlan.ts`), the assistant's facts (`worker/lib/budgetFacts.ts`, `worker/ai/budgetAnswer.ts`) and the labels (fiscal year, amendment name, tentative date) all follow the saved version. The chat's map knowledge is built by the ingest (`ingest/gis.py`, a copy of the built-in links kept equal by `tests/worker-capitalplan.test.ts`) and follows the built-in budget until it is updated.

Keep the revenue lines named Property tax, Sales tax, Transportation tax and RAP tax, and the history line keyed sales: the Sales tax tab and the assistant's tax share sentence look them up by those names, so a renamed line shows as zero there. Every save is in Activity and can be undone (the budget goes back to the version before it). Visitors see a save within a minute.

## Adding an area

Each content area plugs in through `worker/staff/modules.ts` (API routes, which check `requireArea`) and `src/console/staff/sections.ts` (the screen). Writes go through `auditStatement` in the same batch as the change, and call `published(env)` afterward.
