#!/bin/sh
# Migrate, then serve. drizzle-kit migrate is idempotent (applied migrations
# are tracked in drizzle.__drizzle_migrations and skipped), so every boot runs
# it and the server only accepts traffic once the schema is current. A failed
# migration exits non-zero and the container stops instead of serving against
# a half-migrated database.
set -e

echo "Applying database migrations..."
bun run db:migrate:drizzle

# Backfill thumbnails for existing image blobs. Idempotent (one stat per image,
# skips ones already generated), so it's safe to run every boot alongside the
# schema migration. Non-fatal: thumbnails also generate lazily on first request,
# so a failure here must not stop the server from booting.
echo "Backfilling image thumbnails..."
bun run backfill-thumbnails || echo "warning: thumbnail backfill failed; they'll generate lazily on request"

echo "Starting server..."
exec bun run start
