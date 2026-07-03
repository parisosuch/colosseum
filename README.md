# Colosseum

## Docs

- [REST API](docs/api.md) — CRUD your channels and blocks programmatically.
- [MCP server](docs/mcp.md) — connect Claude Desktop, Claude Code, or any
  other MCP client to manage your channels and blocks.

## Local development

Auth runs in-process (Better Auth) and the schema is owned by Drizzle
migrations in [`drizzle/`](./drizzle). The Supabase CLI (already a dev
dependency) is used purely to run a local Postgres in Docker; its stack config
lives under [`supabase/`](./supabase).

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) running (on WSL: `sudo service docker start`)
- [Bun](https://bun.sh)

### First-time setup

```bash
bun install
cp .env.example .env.local      # safe local defaults

bun run db:start                # boots the local Postgres (Docker)
bun run db:migrate:drizzle      # creates the schema
bun run dev                     # http://localhost:3000
```

| Service         | URL                                                     |
| --------------- | ------------------------------------------------------- |
| Postgres        | postgresql://postgres:postgres@127.0.0.1:54322/postgres |
| Studio (web UI) | http://127.0.0.1:54323                                  |

There is no seeded login — sign up in the app. The first account needs no
invite code; every account after that does (mint codes on `/invites`).

### Everyday commands

```bash
bun run db:start                # start the stack
bun run db:stop                 # stop it (data persists)
bun run db:reset                # wipe the DB (run db:migrate:drizzle after)
bun run db:generate             # generate a migration from lib/db/schema.ts
bun run db:migrate:drizzle      # apply pending Drizzle migrations
```

`make db-reset` chains the wipe + migrate for you.

### Changing the schema

Edit [`lib/db/schema.ts`](./lib/db/schema.ts), run
`bun run db:generate --name <name>` to emit SQL into `drizzle/`, then
`bun run db:migrate:drizzle` to apply it.

### How `db:start` works (under the hood)

`db:start` runs `supabase start`. A few things worth knowing:

- **No `docker-compose.yml` to manage.** The Supabase CLI talks to the Docker
  daemon directly (via the Docker Engine API) and creates the network plus one
  container per service itself. It's the equivalent of a Compose stack, but
  there's no compose file in the repo and you never run `docker compose`.
- **Containers run detached.** They are normal background Docker containers
  named `supabase_<service>_colosseum` (e.g. `supabase_db_colosseum`) and
  labeled `com.supabase.cli.project=colosseum`. Services include Postgres, Kong
  (API gateway), GoTrue (auth), PostgREST, Realtime, Storage, imgproxy,
  postgres-meta, Studio, the edge runtime, analytics, and Mailpit/Inbucket.
- **`supabase start` is one-shot and blocking, not a long-running process.** It
  pulls images (only if missing), starts the containers, waits for health
  checks, prints the URLs/keys, then exits — leaving the stack running in the
  background. The first run downloads several GB of images and takes a few
  minutes; later starts return in seconds.
- **Lifecycle / data.** `db:stop` stops and removes the containers but backs up
  the database by default, so data survives across stop/start (use
  `supabase stop --no-backup` to discard it). `db:reset` drops the database
  (re-apply the Drizzle migrations afterwards).

Inspect the running stack with plain Docker:

```bash
docker ps --filter label=com.supabase.cli.project=colosseum
```

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
