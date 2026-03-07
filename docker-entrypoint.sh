#!/bin/sh
set -e

if [ "$#" -gt 0 ]; then
  exec "$@"
fi

echo "Running Prisma migrations..."
npx prisma migrate deploy

echo "Starting app..."
exec npm run start