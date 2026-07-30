# prodmesh — church production dashboard
#
# A LAN server: booth screens, room Macs and phones browse to it. It is not a
# desktop app, so the container needs the host's network reachable from those
# machines — see docker-compose.yml.
#
# Two stages so the build toolchain (better-sqlite3 compiles against Node's
# headers when no prebuilt binary matches) never ships in the runtime image.

# ── Build ─────────────────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS build

# better-sqlite3 falls back to compiling from source on platforms without a
# prebuild. Cheap insurance: without these the build fails on exactly the
# architectures a church is most likely to self-host on.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# Drop dev dependencies (vite, vitest, typescript) from what gets copied on.
RUN npm prune --omit=dev

# The frontend libraries are `dependencies` because Vite needs them to build —
# but the build already happened, and what came out is dist/ (under 1 MB). The
# server imports none of them, so they are 53 MB of dead weight in an image a
# church has to pull. lucide-react alone is 40 MB of individual icon modules.
#
# Removing them here rather than moving them to devDependencies keeps this a
# packaging concern: `npm ci --omit=dev && npm run build` anywhere else would
# break if the build's own inputs were classified as optional.
RUN rm -rf node_modules/lucide-react \
           node_modules/react \
           node_modules/react-dom \
           node_modules/react-router \
           node_modules/react-router-dom \
           node_modules/scheduler \
           node_modules/@fontsource \
           node_modules/@fontsource-variable

# ── Runtime ───────────────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS runtime

# Stamped at build time because the image has no .git to ask. Without this the
# Admin → System panel can only say "unknown".
ARG PRODMESH_VERSION=0.0.0
ARG PRODMESH_COMMIT=unknown
ARG PRODMESH_COMMIT_SUBJECT=""

ENV NODE_ENV=production \
    PORT=8080 \
    PRODMESH_DATA_DIR=/data \
    PRODMESH_CONTAINER=1 \
    PRODMESH_VERSION=$PRODMESH_VERSION \
    PRODMESH_COMMIT=$PRODMESH_COMMIT \
    PRODMESH_COMMIT_SUBJECT=$PRODMESH_COMMIT_SUBJECT

WORKDIR /app

# Only what the server actually serves: the built UI, the server, and the
# runtime dependencies.
#
# --chown on each COPY, never a `chown -R` afterwards: recursive chown rewrites
# every file's metadata, and because that lands in its own layer it duplicated
# all of node_modules. One convenience line was 99 MB of the image.
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/server ./server
COPY --from=build --chown=node:node /app/package.json ./package.json

# Everything mutable lives in the volume: SQLite, secrets.json, uploaded logo,
# show timelines. The image itself stays read-only in practice.
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]

EXPOSE 8080

# /api/system/health is deliberately unauthenticated (redacted for anonymous
# callers), which makes it the one endpoint a healthcheck can use.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/system/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
