#!/usr/bin/env bash
#
# Installs the nginx vhost for CareerForge and issues a Let's Encrypt certificate.
#
#   bash deploy/setup-nginx.sh yourdomain.com [www.yourdomain.com]
#
# Your domain's A record must already point at this server, or certbot fails.

set -euo pipefail

DOMAIN="${1:-}"
ALT="${2:-}"
APP_DIR="/var/www/careerforge"

[[ $EUID -eq 0 ]] || { echo "Run this as root."; exit 1; }
[[ -n "$DOMAIN" ]] || { echo "Usage: bash deploy/setup-nginx.sh yourdomain.com [www.yourdomain.com]"; exit 1; }

log() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

SERVER_NAMES="$DOMAIN${ALT:+ $ALT}"

log "Writing /etc/nginx/sites-available/careerforge"
cat > /etc/nginx/sites-available/careerforge <<NGINX
# CareerForge — nginx serves the built SPA, proxies /api to the Node process.

limit_req_zone \$binary_remote_addr zone=cf_api:10m rate=20r/s;
limit_req_zone \$binary_remote_addr zone=cf_auth:10m rate=2r/s;

server {
    listen 80;
    listen [::]:80;
    server_name ${SERVER_NAMES};

    root ${APP_DIR}/client/dist;
    index index.html;

    client_max_body_size 2m;

    # ---- security headers ----
    add_header X-Frame-Options SAMEORIGIN always;
    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;

    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css application/json application/javascript
               application/x-javascript text/xml application/xml image/svg+xml;

    # ---- OTP endpoints: tightest rate limit ----
    location ~ ^/api/auth/(request-otp|verify-otp) {
        limit_req zone=cf_auth burst=5 nodelay;
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    # ---- everything else under /api ----
    location /api/ {
        limit_req zone=cf_api burst=40 nodelay;
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 60s;
    }

    # ---- hashed build assets ----
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        try_files \$uri =404;
    }

    # ---- SPA fallback ----
    location / {
        try_files \$uri \$uri/ /index.html;
    }

    location = /index.html {
        add_header Cache-Control "no-cache, must-revalidate";
    }
}
NGINX

ln -sf /etc/nginx/sites-available/careerforge /etc/nginx/sites-enabled/careerforge
rm -f /etc/nginx/sites-enabled/default

log "Testing the nginx configuration"
nginx -t
systemctl reload nginx

log "Issuing a TLS certificate for ${SERVER_NAMES}"
if ! command -v certbot >/dev/null; then
  apt-get install -y -qq certbot python3-certbot-nginx
fi

CERTBOT_DOMAINS=(-d "$DOMAIN")
[[ -n "$ALT" ]] && CERTBOT_DOMAINS+=(-d "$ALT")

if certbot --nginx "${CERTBOT_DOMAINS[@]}" --non-interactive --agree-tos --redirect \
     --register-unsafely-without-email; then
  systemctl reload nginx
  printf '\n\033[1;32mHTTPS is live at https://%s\033[0m\n' "$DOMAIN"
  printf 'Now set APP_URL and API_URL in %s/server/.env to https://%s and run:\n' "$APP_DIR" "$DOMAIN"
  printf '  pm2 restart careerforge-api --update-env\n\n'
else
  printf '\n\033[1;33mCertbot failed — the site is still reachable over http://%s\033[0m\n' "$DOMAIN"
  printf 'Most common cause: the A record does not point at this server yet.\n'
  printf 'Fix DNS, then re-run:  certbot --nginx -d %s\n\n' "$DOMAIN"
fi
