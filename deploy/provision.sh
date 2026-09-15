#!/usr/bin/env bash
#
# One-time provisioning for a fresh Ubuntu 22.04/24.04 Hostinger VPS.
# Installs Node 20, MariaDB, nginx, PM2, a firewall and a deploy user,
# then creates the CareerForge database and its own least-privilege DB user.
#
# Run as root ON THE SERVER:
#   bash provision.sh
#
# It is idempotent — safe to re-run.

set -euo pipefail

APP_USER="careerforge"
APP_DIR="/var/www/careerforge"
DB_NAME="careerforge"
DB_USER="careerforge"
NODE_MAJOR="20"

log()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m !  %s\033[0m\n' "$*"; }

[[ $EUID -eq 0 ]] || { echo "Run this as root."; exit 1; }

# ---------------------------------------------------------------- packages
log "Updating packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get upgrade -y -qq

log "Installing base packages"
apt-get install -y -qq curl git ufw nginx mariadb-server ca-certificates gnupg openssl

# ------------------------------------------------------------------- node
if ! command -v node >/dev/null || [[ "$(node -v | cut -d. -f1 | tr -d v)" -lt "$NODE_MAJOR" ]]; then
  log "Installing Node.js ${NODE_MAJOR}.x"
  mkdir -p /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg --yes
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" \
    > /etc/apt/sources.list.d/nodesource.list
  apt-get update -qq
  apt-get install -y -qq nodejs
fi
log "Node $(node -v), npm $(npm -v)"

command -v pm2 >/dev/null || { log "Installing PM2"; npm install -g pm2 --silent; }

# ------------------------------------------------------------- app user
if ! id -u "$APP_USER" >/dev/null 2>&1; then
  log "Creating service user '$APP_USER'"
  adduser --system --group --home "$APP_DIR" --shell /bin/bash "$APP_USER"
fi
mkdir -p "$APP_DIR"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

# ------------------------------------------------------------- database
log "Securing MariaDB and creating the application database"
systemctl enable --now mariadb

DB_PASSWORD_FILE="/root/.careerforge_db_password"
if [[ -f "$DB_PASSWORD_FILE" ]]; then
  DB_PASSWORD="$(cat "$DB_PASSWORD_FILE")"
  warn "Reusing the DB password stored in $DB_PASSWORD_FILE"
else
  DB_PASSWORD="$(openssl rand -base64 30 | tr -d '/+=' | head -c 28)"
  umask 077; printf '%s' "$DB_PASSWORD" > "$DB_PASSWORD_FILE"
fi

mysql <<SQL
CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASSWORD}';
ALTER USER '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_PASSWORD}';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, INDEX, ALTER, REFERENCES ON \`${DB_NAME}\`.* TO '${DB_USER}'@'localhost';
DELETE FROM mysql.user WHERE User='';
DROP DATABASE IF EXISTS test;
FLUSH PRIVILEGES;
SQL

# bind MariaDB to localhost only — nothing reaches it from the internet
CONF=/etc/mysql/mariadb.conf.d/50-server.cnf
if [[ -f "$CONF" ]] && ! grep -q '^bind-address\s*=\s*127.0.0.1' "$CONF"; then
  sed -i 's/^bind-address.*/bind-address = 127.0.0.1/' "$CONF"
  systemctl restart mariadb
fi

# ------------------------------------------------------------- firewall
log "Configuring the firewall"
ufw allow OpenSSH >/dev/null
ufw allow 'Nginx Full' >/dev/null
ufw --force enable >/dev/null
ufw status numbered | sed 's/^/    /'

# --------------------------------------------------------------- secrets
JWT_SECRET="$(openssl rand -hex 48)"
JWT_REFRESH_SECRET="$(openssl rand -hex 48)"

ENV_FILE="$APP_DIR/server/.env"
mkdir -p "$APP_DIR/server"
if [[ -f "$ENV_FILE" ]]; then
  warn "$ENV_FILE already exists — leaving it untouched."
else
  log "Writing $ENV_FILE"
  cat > "$ENV_FILE" <<ENV
NODE_ENV=production
PORT=4000
APP_NAME=CareerForge
APP_URL=https://CHANGE-ME-your-domain.com
API_URL=https://CHANGE-ME-your-domain.com

DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=${DB_USER}
DB_PASSWORD=${DB_PASSWORD}
DB_NAME=${DB_NAME}

JWT_SECRET=${JWT_SECRET}
JWT_REFRESH_SECRET=${JWT_REFRESH_SECRET}
ACCESS_TOKEN_TTL=30m
REFRESH_TOKEN_TTL_DAYS=30

OTP_LENGTH=6
OTP_TTL_MINUTES=10
OTP_RESEND_COOLDOWN_SECONDS=60
OTP_MAX_VERIFY_ATTEMPTS=5
OTP_MAX_PER_EMAIL_PER_HOUR=5

# ---- FILL THESE IN: create a mailbox in hPanel, then use its credentials ----
SMTP_HOST=smtp.hostinger.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=no-reply@CHANGE-ME-your-domain.com
SMTP_PASS=CHANGE-ME
MAIL_FROM_NAME=CareerForge
MAIL_FROM_ADDRESS=no-reply@CHANGE-ME-your-domain.com
MAIL_DEV_ECHO=false

VALIDATE_EMAIL_MX=true
ALLOWED_EMAIL_DOMAINS=

JOB_ALERT_CRON=0 8 * * *
TZ=Asia/Kolkata
ENV
  chmod 600 "$ENV_FILE"
  chown "$APP_USER:$APP_USER" "$ENV_FILE"
fi

cat <<DONE

────────────────────────────────────────────────────────────────
  Provisioning complete.

  Database : ${DB_NAME}
  DB user  : ${DB_USER}@localhost
  Password : stored in ${DB_PASSWORD_FILE} (and written into .env)

  NEXT — three things, in this order:

  1. Edit ${ENV_FILE}
       • APP_URL / API_URL  → your real https:// domain
       • SMTP_USER / SMTP_PASS → the mailbox you create in hPanel
         (Emails → create no-reply@yourdomain.com, then use that password)

  2. Point your domain's A record at this server, then:
       bash deploy/setup-nginx.sh yourdomain.com

  3. Deploy the code:
       bash deploy/deploy.sh
────────────────────────────────────────────────────────────────

DONE
