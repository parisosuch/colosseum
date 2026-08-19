#!/bin/sh
# Migrate, then serve. drizzle-kit migrate is idempotent (applied migrations
# are tracked in drizzle.__drizzle_migrations and skipped), so every boot runs
# it and the server only accepts traffic once the schema is current. A failed
# migration exits non-zero and the container stops instead of serving against
# a half-migrated database.
set -e

echo "Applying database migrations..."
bun run db:migrate:drizzle

# One-shot data fixes (scripts/data/), tracked in the data_migration ledger the
# same way drizzle tracks schema migrations. Each runs once and is skipped
# thereafter, so a settled deployment costs a single SELECT. Runs after the
# schema migrations so a data fix can rely on its column existing. A migration
# marked `required` exits non-zero here and stops the container; the rest log
# and let the boot continue.
echo "Applying data migrations..."
bun run data:migrate

echo "Starting server..."
exec bun run start
