# Staff portal

City staff sign in at `vineyardportal.org/staff` to keep the portal current. Nothing on the public site links to it, and its pages are marked noindex.

## Accounts

Everyone has their own named account. A department is only a label; what a person can change is set by role and areas.

- **Owner**: every area, and who may sign in. At least one owner is always active.
- **Admin**: every area, and can add and manage editors.
- **Editor**: only the areas they were given. Areas: records and meetings, votes, people and boards, map and projects, budget, events and notices, site pages and links.

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

## Adding an area

Each content area plugs in through `worker/staff/modules.ts` (API routes, which check `requireArea`) and `src/console/staff/sections.ts` (the screen). Writes go through `auditStatement` in the same batch as the change, and call `published(env)` afterward.
