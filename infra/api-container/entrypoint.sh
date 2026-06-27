#!/bin/sh
set -eu

# Run pending Prisma migrations before accepting traffic. DATABASE_URL is
# injected by the ECS task definition (Secrets Manager → env at start).
echo "Running database migrations..."
cd /app/packages/db
npx prisma migrate deploy

echo "Starting API..."
cd /app/apps/api
exec node dist/index.js
