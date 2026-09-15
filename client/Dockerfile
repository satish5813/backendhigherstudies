# KL Placement Readiness — frontend image.
#
# Builds the React app and serves it with nginx, which also forwards /api and
# /uploads to the backend. The browser therefore talks to one origin only —
# no CORS, and the session cookie works exactly as it does when Express serves
# the bundle itself. Vite's dev server does the same thing locally.
#
# API_UPSTREAM is the backend's host name (no scheme). Set it in Coolify to
# point this image at a different backend without rebuilding.

# ---------------------------------------------------------------- build stage
FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build

# ------------------------------------------------------------------ run stage
FROM nginx:1.27-alpine

ENV API_UPSTREAM=bl2mqfd6tm3nk2az3xl36mpo.187.127.135.148.sslip.io

# The nginx image runs envsubst over /etc/nginx/templates/*.template at start,
# so ${API_UPSTREAM} below is filled in from the environment.
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ >/dev/null 2>&1 || exit 1
