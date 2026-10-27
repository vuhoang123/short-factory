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
COPY workers/media/package.json ./workers/media/package.json
COPY packages/publishers/package.json ./packages/publishers/package.json
COPY packages/media/package.json ./packages/media/package.json
COPY packages/automation/package.json ./packages/automation/package.json
COPY packages/analytics/package.json ./packages/analytics/package.json
COPY packages/workflows/package.json ./packages/workflows/package.json
COPY workers/automation/package.json ./workers/automation/package.json
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

FROM base AS media-worker
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg chromium espeak-ng fonts-noto-core fonts-noto-cjk libnss3 libatk1.0-0 libatk-bridge2.0-0 libgbm1 libxkbcommon0 libasound2 libxshmfence1 libxcomposite1 libxdamage1 libxrandr2 libxfixes3 libx11-xcb1 libdrm2 && rm -rf /var/lib/apt/lists/*
ENV REMOTION_BROWSER_EXECUTABLE=/usr/bin/chromium
RUN pnpm --filter @shorts-factory/media-worker typecheck
RUN mkdir -p /app/.data/objects && chown -R node:node /app/.data
USER node
CMD ["pnpm", "--filter", "@shorts-factory/media-worker", "start"]

FROM media-worker AS automation-worker
RUN pnpm --filter @shorts-factory/automation-worker typecheck
CMD ["pnpm", "--filter", "@shorts-factory/automation-worker", "start"]
