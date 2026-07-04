# Colosseum

An Are.na-style app: users collect **blocks** into **channels**, organized as
columns. Next.js (App Router) + Postgres via Drizzle + Better Auth.

## Stack

- **Next.js 15** App Router, React, TypeScript
- **Postgres** via **Drizzle** (`lib/db/`); migrations in `drizzle/`;
  authorization enforced in app code (the connection bypasses RLS)
- **Better Auth** in-process (`lib/auth.ts`, client `lib/auth-client.ts`)
- Local dev Postgres is the compose `db` service (`make start-db`)
- **Tailwind** + Radix UI primitives
- **Bun** as package manager and script runner
- **oxlint** / **oxfmt** for lint + format

## Commands

Use `bun`, never `npm`. A `Makefile` wraps the common ones:

- `make dev` — start the dev server (`bun run dev`)
- `make check` — format + lint + typecheck (run before committing)
- `make test` — run the `bun test` suite (needs a running, seeded DB)
- `make start-db` / `make stop-db` — local Postgres (compose `db` service)
- `make db-reset` — recreate DB, apply migrations, and seed fixtures
- `make seed` — load deterministic dev/test fixtures (`bun run db:seed`)
- `make help` — list everything

## Git

- **Conventional Commits** (`feat:`, `fix:`, `docs:`, `chore:`, etc.).
- **Branch off `main`** for every change; open a PR back into `main`.
- PRs are **squash-merged**, so don't put the issue number in the commit
  subject — reference the issue in the PR description instead (the squash
  commit links the PR automatically).
- **Before pushing, run `make check`** (format + lint + typecheck). CI runs
  `bun run lint`, `bun run format:check`, and `bun run typecheck` and fails on
  any of them — `format:check` does not auto-fix, so run `bun run format`
  (or `make check`) first or CI will reject the unformatted code.
- **1.0.0 is released.** Do **not** bump `version` in `package.json` in a
  feature/fix PR — leave it untouched. The version is bumped (semver) and the
  release commit tagged `vX.Y.Z` only at release time, when a batch of merged
  changes ships.

## Conventions

- **Never co-author commits or PRs.** Do not add `Co-Authored-By:` trailers or
  "Generated with Claude Code" footers to commit messages or PR bodies.
- Keep issue/PR numbers (`#nn`) out of source comments. They're fine in PR
  descriptions.
- Data access lives in `lib/colosseum/` (e.g. `user.ts`, `channel.ts`,
  `column.ts`). Lookups that may legitimately miss return `null`; callers
  treat that as not-found, not an error.
- Pages render not-found states inline rather than throwing.
- Tests are colocated `*.test.ts` files run with `bun test`. The data layer's
  tests hit a real Postgres and set up via `seed()` from `scripts/seed.ts`
  (`beforeAll`), so keep the seed and its exported fixture constants the single
  source of test data. Because the data layer imports `server-only`, `db:seed`
  and `test` run with `--conditions=react-server`.
