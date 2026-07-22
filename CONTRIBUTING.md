# Contributing to Colosseum

Thanks for your interest in improving Colosseum! This guide covers how to get a
development environment running and what we expect in a pull request.

## Getting started

Prerequisites and full setup steps live in the [README](./README.md#local-development).
Common tasks are wrapped by the [`Makefile`](./Makefile) — run `make help` to
see everything. The short version:

```bash
make setup                      # install deps + start the local Postgres (Docker)
cp .env.example .env.local      # safe local defaults
make migrate-up                 # create the schema
make seed                       # load sample data (optional)
make dev                        # http://localhost:3000
```

Every `make` target just wraps a `bun run` script, so you can run the
underlying command directly if you prefer (e.g. `bun run dev`).

## Branching and pull requests

- **Fork the repo** (or, for maintainers, branch directly) and base your work on
  the **`next`** branch — that's where features and fixes land.
  - **Hotfixes** (urgent production fixes) target **`main`** instead.
  - Releases are cut by maintainers, who merge `next`/release branches into
    `main` and tag `vX.Y.Z`.
- Keep each PR focused on a single change; smaller PRs are easier to review.
- PRs are **squash-merged**, so the PR title becomes the commit subject. Don't
  put the issue number in the title — reference it in the PR description (e.g.
  "Closes #123"), and the squash commit links the PR automatically.
- **Don't bump `version` in `package.json`.** Versioning happens at release
  time, not in feature/fix PRs.

## Commit messages

We use [Conventional Commits](https://www.conventionalcommits.org/): `feat:`,
`fix:`, `docs:`, `chore:`, `refactor:`, `test:`, etc. Example:

```
feat: add Spotify block embedding
```

## Before you push

Run the full check suite — CI runs the same commands and fails on any of them:

```bash
make check            # format + lint + typecheck (oxfmt, oxlint, tsc)
```

`make format` auto-formats; CI's `format:check` does **not** auto-fix, so run
`make check` (or `make format`) before pushing or CI will reject unformatted
code. The individual steps are also available as `make format`, `make lint`,
and `make typecheck`.

### Tests

Tests run with Bun's built-in runner against a real Postgres, so start and seed
the database first:

```bash
make db-reset         # wipe, migrate, seed
make test
```

Add or update tests when you change behavior in the data-access layer
(`lib/colosseum/`). Tests are colocated `*.test.ts` files and share the seed
fixtures from `scripts/seed.ts`.

## Reporting bugs and requesting features

Open an issue using the templates under
[`.github/ISSUE_TEMPLATE`](./.github/ISSUE_TEMPLATE). For security issues, do
**not** open a public issue — see [SECURITY.md](./SECURITY.md).

## Code of Conduct

This project follows a [Code of Conduct](./CODE_OF_CONDUCT.md). By
participating, you agree to uphold it.
