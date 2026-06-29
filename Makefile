.PHONY: help install dev build start format lint typecheck check start-supabase stop-supabase restart-supabase status migrate-create migrate-up db-reset db-seed setup clean

help:
	@echo "Colosseum - Development Commands"
	@echo ""
	@echo "Setup Commands:"
	@echo "  make setup               Complete local dev setup (install deps, start Supabase)"
	@echo ""
	@echo "Development Commands:"
	@echo "  make dev                 Start Next.js development server"
	@echo "  make build               Build the production bundle"
	@echo "  make start               Start the production server"
	@echo "  make start-supabase      Start local Supabase stack"
	@echo "  make stop-supabase       Stop local Supabase stack"
	@echo "  make restart-supabase    Restart local Supabase stack"
	@echo ""
	@echo "Quality Commands (run before committing):"
	@echo "  make format              Format code with oxfmt"
	@echo "  make lint                Lint with oxlint"
	@echo "  make typecheck           Type-check with tsc"
	@echo "  make check               format + lint + typecheck"
	@echo ""
	@echo "Database Commands:"
	@echo "  make migrate-create      Create a new database migration"
	@echo "  make migrate-up          Apply pending migrations"
	@echo "  make db-reset            Recreate DB, apply all migrations + seed"
	@echo "  make db-seed             Generate seed screenshots"
	@echo ""
	@echo "Utility Commands:"
	@echo "  make install             Install dependencies only"
	@echo "  make status              Show Supabase service status"
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

start-supabase:
	@echo "Starting Supabase local stack..."
	bun run db:start
	@echo "✓ Supabase running"
	@echo ""
	@echo "Access points:"
	@echo "  Studio: http://127.0.0.1:54323"
	@echo "  API:    http://127.0.0.1:54321"
	@echo "  DB:     postgresql://postgres:postgres@127.0.0.1:54322/postgres"

stop-supabase:
	@echo "Stopping Supabase..."
	bun run db:stop
	@echo "✓ Supabase stopped"

restart-supabase: stop-supabase start-supabase

status:
	@echo "Checking services..."
	bun run db:status

migrate-create:
	@read -p "Enter migration name: " name; \
	bun run db:migration $$name

migrate-up:
	@echo "Applying migrations..."
	bun run db:migrate
	@echo "✓ Migrations applied"

db-reset:
	@echo "Resetting database (migrations + seed)..."
	bun run db:reset
	@echo "✓ Database reset"

db-seed:
	@echo "Generating seed screenshots..."
	bun run db:seed:screenshots
	@echo "✓ Seed screenshots generated"

setup: install start-supabase
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
