# Private activity panel

The owner's panel shows page visits, questions asked, and thumbs up or down on answers.

- Address: an unguessable path under `/api/k/` (see `PANEL_PREFIX` in `worker/panel/routes.ts`). It is
  not linked anywhere, is not part of the public site's JavaScript, and is served with
  `X-Robots-Tag: noindex`.
- Sign-in: one owner account. Password stored only as a salted PBKDF2-SHA256 hash (100,000
  iterations). Passkeys (WebAuthn, ES256 or RS256) can be added from Security after signing in.
  Five failed attempts from one IP (or 40 overall) in 15 minutes lock sign-in for 15 minutes.
- Sessions: HMAC-signed, HttpOnly, Secure, SameSite=Strict cookie scoped to the panel path, 12 hours.
  Changing the password signs out every session.
- First-time setup: run the Ingest workflow with command `migrate`. While no owner exists, its
  output includes `panelSetupCode` (valid 24 hours, single use). Enter it on the panel page with an
  email and password.
- Data: `activity_visits`, `activity_questions`, `activity_feedback` in the catalog D1 database,
  kept permanently. Logging pauses automatically if the database passes 420 MB (the free tier limit
  is 500 MB), and activity writes are capped at 20,000 per day.
- Disclosure: the landing page footer says visits and questions, including IP address, are logged.

## Staff uploads and resident submissions

- Adding records directly is for panel accounts only: the owner and invited uploaders use the Add
  tab (staff uploads, source `portal-staff`). The public site has no direct upload.
- Residents use the public page "Submit a public record" (`/add`, linked quietly at the bottom of
  `/records`). A submission is stored as **pending** (`resident_submissions.status = 'pending'`,
  files in R2 under `resident/`, counted in the 300 MB resident budget). It is not indexed, not in
  search and not served. The submitter sees "Thanks. Your submission will appear after review."
- Owner only, Submissions tab: the **Pending** list shows each item's title, type, text and a file
  link (served to the signed-in owner only, sandboxed). **Approve** creates the record (source
  `resident-submitted`, label "Resident submitted. Not a city record.") and logs it. **Reject**
  deletes the file and the row and logs it. Uploader accounts cannot see or approve submissions.
- Approved items keep the earlier guard rails: Report (hidden after reports from 2 people), Hide,
  Restore, Remove, the pause switch, 3 items per person and 30 in all per day, and the log.
- End to end check (`.github/workflows/add-e2e.yml`, `ingest/e2e_add.py`): submits a test note,
  checks it is pending and not in search, approves it through `/api/admin/resident/e2e/approve`,
  checks search and the label, reports it from two runners, checks it is hidden, then deletes it.
  The admin routes `/resident/e2e/*` touch only items titled "Portal end to end test ...".
