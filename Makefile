.PHONY: help install dev build start format lint typecheck check test start-db stop-db restart-db status migrate-create migrate-up db-reset seed setup clean

help:
	@echo "Colosseum - Development Commands"
	@echo ""
	@echo "Setup Commands:"
	@echo "  make setup               Complete local dev setup (install deps, start Postgres)"
	@echo ""
	@echo "Development Commands:"
	@echo "  make dev                 Start Next.js development server"
	@echo "  make build               Build the production bundle"
	@echo "  make start               Start the production server"
	@echo "  make start-db            Start the local Postgres (compose db service)"
	@echo "  make stop-db             Stop it (data persists)"
	@echo "  make restart-db          Restart it"
	@echo ""
	@echo "Quality Commands (run before committing):"
	@echo "  make format              Format code with oxfmt"
	@echo "  make lint                Lint with oxlint"
	@echo "  make typecheck           Type-check with tsc"
	@echo "  make check               format + lint + typecheck"
	@echo "  make test                Run the bun test suite (needs a running DB)"
	@echo ""
	@echo "Database Commands:"
	@echo "  make migrate-create      Generate a Drizzle migration from lib/db/schema.ts"
	@echo "  make migrate-up          Apply pending Drizzle migrations"
	@echo "  make db-reset            Recreate DB, apply migrations, and seed fixtures"
	@echo "  make seed                Load deterministic dev/test fixtures"
	@echo ""
	@echo "Utility Commands:"
	@echo "  make install             Install dependencies only"
	@echo "  make status              Show local Postgres status"
	@echo "  make clean               Remove build + cache artifacts"
	@echo ""

install:
	@echo "Installing dependencies..."
	bun install
	@echo "✓ Dependencies installed"

dev:
	@echo "Starting Next.js development server..."
	bun run dev

build:
	@echo "Building production bundle..."
	bun run build
	@echo "✓ Build complete"

start:
	@echo "Starting production server..."
	bun run start

format:
	@echo "Formatting code..."
	bun run format
	@echo "✓ Code formatted"

lint:
	@echo "Linting..."
	bun run lint
	@echo "✓ Lint passed"

typecheck:
	@echo "Type checking..."
	bun run typecheck
	@echo "✓ Type check passed"

check: format lint typecheck
	@echo ""
	@echo "✓ All checks passed"

test:
	@echo "Running tests..."
	bun run test
	@echo "✓ Tests passed"

start-db:
	@echo "Starting local Postgres..."
	bun run db:start
	@echo "✓ Postgres running at postgresql://postgres:postgres@127.0.0.1:54322/postgres"

stop-db:
	@echo "Stopping local Postgres..."
	bun run db:stop
	@echo "✓ Postgres stopped"

restart-db: stop-db start-db

status:
	@echo "Checking services..."
	bun run db:status

migrate-create:
	@read -p "Enter migration name: " name; \
	bun run db:generate --name $$name

migrate-up:
	@echo "Applying migrations..."
	bun run db:migrate:drizzle
	@echo "✓ Migrations applied"

db-reset:
	@echo "Resetting database (Drizzle owns the schema)..."
	bun run db:reset
	bun run db:migrate:drizzle
	bun run db:seed
	@echo "✓ Database reset and seeded"

seed:
	@echo "Seeding fixtures..."
	bun run db:seed
	@echo "✓ Fixtures seeded"

setup: install start-db
	@echo ""
	@echo "✓ Setup complete!"
	@echo ""
	@echo "Next steps:"
	@echo "  1. Copy .env.example to .env.local and verify credentials"
	@echo "  2. Run 'make dev' to start the Next.js server"
	@echo "  3. Visit http://localhost:3000"

clean:
	@echo "Cleaning up build + cache artifacts..."
	rm -rf .next node_modules/.cache
	@echo "✓ Cache cleaned"
