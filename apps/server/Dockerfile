# syntax=docker/dockerfile:1.7
# One image: the API serves /api and the built SPA (ADR 0011).
FROM node:24-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN apk add --no-cache tini && npm install -g pnpm@12.21.0

FROM base AS build
WORKDIR /repo
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile
RUN pnpm --filter @repo/web build && pnpm --filter @repo/server build
# Production dependencies only, flat, so the bundle (which inlines @repo/*) resolves
# its external packages from /app/node_modules.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm --filter @repo/server deploy --prod --config.node-linker=hoisted /deploy

FROM base AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=4400 WEB_DIST_DIR=/app/web DB_MIGRATIONS_DIR=/app/drizzle LOG_FORMAT=json
COPY --from=build /deploy/node_modules ./node_modules
COPY --from=build /repo/apps/server/dist ./dist
COPY --from=build /repo/apps/web/dist ./web
COPY --from=build /repo/packages/db/drizzle ./drizzle
USER node
EXPOSE 4400
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD node -e "fetch('http://127.0.0.1:4400/readyz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.mjs"]
