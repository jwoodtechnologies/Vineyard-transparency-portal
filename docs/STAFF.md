# Staff portal

City staff sign in at `vineyardportal.org/staff` to keep the portal current. Nothing on the public site links to it, and its pages are marked noindex.

## Accounts

Everyone has their own named account. A department is only a label; what a person can change is set by role and areas.

- **Owner**: every area, and who may sign in. At least one owner is always active.
- **Admin**: every area, and can add and manage editors.
- **Editor**: only the areas they were given. Areas: records and meetings, votes, people and boards, map and projects, budget, events and notices (notices, events and updates), site pages and links.

An owner or admin adds a person (name, email, department, role, areas). The portal shows a one-time sign-in link, valid for 7 days. The link carries its token after the `#`, so it never reaches a server log. The person opens it and chooses a passkey (fastest) or a password of at least 12 characters. Turning an account off signs it out at once. "Reset sign-in" removes every passkey, password and open session and makes a new link.

## First owner

While no staff owner exists, `/staff/setup` accepts the email and password of the existing private owner panel. That proves the person is the portal owner and opens the same account setup as any invited person. After the first owner exists, setup closes for good.

## Sign-in protection

- A small proof of work runs in the browser while the person types. Nothing is clicked or read, and VPNs are not penalized. It gets harder after repeated failures from one address.
- A hidden field that people never see catches simple bots.
- 8 failed attempts from one address, or 6 for one email, lock sign-in for 15 minutes. Wrong email and wrong password take the same time and give the same answer.
- Sessions last 12 hours, are stored hashed, and are sent as an HttpOnly, Secure, SameSite=Strict cookie scoped to `/api/staff`. Every change request must come from the staff page itself.

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

**Events** (`/staff/events`) add a community event, a special meeting or a closure day to the portal calendar (`worker/staff/events.ts`, table in `worker/api/siteEvents.ts`). They are merged with the city calendar's events by `GET /api/events` and look the same there, with the same category groups. An event can be all day, run over several days, have a place, details and a link. If the city's own calendar cannot be reached for six seconds, the events staff added still show.

**Updates** (`/staff/updates`) post a short note such as "We finished the 400 North signal" (`worker/staff/updates.ts`, using the same storage and indexing as the owner panel's Updates tab in `worker/contrib/updates.ts`). An update is a record of its own: searchable, cited by the assistant, listed on the Records page and, when it names a funded project, shown on that project's card under the map. A removed update can be put back from Activity under the same id, with the same words.

Every change to a notice, event or update is in Activity and can be undone. Public pages follow within moments; a reader's browser may keep the previous copy for up to a minute.

## Adding an area

Each content area plugs in through `worker/staff/modules.ts` (API routes, which check `requireArea`) and `src/console/staff/sections.ts` (the screen). Writes go through `auditStatement` in the same batch as the change, and call `published(env)` afterward.
