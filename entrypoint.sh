#!/bin/sh
# Migrate, then serve. drizzle-kit migrate is idempotent (applied migrations
# are tracked in drizzle.__drizzle_migrations and skipped), so every boot runs
# it and the server only accepts traffic once the schema is current. A failed
# migration exits non-zero and the container stops instead of serving against
# a half-migrated database.
set -e

echo "Applying database migrations..."
bun run db:migrate:drizzle

# Copy any disk-resident blobs into the object store when S3 is configured, so
# switching an existing deployment to S3 doesn't orphan its images. No-op (one
# HEAD) once done, and no-op entirely on the local-disk default.
echo "Syncing blobs to object storage..."
bun --conditions=react-server scripts/migrate-blobs.ts

echo "Starting server..."
exec bun run start
