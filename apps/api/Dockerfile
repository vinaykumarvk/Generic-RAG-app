# IntelliRAG API — multi-stage build
FROM node:20-slim AS builder
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/workflow-engine/package.json packages/workflow-engine/
COPY packages/api-core/package.json packages/api-core/
COPY packages/api-integrations/package.json packages/api-integrations/
COPY apps/api/package.json apps/api/

RUN npm ci --workspace=packages/shared --workspace=packages/workflow-engine \
    --workspace=packages/api-core --workspace=packages/api-integrations \
    --workspace=apps/api --include-workspace-root

COPY tsconfig.base.json ./
COPY packages/ packages/
COPY apps/api/ apps/api/

RUN npm run build:packages && npm run --workspace=apps/api build

# --- Production image ---
FROM node:20-slim
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends tini && \
    rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/shared/package.json ./packages/shared/
COPY --from=builder /app/packages/workflow-engine/dist ./packages/workflow-engine/dist
COPY --from=builder /app/packages/workflow-engine/package.json ./packages/workflow-engine/
COPY --from=builder /app/packages/api-core/dist ./packages/api-core/dist
COPY --from=builder /app/packages/api-core/package.json ./packages/api-core/
COPY --from=builder /app/packages/api-integrations/dist ./packages/api-integrations/dist
COPY --from=builder /app/packages/api-integrations/package.json ./packages/api-integrations/
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/package.json ./apps/api/
COPY apps/api/src/migrations ./apps/api/dist/migrations

RUN mkdir -p /app/uploads && chown node:node /app/uploads
USER node

EXPOSE 3001
ENTRYPOINT ["tini", "--"]
CMD ["node", "apps/api/dist/index.js"]
