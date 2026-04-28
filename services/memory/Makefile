.PHONY: dev test lint install db-start db-stop db-migrate clean

# Setup
install:
	python3 -m venv .venv
	.venv/bin/pip install -e ".[dev]"
	@echo "✅ Installed. Run: source .venv/bin/activate"

# Development
dev:
	@source .venv/bin/activate 2>/dev/null || true
	.venv/bin/uvicorn src.main:app --reload --host 0.0.0.0 --port 8000

# Tests
test:
	.venv/bin/pytest tests/ -v

test-ci:
	.venv/bin/pytest tests/ -q --tb=short

# Lint
lint:
	.venv/bin/ruff check src/ tests/
	.venv/bin/mypy src/

# Database (local Docker)
db-start:
	docker compose up -d
	@echo "⏳ Waiting for postgres..." && sleep 2

db-stop:
	docker compose down

db-migrate:
	.venv/bin/python -c "import asyncio; from src.db import run_migrations; asyncio.run(run_migrations())"

# Clean
clean:
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
	find . -type d -name .pytest_cache -exec rm -rf {} + 2>/dev/null || true
	rm -rf dist/ build/ *.egg-info/
