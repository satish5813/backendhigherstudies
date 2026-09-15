# Deploying to the Hostinger VPS with Coolify

Coolify is already installed on `187.127.135.148` — its dashboard answers on
port 8000 and its Traefik proxy holds port 80. Nothing is deployed to it yet.

Everything below happens in Coolify's web UI. **No SSH is needed**, which is the
point: nobody has to hold a root session open, and no credentials to that box
need to be shared with anyone.

---

## Before the first deploy

### 1. Make the repositories private

`satish5813/KLEFHigherPlacement` and `satish5813/backendhigherstudies` are both
public. This is a placement system for one institution — its schema, readiness
scoring and cohort logic have no reason to be world-readable, and a public repo
is one more way for something sensitive to escape later.

GitHub → **Settings** → **Danger Zone** → *Change repository visibility* →
Private. Ten seconds, and it changes nothing about how Coolify deploys: connect
it with a GitHub App and Coolify reads private repos fine.

### 2. Student data is no longer in git

`server/src/db/data/cohorts.json` carried 656 students' names, registration
numbers, gender, dates of birth, mobile numbers, personal emails and CGPAs. It
was in the first commit and has been purged from the entire history.

`import-cohorts.js` reads it from disk, so it never needed to be in version
control. **You upload it to the server once, by hand**, and run the import.
Never commit it.

### 3. Rotate the VPS root password

Two root passwords for this box were typed into a chat transcript. Treat both as
compromised: change the password, then switch to key-only login
(`PasswordAuthentication no` in `/etc/ssh/sshd_config`). Root-with-password on a
public IP is brute-forced within hours, and this box will hold 656 students'
records.

---

## One repository, not two

You created a frontend repo and a backend repo. This project is a **monorepo**
and should stay in one: Express serves the built React bundle from the same
process, which is how it runs today and what the Dockerfile builds.

Splitting them means two deployments, two domains, a CORS layer and a second
TLS certificate — real work, for no benefit at this size. Use
`backendhigherstudies` for everything and leave the other repo empty, or use
either one; the name matters less than picking one.

---

## Deploying

### Step 1 — the database

Coolify → your project → **+ New** → **Database** → **MySQL 8**.

| Setting | Value |
| --- | --- |
| Name | `careerforge-db` |
| Database | `careerforge` |
| Username | `careerforge` |
| Password | from `_private-data/production-secrets.txt` |

Then open the database's **Advanced / Custom options** and add:

```
--default-time-zone=+00:00
```

This one is not optional. The Node driver writes UTC; if MySQL is on IST the two
disagree and every `NOW()` comparison skews by 5½ hours — a 10-minute sign-in
code reads as expired-in-five-hours. It cost real time to diagnose locally and
would be far worse to find remotely.

Coolify will show an internal hostname like `careerforge-db`. That is what
`DB_HOST` should be — not an IP, and never the public one.

### Step 2 — the application

Coolify → **+ New** → **Application** → **Public** (or Private) **Repository**.

| Setting | Value |
| --- | --- |
| Repository | `https://github.com/satish5813/backendhigherstudies` |
| Branch | `master` |
| Build pack | **Dockerfile** |
| Port | `4000` |

The `Dockerfile` in the repo root builds both halves and serves them from one
container.

### Step 3 — environment variables

Paste these into Coolify's **Environment Variables** tab. Values marked
`← secrets file` come from `_private-data/production-secrets.txt`.

```
NODE_ENV=production
PORT=4000
APP_NAME=KL Placement Readiness
APP_URL=https://placement.yourdomain.in

DB_HOST=careerforge-db
DB_PORT=3306
DB_NAME=careerforge
DB_USER=careerforge
DB_PASSWORD=                     ← secrets file

JWT_SECRET=                      ← secrets file
JWT_REFRESH_SECRET=              ← secrets file

SMTP_HOST=smtp.office365.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=drsatishthatavarti@kluniversity.in
SMTP_PASS=                       ← your mailbox password
MAIL_FROM_NAME=KL Placement Readiness
MAIL_FROM_ADDRESS=drsatishthatavarti@kluniversity.in
MAIL_DEV_ECHO=false

GEMINI_API_KEY=                  ← your existing key

JOB_MIN_CTC=20
JOB_MAX_CTC=80
JOB_AUTO_INGEST=true
JOB_INGEST_HOUR=3
DIRECTORY_LIST_ROSTER=true
```

**`MAIL_DEV_ECHO` must be `false`.** Set to `true` the API returns the sign-in
code in its own response, and anyone can sign in as any student. It is correct
for local testing and a complete authentication bypass in production.

**`APP_URL` must be the real domain.** Every email link is built from it; left
at the default, students receive links to `localhost`.

### Step 4 — persistent storage

Coolify → the application → **Storages**. Add two volume mounts:

| Mount path | Holds |
| --- | --- |
| `/app/server/uploads` | profile photos |
| `/app/server/private` | application-proof screenshots |

Without these, every redeploy deletes every photo a student uploaded and every
piece of application evidence they attached. Containers are disposable; these
two directories are not.

### Step 5 — domain and TLS

Coolify → **Domains** → enter `placement.yourdomain.in`. Point an A record at
`187.127.135.148` first. Coolify requests the certificate itself via Traefik;
there is nothing to configure.

### Step 6 — deploy, then set up the data

Press **Deploy** and watch the build log. When it is healthy, open Coolify's
**Terminal** for the application container and run, in order:

```bash
node server/src/db/migrate.js          # creates 21 tables
node server/src/db/make-admin.js drsatishthatavarti@kluniversity.in
```

Then upload `cohorts.json` to `/app/server/src/db/data/` (Coolify's file
manager, or `docker cp`) and:

```bash
node server/src/db/import-cohorts.js   # 656 students
node server/src/db/normalise-campus.js --write
node server/src/db/check-boards.js     # confirms the job sources resolve
```

Do **not** run `seed.js` in production. It inserts fictional demo jobs, which is
exactly the data the board audit had to retire.

---

## After it is up

Check these in order. Each one catches a different class of failure:

```bash
curl https://placement.yourdomain.in/api/health
```
`{"db":true}` means the database connection and the timezone setting are both
right.

Sign in as yourself. If the response contains a `devCode` field,
`MAIL_DEV_ECHO` is still `true` — stop and fix it before telling any student the
address.

Check the email actually arrived. SMTP failures are silent from the outside.

Then, when you are ready to bring students in:

```bash
node server/src/db/invite-students.js --campus Vijayawada          # dry run
node server/src/db/invite-students.js --send --campus Vijayawada   # 537 emails
```

---

## What runs on its own

- **03:00 daily** — job sweep: pulls fresher openings at 20-80 LPA into the
  moderation queue. Nothing reaches a student until you approve it.
- **Hourly** — job-alert digests, each student at their chosen hour.
- **03:20 daily** — expired OTPs, dead sessions and year-old activity logs are
  cleared.
