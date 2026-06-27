# Production image — API + React SPA (ADR 0002 same-origin).
#
# Build:
#   docker build \
#     --build-arg VITE_CLERK_PUBLISHABLE_KEY=pk_test_... \
#     -t edi-hub-api .
#
# Runtime env (ECS task definition):
#   DATABASE_URL, CLERK_SECRET_KEY, CLERK_WEBHOOK_SECRET — from Secrets Manager
#   S3_BUCKET, S3_REGION, NODE_ENV=production, WEB_STATIC_DIR=/app/apps/web/dist

FROM node:22-alpine AS builder

RUN apk add --no-cache openssl

WORKDIR /app

COPY package.json package-lock.json tsconfig.json tsconfig.base.json ./
COPY packages packages
COPY apps/api apps/api
COPY apps/web apps/web

RUN npm ci

ARG VITE_CLERK_PUBLISHABLE_KEY=""
ENV VITE_CLERK_PUBLISHABLE_KEY=$VITE_CLERK_PUBLISHABLE_KEY

RUN npm run db:generate
RUN npm run build --workspace=@edi/shared \
  && npm run build --workspace=@edi/db \
  && npm run build --workspace=@edi/edi-parser \
  && npm run build --workspace=@edi/api
RUN npm run build --workspace=@edi/web

FROM node:22-alpine AS runner

RUN apk add --no-cache openssl

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    WEB_STATIC_DIR=/app/apps/web/dist

COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/package.json ./apps/api/package.json
COPY --from=builder /app/apps/web/dist ./apps/web/dist
COPY infra/api-container/entrypoint.sh /entrypoint.sh

RUN chmod +x /entrypoint.sh

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1

ENTRYPOINT ["/entrypoint.sh"]
