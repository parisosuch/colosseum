<a href="https://demo-nextjs-with-supabase.vercel.app/">
  <img alt="Next.js and Supabase Starter Kit - the fastest way to build apps with Next.js and Supabase" src="https://demo-nextjs-with-supabase.vercel.app/opengraph-image.png">
  <h1 align="center">Next.js and Supabase Starter Kit</h1>
</a>

<p align="center">
 The fastest way to build apps with Next.js and Supabase
</p>

<p align="center">
  <a href="#features"><strong>Features</strong></a> ·
  <a href="#demo"><strong>Demo</strong></a> ·
  <a href="#deploy-to-vercel"><strong>Deploy to Vercel</strong></a> ·
  <a href="#clone-and-run-locally"><strong>Clone and run locally</strong></a> ·
  <a href="#feedback-and-issues"><strong>Feedback and issues</strong></a>
  <a href="#more-supabase-examples"><strong>More Examples</strong></a>
</p>
<br/>

## Local development (Supabase in Docker)

This project runs against a full Supabase stack in Docker, managed by the
[Supabase CLI](https://supabase.com/docs/guides/local-development) (already a
dev dependency). Everything lives under [`supabase/`](./supabase): the stack
config (`config.toml`), the schema (`migrations/`), and seed data (`seed.sql`).

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) running (on WSL: `sudo service docker start`)
- [Bun](https://bun.sh)

### First-time setup

```bash
bun install
cp .env.example .env.local      # local Supabase keys (safe defaults)

bun run db:start                # boots the Docker stack + applies migrations + seed
bun run dev                     # http://localhost:3000
```

`db:start` prints the local URLs and keys. They match `.env.example`'s defaults,
but if your CLI emits different keys, copy them into `.env.local` (run
`bun run db:status` to see them again).

| Service          | URL                                                     |
| ---------------- | ------------------------------------------------------- |
| API              | http://127.0.0.1:54321                                  |
| Studio (web UI)  | http://127.0.0.1:54323                                  |
| Postgres         | postgresql://postgres:postgres@127.0.0.1:54322/postgres |
| Inbucket (email) | http://127.0.0.1:54324                                  |

The seed creates a confirmed test login (email confirmations are off locally):

- **email:** `test@example.com`
- **password:** `password123`

### Everyday commands

```bash
bun run db:start                # start the stack
bun run db:stop                 # stop it (data persists)
bun run db:status               # show URLs + keys
bun run db:reset                # wipe + re-run all migrations + seed
bun run db:migration <name>     # scaffold a new migration in supabase/migrations
```

### Changing the schema

Add SQL to a new migration (`bun run db:migration <name>`), then `bun run db:reset`
to apply it from scratch. The current schema in `migrations/` was reconstructed
from the data-access layer (`lib/colosseum/*`) — see the header comment in the
init migration for the assumptions made about RLS and constraints.

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
  `supabase stop --no-backup` to discard it). `db:reset` drops the database and
  re-runs every migration + the seed.

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

### Seed screenshots (puppeteer / Chromium)

The seeded URL columns render real screenshots of the linked sites. Those
images live in `supabase/seed-screenshots/` and are uploaded into the local
`screenshots` bucket on `db:reset` (via `objects_path` in `config.toml`).

Regenerate them with:

```bash
bun run db:seed:screenshots   # captures the URLs in scripts/generate-seed-screenshots.ts
bun run db:reset              # loads the new images into local storage
```

This uses the **same** capture code as the runtime screenshot route
(`captureWebsiteScreenshot` in `lib/colosseum/screenshot.ts`), which drives
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

## Features

- Works across the entire [Next.js](https://nextjs.org) stack
  - App Router
  - Pages Router
  - Middleware
  - Client
  - Server
  - It just works!
- supabase-ssr. A package to configure Supabase Auth to use cookies
- Password-based authentication block installed via the [Supabase UI Library](https://supabase.com/ui/docs/nextjs/password-based-auth)
- Styling with [Tailwind CSS](https://tailwindcss.com)
- Components with [shadcn/ui](https://ui.shadcn.com/)
- Optional deployment with [Supabase Vercel Integration and Vercel deploy](#deploy-your-own)
  - Environment variables automatically assigned to Vercel project

## Demo

You can view a fully working demo at [demo-nextjs-with-supabase.vercel.app](https://demo-nextjs-with-supabase.vercel.app/).

## Deploy to Vercel

Vercel deployment will guide you through creating a Supabase account and project.

After installation of the Supabase integration, all relevant environment variables will be assigned to the project so the deployment is fully functioning.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fvercel%2Fnext.js%2Ftree%2Fcanary%2Fexamples%2Fwith-supabase&project-name=nextjs-with-supabase&repository-name=nextjs-with-supabase&demo-title=nextjs-with-supabase&demo-description=This+starter+configures+Supabase+Auth+to+use+cookies%2C+making+the+user%27s+session+available+throughout+the+entire+Next.js+app+-+Client+Components%2C+Server+Components%2C+Route+Handlers%2C+Server+Actions+and+Middleware.&demo-url=https%3A%2F%2Fdemo-nextjs-with-supabase.vercel.app%2F&external-id=https%3A%2F%2Fgithub.com%2Fvercel%2Fnext.js%2Ftree%2Fcanary%2Fexamples%2Fwith-supabase&demo-image=https%3A%2F%2Fdemo-nextjs-with-supabase.vercel.app%2Fopengraph-image.png)

The above will also clone the Starter kit to your GitHub, you can clone that locally and develop locally.

If you wish to just develop locally and not deploy to Vercel, [follow the steps below](#clone-and-run-locally).

## Clone and run locally

1. You'll first need a Supabase project which can be made [via the Supabase dashboard](https://database.new)

2. Create a Next.js app using the Supabase Starter template npx command

   ```bash
   npx create-next-app --example with-supabase with-supabase-app
   ```

   ```bash
   yarn create next-app --example with-supabase with-supabase-app
   ```

   ```bash
   pnpm create next-app --example with-supabase with-supabase-app
   ```

3. Use `cd` to change into the app's directory

   ```bash
   cd with-supabase-app
   ```

4. Rename `.env.example` to `.env.local` and update the following:

   ```
   NEXT_PUBLIC_SUPABASE_URL=[INSERT SUPABASE PROJECT URL]
   NEXT_PUBLIC_SUPABASE_ANON_KEY=[INSERT SUPABASE PROJECT API ANON KEY]
   ```

   Both `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` can be found in [your Supabase project's API settings](https://supabase.com/dashboard/project/_?showConnect=true)

5. You can now run the Next.js local development server:

   ```bash
   npm run dev
   ```

   The starter kit should now be running on [localhost:3000](http://localhost:3000/).

6. This template comes with the default shadcn/ui style initialized. If you instead want other ui.shadcn styles, delete `components.json` and [re-install shadcn/ui](https://ui.shadcn.com/docs/installation/next)

> Check out [the docs for Local Development](https://supabase.com/docs/guides/getting-started/local-development) to also run Supabase locally.

## Feedback and issues

Please file feedback and issues over on the [Supabase GitHub org](https://github.com/supabase/supabase/issues/new/choose).

## More Supabase examples

- [Next.js Subscription Payments Starter](https://github.com/vercel/nextjs-subscription-payments)
- [Cookie-based Auth and the Next.js 13 App Router (free course)](https://youtube.com/playlist?list=PL5S4mPUpp4OtMhpnp93EFSo42iQ40XjbF)
- [Supabase Auth and the Next.js App Router](https://github.com/supabase/supabase/tree/master/examples/auth/nextjs)
