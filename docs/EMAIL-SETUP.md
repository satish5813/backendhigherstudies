# Sending mail from CareerForge

The app sends two things: the **sign-in code** every student needs to log in, and
the **daily job-alert digest**. Without working SMTP nobody can sign in, so this
is worth getting right before launch.

> **Never paste a mailbox password into a chat, a ticket or a commit.** Put it in
> `server/.env` only. That file is gitignored, and nothing else reads it.

Test any configuration with:

```bash
node server/src/db/test-mail.js                    # connect + authenticate
node server/src/db/test-mail.js you@kluniversity.in # ...and send a real message
```

It reads `.env`, masks the password in its output, and explains failures in
plain language rather than raw SMTP codes.

---

## Option A — KL University Outlook / Microsoft 365

**Read this before you spend an evening retyping your password.**

Microsoft **disabled basic SMTP authentication for Exchange Online** across all
tenants (completed 2023). Your normal Outlook username and password will be
rejected with a `535 5.7.139` error *even when they are perfectly correct*.
That error is a tenant policy block, not a typo.

Settings, once SMTP AUTH is actually enabled for the mailbox:

```ini
SMTP_HOST=smtp.office365.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=no-reply@kluniversity.in
SMTP_PASS=the-mailbox-password
MAIL_FROM_ADDRESS=no-reply@kluniversity.in   # must match SMTP_USER
MAIL_FROM_NAME=KLU CareerForge
```

### What to ask KLU IT for

Send them this, verbatim:

> Please enable **Authenticated SMTP (SMTP AUTH)** on the mailbox
> `no-reply@kluniversity.in`. In the Microsoft 365 admin centre this is
> *Users → Active users → (mailbox) → Mail → Manage email apps → Authenticated SMTP*.
> The tenant-wide default may also need a per-mailbox exception if
> `AlwaysEnabled` is off in the transport config. The mailbox will send
> transactional sign-in codes from an internal application.

If they will not enable it — many university IT teams won't, and they have good
reasons — ask instead for **one** of:

1. **An SMTP relay host** (an internal `smtp-relay.kluniversity.in` that accepts
   mail from your VPS IP without authentication). Then set `SMTP_HOST` to that,
   `SMTP_PORT=25` or `587`, and leave `SMTP_USER`/`SMTP_PASS` empty.
2. **A Microsoft 365 "high volume email" account** — designed for exactly this.
3. **Permission to use an external provider** on a subdomain such as
   `mail.kluniversity.in` (Option B below).

### Volume limits matter here

A normal Microsoft 365 mailbox is capped at roughly **30 messages per minute**
and **10,000 recipients per day**, and Microsoft treats bursts as spam. With 656
students that is survivable for sign-in codes but tight for a daily digest to
everyone at 08:00. The app already throttles itself to ~3 messages/second on
Office 365 hosts, but for the full cohort a transactional provider is the
better tool.

---

## Option B — a transactional provider (recommended for 656 students)

Built for this, free at your volume, and far better deliverability than a
university mailbox. You keep the `@kluniversity.in` from-address by verifying
the domain with DNS records — which needs IT to add two TXT records, a much
smaller ask than enabling SMTP AUTH.

| Provider | Free tier | Host | Port |
|---|---|---|---|
| **Brevo** | 300/day | `smtp-relay.brevo.com` | 587 |
| **Resend** | 3,000/month | `smtp.resend.com` | 587 |
| **Amazon SES** | 3,000/month trial | `email-smtp.<region>.amazonaws.com` | 587 |
| **Mailgun** | 100/day | `smtp.mailgun.org` | 587 |

```ini
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-brevo-login
SMTP_PASS=your-brevo-smtp-key        # an API key, not your account password
MAIL_FROM_ADDRESS=no-reply@kluniversity.in
MAIL_FROM_NAME=KLU CareerForge
```

Brevo/Resend/SES all give you an SMTP **key** rather than a password — if it
leaks you revoke that one key, and no mailbox is exposed. That alone is a good
reason to prefer them over a staff account.

---

## Option C — Hostinger mailbox

If the app runs on your Hostinger VPS and you own a domain there, hPanel creates
a mailbox in a minute and it works without asking anyone's permission.

```ini
SMTP_HOST=smtp.hostinger.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=no-reply@yourdomain.com
SMTP_PASS=the-mailbox-password
MAIL_FROM_ADDRESS=no-reply@yourdomain.com
```

Shared-hosting mailboxes are usually capped a few hundred messages a day — fine
for sign-in codes, thin for a daily digest to the whole cohort.

---

## DNS: SPF and DKIM

Whatever you choose, add these or your mail lands in spam — which looks exactly
like the app being broken.

- **SPF**: one TXT record on the sending domain naming the provider, e.g.
  `v=spf1 include:spf.protection.outlook.com -all` for Microsoft 365, or the
  `include:` your provider gives you.
- **DKIM**: the provider gives you one or two CNAME records. Microsoft 365
  enables DKIM from *Defender → Policies → Email authentication*.
- **DMARC** (optional but sensible): `v=DMARC1; p=none; rua=mailto:you@kluniversity.in`
  to start, so you can see what is being sent in your name.

---

## Troubleshooting

| What you see | What it means |
|---|---|
| `535 5.7.139` | SMTP AUTH is disabled for the mailbox/tenant. Not a wrong password. |
| `5.7.57 ... not permitted to send as` | `MAIL_FROM_ADDRESS` does not match `SMTP_USER` or an owned alias. |
| `ETIMEDOUT` / `ECONNREFUSED` | Wrong host/port, or outbound SMTP is firewalled. Port 25 is blocked nearly everywhere. |
| `self signed certificate` / TLS errors | Port 587 needs `SMTP_SECURE=false`; port 465 needs `true`. |
| `4.7.x` throttling | Sending too fast for the mailbox's limits. Move to a transactional provider. |
| Sends fine, arrives in spam | SPF/DKIM missing. |

Live status any time:

```bash
curl -s http://localhost:4000/api/auth/diagnostics
```

`"verified": true` means the connection and credentials are good. The same panel
is in the app under **Settings → Email delivery**.

---

## Until SMTP works

Local development does not need any of this. With `MAIL_DEV_ECHO=true` and
`NODE_ENV=development` the sign-in code is printed in the server log and shown
on screen, so you can use the whole app while IT takes their time.

Both are ignored in production — `MAIL_DEV_ECHO` cannot leak a code from a
production build.
