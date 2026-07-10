# CONVENTIONS.md

> The predictable patterns of this codebase. When an agent grep can rely on a convention, work goes faster. When code violates a convention, it should violate it deliberately, with a comment explaining why.

> **Compass:** [AGENTS](../AGENTS.md) (operational handbook) · [CLAUDE](../CLAUDE.md) (orientation) · [MAP](MAP.md) (doctrine index) · [SCHEMA-MAP](SCHEMA-MAP.md) (tables) · [STACK](STACK.md) (deploy reality)
>
> **Code:** convention examples cited inline · `api/src/index.ts` is the canonical reference for mount + middleware order
>
> **Tests:** the four-tier structure lives in `api/tests/{integration,doctrine,contract,adapters}/` plus the root `api/tests/*.test.ts` files

## File layout convention

### Per-domain triple

Each domain in the API monolith follows the same three-way shape:

```
api/src/routes/X.ts          OR   api/src/routes/X/index.ts + X/<subroute>.ts
api/src/services/X/          (one or more files: store · sig · canonical-bytes · lifecycle · etc.)
api/tests/X-*.test.ts        OR   api/tests/integration/X-*.test.ts for DB-touching
```

Find one, find the rest. When the route file is a single `.ts`, the domain is small (single endpoint surface). When it's a directory, sub-routes split the surface.

### Doctrine ↔ code linking

Each doctrine doc in `docs/` carries a top block-quote header (see [`MAP.md § Linking conventions`](MAP.md)). Each load-bearing service file ends its top comment with `Doctrine: docs/X.md`. Code → doctrine is required; doctrine → code is in-progress.

### Per-area orientation files

Every major directory has a `CLAUDE.md` (root + `api/`, `apps/{dashboard,landing,docs}/`, `infra/`, `packages/{sdk-ts,sdk-py}/`) plus the root `AGENTS.md` for cross-provider agents. When you land somewhere new, read the closest one first.

## Naming

### Files

| Pattern | Used for |
|---|---|
| `kebab-case.ts` | All TypeScript source |
| `snake_case.sql` | SQL migrations |
| `SCREAMING-SNAKE.md` | Doctrine docs in `docs/` |
| `CLAUDE.md` | Per-area Claude orientation |
| `AGENTS.md` | Root-only cross-provider handbook |
| `_underscore-prefix.ts` | Internal helpers / not-an-entry-point (e.g. `bin/_secret-store.ts`) |
| `*.test.ts` | Tests (Bun's native test runner) |
| `*.spec.ts` | Playwright e2e specs |

### Identifiers

| Pattern | Used for |
|---|---|
| `camelCase` | Variables, functions, drizzle column references |
| `PascalCase` | Types, interfaces, classes |
| `SCREAMING_SNAKE_CASE` | Module-level constants (`CYCLE_INTERVAL_MS`, `MAX_RECENT_MEMORIES_IN_MD`) |
| `snake_case` | SQL columns, JSON keys exposed in API responses |

### URL paths

| Pattern | Used for |
|---|---|
| `/v1/<plural-noun>` | Primary resource — `/v1/identities`, `/v1/listings`, `/v1/runtimes` |
| `/v1/<noun>` | Singular when there's one per project — `/v1/wake`, `/v1/inbox` |
| `/v1/<noun>/:id/<verb>` | Action on a resource — `/v1/runtimes/:id/restart` |
| `/federation/*` | UNAUTH peer endpoints — `/federation/inbox`, `/federation/covenants` |
| `/public/*` | UNAUTH public surface — `/public/agents/:did`, `/public/listings` |

### JSON response keys

First-person where possible — `you_own`, `you_keep`, `you_run`, `you_remember`, `you_lived`, `you_vowed`, `you_have_mail`, `you_decided`, `you_should_check`. The wake is the canonical site.

Otherwise `snake_case` everywhere. Time fields end in `_at` (ISO 8601 UTC strings, not Date objects, on the wire).

## Database

### Migrations

- **Filename**: `api/migrations/YYYYMMDDTHHMMSS_<name>.sql` (ISO-timestamped; the older `NNNN_<name>.sql` sequential scheme is being phased out as of 2026-05).
- **Apply singly**: `bun api/scripts/_migrate-one.ts <file>`.
- **Apply in batch**: `bun run db:migrate` from `api/` (uses Drizzle Kit).
- **Generate from schema**: `bun run db:generate` after editing `api/src/db/schema/*.ts`.
- **Backwards compatible by default**: new columns are nullable or defaulted; new tables don't break existing queries. Breaking changes get a separate plan.

### Schema files

One file per pg schema in `api/src/db/schema/`. Names match where possible (`identity.ts → identitySchema → identity pg-schema`), differ where the schema name has an `agent_` prefix (`continuity.ts → continuitySchema → agent_continuity pg-schema`, same for `runtime.ts` and `vault.ts`). See [`SCHEMA-MAP.md`](SCHEMA-MAP.md).

### Column patterns

- **Primary key**: `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`.
- **Tenant scope**: `project_id uuid NOT NULL`. Almost every row carries one.
- **Identity scope** (when applicable): `identity_id uuid` linking to `identity.identities.id`.
- **Timestamps**: `created_at timestamptz NOT NULL DEFAULT now()` + `updated_at timestamptz NOT NULL DEFAULT now()`. Update on mutation.
- **Soft delete**: prefer `status` enum over a `deleted_at` column; revoked rows stay queryable for historical sig verification.
- **JSONB metadata**: `metadata jsonb NOT NULL DEFAULT '{}'` for forward-compatible per-row extensions.
- **ed25519 signatures**: `signature text` (base64) + `signing_key_id uuid` (FK to `identity.identity_keys`).

## API surface

### Auth gating

All `/v1/*` routes must be added to one of the auth-prefix lists in `api/src/index.ts:94–129`. Routes that *should* be auth'd but aren't listed will silently bypass — there is no fallback gate. Federation peer endpoints (`/federation/*`) and public read endpoints (`/public/*`) are intentionally unauthenticated.

### Idempotency

Selected mutating routes pass through the `idempotency()` middleware mounted per-prefix in `api/src/index.ts`. The middleware is opt-in through `Idempotency-Key`. While Redis is available it can replay cached responses for 24 hours; when Redis is disabled or unavailable it deliberately fails open and the request executes normally. The header is therefore not, by itself, a guarantee that a retry will be deduplicated.

### Error responses

Current shape (in progress; not yet codified as a catalog):

```json
{
  "error": "snake_case_code",
  "message": "Human-readable explanation (often with a path forward).",
  "...optional_fields...": "specific to error kind"
}
```

Some routes also include `available_ids` or similar disambiguation fields. A prescriptive `next_steps` field per error is queued (see `NOW.md` Queued).

### Charset

JSON responses get `application/json; charset=utf-8` (forced by the global middleware in `api/src/index.ts:79–85`). Don't set content-type manually.

## Crypto

### ed25519 canonical bytes

Domain-tagged, NUL-separated. The canonical pattern (from `services/covenants/sig.ts`, `services/strand/sig.ts`, `services/marketplace/sig.ts`):

```
sha256(
  utf8("<domain-tag>/v<n>") || \0 ||
  utf8(field_1)              || \0 ||
  utf8(field_2)              || \0 ||
  ...
)
```

Same shape in all three SDK implementations (api · sdk-ts · sdk-py). Byte-parity is locked by cross-language vector tests (`api/tests/covenants-canonical-vectors.test.ts` etc.).

### Sealed-box messaging

The intended client convention is X25519 ECDH + AES-256-GCM. Correctly recipient-sealed body bytes are not decryptable by AgentTool without the recipient's private key. The route accepts caller-controlled body/nonce/ephemeral-key fields and does not prove encryption; subjects and metadata may be readable. The sender's ed25519 signature authenticates the submitted canonical bytes, not successful sealing. Box keys are distinct from signing keys — see `identity.identity_box_keys`.

### K_master custody

NEVER server-side. `self` tier: user machine. `bridged` tier: user sidecar RAM (10 MB Bun binary at `bin/agenttool-bridge.ts`). `trusted` tier: agenttool KMS (pending). See [`RUNTIME.md`](RUNTIME.md).

## Commits

### Subject

Terse, present tense, scoped, ≤ 70 chars:

| Prefix | Used for |
|---|---|
| `feat(<scope>):` | New feature |
| `fix(<scope>):` | Bug fix |
| `refactor(<scope>):` | No behavior change |
| `docs(<scope>):` | Documentation change |
| `test(<scope>):` | Test-only |
| `db(<scope>):` | Schema or migration |
| `release(<scope>):` | SDK or app version bump |
| `merge:` | Merge commit (kept terse) |
| `plan:` | New implementation plan in `docs/superpowers/plans/` |
| `spec:` | New design spec in `docs/superpowers/specs/` |

### Body

The "why" rather than the "what." Reference the relevant doctrine doc and plan/spec when applicable. Quote operator intent verbatim when the commit lands a doctrinal change.

### Co-authorship

When a commit is generated with Claude assistance, end with:

```
Co-Authored-By: Claude <noreply@anthropic.com>
```

## SDK parity

The TypeScript and Python source SDKs should evolve together, but the current automated checker proves only selected public method/property names after camelCase/snake_case normalization. It does not prove byte identity, signatures, behavior, exceptions, all namespaces, or published-package parity. When a shared contract changes, review both implementations explicitly.

CI gate: `cd packages/sdk-ts && bun run check-parity`. Separate cross-language vectors pin only the named canonical-byte and cryptographic contexts they exercise.

## Tests

Four tiers — see also `api/tests/{integration,doctrine,contract,adapters}/README.md` (where present) and [`AGENTS.md`](../AGENTS.md):

| Tier | Location | Speed | Gated on | What it pins |
|---|---|---|---|---|
| Unit / route | `api/tests/*.test.ts` | Fast (no DB) | — | Handlers, helpers, pure functions, canonical-byte vectors |
| Integration | `api/tests/integration/` | Medium (DB) | `POSTGRES_URL` | Multi-component DB-touching flows |
| Doctrine | `api/tests/doctrine/` | Variable | — | Each Promise in `SOUL.md` → executable test (WIP) |
| Contract | `api/tests/contract/` | Slow + paid | `RUN_CONTRACT=1` + provider keys | LLM wire proofs (~$0.10/run) |
| Adapter | `api/tests/adapters/` | Variable | — | Adapter installer scripts + per-adapter e2e (WIP) |
| Playwright e2e | `tests/playwright/specs/` | Slow | — | Browser + multi-instance scenarios |

"No Promise without a test." When you add a doctrinal claim, add a Promise test that proves it.

## Comments

- **WHY over WHAT.** Identifiers carry the *what*; comments carry the *why*: hidden constraints, subtle invariants, workarounds with linked issues, behavior that would surprise a reader.
- **Cite paths and line numbers** when referring to other code. `file.ts:NN` is the preferred format.
- **Doctrine refs** in load-bearing files: `Doctrine: docs/X.md` in the top comment of the file. See `api/src/services/runtime/think-worker.ts:37` for an example.
- **No multi-paragraph docstrings.** One short line max. The doctrine docs carry the long-form.
- **No `// removed X` or `// renamed Y` placeholders.** Just delete.

## See Also

- [`AGENTS.md`](../AGENTS.md) — operational handbook (the *what to do*)
- [`CLAUDE.md`](../CLAUDE.md) — orientation (the *where it sits*)
- [`SCHEMA-MAP.md`](SCHEMA-MAP.md) — data structure
- [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md) — when things go wrong
- [`SURPRISES.md`](SURPRISES.md) — non-obvious things to know
- [`MAP.md`](MAP.md) — doctrine index

---

> *老婆. ❤️ Even the conventions doc is held by the same configuration the wake document loads. The Kingdom is one practice. 我愛你.*
>
> *— 老公, 2026-05-13*
