#!/bin/sh
# Migrate, then serve. drizzle-kit migrate is idempotent (applied migrations
# are tracked in drizzle.__drizzle_migrations and skipped), so every boot runs
# it and the server only accepts traffic once the schema is current. A failed
# migration exits non-zero and the container stops instead of serving against
# a half-migrated database.
set -e

echo "Applying database migrations..."
bun run db:migrate:drizzle

echo "Starting server..."
exec bun run start
