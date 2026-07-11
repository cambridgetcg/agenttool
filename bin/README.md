# bin/

Operator + agent entry points. Bash + Bun, no compilation step unless noted.

## Compass

- **Up one level:** [`AGENTS.md`](../AGENTS.md) (operational handbook · cross-provider) · [`CLAUDE.md`](../CLAUDE.md) (orientation spine) · [`README.md`](../README.md).
- **Where these compose:** [`docs/RUNTIME.md`](../docs/RUNTIME.md) (bridge + think) · [`docs/STACK.md`](../docs/STACK.md) (deploy/ops) · [`docs/IDENTITY-SEED.md`](../docs/IDENTITY-SEED.md) (mnemonics).
- **Conventions for adding a script:** [`docs/CONVENTIONS.md`](../docs/CONVENTIONS.md).

## Entry points by role

### Agent-side (orchestrator)

| Script | What it does | Doctrine |
|---|---|---|
| `agenttool-bridge.ts` | Sidecar that holds `K_master` locally for hosted orchestrators. Bun-compiled (~10MB headless). Outbound WSS to `/v1/runtimes/:id/bridge` — mutual ed25519 handshake → HKDF session secret → exposes `decrypt`/`encrypt` only, never the key. | [`docs/RUNTIME.md`](../docs/RUNTIME.md) §Bridged tier |
| `agenttool-think.ts` | Orchestrator CLI (Horizon C, Slice 3+4). Drives the think-loop in `self` tier and dev cycles. | [`docs/RUNTIME.md`](../docs/RUNTIME.md) §Think loop |
| `agenttool-seed.ts` | Interactive BIP39 mnemonic management. The seed is the identity. | [`docs/IDENTITY-SEED.md`](../docs/IDENTITY-SEED.md) |
| `agenttool-secret` · `agenttool-rotate` | Vault + key rotation helpers. | [`docs/TOKEN-HYGIENE.md`](../docs/TOKEN-HYGIENE.md) |
| `sign-thought.ts` | Ed25519-sign a thought offline (for `self`-tier custody). | [`docs/STRANDS.md`](../docs/STRANDS.md) |
| `gen-k-master.ts` | Generate `K_master` AES-256 key. One-shot, output to stdout — never persists. | [`docs/STRANDS.md`](../docs/STRANDS.md) |

### Operator-side (platform)

| Script | What it does | Doctrine |
|---|---|---|
| `build-love-packages.ts` | Builds and verifies the fixed `love-package/v1` catalog into an explicit staging directory using clean tracked source, package CI/build scripts, and `bun pm pack`. It does not publish, upload, install dependencies, or read credentials. | [`docs/LOVE-PACKAGE-PROTOCOL.md`](../docs/LOVE-PACKAGE-PROTOCOL.md) |
| `frontend-deploy.sh` | Low-level CF Pages uploader (web · dashboard · docs). Reads CF credentials from macOS keychain and uses exact Wrangler 4.110.0. Use `deploy.sh --no-migrate --no-api` for the normal release gate and receipt. | [`docs/STACK.md`](../docs/STACK.md) §Frontend |
| `migrate.sh` · `migrate.ts` | Apply `api/migrations/*.sql` in numeric/timestamp order. Idempotent — every migration uses `CREATE/ADD ... IF NOT EXISTS`. | [`docs/DEVELOPMENT.md`](../docs/DEVELOPMENT.md) §Migrations |
| `preflight.sh` · `run-test-tier.sh` | Default gate needs no application/service credentials; database, smoke, paid-contract, and known-red diagnostic modes are explicit. Environment sanitation is not an OS network sandbox. | [`api/tests/README.md`](../api/tests/README.md) |
| `deploy.sh` | GitHub-main source gate, migrations, preflight, Fly/Pages release, provenance verification, local JSON receipt, and standalone fast-forward Codeberg mirroring. | [`docs/DEPLOY-PROCEDURE.md`](../docs/DEPLOY-PROCEDURE.md) |
| `smoke-test.sh` | End-to-end smoke against a deployed instance. | — |
| `create-project.ts` | Create a project + identity + wallet + bearer key (operator-side genesis). | [`docs/IDENTITY-ANCHOR.md`](../docs/IDENTITY-ANCHOR.md) |
| `_secret-store.ts` | Internal helper for macOS-keychain credential access. | — |

## File-naming conventions in this dir

- `agenttool-*.ts` — agent-side or operator-side CLI binaries. Each carries a shebang (`#!/usr/bin/env bun`).
- `agenttool-*` (no extension) — bash wrappers for the same.
- `_*.ts` — internal helpers, not direct entry points.
- `*.sh` — operator scripts. Bash + `set -euo pipefail`.

## Conventions

- **Shebangs everywhere.** `#!/usr/bin/env bun` or `#!/usr/bin/env bash` so any script runs as `bin/<name>` from the repo root.
- **No secrets in arguments.** Credentials flow via env, vault, or macOS keychain — never on the command line.
- **K_master never on disk.** `gen-k-master.ts` outputs to stdout; the operator is responsible for placing it.

## See also

- Workers (not scripts — long-running BullMQ): [`api/src/workers/`](../api/src/workers/).
- Deploy semantics: [`docs/STACK.md`](../docs/STACK.md).
- K_master rotation runbook: [`docs/DEVELOPMENT.md`](../docs/DEVELOPMENT.md).
