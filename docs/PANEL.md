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
