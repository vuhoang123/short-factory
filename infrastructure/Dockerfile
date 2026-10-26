FROM node:22-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN npm install --global pnpm@11.25.0
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
ENV npm_config_fetch_timeout=300000 npm_config_fetch_retries=5
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json tsconfig.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/database/package.json ./packages/database/package.json
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/sources/package.json ./packages/sources/package.json
COPY workers/discovery/package.json ./workers/discovery/package.json
COPY packages/publishers/package.json ./packages/publishers/package.json
COPY packages/media/package.json ./packages/media/package.json
RUN --mount=type=cache,id=shorts-factory-pnpm,target=/root/.local/share/pnpm/store/v11 pnpm install --frozen-lockfile --network-concurrency=8
COPY apps ./apps
COPY packages ./packages
COPY workers ./workers
COPY prisma ./prisma
COPY contracts ./contracts
COPY examples ./examples
RUN DATABASE_URL=postgresql://build-placeholder:build-placeholder@127.0.0.1:5432/build_placeholder pnpm db:generate

FROM base AS api
RUN pnpm --filter @shorts-factory/api build
RUN mkdir -p /app/.data/objects && chown -R node:node /app/.data
USER node
EXPOSE 3001
CMD ["pnpm", "--filter", "@shorts-factory/api", "start"]

FROM base AS web
ARG API_URL=http://api:3001
ENV API_URL=${API_URL}
RUN pnpm --filter @shorts-factory/web build
RUN chown -R node:node /app/apps/web/.next
USER node
EXPOSE 3000
CMD ["pnpm", "--filter", "@shorts-factory/web", "start"]

FROM base AS worker
RUN pnpm --filter @shorts-factory/discovery-worker typecheck
USER node
CMD ["pnpm", "--filter", "@shorts-factory/discovery-worker", "start"]
