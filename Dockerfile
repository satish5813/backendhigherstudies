# KL Placement Readiness — production image.
#
# One container serves both halves: Express handles /api and also serves the
# built React bundle, which is how it already runs locally. That keeps Coolify
# to a single service plus a database, rather than a proxy juggling two.
#
# Two stages so the image does not ship the client's build toolchain — Vite,
# Tailwind and their dependency trees are several hundred megabytes that have
# no business on a production server.

# ---------------------------------------------------------------- build stage
FROM node:22-bookworm-slim AS build
WORKDIR /app

# Copy manifests first so `npm ci` is cached until a dependency actually
# changes. Without this every source edit re-installs everything.
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY client/package.json ./client/
RUN npm ci

COPY . .
RUN npm run build --workspace client

# ---------------------------------------------------------------- run stage
FROM node:22-bookworm-slim AS run
WORKDIR /app

ENV NODE_ENV=production

# sharp needs libvips at runtime for avatars and proof screenshots. The slim
# image does not carry it, and the failure only shows up on first upload.
RUN apt-get update \
 && apt-get install -y --no-install-recommends libvips42 ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY server/package.json ./server/
# Production deps only, and the client is not installed at all — its build
# output is copied in below as static files.
RUN npm ci --omit=dev --workspace server --include-workspace-root

COPY server ./server
COPY --from=build /app/client/dist ./client/dist

# Uploads and proof screenshots are written at runtime. These are declared as
# volumes so a redeploy does not wipe a student's photo or their application
# evidence — mount them to host paths in Coolify.
RUN mkdir -p /app/server/uploads/avatars /app/server/private/proofs
VOLUME ["/app/server/uploads", "/app/server/private"]

# Run unprivileged. The node image ships a `node` user for exactly this.
RUN chown -R node:node /app
USER node

EXPOSE 4000

# Coolify reads this to decide whether a deploy succeeded. /api/health checks
# the database too, so a container that starts without MySQL is reported
# unhealthy instead of silently serving errors.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/api/health').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"

CMD ["node", "server/src/index.js"]
