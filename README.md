# CareerForge

Student career platform: passwordless email-OTP sign-in, a structured profile
(personal details, education, skills, projects, internships, achievements),
live LeetCode/GitHub/CodeChef stats, an **ATS-scored resume builder** with eleven
templates, a shareable public profile page, and **daily matched job alerts** by
email — plus an importer that loads the KLU placement cohorts (LPA7 / LPA8) so
students can claim the readiness analysis their placement cell already has.

React 18 + Tailwind on the front, Node/Express + MySQL on the back.

---

## Quick start

### Windows (recommended here — works despite the `&` in the path)

```bash
powershell -ExecutionPolicy Bypass -File scripts\start-local.ps1
```

One command. It starts a throwaway MySQL on port 3307 using your installed
MySQL 8.0 binaries (your `MySQL80` Windows service is never touched), applies
migrations, seeds demo data, builds the SPA if needed, and serves everything on
<http://localhost:4000>.

| Flag | Effect |
|---|---|
| `-Reset` | drop the local database and re-seed from scratch |
| `-NoSeed` | skip the demo student and sample jobs |
| `-Port 5000` | serve on a different port |

Local data lives in `.local-db/` and survives restarts. Stop the API with
Ctrl+C; MySQL keeps running (the script prints the shutdown command).

### Any platform, manual

```bash
npm install
cp server/.env.example server/.env     # then edit DB_* and SMTP_*
node server/src/db/migrate.js          # creates the database + tables
node server/src/db/seed.js             # demo student + 12 sample jobs
node server/src/index.js               # API + built SPA on :4000
```

For hot reload during front-end work, run Vite alongside it — it proxies
`/api` to port 4000:

```bash
cd client && node ../node_modules/vite/bin/vite.js
```

Then use <http://localhost:5173> instead.

With `MAIL_DEV_ECHO=true` and `NODE_ENV=development` the OTP is printed in the
API log **and** returned in the response, so you can sign in before SMTP is
configured. Both are ignored in production.

### ⚠ Windows: the `&` in the folder path

This project sits under `…\Desktop\LPA&\`. Windows `cmd.exe` treats `&` as a
command separator, so **`npm run <script>` fails here** with
`'…\node_modules\.bin\' is not recognized`. Two options:

- **Recommended** — move or rename the parent folder so the path has no `&`
  (e.g. `…\Desktop\LPA\career-portal`). Everything then works normally.
- **Workaround** — bypass npm's shell and call the binaries through node:

  ```bash
  node node_modules/vite/bin/vite.js build --root client
  node server/src/index.js
  node server/src/db/migrate.js
  ```

The Linux VPS is unaffected.

---

## Layout

```
career-portal/
├── server/                    Express API
│   └── src/
│       ├── index.js           app bootstrap, health check, SPA fallback
│       ├── config/            env parsing + mysql pool
│       ├── db/
│       │   ├── schema.sql     14 tables, idempotent
│       │   ├── migrate.js     creates the DB, applies schema.sql
│       │   ├── seed.js        demo student + starter job board
│       │   ├── import-cohorts.js  loads data/cohorts.json into MySQL
│       │   ├── make-admin.js  grant/revoke the admin role
│       │   ├── e2e-cohorts.js cohort claiming, admin guards, PII containment
│       │   ├── smoke.js       pure-logic checks, no DB needed
│       │   └── e2e.js         full HTTP test against a running server
│       ├── middleware/        auth guard, rate limits, zod validation, errors
│       ├── routes/            auth · profile · sections · resumes · coding · jobs · me · cohorts · public
│       ├── services/          otp · mailer · atsScore · codingProfiles · jobAlerts · resumeBuilder · cohorts
│       ├── templates/         transactional email HTML
│       ├── jobs/scheduler.js  node-cron: alert sweep + nightly cleanup
│       └── utils/             tokens, slugs, email validation, activity log
├── client/                    Vite + React + Tailwind SPA
│   └── src/
│       ├── pages/             Landing · Login · Dashboard · ProfileEditor · ResumeList
│       │                      ResumeBuilder · Jobs · Alerts · Activity · Settings
│       │                      Cohorts · StudentReport
│       │                      PublicProfile · Directory · NotFound
│       ├── components/        AppLayout, ui kit, profile forms, resume document
│       ├── lib/api.js         fetch wrapper with transparent token refresh
│       └── store/auth.jsx     session context
├── scripts/
│   ├── start-local.ps1        one-command Windows dev environment
│   └── extract-cohorts.py     LPA workbooks -> cohorts.json
└── deploy/
    ├── provision.sh           one-time VPS setup (Node, MariaDB, nginx, PM2, ufw)
    ├── setup-nginx.sh         vhost + Let's Encrypt TLS
    ├── deploy.sh              sync → build → migrate → PM2 reload
    └── ecosystem.config.cjs   PM2 process definition
```

---

## How the OTP flow works

1. **`POST /api/auth/check-email`** runs as the student types (debounced 450ms).
   It checks the address shape, rejects disposable domains, catches common typos
   (`gmial.com` → suggests `gmail.com`), enforces `ALLOWED_EMAIL_DOMAINS` if set,
   and confirms the domain has MX records — so a typo is caught *before* a code
   is spent.
2. **`POST /api/auth/request-otp`** generates a `crypto.randomInt` code, stores
   only its **bcrypt hash**, invalidates any outstanding code for that address,
   and emails it. The response is identical whether or not the account exists,
   so the endpoint cannot be used to enumerate users.
3. **`POST /api/auth/verify-otp`** compares the hash. If the address is unknown,
   verifying *is* the signup — a user row, a public handle and a job-alert row
   are created in one step.
4. A 30-minute JWT access token plus a rotating 30-day refresh token (stored
   hashed, delivered as an httpOnly cookie) come back.

**Limits**, all configurable in `.env`: 60s resend cooldown, 5 codes per address
per hour, 5 wrong attempts per code, 10 OTP requests per IP per 15 minutes, and
a tighter nginx-level limit (2 r/s) on the two OTP endpoints in production.

**Verifying delivery works:** `GET /api/auth/diagnostics` reports SMTP host,
whether the connection verified at boot, and the active OTP policy. The same
data is rendered on the in-app **Settings → Email delivery** panel, so you can
confirm mail is going out without reading server logs.

---

## ATS scoring

`server/src/services/atsScore.js`. Eight weighted dimensions totalling 100:

| Dimension | Weight | What it checks |
|---|--:|---|
| Contact details | 10 | name, valid email, 10-digit phone, city, at least one profile link |
| Required sections | 15 | summary ≥40 chars, education, ≥3 skills, ≥1 project or internship |
| Role keyword match | 25 | overlap with the target role's keyword set **plus** any pasted job description |
| Quantified impact | 15 | share of bullets containing a measurable number |
| Bullet quality | 10 | action-verb openers; penalises "responsible for", "worked on", 32+ word bullets |
| Parseability | 10 | emoji/arrows/decorative bullets, missing dates, missing graduation year |
| Length & density | 10 | 350–650 words is the target band for a one-page fresher resume |
| Skill coverage | 5 | 6–28 skills, penalising both too few and keyword stuffing |

It returns the score, a band, the per-dimension breakdown with **specific tips**,
matched and missing keywords listed individually, and a `topFixes` list ordered
by how many points each gap costs. Rescored on every save.

---

## Templates

Eleven templates, four layout shells (`single`, `timeline`, `banner`, `sidebar`),
one shared set of section renderers. Adding a template is a style-token entry in
`client/src/components/resume/ResumeDocument.jsx` plus a metadata entry in
`server/src/services/resumeBuilder.js`.

| Template | Layout | Safety | Cost | Character |
|---|---|---|--:|---|
| ATS Classic | single | Safest parse | — | The default. Nothing to go wrong. |
| ATS Compact | single | Safest parse | — | Tight spacing for a dense fresher profile. |
| Minimal | single | Safest parse | — | No rules, no colour, wide margins. |
| ATS Modern | single | ATS safe | — | Indigo accent, ruled headings. |
| ATS Technical | single | ATS safe | — | Skills first, projects before education. |
| ATS Academic | single | ATS safe | — | Centred header, education leads. |
| Elegant Serif | single | ATS safe | — | Cambria/Georgia, letter-spaced headings. |
| Executive | single | ATS safe | — | Navy rules, wider name block. |
| Timeline | timeline | ATS safe | — | Dates in a left gutter beside each entry. |
| Banner | banner | **Design-first** | −2 | Full-bleed coloured header, name reversed out. |
| Sidebar | sidebar | **Design-first** | −4 | Two columns: education and skills beside experience. |

### Picking one

The picker draws every template as a **real miniature of the document** —
an actual `<ResumeDocument>` at ~22% scale rendered with the student's own
content, not a stock screenshot. A list of names and blurbs is useless: nobody
can choose a design they have never seen. The same gallery appears when
creating a resume and in the builder's Design tab.

### Accent colour

Any template takes any accent — colour is a property, not a template, which is
why there is no "Navy Classic" and "Crimson Classic" cluttering the gallery.
Eight presets ship in `ACCENT_PRESETS`, all dark enough to stay legible printed
in greyscale. Only a 6-digit hex is accepted (validated in zod *and* in
`normaliseAccent`) so nothing arbitrary reaches an inline style, and changing
the colour never moves the ATS score.

**Safety grades are enforced, not decorative.** `atsPenalty` on a template is
subtracted from the parseability dimension, so picking the Sidebar visibly drops
the score (82 → 78 on the demo profile) and the scorer explains why in
"Fix these first". A test asserts the penalty a template *advertises* equals the
points it actually costs, so the two can never drift apart.

The Sidebar is two columns visually, but its DOM order is
summary → experience → projects → achievements → education → skills, so a parser
reading source order still gets a coherent document. That is the best a
two-column resume can do; it is still the riskiest option in the set.

### On importing third-party templates

Template collections found online are usually static HTML pages that position
content with `position: absolute` and `float`, which is precisely what scrambles
an ATS parse — and they carry hardcoded content rather than a data model. They
cannot be dropped into this renderer, and adopting their layout techniques would
contradict the score this app reports. New templates belong here as style tokens
and layout shells over the shared section renderers.

The Timeline, Executive and accent-palette work was informed by the design
token sets in [Magic-Resume](https://github.com/Magic-Resume/Magic-Resume)
(MIT, © 2025 林陌青川) — a well-built data-driven template DSL. No code was
copied; the ideas were re-expressed as tokens for the renderer here.

---

## Targeting a resume

A generic resume is scored against a generic keyword list, which is not the
score that matters. Two ways to aim it:

- **At a job.** Jobs → open a posting → **Resume for this job**. The title,
  required skills and description are pulled in, so the ATS score is measured
  against that exact posting.
- **At a role.** New resume → pick from the twelve roles in `ROLE_KEYWORDS`
  (Software Engineer, Data Analyst, DevOps, Android, …). The role seeds the
  keyword set.

Either way the resume autofills from the profile, scores immediately, and the
Download PDF button prints exactly what the preview shows.

---

## Placement cohort data (LPA7 / LPA8)

The KLU placement workbooks are imported into the database as **institutional
records, not accounts** — 656 students across two cohorts.

```bash
python scripts/extract-cohorts.py      # workbooks -> server/src/db/data/cohorts.json
node server/src/db/import-cohorts.js   # JSON -> MySQL  (add --dry-run to preview)
```

Two steps on purpose: the extract needs pandas and the source spreadsheets, the
import needs neither. The JSON is committed, so the VPS runs pure Node.

| Cohort | Students | Banded | With email | Source |
|---|--:|--:|--:|---|
| `lpa7` | 425 | 425 | 0 | `Readiness_Tiers_6_7_LPA.xlsx`, `LPA7.xlsx` |
| `lpa8` | 231 | 182 | 96 | `KLU_Readiness_Tiers.xlsx`, `Readiness_Tiers.xlsx`, `FINAL_student_coding_profiles.xlsx`, `academic_records.xlsx` |

Four tables: `cohorts`, `student_records`, `student_assessments` (726 CRT
scores), `student_coding_stats` (1,538 platform rows). Re-runnable — records
upsert on (cohort, registration number), and a record already claimed keeps its
owner.

### Claiming

A `student_record` has no `user_id` until a student claims it. That keeps 656
people out of the `users` table who never asked for an account, and keeps their
PII off every public endpoint.

- **Automatically** at signup, when the email matches `placement_email` or
  `personal_email` (96 records).
- **Manually** with a registration number, from the dashboard — the route for
  the other 560.

Claiming seeds the profile from what the placement cell already knows: branch,
campus, registration number, UG CGPA, three education rows from the CGPAs, and
any known LeetCode/CodeChef/GitHub handles as linked accounts ready to sync.
It only fills blanks, so a student who has already edited something keeps their
version.

`GET /api/me/readiness` then returns their band, readiness index, rank within
the cohort, the six dimension scores, CRT history and the strengths/gaps/plan
notes — rendered on the dashboard.

### For the placement cell

```bash
node server/src/db/make-admin.js you@klu.ac.in    # --revoke to undo, --list to check
```

The account must exist first — sign in once, then promote. Admins get a
**Students** item in the sidebar:

- **Roster** (`/app/students`) — all 656 ranked by readiness index, filtered by
  band and branch, searchable by name or registration number.
- **Report** (`/app/students/:cohort/:regNo`) — one student's full profiling
  page: band and rank, the six dimension scores, academics, CRT history,
  matched coding profiles with confidence levels, contact details, and the
  strengths/gaps/plan analysis. Printable as a hand-out.

### PII

`KLU_Readiness_Tiers.xlsx` carries gender, date of birth, mobile numbers and
personal email addresses. These are stored, and:

- never returned by `/api/u/*` (the public profile and directory),
- never returned by the admin roster at `/api/cohorts/:code/students`,
- reachable only by the student who owns the record, via `/api/me/readiness`.

A test asserts the public profile contains no mobile number and no date of
birth. If you extend the cohort endpoints, keep that test passing.

Empty or irrelevant sections are dropped from the document entirely — a student
with no internships gets no empty "Experience" heading, and an unlinked LeetCode
account renders an empty state rather than a misleading zero.

---

## API

All routes are under `/api`. Authenticated routes take `Authorization: Bearer <accessToken>`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | DB + mail status |
| GET | `/auth/diagnostics` | OTP pipeline configuration |
| POST | `/auth/check-email` | live validation while typing |
| POST | `/auth/request-otp` | send a code |
| POST | `/auth/verify-otp` | verify → sign in or sign up |
| POST | `/auth/refresh` · `/auth/logout` | session rotation |
| GET | `/auth/me` | current user |
| GET·PATCH | `/profile` | full profile / personal details |
| PUT | `/profile/links` | social + coding handles |
| GET·POST | `/profile/:section` | education·skills·projects·experience·achievements |
| PATCH·DELETE | `/profile/:section/:id` | edit / remove one entry |
| PUT | `/profile/:section/reorder` | reorder entries |
| GET·POST | `/coding` · `/coding/sync[/:platform]` | cached stats / live refresh |
| GET | `/resumes/templates` · `/resumes/autofill` | template gallery / profile→resume |
| GET·POST | `/resumes` | list / create |
| GET·PATCH·DELETE | `/resumes/:id` | one resume (PATCH rescores) |
| POST | `/resumes/score` | score arbitrary data, no save |
| POST | `/resumes/:id/refresh` · `/export` | pull latest profile / log a download |
| GET | `/jobs` · `/jobs/recommended` · `/jobs/:id` | board, ranked matches, detail |
| GET·PUT | `/jobs/alerts/me` | alert preferences |
| POST | `/jobs/alerts/me/test` | send a digest right now |
| GET | `/me/activity` · `/me/stats` · `/me/sessions` | profiling log, counters, devices |
| POST·DELETE | `/me/sessions/revoke-all` · `/me` | sign out everywhere / delete account |
| GET | `/u` · `/u/:slug` | public directory and profile |

---

## Job alerts

`job_alerts` holds each student's roles, skills, locations, work modes, job
types, minimum CTC, frequency and preferred send hour. The scheduler runs
**hourly** and picks up only students whose `send_hour` is the current hour, so
each person gets exactly one digest per day at their chosen time.

`matchScore()` weights skill overlap (45), role-title match (25), location and
work mode (20) and freshness (5+). Only jobs scoring ≥35 are sent. Every send —
including skips and failures — is recorded in `alert_deliveries` and surfaced in
the Alerts page's delivery history. **"Send me one now"** bypasses the schedule
so a student can confirm mail reaches them.

---

## Tests

```bash
node server/src/db/smoke.js       # 43 checks: ATS scoring, email validation,
                                  # resume shaping, handle parsing, job matching,
                                  # template penalties. No database needed.

node server/src/index.js          # terminal 1
node server/src/db/e2e.js         # terminal 2 — 114 HTTP checks: OTP lifecycle,
                                  # rate limits, every CRUD route, ownership
                                  # isolation, ATS scoring, alerts, account deletion.
node server/src/db/e2e-cohorts.js # 37 checks: claiming, readiness, admin guards,
                                  # and that PII never reaches a public endpoint.
```

`e2e.js` needs `MAIL_DEV_ECHO=true` and `NODE_ENV=development` to read back the
code. It creates a throwaway account and deletes it at the end. Point it at the
live server with `API_BASE=https://yourdomain.com node server/src/db/e2e.js`.

---

## Deployment

See [DEPLOYMENT.md](DEPLOYMENT.md).
