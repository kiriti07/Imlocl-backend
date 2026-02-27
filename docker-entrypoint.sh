#!/bin/sh
set -e

echo "Running migrations..."
npx prisma migrate deploy

echo "Starting app..."
node dist/index.js