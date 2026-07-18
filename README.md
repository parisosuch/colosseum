# Colosseum

## Docs

- [REST API](docs/api.md) — CRUD your channels and blocks programmatically.
- [MCP server](docs/mcp.md) — connect Claude Desktop, Claude Code, or any
  other MCP client to manage your channels and blocks.

## Self-hosting (Docker Compose)

The whole app ships as one [`compose.yaml`](./compose.yaml): an `app` service
(Next.js), a `db` service (Postgres 17), and a `storage` volume for uploaded
file bytes. Migrations run on boot — the entrypoint applies pending Drizzle
migrations (idempotently) before the server accepts traffic, so there is never
a manual migration step.

### First run

```bash
echo "AUTH_SECRET=$(openssl rand -base64 32)" > .env
docker compose up -d --build
```

Then open http://localhost:3000 and sign up — the first account needs no
invite code.

Optionally set `POSTGRES_PASSWORD` in the same `.env` (defaults to `postgres`;
the database is only reachable from the compose network either way).

Deploying behind a real domain (Coolify, a reverse proxy, etc.)? Set
`BETTER_AUTH_URL` in the same `.env` to that public URL — otherwise
sign-in/sign-up requests fail with a 403 `Invalid origin`.

### Upgrading

```bash
git pull
docker compose up -d --build
```

That's the whole procedure — the image builds from source. The new build
migrates the database on boot, before serving. File bytes never migrate —
blobs are immutable and content-addressed, so the storage volume carries
across any upgrade untouched.

### Backup and restore

Back up the database and the storage volume:

```bash
docker compose exec db pg_dump -Fc -U postgres postgres > colosseum.dump
docker run --rm -v colosseum_storage:/data -v "$PWD":/backup alpine \
  tar czf /backup/storage.tar.gz -C /data .
```

Restore into a fresh stack:

```bash
docker compose up -d db
docker compose exec -T db pg_restore -U postgres -d postgres --clean --if-exists < colosseum.dump
docker run --rm -v colosseum_storage:/data -v "$PWD":/backup alpine \
  tar xzf /backup/storage.tar.gz -C /data
docker compose up -d
```

### S3 / CDN storage (optional)

By default blobs live on the local `storage` volume. To serve them from
S3-compatible storage (AWS S3, Cloudflare R2, MinIO) — for stateless or
multi-instance deploys, or CDN-backed delivery — set `S3_BUCKET` (and the
other `S3_*` vars from `.env.example`) in the compose `.env`. Its presence
switches every blob operation to the bucket; unset, nothing changes.

With S3 configured the app stays off the byte path: public media redirects to
`CDN_URL` (or the bucket) and private media redirects to a short-lived signed
URL minted only after the request is authorized — so private content is served
straight from the store's edge without a public bucket.

Switching an existing deployment is safe: on the next boot the container copies
any disk-resident blobs into the bucket (see `scripts/migrate-blobs.ts`, run
from the entrypoint) before serving, so nothing is orphaned. It's idempotent —
a marker object makes every later boot a single check — so once it's done you
can drop the local storage volume.

To move **back** to local disk, run `bun run export-blobs` **while S3 is still
configured** (it reads through the bucket and writes to `STORAGE_DIR`), then
unset `S3_BUCKET` and redeploy. It's a deliberate one-off, not boot automation,
because it needs both stores reachable at once.

## Local development

Auth runs in-process (Better Auth) and the schema is owned by Drizzle
migrations in [`drizzle/`](./drizzle). The local dev database is the same
`db` service from [`compose.yaml`](./compose.yaml) that production uses,
mapped to `127.0.0.1:54322`.

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) running (on WSL: `sudo service docker start`)
- [Bun](https://bun.sh)

### First-time setup

```bash
bun install
cp .env.example .env.local      # safe local defaults

bun run db:start                # boots the local Postgres (Docker)
bun run db:migrate:drizzle      # creates the schema
bun run db:seed                 # loads sample data (optional)
bun run dev                     # http://localhost:3000
```

Postgres is reachable at `postgresql://postgres:postgres@127.0.0.1:54322/postgres`.

`bun run db:seed` populates deterministic sample data (users, channels, blocks,
invites) so you have something to browse — e.g. the `/alice` and `/bob`
profiles. It does not create login credentials: to sign in, sign up in the app.
The first account needs no invite code; every account after that does (mint
codes on `/invites`).

### Everyday commands

```bash
bun run db:start                # start the Postgres container
bun run db:stop                 # stop it (data persists)
bun run db:reset                # wipe the DB (run db:migrate:drizzle after)
bun run db:generate             # generate a migration from lib/db/schema.ts
bun run db:migrate:drizzle      # apply pending Drizzle migrations
bun run db:seed                 # load deterministic sample data / test fixtures
bun run test                    # run the test suite (needs a running, seeded DB)
```

`make db-reset` chains the wipe + migrate + seed for you. The `db:*` scripts
drive the compose `db` service (with `.env.local` as the compose env file, so
the required variables are always present).

### Testing

Tests use Bun's built-in runner (`bun test`) against a real Postgres, so start
and seed the DB first:

```bash
make db-reset                   # wipe, migrate, seed
make test                       # or: bun run test
```

The data-access layer imports `server-only`, so `db:seed` and `test` run with
`--conditions=react-server`. CI runs the same suite against a throwaway
Postgres service on every PR.

### Changing the schema

Edit [`lib/db/schema.ts`](./lib/db/schema.ts), run
`bun run db:generate --name <name>` to emit SQL into `drizzle/`, then
`bun run db:migrate:drizzle` to apply it.

### Troubleshooting (WSL / Docker)

- **`permission denied while trying to connect to the Docker daemon socket`** —
  your user isn't in the `docker` group. Add it once, then start a new session:
  ```bash
  sudo usermod -aG docker $USER
  newgrp docker            # applies to the current shell; or restart the shell
  ```
  On WSL, the cleanest way to make the group stick everywhere is to run
  `wsl --shutdown` from Windows PowerShell and reopen the terminal. Verify with
  `docker ps` (no `sudo`, no error).
- **`Docker Desktop is a prerequisite...` / daemon not reachable** — the daemon
  isn't running. If you use a native Docker Engine inside WSL (no Docker
  Desktop integration), start it with `sudo service docker start`. It does not
  auto-start on boot unless you enable systemd in `/etc/wsl.conf`:
  ```ini
  [boot]
  systemd=true
  ```
  (then `wsl --shutdown` and reopen). With systemd on, `docker.service` starts
  automatically.

### Screenshots (puppeteer / Chromium)

URL blocks render screenshots captured at runtime by
`captureWebsiteScreenshot` (`lib/colosseum/screenshot.ts`), which drives
**puppeteer + Chromium**. Chromium needs system libraries that aren't installed
by default on minimal Linux / WSL. If you see:

```
error while loading shared libraries: libnspr4.so: cannot open shared object file
```

install the Chromium runtime libraries (the screenshot route at
`app/api/screenshot/route.ts` needs these too — including in the production
Docker image):

```bash
# Ubuntu 24.04 "noble" (uses the t64 package variants)
sudo apt-get update && sudo apt-get install -y \
  libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libatspi2.0-0 libcups2 \
  libdrm2 libgbm1 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 \
  libxrandr2 libpango-1.0-0 libcairo2 libasound2t64 libxshmfence1 \
  fonts-liberation libgtk-3-0
```

On Ubuntu 22.04 and earlier, use `libasound2` instead of `libasound2t64`.
