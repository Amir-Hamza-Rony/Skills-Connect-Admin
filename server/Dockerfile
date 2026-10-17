# syntax=docker/dockerfile:1
#
# Skills Connect Admin — API image (BACKEND-PLAN B1 scaffold).
# Tuned for correctness first; image slimming moves to B6 alongside the real
# staging deploy. Verify with:  docker build -f server/Dockerfile -t sc-api .
#
# MongoDB is NOT in this image — D3 uses MongoDB Atlas, reached over the
# network via MONGODB_URI. Redis and MinIO are dev-only compose services.

# ---------- deps: install every workspace dependency from the lockfile --------
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json ./server/
RUN npm ci

# ---------- build: compile TypeScript to dist/ --------------------------------
FROM deps AS build
COPY server ./server
RUN npm run server:build

# ---------- runtime: production node + compiled server only ------------------
FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

# `lib/version.ts` reads ../../package.json, so server/package.json must ship.
COPY --from=deps  /app/node_modules                              ./node_modules
COPY --from=build /app/server/dist                               ./server/dist
COPY --from=build /app/server/package.json                       ./server/package.json

# Never run the API as root.
USER node

EXPOSE 4000

# Fails the container if Mongo is unreachable — matches the server's own
# fail-fast rule, so an orchestrator will not route traffic to a broken pod.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/dist/server.js"]