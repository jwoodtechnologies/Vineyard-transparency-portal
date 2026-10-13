# Private activity panel

The panel is the owner's own console. It shows page visits, questions asked, and thumbs up or down on
answers, and holds the owner's own tools.

New staff accounts are made in the staff portal at `vineyardportal.org/staff`, under Accounts (see
`docs/STAFF.md`). The panel no longer makes invites: its People tab says where to go, and
`POST /api/invites/create` answers 410 with that sentence. Panel accounts and links made before then
keep working, and the owner can still turn them off and on and revoke open links. The owner's email
and password sign-in is unchanged; `/staff/setup` and last-resort recovery rely on it.

- Address: an unguessable path under `/api/k/` (see `PANEL_PREFIX` in `worker/panel/routes.ts`). It is
  not linked anywhere, is not part of the public site's JavaScript, and is served with
  `X-Robots-Tag: noindex`.
- Sign-in: one owner account (email and password, unchanged). Password stored only as a salted
  PBKDF2-SHA256 hash (100,000 iterations). Passkeys (WebAuthn, ES256 or RS256) can be added from
  Security after signing in. Five failed attempts from one IP (or 40 overall) in 15 minutes lock
  sign-in for 15 minutes. The sign-in form says "Email or user name": the owner's email goes the
  owner's way exactly as before; any other name is checked against admin accounts.
- Sessions: HMAC-signed, HttpOnly, Secure, SameSite=Strict cookie scoped to the panel path, 12 hours.
  Changing the owner password signs out every session. Every request re-reads the account (exists,
  same role, not turned off; for an admin, the same password epoch).

## Accounts and roles

| Role | Made by | Signs in with | Can use |
| --- | --- | --- | --- |
| Owner (account 1) | setup code | email and password, passkeys optional | everything |
| Admin | owner invite (no new ones; see above), link valid 7 days | own sign-in name (email or user name) and password, or a passkey | Activity, Add, Updates, Uploads (all, edit and delete any), Submissions (approve, reject), Coverage, Health |
| Uploader | owner invite (no new ones; see above), link valid 72 hours | passkey only | Add, Uploads (edit and delete its own) |

- Only the owner sees People: existing accounts (turning them off and on), invites made earlier
  (revoke an open one), the upload log. Only the owner pauses submissions and hides, restores or
  removes approved ones.
- Joining as an admin with a link made earlier: the link opens "Welcome": a sign-in name (an email address, or a user name of
  3 to 60 letters, digits, dots, dashes or underscores; not the owner's email; unique) and a password
  of 12 or more characters (PBKDF2 like the owner's, in `panel_logins`). Then the Security sheet opens
  with "Add a passkey". Admins can add or remove passkeys and change their password in Security;
  changing it ends their other sessions (the epoch in `panel_logins` moves on). Wrong admin passwords
  count toward the same lockout.
- Tables: `panel_accounts` (role owner, admin or uploader; tables from before admins are widened once,
  ids kept), `panel_logins` (admin sign-in), `panel_invites` (role, name, expiry), `panel_passkeys`.

## Add: one file or many

- Drop or choose any number of files. One "For every file" box sets type, date, body text, meeting
  and project for all of them; each file has its own title, filled in from its file name.
- Files are sent one at a time. Each row shows Ready, Adding, Added or the reason it failed; a bar
  and a line ("4 files, 2 added, 1 failed, 1 skipped.") show progress. Retry failed sends the
  failed ones again.
- Limits are the existing ones: PDF, PNG, JPG, TXT or CSV; 25 MB a file (1 MB for text and CSV),
  checked in the browser and again on the server; the archive storage stop (a full archive stops
  the rest of the batch). PDFs over 4 MB get a title entry at once and their text from the
  five-minute job, as before.

## Updates

- Tab Updates (owner and admins): Title (optional, else the first line), Text (required), Date
  (default today, Vineyard time), Project or topic (optional: funded projects drawn on the map, or
  a short topic list), Publish.
- Each update is an `uploads` row (kind `update`, author `account_id`, `topic`, `topic_label`) and a
  record (`document_type` `staff_update`, source `portal-staff`) indexed into search in the same
  request. Its search text starts with the title, "Update posted on the portal, <date>" and the
  project or topic line.
- Public: the record page and search results carry the label "Update posted on the portal,
  <date>"; Records shows an "Updates" row (three newest, `GET /api/updates`, not edge cached) and a
  topic `/records?topic=updates`; a project's card under the map shows its newest update.
- Chat: updates are retrieved like any record; the prompt tells the model to cite them and to give
  a newer update's state first. Citations carry the update label.
- Edit and Remove (owner or any admin): every edit is logged in `upload_audit` with the text from
  before (`before_json`); History shows it. Removing takes the record out of search and keeps its
  last text in the log ("Removed" list).
- First-time setup: run the Ingest workflow with command `migrate`. While no owner exists, its
  output includes `panelSetupCode` (valid 24 hours, single use). Enter it on the panel page with an
  email and password.
- Data: `activity_visits`, `activity_questions`, `activity_feedback` in the catalog D1 database,
  kept permanently. Logging pauses automatically if the database passes 420 MB (the free tier limit
  is 500 MB), and activity writes are capped at 20,000 per day.
- Disclosure: the landing page footer says visits and questions, including IP address, are logged.

## Staff uploads and resident submissions

- Adding records directly is for panel accounts only: the owner, admins and invited uploaders use the Add
  tab (staff uploads, source `portal-staff`). The public site has no direct upload.
- Residents use the public page "Submit a public record" (`/add`, linked quietly at the bottom of
  `/records`). A submission is stored as **pending** (`resident_submissions.status = 'pending'`,
  files in R2 under `resident/`, counted in the 300 MB resident budget). It is not indexed, not in
  search and not served. The submitter sees "Thanks. Your submission will appear after review."
- Owner and admins, Submissions tab: the **Pending** list shows each item's title, type, text and a file
  link (served to signed-in reviewers only, sandboxed). **Approve** creates the record (source
  `resident-submitted`, label "Resident submitted. Not a city record.") and logs it. **Reject**
  deletes the file and the row and logs it. Uploader accounts cannot see or approve submissions.
- Approved items keep the earlier guard rails: Report (hidden after reports from 2 people), Hide,
  Restore, Remove, the pause switch, 3 items per person and 30 in all per day, and the log.
- End to end check (`.github/workflows/add-e2e.yml`, `ingest/e2e_add.py`): submits a test note,
  checks it is pending and not in search, approves it through `/api/admin/resident/e2e/approve`,
  checks search and the label, reports it from two runners, checks it is hidden, then deletes it.
  The admin routes `/resident/e2e/*` touch only items titled "Portal end to end test ...".
