#!/bin/sh
set -e

echo "Running Prisma migrations..."
npx prisma migrate deploy

echo "Building TypeScript..."
npm run build

echo "Starting app..."
node dist/server.js