.PHONY: ci verify move-build move-test move-fmt fe-dev fe-build fe-lint fe-test fe-coverage fe-tsc fe-fmt sloc clean

SHELL := /bin/bash
.SHELLFLAGS := -o pipefail -c

CONTRACTS_DIR := contracts
FRONTEND_DIR := frontend

# ─── Aggregate ────────────────────────────────────────────────

# Silent (CI-friendly) — fails fast, minimal output
ci:
	@sui move build --path $(CONTRACTS_DIR) 2>&1 | tail -n 5
	@sui move test --path $(CONTRACTS_DIR) 2>&1 | tail -n 10
	@cd $(FRONTEND_DIR) && pnpm test:coverage --silent
	@cd $(FRONTEND_DIR) && npx tsc --noEmit -p tsconfig.app.json
	@cd $(FRONTEND_DIR) && pnpm lint --quiet
	@sloc-guard -q check

# Verbose — full output for local development
verify: move-build move-test move-fmt fe-coverage fe-tsc fe-lint fe-fmt sloc

# ─── Move Contracts ──────────────────────────────────────────

move-build:
	sui move build --path $(CONTRACTS_DIR)

move-test:
	sui move test --path $(CONTRACTS_DIR)

# Lint-level type check without publishing
move-check:
	sui move build --lint --path $(CONTRACTS_DIR)

move-fmt:
	@echo "move fmt: manual review (no official formatter yet)"

# Dry-run publish to check deployability
move-publish-dry:
	sui client publish --dry-run $(CONTRACTS_DIR)

# ─── Frontend ────────────────────────────────────────────────

fe-dev:
	cd $(FRONTEND_DIR) && pnpm dev

fe-build:
	cd $(FRONTEND_DIR) && pnpm install && pnpm build

fe-test:
	cd $(FRONTEND_DIR) && pnpm test

fe-coverage:
	cd $(FRONTEND_DIR) && pnpm test:coverage

fe-tsc:
	cd $(FRONTEND_DIR) && npx tsc --noEmit -p tsconfig.app.json

fe-lint:
	cd $(FRONTEND_DIR) && pnpm lint

fe-fmt:
	cd $(FRONTEND_DIR) && pnpm format

fe-fmt-check:
	cd $(FRONTEND_DIR) && pnpm format:check

# ─── Utility ─────────────────────────────────────────────────

sloc:
	sloc-guard check

clean:
	rm -rf $(CONTRACTS_DIR)/build $(FRONTEND_DIR)/dist
