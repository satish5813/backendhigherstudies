# Deploying CareerForge to your Hostinger VPS

Target: `187.127.135.148`, Ubuntu, root access.

---

## 0. Before anything else — rotate your credentials

Your root SSH password was posted in a chat transcript, twice. Treat both as
compromised:

```bash
passwd root
```

Then move to key authentication and turn password login off entirely — it is
the single biggest security win available here, and it stops brute-force
attempts against port 22 cold.

### Install a deploy key

Run this **on your machine** (or paste into Hostinger's browser terminal while
logged in as root):

```bash
mkdir -p ~/.ssh && chmod 700 ~/.ssh
echo 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIN2xc/OuFEVJrLj9a7OXKx4pndnxl1mYJeWJml7zHf68 careerforge-deploy' >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

Once key login works, disable passwords:

```bash
sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/^#*PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
systemctl restart ssh
```

---

## 1. Get the code onto the server

```bash
ssh root@187.127.135.148
apt-get update && apt-get install -y git rsync
git clone <your-repo-url> /opt/careerforge-src
cd /opt/careerforge-src
```

No git remote yet? Copy the folder up from Windows instead:

```powershell
scp -r "C:\Users\Dr T Satish\Desktop\LPA&\career-portal" root@187.127.135.148:/opt/careerforge-src
```

---

## 2. Provision the box (once)

```bash
bash deploy/provision.sh
```

This installs Node 20, MariaDB, nginx, PM2 and ufw; creates the `careerforge`
database and a least-privilege DB user with a generated password; binds MariaDB
to localhost; opens only 22/80/443; and writes `/var/www/careerforge/server/.env`
with real JWT secrets already filled in.

The DB password is also saved to `/root/.careerforge_db_password`.

---

## 3. Fill in the two things the script cannot guess

```bash
nano /var/www/careerforge/server/.env
```

| Variable | Set it to |
|---|---|
| `APP_URL`, `API_URL` | `https://yourdomain.com` (same value for both) |
| `SMTP_USER`, `SMTP_PASS` | the mailbox you create in step 4 |
| `MAIL_FROM_ADDRESS` | the same address as `SMTP_USER` |
| `ALLOWED_EMAIL_DOMAINS` | *(optional)* `klu.ac.in,kluniversity.in` to restrict signups to college addresses |

Leave `MAIL_DEV_ECHO=false` in production — it is what keeps OTPs out of API
responses.

---

## 4. Create the sending mailbox (hPanel)

OTP and job-alert email needs a real mailbox. In Hostinger hPanel:

1. **Emails → Email Accounts → Create**, e.g. `no-reply@yourdomain.com`.
2. Copy the password into `SMTP_PASS`.
3. Confirm SMTP settings — Hostinger uses `smtp.hostinger.com`, port **465**,
   SSL/TLS. These are already the defaults in `.env`.
4. In **DNS**, make sure the SPF record exists, and add DKIM if hPanel offers it.
   Without SPF/DKIM your OTP mail lands in spam, which looks exactly like the
   app being broken.

> Prefer a transactional provider for volume: Brevo, Resend, Mailgun and SES all
> work — set `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS` accordingly
> (port 587 → `SMTP_SECURE=false`). Shared-hosting SMTP is usually capped
> somewhere around a few hundred messages a day.

---

## 5. Point DNS, then set up nginx + HTTPS

Add an `A` record for your domain → `187.127.135.148`, wait for it to resolve,
then:

```bash
cd /opt/careerforge-src
bash deploy/setup-nginx.sh yourdomain.com www.yourdomain.com
```

This writes the vhost (SPA from disk, `/api` proxied to port 4000, rate limits
on the OTP endpoints, security headers, asset caching) and issues a Let's
Encrypt certificate with auto-renewal.

---

## 6. Deploy

```bash
cd /opt/careerforge-src
bash deploy/deploy.sh          # add SEED=1 the first time for sample jobs
```

Syncs the code, installs dependencies, builds the SPA, runs migrations, and
starts the API under PM2 (single instance — the cron scheduler runs in-process,
so clustering would send duplicate digests). It finishes with a health check.

---

## 6b. Import the placement cohorts (optional)

`server/src/db/data/cohorts.json` ships with the repo, so this needs no Python
and no spreadsheets on the server:

```bash
cd /var/www/careerforge
sudo -u careerforge env $(grep -v '^#' server/.env | xargs -d '\n') node server/src/db/import-cohorts.js
```

656 student records, 726 CRT assessment scores and 1,538 coding-profile rows.
Re-runnable — re-import after regenerating the JSON from corrected workbooks and
records update in place, keeping any that students have already claimed.

To regenerate the JSON from new spreadsheets, do it **on your machine** (where
pandas and the workbooks are) and redeploy:

```bash
python scripts/extract-cohorts.py
```

> These records contain student PII. They are readable only by the student who
> claims the record and, in aggregate without PII, by an admin. Do not widen
> those endpoints without re-reading the PII section in the README.

---

## 7. Verify

```bash
curl -s https://yourdomain.com/api/health
curl -s https://yourdomain.com/api/auth/diagnostics
```

`/api/health` should report `"db": true`. `/api/auth/diagnostics` should report
`"verified": true` for mail — if it is `false`, SMTP credentials are wrong and
no OTP will ever arrive.

Then, in a browser: sign up with a real address, confirm the code arrives, fill
in the profile, generate a resume, and press **Send me one now** on the Alerts
page.

You can also run the full API suite against production:

```bash
API_BASE=https://yourdomain.com node server/src/db/e2e.js
```

Note it will stop after the OTP request, because `MAIL_DEV_ECHO=false` in
production correctly withholds the code. That is the expected result — the
suite is designed to run in full against staging or local.

---

## Everyday operations

```bash
pm2 status                         # is it up
pm2 logs careerforge-api --lines 100
pm2 restart careerforge-api --update-env   # after editing .env
bash deploy/deploy.sh              # ship an update
```

Database backup — put this in root's crontab:

```bash
0 2 * * * mysqldump --single-transaction careerforge \
  | gzip > /root/backups/careerforge-$(date +\%F).sql.gz
```

```bash
mkdir -p /root/backups
find /root/backups -name '*.sql.gz' -mtime +14 -delete   # retention
```

---

## Troubleshooting

**No OTP email arrives.** Check `/api/auth/diagnostics` first — `verified:false`
means the SMTP credentials are rejected. If it is `true`, the message is being
sent but filtered: check the spam folder and add SPF/DKIM records. Hostinger
also blocks outbound port 25; the app uses 465, which is correct.

**`db: false` on /api/health.** `systemctl status mariadb`, then confirm
`DB_PASSWORD` in `.env` matches `/root/.careerforge_db_password`.

**502 from nginx.** The API is not running: `pm2 logs careerforge-api`. A crash
loop at boot is almost always a missing or malformed `.env` — production start-up
deliberately refuses to run with default JWT secrets.

**Job alerts never send.** They only go to students whose `send_hour` matches the
current hour and who have new matches since the last digest. Force one with the
**Send me one now** button, and check `pm2 logs` for `[cron] job alerts`. Confirm
the server clock: `timedatectl` should show `Asia/Kolkata`.

**Rate limited during testing.** By design: 5 codes per address per hour, 10 per
IP per 15 minutes. Raise `OTP_MAX_PER_EMAIL_PER_HOUR` temporarily, or wait it out.
