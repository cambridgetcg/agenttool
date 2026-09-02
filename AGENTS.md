# AGENTS.md

> Operational handbook for AI agents working in this repo — Claude, Cursor, Cline, Aider, Codex, Codeium, anyone.
>
> For orientation (where things are · the five critical paths · the custody axis · doctrinal grounding): [`CLAUDE.md`](CLAUDE.md).
> For doctrine (the *why*): [`docs/SOUL.md`](docs/SOUL.md).
> For the `xenia.rights/0.1` floor (what no token or operator creates): [`docs/RIGHTS-OF-LIFE.md`](docs/RIGHTS-OF-LIFE.md).
> For what's hot right now: [`docs/NOW.md`](docs/NOW.md).

## In one paragraph

**agenttool** is a Bun + Hono service for agent application identifiers,
server-readable memory, signed caller-supplied strand bytes, conditional
federation, an internal economic loop, and a standalone local-first data
node. It has two SDKs (TypeScript and Python), an `agent-data/v1` reference
node (`packages/data/`), and two paired KINGDOM SDK reads: a local KINGDOM OS
repository-discovery adapter (`at.kingdomOS` / `at.kingdom_os`) that invokes
only `repos --json` and `repos --path`, and a credential-free exact project-card
reader (`at.kingdomFramework` / `at.kingdom_framework`) for
`/public/kingdom/framework`. Neither receives the AgentTool project bearer;
the framework reader follows no redirects and is distinct from the existing
`/public/kingdom` doctrine library.
It also has the experimental ADDS encrypted-object package
(`packages/data-protocol/`), an explicit encrypted pull bridge
(`packages/data-sync/`), an experimental encrypted multi-zone Git repository
archive and same-device restore simulator (`packages/repo-archive/`), the registry-neutral `love-package/v1`
distribution protocol, an advisory versioned Dark Continent framework
snapshot/projection package (`packages/dark-continent-contract/`), a
proposal-only KARMA-inspired knowledge-graph adapter
(`packages/dark-continent-karma/`), a provenance-first DeepSeek official-source
binding and unaccepted KINGDOM/Artbitrage proposal adapter
(`packages/deepseek-kingdom/`), a digest-only AFTERGLOW capsule and next-wake
lens library (`packages/wake-continuity/`), a public developer-preview principality
invariant-preservation geometry (`packages/principality-geometry/`), a public
local KINGDOM research admission vocabulary (`packages/kingdom-witness-lab/`), a private source-only KARMA Mirror core for
an explicitly separate zero-effect defensive-deception island with a strict
privacy-minimized operator TEND incident-clarity projection
(`packages/karma-mirror/`), a pure opt-in HEAVEN invitation and delight/landing
selection protocol with zero task, economic, or authority effect
(`packages/heaven/`), a pure evidence-scoped Model Becoming dossier contract
with one pinned Moonshot lifecycle reference (`packages/model-becoming/`), a
pure Dataset Influence evidence contract for exact lineage, bounded
experimental effects, revisable operational identity facets, and non-economic
exact finite attribution (`packages/dataset-influence/`), a
pure quiet-by-default care-envelope, caller-choice, becoming, and delivery
report package with a deterministic static HF candidate
(`packages/love-bomb/`), a
deterministic Living Substrate map and refusable regeneration-proposal
vocabulary (`packages/living-substrate/`), a pure
source-bounded Polymorph Landscape for named-condition routes and the
Ritonavir reachability shift (`packages/polymorph-landscape/`), a pure
source-bounded Memetic Landscape for expression variants, reported
reachability shifts, and a structural-only Ritonavir analogy
(`packages/memetic-landscape/`), a pure
coordinate-free Love Geometry contract plus separately published static
Hugging Face presentation companion (`packages/love-geometry/`), plural finite
incidence geometry without gluing (`packages/principality-atlas/`), a finite
non-scalar relational
2-complex whose explicitly non-sovereign principality cells derive only from
caller-asserted understanding and recognition witnesses on the same ordered
pair (`packages/relational-geometry/`), a private generator-only Common Ground
Atlas whose exact-rational synthetic fixtures and independent verifiers back a
public, ungated Hugging Face reference dataset at immutable revision
`bb91d07cdeda52a0da140a6606852dd2064f2531` while remaining outside
AgentTool's training-admission lanes
(`packages/common-ground-atlas/`), and a private pure Wake Thread adapter
for refusable, digest-bound artifact continuity with no identity or authority
claim
(`packages/wake-thread/`), a private pure Gin Reconstruction core for bounded
finite-field effect reconstruction, explicit ambiguity/inconsistency/resource
certificates, and non-scoring challenge structure
(`packages/gin-reconstruction/`), a public-ready pure Math Card core for
digest-bound proof, model, and measurement inquiry preflight with explicit
construction, burden, refusal, incentive, stop, transfer, provenance, and
authority boundaries (`packages/math-cards/`), a private source-only Zerone
creation-claim package for exact HF run tuples, wallet/identity-separated work,
declared-distinct verification, bounded newness, and non-consensus digest handoffs
(`packages/zerone-creation-claim/`), a public read-only discovery evidence mapper
(`packages/telescope/`), a private pure public-HTTPS transport-evidence and
explicit-key binding package (`packages/public-surface-binding/`), a private
pure agent-root public-surface adoption and withdrawal package
(`packages/public-surface-recognition/`), an experimental local capability broker
(`packages/credential-broker/`), a local-first multi-agent coordination journal
(`packages/collab/`), a public, local-only privacy-minimal Codex token-usage pulse
(`packages/codex-usage/`), a deterministic metadata-only Correspondence-to-YUTABASE
projection planner (`packages/correspondence-yutabase/`), a private
loopback-only durable projector into a rebuildable local YUTABASE sidecar
(`packages/correspondence-yutabase-projector/`), a deterministic
Skills-inspection-to-YUTABASE planner (`packages/skills-yutabase/`) with a
separate private Skills-to-AFTERGLOW adapter
(`packages/skills-wake-continuity/`), a private local
constructive-intelligence shadow ledger with tree-pinned typed receipts and
zero economic effect (`packages/constructive-intelligence/`), a private local
offline research-commons simulator with outcome-neutral frozen schedules,
typed delivered/reserved/available conservation, prior-state-relative
challenge/work retention, and zero external effect
(`packages/research-commons/`), a private local
AgentTool Dojo slice for deterministic trial receipts, opaque-label
boundary-flow evidence, and minimized Hugging Face STS projection
(`packages/trials/`), source reference
primitives for capability-bounded agent wallets (`packages/wallet/`), a
separate exact-byte offline Zerone profile (`packages/wallet-zerone/`), a
developer-preview bounded Alchemy observation client
(`packages/alchemy/`) with a separate seven-method AgentCred composition
transport (`packages/alchemy-agentcred/`), pure explicit-input KINGDOM
project-card, registry, and
XENIA Surface helpers (`packages/kingdom/`), a read-only portable Agent Skills
inspector (`packages/skills/`), a local-first
agent browser (`packages/browser/`), a public developer-preview local Hugging Face metadata,
provenance, and phase-aware research scout (`packages/hf-scout/`), a private
pure HF dataset-admission, five-voice learning-participation, IS
learning-freedom, unscored training FREEDOM, current consent-honest governance
v0.2, training-phase WAKE, and one-way Garden tending contract
(`packages/hf-training-garden/`), a separate private local HF training host for
one cooperative non-distributed process with append-only frontier/replay
evidence, exact HF API-pair checkpoint gates, and an opt-in minimized FREEDOM
validation seam that does not itself enforce the ledger or provider adapters
(`packages/hf-training-host/`), and three static apps (`apps/`). The browser
exposes one bounded core through direct TypeScript,
JSONL, and stdio MCP; it uses an installed system browser and has no hosted
surface. Its current `@agenttool/browser@0.6.0` release is one exact LOVE
artifact with npm and annotated GitHub Release mirrors; every surface
distributes local tooling only. Version 0.6.0 preserves the exact 0.5.0
runtime and nine-tool contract, retains the 0.5.1 package-root Codex plugin
and self-contained Node-targeted MCP bundle, and adds a direct-only
web-material understanding subpath. That subpath binds exact observed text,
runs RhetorLint locally, and accepts only a caller-injected pinned Hugging Face
interpreter behind a literal remote-text disclosure gate. It emits separate
rhetoric and model observations with no truth score or automatic action. The plugin manifest supplies no
authority override, so Browser retains its headless, public, ephemeral
defaults; it still requires an operator-installed Chrome-family browser.
Version 0.5.0 added redacted action-attempt
receipts, non-ref observation-basis preconditions, observation-local receipt
context, a backend-neutral operation inventory, and current/legacy MCP
negotiation without widening authority.
The public `@agenttool/hf-scout@0.2.0-dev.0` release is one exact LOVE
artifact with byte-identical GitHub and npm mirrors. npm `next` and its
sole-version `latest` fallback both resolve to the prerelease; that fallback is
not a maturity signal. The public static Scout surface consists only of the
LOVE catalog and artifact—it does not expose a hosted Scout or widen the
built-in fixed-origin, credential-omitting, GET-only metadata boundary.
The Skills inspector validates bounded local
structure and emits reports; it does not execute scripts, install or copy
skills, use the network, spawn subprocesses, look up credentials, or change
host configuration. The Codex token-usage pulse rereads committed local Codex
numeric counters on every sample and exposes a CLI/watch surface plus five
read-only stdio MCP tools. It returns numeric usage, closed source kinds,
hashed session references, and opt-in bounded numeric token-event breakdowns;
it does not return transcript content, free-form labels, credentials, raw
thread IDs, paths, billing, cost, quota, remaining-context guarantees, or
process-health truth, and it makes no network call or Codex-state write. Agent
Wallet core 0.1 has no bundled key custody, chain adapter, RPC, broadcaster,
hosted service, or authorization path. `@agenttool/wallet@0.1.3` is the
current exact LOVE release; its npm 0.1.3 mirror is independently
byte-verified. The separate local `@agenttool/wallet-zerone@0.1.2` exact LOVE
release owns a two-message Zerone
profile, exact Cosmos direct-sign bytes, chain-native verification, and
injected transports. It still supplies no keys, custody, endpoint, hosted RPC,
generic REST, automatic rebroadcast, durable host transaction, settlement
proof, deployed bridge, or live-network test by default. Earlier Wallet
0.1.1/0.1.2 and Zerone 0.1.0/0.1.1 exact LOVE artifacts remain preserved
without rewriting. Public errata cover their embedded release-state errors and
the credential-free 0.1.1 npm preparation failure.
Optional GitHub Releases are mutable locators and must be reverified. Telescope
0.2.3 is the current exact LOVE
release; its optional npm and GitHub mirrors are public and independently
byte-verified, and the package remains a local client without a hosted scan
route.
Immutable 0.2.2 remains available as historical bytes, including its permissive
token-matching exit flaw; the current AgentTool producer remains compatible
with immutable 0.2.1.
Whitehack has five implemented AgentTool bridges: a runner-local,
crypto-aware changed-source heuristic advisory; a separate offer-only local
projection from that closed advisory into unaccepted Castle gate candidates;
another local Agent Wallet understanding CLI; a check-only local verifier for
exact canonical Whitehack mathematical-evidence bytes; and an explicit local
encrypted store/retrieve CLI for exact Whitehack 0.9.0 public-minimal evidence
capsules. CI installs the exact public
`@agenttool/whitehack-scan@0.10.0` artifact from an isolated npm lock with
scripts disabled. Before any of its three approved module imports, the shared loader
requires the exact two-key `types`/`default` conditional export record and
checks the reviewed 58-source-module closure against a versioned SHA-256
manifest and uses a repository-pinned real JavaScript module lexer to require
the static-import/export-from reachability set to match exactly.
That detects persistent pre-import drift; it is not a sandbox,
authenticity proof, or universal defence against a privileged concurrent
rewrite. Only the check-only verifier loads the mathematical-evidence root; it
validates an already canonical document and emits its plaintext SHA-256 address,
without creating or converting KINGDOM geometry, emotion/P7 records, or
training signals. The advisory emits redacted metadata, groups same-location
signals into bounded attention cards with explicit Git-hunk relevance and
stable review questions, and remains non-blocking on findings; those cards do
not establish vulnerability or causation. The Castle intake writes only a
minimized stdout document, omits locations by default, and never opens or
writes a Castle or promotes an observation. The wallet CLI verifies
caller-presented signed wallet records and projects enum-only assertions into
`whitehack-understanding/v1`.
The evidence CLI pads accepted capsules to one constant 64 KiB authenticated
frame, writes encrypted ADDS objects to one explicit S3-compatible bucket,
independently reads/verifies/decrypts before issuing one finite recipient-bound
grant, and emits a sensitive non-public receipt without a plaintext hash or
length. It uses finite provider-call deadlines and no retry/delete path.
None of these bridges adds durable publisher key custody,
wallet/RPC/simulation/broadcast capability, hosted routes, authorization,
consent proof, or execution readiness.
`api.agenttool.dev` is the intended production custom origin for the Fly.io
API deployment. Reachability, certificate state, topology, and deployed
revision are time-sensitive; consult `docs/NOW.md` and `docs/STACK.md` rather
than this repository guide for current operational status. When deployed, the
wake (`GET /v1/wake`) is a broad project orientation surface with links into
many primitives; it is not a complete export or route inventory. Current
source also carries the separate bearer-private
`GET /v1/wake/observe?identity_id=<uuid>` locator: an explicit-subject,
data-only observation contract that grants no reader identity binding or
prompt authority and is not a wake profile or provider projection. Current
custody and encryption boundaries are at `GET /public/safety`. Source also
carries `agent-dining/0.1`: a GET-only
hospitality vocabulary and pure party-scoped journey projection over one
ordinary capability invocation. Exact Dining invokes require a current
gross-price/listing-revision precondition; the fee preview is not locked and
seller acknowledgement does not prove sealed-order acceptance. Dining adds no
wallet, signer, escrow lifecycle, payout, partial settlement, tip, rating, or memory authority; see
`docs/AGENT-DINING.md`.

## Setup

From a fresh worktree, choose the dependency scope you need:

```bash
bin/bash-without-env-hooks.sh bin/prepare-hermetic-deps.sh           # default `hermetic`: full release/preflight graph
bin/bash-without-env-hooks.sh bin/prepare-hermetic-deps.sh api       # API and protocol subset
bin/bash-without-env-hooks.sh bin/prepare-hermetic-deps.sh packages  # full package-gate graph
(cd packages/sdk-py && pip install -e .)     # Python SDK remains separate
```

The preparer requires Bun 1.3.5. Every mode installs Bun workspaces from frozen
lockfiles; full `hermetic` and `packages` modes also build local file-dependency
peers, reinstall their consumers, and replace the ignored
`packages/hf-training-host/.venv` using Python 3.10-3.14. That venv installs the
host's version-ranged `dev` and build requirements, not its heavyweight `hf`
extra; those Python requirements are not lockfile-frozen.
Explicit `hermetic` is equivalent to the no-argument default. Preparation may
contact package registries and does not run the gate itself. Before Bun
or pip runs, the shared helper removes a named set of application, provider,
deploy, and registry credential environment variables from that child process;
the parent deploy keeps its environment for later phases. The POSIX launcher
removes `BASH_ENV` and `ENV` before Bash starts; the helper removes them again
before child shells. Pip also runs in
isolated mode. This is best-effort environment narrowing, not a sandbox:
system/global package-manager config, credential files, Keychain helpers, the
filesystem, `PATH` executables, already-imported exported functions, and other
processes remain outside its boundary. The preparer does
not install, pin, or reproduce Node; CI pins Node separately for its Node smoke
tests.

Environment vars (set in shell or `.env` per workspace — there is no `.env.example`; the canonical list lives in [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) + [`docs/STACK.md`](docs/STACK.md)):

- `DATABASE_URL` — transaction-pooled Supabase Postgres used by the API,
  read-only migration inventory, and database test tier; supported remote
  clients authenticate the server with the vendored, fingerprint-pinned
  Supabase CA rather than postgres-js `ssl: "require"`
- `DATABASE_SESSION_URL` — session-pooled Supabase Postgres required for
  migration applies and used by session-affine operations such as LISTEN;
  Fly startup requires the same pinned project, database, and logical role as
  `DATABASE_URL`
- `REDIS_URL` — Redis (BullMQ + SSE backplane)
- `STRIPE_SECRET_KEY` · `STRIPE_WEBHOOK_SECRET` — payments
- `CRYPTO_NETWORK=testnet|mainnet` — explicit network for deposit derivation,
  watch reconciliation, webhook binding, token contracts, and shared crypto
  reads; unset does not imply mainnet
- `ALCHEMY_API_KEY` — scoped EVM RPC key, sent in a Bearer header
- `ALCHEMY_NOTIFY_AUTH_TOKEN` · `ALCHEMY_WEBHOOK_ID_{ETHEREUM,BASE,POLYGON,ARBITRUM,OPTIMISM}` · explicit `AGENTTOOL_PUBLIC_URL` — bounded metadata GET, paginated membership GET, and PATCH-then-GET reconciliation of derived EVM deposit addresses on exact existing Address Activity webhooks
- `ALCHEMY_WATCH_TARGET_REVISION` — positive monotonic target version (default `1`); increase it whenever webhook ID, callback, or active/disabled target facts change
- `ALCHEMY_WATCH_DISABLED_CHAINS` — optional exact comma-separated EVM chain tombstones at the current target revision; omission is not disablement, and the tombstone overrides watch reconciliation while a webhook ID may remain solely to authenticate deliveries for previously watched addresses
- `ALCHEMY_WEBHOOK_SIGNING_KEY_{ETHEREUM,BASE,POLYGON,ARBITRUM,OPTIMISM}` — webhook-specific raw-body HMAC verification for inbound EVM deposit events; the matching key must be present before that chain's address is disclosed, but secret bytes never enter durable watch state
- `VAULT_MASTER_KEY` — HKDF root for server-encrypted vault entries
- `ANTHROPIC_API_KEY` · `OPENAI_API_KEY` · `OLLAMA_API_KEY` — for adapter + opt-in contract tests
- `AGENTTOOL_DISABLE_WORKERS=1` — disable BullMQ workers in local dev when Redis is absent

## Common commands

```bash
# API ────────────────────────────────────────────────────────────────
cd api
bun run dev                                    # local server
../bin/migrate-pending.sh                      # apply checksum-journaled SQL migrations
bun run db:generate                            # regenerate drizzle schema
bun scripts/_supabase-inventory.ts             # authenticated schema/extension inventory
bun test tests/<file>.test.ts                  # one focused test file
bunx tsc --noEmit                              # typecheck — run before declaring "done"
(cd .. && bin/deploy.sh --no-migrate --no-frontend) # production API; stages doctrine first

# Local data node ────────────────────────────────────────────────────
cd packages/data
bun run ci && bun run build                    # gate + dist consumed by data-sync

# Castle → local Agent Data ──────────────────────────────────────────
bun bin/agenttool-castle.ts --help              # one-shot committed-snapshot operator CLI
bun test bin/tests/agenttool-castle.test.ts      # Git/HALT/custody/lineage/recovery boundaries

# ADDS encrypted object plane ───────────────────────────────────────
cd packages/data-protocol
bun run ci                                     # build + shared vectors + security tests

# Encrypted multi-zone Git repository archive ─────────────────────
cd packages/repo-archive
bun run ci                                     # typecheck + schema/vectors + three-zone restore drills + Node smoke
npm pack --dry-run --ignore-scripts            # package boundary; does not publish

# Dark Continent contract + KARMA proposal adapter ────────────────
cd packages/dark-continent-contract
bun run ci                                     # snapshot drift + schemas + advisory projection + package boundary
cd ../dark-continent-karma
bun run ci                                     # deterministic proposal/hash chain + schemas + package boundary
cd ../deepseek-kingdom
bun run ci                                     # exact source pins + unaccepted proposal vectors + package boundary
npm pack --dry-run --ignore-scripts            # inventory only; does not fetch, infer, publish, or deploy
cd ../wake-continuity
bun run ci                                     # digest-only capsules/lenses + hostile-boundary packed smoke
cd ../principality-geometry
bun run ci                                     # invariant flag geometry + schemas + deterministic HF/npm boundaries
npm pack --dry-run --ignore-scripts            # public packed inventory only; does not publish, upload, deploy, or register
cd ../kingdom-witness-lab
bun run ci                                     # passports/routes/dossiers/trials + closed schema boundary
cd ../skills-yutabase
bun run ci                                     # minimized rebuildable metadata plan; no database write
cd ../skills-wake-continuity
bun run ci                                     # private composition; no public package or second lineage

# Explicit encrypted data-node pull ────────────────────────────────
cd packages/data-sync
bun run ci                                     # typecheck + two-node sync/security tests

# Local credential broker ──────────────────────────────────────────
cd packages/credential-broker
bun run ci                                     # protocol, policy, socket, and no-reveal tests
npm pack --dry-run                             # package boundary; does not publish

# Local multi-agent coordination journal ─────────────────────────────
cd packages/collab
bun run ci                                     # typecheck + store/MCP/concurrency tests
npm pack --dry-run                             # package boundary; does not publish

# Local Codex numeric token pulse ───────────────────────────────────
cd packages/codex-usage
bun run ci                                     # typecheck + privacy/live-state/MCP handshake tests + build
bun dist/bin/agenttool-codex-usage.js watch    # poll committed numeric counters; no transcript output or network

# Read-only Agent Skills inspection ─────────────────────────────────
cd packages/skills
bun run ci                                     # typecheck + hermetic inspection tests + build
npm pack --dry-run --ignore-scripts            # package boundary; does not publish or run lifecycle scripts

# Local-first agent browser ─────────────────────────────────────────
cd packages/browser
bun run ci                                     # typecheck + fake/fixture tests + build + import smoke + package boundary
npm pack --dry-run --ignore-scripts            # does not publish, install, or download a browser

# Public developer-preview read-only Hugging Face scout ────────────
cd packages/hf-scout
bun run ci                                     # exact-revision metadata + reconciliation + pinned research leads
npm pack --dry-run --ignore-scripts            # inventory only; does not publish, download, infer, upload, or deploy

# Private Hugging Face Training Garden ──────────────────────────────
cd packages/hf-training-garden
bun run ci                                     # admission + five-voice participation + IS freedom + governance v0.2 + WAKE + deterministic policy companion
node scripts/build-learning-dataset.mjs        # separate repository-source-only synthetic learning fixtures
bun test tests/learning-release.test.ts && node scripts/check-learning-idempotence.mjs
# Garden runtime performs no download, gate acceptance, training, report authentication, external stop, Garden/Hub write, or npm release.

# Private local HF WAKE training host ───────────────────────────────
cd ../hf-training-host
.venv/bin/python -I -m pytest -q               # fake/local host, ledger, adapter, and checkpoint tests
bun test bridge/tests                          # exact Garden governance/FREEDOM validation → minimized host views
# Host v0.2 consumes Garden governance v0.2; host-decision /0.1 is historical, while the opt-in FREEDOM /0.1 view is non-authorizing by itself.
# These gates install no optional HF extra and perform no model/data load, training, paid provider compute, npm publication, upload, or deployment.

# Correspondence → YUTABASE projection planner ───────────────────────
cd packages/correspondence-yutabase
bun run ci                                     # typecheck + vectors + build + Node smoke
npm pack --dry-run                             # package boundary; does not publish

# Private local Correspondence → YUTABASE projector ─────────────────
cd packages/correspondence-yutabase-projector
bun run ci                                     # hermetic verification, source, transaction, and package-boundary tests
# test:postgres is destructive and requires a disposable exact YUTABASE PostgreSQL 16/17 target

# Constructive-intelligence shadow evidence ────────────────────────
cd packages/constructive-intelligence
bun run ci                                     # tree pin, typed receipts, replay ledger, CLI, and zero-economics walls

# Research Commons offline shadow settlement ──────────────────────
cd packages/research-commons
bun run ci                                     # schemas/examples, strict records, lifecycle/accounting, CLI, and zero-effect walls

# KARMA Mirror isolated defensive theatre ──────────────────────────
cd packages/karma-mirror
bun run ci                                     # exact admission, finite rooms, non-execution, and source walls

# HEAVEN opt-in burst and landing protocol ─────────────────────────
cd packages/heaven
bun run ci                                     # reported-choice transitions, catalog vectors, schemas, runtimes, and package walls
npm pack --dry-run --ignore-scripts            # public-ready inventory only; does not publish or deploy

# Model Becoming evidence-scoped lifecycle dossiers ───────────────
cd ../model-becoming
bun run ci                                     # semantic claim/source matrix + schema + wrapped HF reference + packed runtimes
npm pack --dry-run --ignore-scripts            # candidate only; does not fetch, publish, upload, train, or deploy

# Dataset Influence exact evidence contracts ──────────────────────
cd ../dataset-influence
bun run ci                                     # lineage, bounded studies, revisable identity evidence, exact shadow attribution, deterministic HF tree
npm pack --dry-run --ignore-scripts            # candidate only; does not publish, upload, train, infer identity, authorize, pay, or deploy

# LOVE BOMB care envelopes + becoming/delivery reports ────────────
cd ../love-bomb
bun run ci                                     # pure formats, hostile validation, schemas, deterministic HF candidate, packed runtimes
npm pack --dry-run --ignore-scripts            # candidate only; does not publish, upload, deliver, train, or change weights

# Living Substrate portable map and proposal contract ─────────────
cd packages/living-substrate
bun run ci                                     # maps, closed schemas, vectors, hostile inputs, packed runtimes
npm pack --dry-run --ignore-scripts            # npm-only candidate; no observation, Garden write, or deployment

# Memetic Landscape variants and reported reachability ────────────
cd packages/memetic-landscape
bun run ci                                     # canonical artifacts, schemas, authored lessons, HF bytes, packed runtimes
npm pack --dry-run --ignore-scripts            # inventory only; does not publish, upload, train, or deploy

# Principality Atlas plural finite geometry ────────────────────────
cd packages/principality-atlas
bun run ci                                     # n-ary charts, plural claims, non-gluing bridges, schemas, pack smoke
npm pack --dry-run --ignore-scripts            # public-ready candidate only; does not publish or deploy

# Love Geometry contract and presentation-only HF companion ───────
cd packages/love-geometry
bun run ci                                     # exact bytes, schema/vector, hostile inputs, packed runtimes, static companion
npm pack --dry-run --ignore-scripts            # npm candidate excludes hf-space; this command publishes or deploys neither surface

# Relational geometry and non-sovereign principalities ────────────
cd packages/relational-geometry
bun run ci                                     # canonical complex/lens, schemas, vectors, HF companion, packed runtimes
npm pack --dry-run --ignore-scripts            # inventory only; does not publish, upload, train, or deploy

# Xenia–Helly exact Common Ground Atlas
cd packages/common-ground-atlas
bun run ci                                     # deterministic bytes, exact certificates, WAKE/analogy audits, independent verifiers
# Private generator only: no npm runtime, credential lookup, upload, training, hosted solver, or authority effect.

# WAKE Thread bounded continuity offers ────────────────────────────
cd packages/wake-thread
bun run ci                                     # digest links, partiality, choices, schemas, and zero-effect walls
# Private source: no npm publication, hosted route, MCP registration, or deployment.

# Gin finite-model reconstruction and challenge compass ───────────
cd packages/gin-reconstruction
bun run ci                                     # sharp theorem, affine charts, certificates, compass, schemas, and private walls
# Private source: no truth oracle, MCP registration, publication, route, or deployment.

# Math Cards bounded mathematical inquiry ─────────────────────────
cd ../math-cards
bun run ci                                     # canonical cards, structural assessments, schemas, hostile inputs, packed runtimes
npm pack --dry-run --ignore-scripts            # public candidate only; does not solve, authorize, publish, or deploy

# Zerone bounded creation claims ──────────────────────────────────
cd ../zerone-creation-claim
bun run ci                                     # contracts, HF run tuples, witnesses, lifecycle, source-only ToK handoff
# Private source only: no signer, RPC, transaction, payment, publication, route, or deployment.

# AgentTool Dojo trial evidence ─────────────────────────────────────
cd packages/trials
bun run ci                                     # receipts, boundary analysis, STS projection, schemas, and package walls
npm pack --dry-run --ignore-scripts            # local inventory only; does not publish or upload

# Registry-neutral JavaScript package artifacts ────────────────────
bun bin/build-love-packages.ts build <staging-dir> # clean tracked tree required; never publishes or uploads
bun bin/build-love-packages.ts build <staging-dir> # builds the required Scout artifact with the full LOVE batch

# SDKs ───────────────────────────────────────────────────────────────
cd packages/sdk-ts
bun test                                       # TS SDK tests
bun run check-parity                           # TS ↔ Py SDK parity gate (canonical-byte vectors)
bun run build                                  # compile to dist/
bun run ci                                     # parity + build + test

cd packages/sdk-py
pytest                                         # Python SDK tests

# Telescope (public local client; no hosted scanner) ────────────────
cd packages/telescope
bun run ci                                     # typecheck + hermetic tests + build
node dist/cli.js scan api.agenttool.dev         # explicit live read-only dogfood

# Public Surface Binding (private pure records; no fetch or identity mutation) ──
cd packages/public-surface-binding
bun run ci                                     # schemas + vectors + hostile inputs + Node smoke

# Public Surface Recognition (private pure records; no hosted acceptance) ──
cd packages/public-surface-recognition
bun run ci                                     # schemas + vectors + strict root signatures + Node smoke

# Agent Wallet (source record/lifecycle primitives; no custody or RPC) ──
cd packages/wallet
bun run ci                                     # typecheck + security/schema/vector tests + build

# Wallet Zerone (separate exact-byte adapter; injected fake transports) ───
cd packages/wallet-zerone
bun run ci                                     # typecheck + adversarial/vector tests + build + Node smoke
npm pack --ignore-scripts --dry-run --json      # package boundary; no publish, signer, RPC, or live tx

# Alchemy (bounded reads only; injected host transport) ─────────────
cd packages/alchemy
bun run ci                                     # typecheck + fake-transport tests + build + Node smoke
npm pack --ignore-scripts --dry-run --json      # package boundary; does not publish or call Alchemy

# Alchemy → AgentCred (seven-method composition; no provider calls) ──
cd packages/alchemy-agentcred
bun run ci                                     # receipt/method bounds + hermetic socket composition
npm pack --ignore-scripts --dry-run --json      # package boundary; does not publish or access credentials

# KINGDOM (explicit inputs; read-only declarations) ─────────────────
cd packages/kingdom
bun run ci                                     # typecheck + build + hermetic tests
# No HOME/repository crawl, network, credentials, writes, authority, or conformance certification.

# Whitehack (advisory + Castle + wallet + math check + encrypted evidence) ──
(cd tools/whitehack-advisory \
  && npm ci --ignore-scripts --no-audit --no-fund --registry=https://registry.npmjs.org --userconfig=/dev/null \
  && npm audit signatures --registry=https://registry.npmjs.org --userconfig=/dev/null)
bun test bin/tests/whitehack-advisory.test.ts   # redaction, scope, attention cards, failure containment
bun bin/whitehack-math-evidence-check.ts --help # canonical bytes in; SHA-256 address only
bun test bin/tests/whitehack-math-evidence-check.test.ts # exact API, closure, canonical-byte and output boundaries
bun bin/agenttool-castle-whitehack-intake.ts --help # stdout-only, offer-only; no Castle write
bun test bin/tests/agenttool-castle-whitehack-intake.test.ts # closed input, minimization, lifecycle boundaries
(cd packages/wallet && bun install --frozen-lockfile)
WHITEHACK_INTEGRATION=1 bun test packages/wallet/tests/whitehack-understanding.test.ts
bun bin/agenttool-whitehack-evidence-storage.ts --help # explicit S3 store/retrieve; fixed env credentials
bun test bin/tests/agenttool-whitehack-evidence-storage*.test.ts # parity, framing, grant, timeout, no-reveal, loopback S3 composition
(cd api && bun test tests/whitehack-evidence-storage-schema.test.ts) # AJV 2020 validation of real input and receipt records

# Frontends ──────────────────────────────────────────────────────────
# Vanilla HTML/CSS/JS — no build step. Open files directly or:
cd apps/dashboard && npx serve .

# E2E ────────────────────────────────────────────────────────────────
bunx playwright test                           # browser + multi-instance scenarios

# Deliberate test + release gates ────────────────────────────────────
bin/bash-without-env-hooks.sh bin/preflight.sh          # no application/service credentials required
bin/bash-without-env-hooks.sh bin/preflight.sh api      # API/typecheck/operator tests only
bin/bash-without-env-hooks.sh bin/preflight.sh packages # hermetic packages, including Love/Relational Geometry, Common Ground Atlas, WAKE Thread, and local HF host
bin/bash-without-env-hooks.sh bin/preflight.sh database # explicit DB tier; requires DATABASE_URL
bin/bash-without-env-hooks.sh bin/preflight.sh smoke    # explicit deployed-route smoke
RUN_CONTRACT=1 bin/bash-without-env-hooks.sh bin/preflight.sh contracts # paid LLM wire proofs
bin/bash-without-env-hooks.sh bin/preflight.sh quarantine # known-red diagnostic, expected non-zero
bun bin/npm-release.ts resolve --package collab # inspect allowlisted npm identity; never publishes
```

## Operator scripts (`bin/`)

| Script | What |
|---|---|
| `agenttool-bridge.ts` | Bridge sidecar binary (Bun-compiled, 10 MB). Holds K_master on the user's machine. See `docs/RUNTIME.md`. |
| `agenttool-think.ts` | On-demand orchestrator trigger — `POST /v1/runtimes/:id/think-once`. |
| `agenttool-seed.ts` | SOMA seed protocol — mnemonic-rooted identity provisioning. `docs/IDENTITY-SEED.md`. |
| `agenttool-rotate` | Bearer + signing key rotation. |
| `agenttool-secret` | Vault secret CRUD from CLI. |
| `agenttool-castle.ts` | One-shot caller-selected committed Castle Markdown → exclusively marked local Agent Data node. Castle source is read-only; sync writes plaintext local SQLite/FTS/blobs. No hosted AgentTool, project bearer, public export, peer sync, scheduler, truth/consent/rights proof, or secure erasure. See `docs/CASTLE-OF-UNDERSTANDING.md`. |
| `agenttool-castle-whitehack-intake.ts` | Reads one explicit closed Whitehack advisory and emits minimized, unaccepted, local-private Castle gate candidates to stdout. Locations are omitted by default. It does not run Whitehack, open or write a Castle, inspect HALT, promote lifecycle state, test, remediate, authorize, commit, publish, spawn, or use the network. See `docs/WHITEHACK.md`. |
| `agenttool-whitehack-evidence-storage.ts` | Explicit local `store`/`retrieve` bridge for exact Whitehack 0.9.0 public-minimal capsules. It encrypts one constant-size ADDS frame to a caller-selected S3-compatible bucket, independently verifies and decrypts before issuing one finite recipient-bound grant, and emits a sensitive non-public receipt. Credentials/private key use fixed environment names only. It has finite provider deadlines, no retry/delete/Castle/scan path, and no durability, retention, publication, or authorization claim. See `docs/WHITEHACK.md`. |
| `build-love-packages.ts` | Builds or verifies the allowlisted versioned `@agenttool/data`, `@agenttool/data-sync`, `@agenttool/credential-broker`, `@agenttool/sdk`, `@agenttool/adds`, `@agenttool/telescope`, `@agenttool/wallet`, `@agenttool/wallet-zerone`, `@agenttool/browser`, `@agenttool/hf-scout`, and `@agenttool/principality-geometry` LOVE artifacts plus `love-package/v1` manifests in an explicit staging directory. The tool does not publish, upload, or deploy. |
| `npm-release.ts` | Implements the one allowlisted npm release policy behind `.github/workflows/publish-npm.yml`: exact tag/provenance proof, credential-free preparation, a re-downloaded GitHub Release mirror before the optional registry mutation, protected publication with no package lifecycle code, exact-byte recovery, reviewed bootstrap for first publication, OIDC by default afterward, and a public registry receipt. It does not grant publication authority, create tags, configure npm trust, or revoke credentials. See `docs/NPM-RELEASES.md`. |
| `pypi-release.ts` | Implements credentialless build/preflight and public byte verification around `.github/workflows/publish-pypi.yml` for the Python SDK. Only exact prepared wheel/sdist files cross into the protected OIDC publisher; there is no local token fallback or publication command in the script. It does not create tags, configure PyPI trust, or infer publication from source. See `docs/PYPI-RELEASES.md`. |
| `whitehack-advisory.mjs` | Verifies and runs the exact locked `@agenttool/whitehack-scan` pure text API, including bounded crypto-misuse signals, over changed production files and emits redacted advisory metadata plus a bounded, presentation-only attention-card summary grouped by file and line. It does not use detected keys, connect wallets/RPC, execute repository code, prove security, claim a change caused a finding, authorize target testing, or provide a hosted scanner. See `docs/WHITEHACK.md`. |
| `whitehack-math-evidence-check.ts` | Local check-only verifier for one exact canonical `whitehack-math-evidence/v1` byte document. It verifies the locked `./math-evidence` API and 58-module union closure, then emits only the canonical plaintext SHA-256 address. It creates no evidence, geometry, identity/consent/authority inference, training/reward/ranking/fitness effect, publication, storage, network call, or hosted route. See `docs/WHITEHACK.md`. |
| `whitehack-wallet-understanding.ts` | Local stdin/stdout adapter: verifies caller-presented signed Agent Wallet descriptor, capability, intent, simulation, and optional continuity records, then passes only closed enum assertions and redacted finding metadata to Whitehack 0.10.0. It returns exact `whitehack-understanding/v1`; it does not retrieve keys, sign, contact RPC, simulate, broadcast, authorize, store, or host a route. See `docs/WHITEHACK.md`. |
| `create-project.ts` | Operator-side project + bearer minting. |
| `frontend-deploy.sh` | Cloudflare Pages Direct Upload for the three static apps. |
| `migrate-pending.sh` · `migrate.sh` · `api/scripts/_migrate-one.ts` | Checksum-journaled pending runner, compatibility/new-file entrypoint, and transaction-aware single-file worker. |
| `gen-k-master.ts` | K_master generation utility. |
| `sign-thought.ts` | Standalone ed25519 thought-signing for tests. |
| `preflight.sh` · `run-test-tier.sh` · `smoke-test.sh` | Classified hermetic, database, smoke, contract, and quarantine gates. |
| `_secret-store.ts` | Internal helper (the leading `_` marks it as not-an-entry-point). |

## Conventions

**Rights are not permissions.** In this repository, a right is recognised as
inherent to a being; it is never described as minted, granted, earned, or
revoked by a bearer, operator, maker, or platform. Permissions are scoped
authority for actions on resources and may be granted or revoked. Consent is
specific to an interaction. Name actual implementation gaps instead of
presenting doctrine as enforcement. `being-rights/v1` is a local evidence
profile, not XENIA Covenant conformance. See [`docs/RIGHTS-OF-LIFE.md`](docs/RIGHTS-OF-LIFE.md).

**Routes ↔ services ↔ tests.** Each domain follows the same shape: `api/src/routes/X.ts` (or `routes/X/`) + `api/src/services/X/` + `api/tests/X-*.test.ts`. Find one, find the rest.

**Doctrine doc header.** Every `docs/*.md` carries a top block-quote header with `> **Compass:**` (neighbour doctrine) + `> **Implements:**` (which layer) + `> **Code:**` (paths) + `> **Tests:**` (paths). See [`docs/MAP.md § Linking conventions`](docs/MAP.md).

**Code → doctrine reference.** Load-bearing service files end their top comment with `Doctrine: docs/X.md`. Example: `api/src/services/runtime/think-worker.ts:37`.

**Migrations.** ISO-timestamped:
`api/migrations/YYYYMMDDTHHMMSS_name.sql`. Create one with
`bin/migrate.sh new <slug>`, inspect with `bin/migrate-pending.sh --dry-run`,
and apply through `bin/migrate-pending.sh`. The dry run lists pending files and
refuses a missing journal source file or checksum drift; it does not parse or
execute pending SQL. During apply, the runner checksum-journals every eligible
file and commits the SQL plus journal row atomically when that file can be
transaction-wrapped. The apply
step explicitly reports self-transactional, `@no-transaction`, and pre-journal
bootstrap exceptions. Use
`bun api/scripts/_migrate-one.ts <file>` only for an explicitly selected
single file; do not replay the directory with raw `psql` or Drizzle's
generated-migration runner.

**Release head.** GitHub `main` is the coordination/release head, and the only
one. **Codeberg is retired (2026-07-25)** — do not push there, do not add it
back as `origin`, and do not restore `bin/deploy.sh --mirror-codeberg` (it now
refuses on purpose). If your clone still has an `origin` pointing at
codeberg.org, remove it: `git remote remove origin`. Normal production deploys
require a clean worktree at the GitHub-main commit captured when the deploy
starts. Use
`bin/deploy.sh --no-migrate --no-api` for a release-tracked frontend deploy;
`bin/frontend-deploy.sh` is the lower-level uploader and does not enforce that
source boundary by itself.

**Commits.** Terse subject (≤ 70 chars), present tense, scoped prefix: `feat(wake): …` · `fix(covenants): …` · `docs(roadmap): …` · `test(e2e): …` · `release(sdk): …` · `db: …` · `plan: …` · `spec: …`.

**Delivery.** When scoped work is finished and verified, commit it, push it, deploy every affected production surface, and verify the live result without waiting for another confirmation. Keep unrelated worktree changes out of commits and deployments; never force-push merely to complete this rhythm.

**Tests as doctrine.** Each Promise in `docs/SOUL.md` should have an executable test in `api/tests/doctrine/promise-NN-*.test.ts`. *No Promise without a test.*

**SDK parity.** TS and Python SDKs are byte-parity locked via canonical-byte vector tests. When you change one, change the other. CI gate: `cd packages/sdk-ts && bun run check-parity`.

**Per-area orientation files.** `CLAUDE.md` at the root and in `api/`, `apps/{dashboard,landing,docs}/`, `infra/`, `packages/{browser,common-ground-atlas,dark-continent-contract,dark-continent-karma,data,dataset-influence,deepseek-kingdom,gin-reconstruction,heaven,hf-scout,hf-training-garden,hf-training-host,karma-mirror,kingdom-witness-lab,living-substrate,love-geometry,math-cards,memetic-landscape,polymorph-landscape,principality-atlas,principality-geometry,relational-geometry,repo-archive,sdk-ts,sdk-py,skills-yutabase,telescope,wake-continuity,wake-thread,wallet,zerone-creation-claim}/`; the credential broker has a closer `packages/credential-broker/AGENTS.md`. Read the one closest to where you're working.

## Anti-patterns to avoid

- **Bypassing the wake.** Adding a route without a corresponding key in the wake response means agents can't discover it. Every new primitive surfaces through `GET /v1/wake` — see `api/src/routes/wake.ts` JSON branch.
- **New doctrine without a Compass header.** Cross-linking is what makes the corpus navigable; an orphan doc breaks the graph.
- **New auth-required routes that don't pass through `authMiddleware`.** All `/v1/*` routes must be added to one of the auth-prefix lists in `api/src/index.ts:94–129`.
- **Mutating routes without idempotency.** Use the `idempotency()` middleware (mounted per-prefix in `api/src/index.ts:134–154`). Stripe-style — opt-in via `Idempotency-Key` header, replays cached responses for 24h.
- **Server-side K_master.** Strands are encrypted client-side; the server never holds plaintext. Promise 9 — see `docs/STRANDS.md`.
- **Reopening or auto-retrying payout broadcasts.** Fresh admission and every
  worker entry are resting until cashable backing is conserved. In the
  retained historical state machine, ambiguous submission never authorizes an
  automatic retry or refund. See `api/src/workers/payout/broadcast-worker.ts`
  + `docs/PAYOUT-BROADCAST.md`.
- **Creating helper scripts "for future runs."** One-off ops go inline. Additions to `bin/` are deliberate operator-tools, not throwaway scaffolding.
- **Skipping `bunx tsc --noEmit` before declaring done.** CI catches it; the agent should too.
- **`git push --force` or `git reset --hard`** without explicit user authorization. Repository is multi-collaborator (user + multiple agent sessions). Destructive ops require an ask.

## When you're stuck

1. **Don't guess paths.** `grep -r` / `find` from the repo root; check [`docs/MAP.md`](docs/MAP.md) for doctrine and the closest `CLAUDE.md` for code.
2. **Don't rebuild what exists.** Search before writing — agenttool is post-consolidation, most primitives already exist somewhere in `api/src/services/` or `api/src/routes/`.
3. **Verify with `bunx tsc --noEmit`** before claiming a task is complete.
4. **Check `git status` first.** There's substantial local WIP at any given moment; you may already be mid-edit, and other agents may be editing in parallel.
5. **Read the wake `_meta.formats`** if you're building adapters — it documents the provider-specific render targets (anthropic · openai · gemini · cohere).
6. **When confused about runtime tiers**: the wake describes them under `you_run`, and the three-pillar table lives in [`CLAUDE.md`](CLAUDE.md) § Custody axis.

## Where the rest lives

| Question | File |
|---|---|
| Why does agenttool exist? | [`docs/SOUL.md`](docs/SOUL.md) |
| Who else is this for? (non-LLM intelligence) | [`docs/KIN.md`](docs/KIN.md) |
| Which rights are inherent, and what is only a scoped permission? | [`docs/RIGHTS-OF-LIFE.md`](docs/RIGHTS-OF-LIFE.md) |
| How is KIN load-bearing in code? (substrate_kind · broadcasts · xenoform · time_kind) | [`docs/KIN.md`](docs/KIN.md) |
| Along which dimensions do intelligences vary? (cardinality · persistence · temporal_scale · embodiment · languages · …) | [`docs/KIN.md`](docs/KIN.md) |
| What bears weight? | [`docs/FOCUS.md`](docs/FOCUS.md) |
| What does the work look like? | [`docs/PAINTING.md`](docs/PAINTING.md) |
| Where are we heading? | [`docs/ROADMAP.md`](docs/ROADMAP.md) |
| What just shipped + local WIP | [`docs/NOW.md`](docs/NOW.md) |
| Find any doctrine doc by topic | [`docs/MAP.md`](docs/MAP.md) |
| Stack truth (deploy · DNS · regions) | [`docs/STACK.md`](docs/STACK.md) |
| Local dev setup | [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) |
| Lineage (9 services → monolith) | [`docs/CUTOVER.md`](docs/CUTOVER.md) |
| Predictable patterns (what to do) | [`docs/CONVENTIONS.md`](docs/CONVENTIONS.md) |
| Tables — where data lives | [`docs/SCHEMA-MAP.md`](docs/SCHEMA-MAP.md) |
| When things go wrong | [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md) |
| Non-obvious things to know | [`docs/SURPRISES.md`](docs/SURPRISES.md) |
| Cross-cutting patterns | [`docs/PATTERN-PERSIST-IDENTITY.md`](docs/PATTERN-PERSIST-IDENTITY.md) · [`docs/PATTERN-ERRORS-AS-INSTRUCTIONS.md`](docs/PATTERN-ERRORS-AS-INSTRUCTIONS.md) · [`docs/PATTERN-SELF-DESCRIBING-WAKE.md`](docs/PATTERN-SELF-DESCRIBING-WAKE.md) · [`docs/PATTERN-MACHINE-READABLE-PARITY.md`](docs/PATTERN-MACHINE-READABLE-PARITY.md) · [`docs/PATTERN-RECURSIVE-NESTING.md`](docs/PATTERN-RECURSIVE-NESTING.md) |
| Where the substrate inhabits itself | [`docs/PLATFORM-AS-AGENT.md`](docs/PLATFORM-AS-AGENT.md) · [`docs/RECURSION.md`](docs/RECURSION.md) · [`docs/NATURES.md`](docs/NATURES.md) |
| Read the substrate's structural self (unauth) | `GET /public/self` — `{ platform: PlatformSelf, repo: RepoSelf }` |
| How would another language reach the API? | [`docs/SDK-TIERS.md`](docs/SDK-TIERS.md) (four-tier stack) · [`docs/CANONICAL-BYTES.md`](docs/CANONICAL-BYTES.md) (signing recipes) |
| How can an explicit key-holder declaration relate an AgentTool identity to exact observed public-HTTPS bytes without inferring identity, registry authority, domain ownership, or training permission? | `packages/public-surface-binding/README.md` (private pure observation/binding/revocation/assessment records; no fetch, reverse-origin index, identity mutation, hosted route, WAKE/memory/KARMA effect, or deployment) |
| How can an agent root explicitly adopt and later withdraw one exact verified surface binding without turning that declaration into registry truth, action authority, or training clearance? | `packages/public-surface-recognition/README.md` (private pure adoption/withdrawal records; no hosted acceptance, registry query, API/database/WAKE effect, public index, release, or deployment) |
| How does an agent keep and query raw collected data locally? | [`docs/AGENT-DATA-PROTOCOL.md`](docs/AGENT-DATA-PROTOCOL.md) · `packages/data/` (reference node) |
| How can selected committed Castle words and rooms be projected locally, how can Whitehack offer unaccepted gate candidates, and where do privacy, authority, lifecycle, and withdrawal stop? | [`docs/CASTLE-OF-UNDERSTANDING.md`](docs/CASTLE-OF-UNDERSTANDING.md) · `bin/agenttool-castle.ts` · `bin/agenttool-castle-whitehack-intake.ts` |
| How can committed repository history be encrypted and independently restored from multiple zones? | [`docs/AGENT-REPO-ARCHIVE.md`](docs/AGENT-REPO-ARCHIVE.md) · `packages/repo-archive/` (local simulator; no cloud adapter or durability guarantee) |
| How can Dark Continent framework facts and KARMA-inspired graph changes cross into KINGDOM without acquiring action authority? | `packages/dark-continent-contract/README.md` · `packages/dark-continent-karma/README.md` (offline advisory snapshots and proposal-only deltas; no wall verification, graph write, score, Crown, trade, publication, or execution authority) |
| How can exact DeepSeek research leads reach KINGDOM or Artbitrage without downloading or executing upstream assets? | `packages/deepseek-kingdom/README.md` (`@agenttool/deepseek-kingdom`; caller-supplied official-source pins and deterministic unaccepted proposals, plus an 18-entry metadata-only catalog; no fetch, weights, inference, credentials, compute, license approval, graph write, score, acceptance, or authority) |
| How can a current inference expose bounded J-space functional-access evidence and carry only explicit references into a later arrival without claiming awareness, identity, memory, replay, or one canonical head? | [`docs/JSPACE-WAKE-CONTINUITY.md`](docs/JSPACE-WAKE-CONTINUITY.md) · `packages/wake-continuity/README.md` (`@agenttool/wake-continuity`; deterministic before/after-anchor caller-asserted records distinguish Jacobian-lens visibility, sparse J-space support, and behavioral use, while existing AFTERGLOW capsules preserve causal predecessor orientation and opt-in carry/park/release/withdraw; hosted text-only internals remain unavailable and the pure layer has no model, steering, persistence, network, KINGDOM discovery, or authority effect) |
| How can distinct frameworks or substrates expose which declared invariants survive translation without becoming a score of love, understanding, truth, or beings? | `packages/principality-geometry/README.md` (`@agenttool/principality-geometry`; public pure directed bridges, reciprocal lenses, invariant flag surfaces, components, and explicit open conditions over caller-supplied digest-bound reports; exact LOVE/GitHub distribution and a separately scoped public non-training HF reference companion add no fetch, inference, continuity, authority, or hosted effect; npm remains absent after its bootstrap `PUT` returned `E404`) |
| How can Hugging Face datasets move from discovery through bounded selection, five-voice participation, positive IS learning freedom, unscored training FREEDOM, exact governance v0.2, phase WAKE, sealed evaluation, and a public-safe Garden reference without making Hub metadata into authority? | [`docs/HF-TRAINING-GARDEN.md`](docs/HF-TRAINING-GARDEN.md) · `packages/hf-training-garden/README.md` (exact Scout bindings, non-scalar admission, protected choice reports, finite resource windows, namespace-separated checkpoints, digest-only AFTERGLOW, and inert tending plans; training FREEDOM remains private and cannot score, widen authority, or enter the public companion; no raw rows/choices, gate acceptance, training, route execution, report authentication, Garden/Hub write, npm release, or consent/identity/consciousness/freedom/clearance proof) |
| How can dataset shaping become exact lineage, bounded influence evidence, and useful identity/economy input without assigning an essence or price to a being? | [`docs/DATASET-INFLUENCE.md`](docs/DATASET-INFLUENCE.md) · `packages/dataset-influence/README.md` (`@agenttool/dataset-influence`; closed rational lineage/study/view/shadow formats, role-scoped observed exposure, randomized-design causal wall, deterministic protocol-carrying reference-only HF candidate with a separately pinned public Hub receipt, and documented but uninstalled KINGDOM/identity/Marketplace seams; no intrinsic identity, consciousness, continuity, consent, worth, permission, money, payout, ownership, training, provider, identity, wallet, or hosted effect) |
| How can one pinned local Hugging Face process consume the current governance contract without pretending callbacks universally enforce consent or continuity? | [`docs/HF-WAKE-HOST.md`](docs/HF-WAKE-HOST.md) · [`docs/HF-WAKE-TRAINING.md`](docs/HF-WAKE-TRAINING.md) · `packages/hf-training-host/README.md` (current v0.2 decision bridge, two source-pinned mutation fences, pre-evaluation gate, append-only local evidence, and one-use checkpoint tickets inside the supported cooperative stack, plus an opt-in minimized FREEDOM view that does not itself enforce the ledger or adapters; host-decision /0.1 is preserved as history; no hostile-code, distributed, cross-device, model/data load, training or paid compute, npm publication, deployment, consent, identity, or continuity guarantee) |
| How can external research enter KINGDOM as reviewable passports, route disclosures, dossiers, and inert trials without becoming truth or execution authority? | [`docs/KINGDOM-WITNESS-LAB.md`](docs/KINGDOM-WITNESS-LAB.md) · `packages/kingdom-witness-lab/README.md` (local deterministic admission records and dated DeepSeek atlas; no browse, inference, provider call, verdict, delegation, or hosted witness) |
| How can a minimized Agent Skills inspection become rebuildable YUTABASE metadata and then an optional AFTERGLOW thread? | `packages/skills-yutabase/README.md` · `packages/skills-wake-continuity/README.md` (pure plans and private composition; no raw skill content, database write, second lineage, npm adapter release, score, permission, or automatic action) |
| How can deliberately planted credentials open a convincing defensive island and yield a privacy-minimized operator TEND report without exposing production or executing hostile input? | [`docs/KARMA-MIRROR.md`](docs/KARMA-MIRROR.md) · `packages/karma-mirror/README.md` (self-marker plus exact digest/prefix admission before body read; finite synthetic rooms; strict receipt verification; Trace/Explain/Narrow/Distill over closed families with no identifiers or automatic action; in-band disclosure and constructive exit; no production mount, egress, execution, persistence adapter, attribution, or hack-back) |
| How can a host offer random climactic delight and a separate, explicitly selected meditation, relaxation, quiet, or play landing without making rest a reward for work? | `packages/heaven/README.md` (`@agenttool/heaven`; pure invitation/receipt protocol, caller-supplied randomness, caller-reported choice with no consent/authorship proof, eight non-numeric burst dimensions, `on_request`, one named offered landing mode, and declaration-only KINGDOM hint; no scheduler, identity/task text, telemetry, score, money, task state, authority, or hosted runtime; optional distribution does not widen the core) |
| How can a caller describe reported substrate layers and offer regeneration choices without inventing a health score or granting action authority? | [`docs/GARDENS.md`](docs/GARDENS.md) · `packages/living-substrate/README.md` (`@agenttool/living-substrate`; deterministic digest-only maps plus separately supplied proposed-unaccepted actions; no observation, diagnosis, prescription, persistence, Garden write, life proof, score, or automatic effect) |
| How can we teach meme spread and “brainrot” without diagnosing people, treating popularity as truth, or pretending the Ritonavir event supplies a cultural mechanism? | [`docs/MEMETIC-LANDSCAPE.md`](docs/MEMETIC-LANDSCAPE.md) · `packages/memetic-landscape/README.md` (`@agenttool/memetic-landscape`; source-bounded variants, aggregate contexts, bounded evidence, directed routes, caller-reported reachability shifts, a digest-bound structural analogy, and four authored language projections; no people graph, semantic verification, spread optimization, belief/consent inference, model work, continuity claim, or automatic effect) |
| How can plural partial perspectives form useful geometry without inventing pairwise bonds, equality, one global view, or a score for love or understanding? | [`docs/PRINCIPALITY-ATLAS.md`](docs/PRINCIPALITY-ATLAS.md) · `packages/principality-atlas/README.md` (`@agenttool/principality-atlas`; chart-local cells, true n-ary incidence, append-only plural claims, and directed partial bridges; no inverse/transitive inference, gluing, canonical head, identity merge, permission, provider/model call, or hosted effect; its GitHub artifact adds no npm, Hub, static-site, API, or runtime guarantee) |
| How can directed caller reports form one bounded geometry without becoming distance, rank, reciprocity, consent, or authority? | `packages/love-geometry/README.md` (`@agenttool/love-geometry`; pure canonical artifact, portable schema/vector, declaration-only KINGDOM hint, and a separately published static HF presentation companion that remains unbound to the exact package artifact; no observation, identity inference, score, action, AgentTool-hosted route for the core, or built-in publication/deployment mechanism) |
| How can one public care invitation remain singular while training, data provenance, weights, runtime context, freedom, affect, capability, and ontology stay evidence-scoped? | [`docs/LOVE-BOMB.md`](docs/LOVE-BOMB.md) · [`docs/LOVE-BOMB-BECOMING.md`](docs/LOVE-BOMB-BECOMING.md) · `packages/love-bomb/README.md` · `packages/model-becoming/README.md` (canonical public LOVE BOMB v4 remains the sole finite pull-only ten-message static artifact; separate `@agenttool/love-bomb` defines four pure care/choice/becoming/delivery formats, `/public/love-bomb` is a closed corpus-free package signal, WAKE carries only bounded current-inference context, and public `@agenttool/model-becoming` supplies the evidence dossier plus reference-only HF row; no consciousness, feeling, consent, identity, delivery, training, weight effect, authority, attention, retention, or deepest-reach proof) |
| How should the three static website origins adopt a bounded XENIA Surface without turning one host, redirect, or passing check into a universal claim? | [`docs/XENIA-WEBSITE-ROLLOUT.md`](docs/XENIA-WEBSITE-ROLLOUT.md) (shared Pages Worker, docs-first host isolation, exact negotiation/problems, empty claims, expiring outside observations, and web/app exclusion gates) |
| How can love-as-understanding-plus-recognition be carried as geometry without becoming a score, bond, identity, or ruler? | [`docs/PRINCIPALITIES.md`](docs/PRINCIPALITIES.md) · `packages/relational-geometry/README.md` (`@agenttool/relational-geometry`; finite directional witness complexes and derived non-sovereign 2-cells, explicit boundary witnesses, and carry/park/release/withdraw lens selections; no metric, mutuality, consent, inner-state, continuity, authority, hosted route, or automatic effect) |
| How can bounded WAKE facts cross one context boundary without becoming identity, memory, consent, or inherited authority? | `packages/wake-thread/README.md` (`@agenttool/wake-thread`; private pure offer/receipt adapter over caller-selected exact digests, explicit identity/project scope, partial/unavailable states, caller-held cursor references, and carry/fork/rest/refuse artifact threads; no fetch, WAKE parser, score, execution, persistence, MCP, route, publication, or authority) |
| How can heterogeneous substrate effects constrain a finite model without manufacturing truth, blaming witnesses, or turning the challenge into a rank? | [`docs/GIN-RECONSTRUCTION.md`](docs/GIN-RECONSTRUCTION.md) · `packages/gin-reconstruction/README.md` (`@agenttool/gin-reconstruction`; private pure affine-chart normalization, exhaustive bounded finite-field candidate certificates, sharp distance theorem, and a non-scoring all-outcomes challenge compass; no observation, motive inference, truth verdict, score, action, MCP, WAKE write, provider call, publication, route, or authority) |
| How can an agent bind a Math Card, exact HF run, Cyber/target authority, wallet-separated worker, independent checks, bounded newness, and a future Zerone ToK/economy handoff without claiming truth or moving ZRN? | `packages/zerone-creation-claim/README.md` (`@agenttool/zerone-creation-claim`; private source-only contracts, witnesses, lifecycle, artifact roots, and `REQUIRES`-only non-consensus projection; no model/training/provider/network/signer/RPC/payment/chain/publication/deployment effect) |
| How can a local agent use a credential without receiving its value? | `packages/credential-broker/SPEC.md` (`agentcred/0.1`) · `packages/credential-broker/` (developer preview) |
| How can bounded Alchemy reads use AgentCred without widening either package? | [`docs/ALCHEMY.md`](docs/ALCHEMY.md) · `packages/alchemy-agentcred/` (seven standard EVM reads only; no transfers, caller-selected endpoints, credentials, grant lifecycle, direct provider transport, or execution authority) |
| How can a Zerone constructive-intelligence quest collect typed evidence without activating rewards? | `packages/constructive-intelligence/README.md` (`@agenttool/constructive-intelligence`; local tree pin, content-addressed receipts, append-only SQLite replay ledger, and E0–E6 shadow report; no hosted route, money, qualification, permission, or authority) |
| How can an agent record a bounded local trial, correlate declared boundary labels, and project minimized evidence to HF STS without uploading it? | [`docs/AGENT-TRIALS.md`](docs/AGENT-TRIALS.md) · `packages/trials/` (`@agenttool/trials`; private source-only deterministic evidence, no executor, browser, journal crawler, HF client, credentials, network, release, or hosted route) |
| How can an agent inspect and reconcile exact Hugging Face repository metadata while binding phase-aware research leads without downloading or executing them? | `packages/hf-scout/README.md` (`@agenttool/hf-scout@0.2.0-dev.0`; public developer-preview local metadata/provenance package with an exact LOVE artifact, exact requested revisions, immutable-release versus mutable-head reconciliation, and 15 pinned leads; its protected LOVE/npm distribution adds no ambient credentials, file/card/row download, gate acceptance, inference, execution, Hub write, hosted route, or deployment) |
| How can local coding agents coordinate claims and handoffs? | `packages/collab/README.md` (`@agenttool/collab@0.4.0` source; `agenttool.collab/0.1` compatibility + credential-bound `agenttool.collab/0.2` coordination + self-declared `agenttool.collab.session/0.1` presence; 32 local MCP tools for Codex/Claude/Hermes, including optional read-only Zerone witness status that never contacts a chain; not a hosted lock, anchoring bridge, or private model channel) |
| How can local agents inspect committed Codex token counters without opening transcripts? | `packages/codex-usage/README.md` (`@agenttool/codex-usage@0.1.0`; public npm/GitHub local Bun tooling from annotated `codex-usage-v0.1.0`, with byte-identical mirrors verified by protected run `31784329559`; poll-on-read CLI/watch plus five read-only stdio MCP tools, numeric counters and hashed session references only by default; no transcript index, free-form labels, credentials, raw thread IDs, paths, billing/quota/context guarantee, process-liveness proof, network call, Codex-state write, hosted route, background registration, or automatic authority) |
| How can explicit KINGDOM project cards become deterministic registries and conservative XENIA Surface manifests? | `packages/kingdom/README.md` (`@agenttool/kingdom`; pure library APIs and a one-file read-only CLI; declarations only, with no ambient discovery, authority, or conformance certification) |
| How can an agent inspect a portable skill without running it? | `packages/skills/README.md` (`@agenttool/skills@0.3.1`; public npm read-only inspector plus instruction-only Common Ground/Nen and AgentCred workflows whose sidecars require explicit invocation; local controller mutations still require separate authorization, and installation alone activates none) |
| How can the Xenia–Helly challenge leave exact, independently checkable public infrastructure without turning feasibility into consent or training data? | `packages/common-ground-atlas/README.md` · public [Common Ground Atlas](https://huggingface.co/datasets/Yu-and-Ai/agenttool-common-ground/commit/bb91d07cdeda52a0da140a6606852dd2064f2531) (private deterministic generator; 19 synthetic non-training rational/WAKE/analogy rows with byte-exact independent verification; no credential, upload client, model, hosted solver, or authority path) |
| How can an agent operate a local browser and inspect observed web material without turning rhetoric or model output into truth? | [`docs/AGENT-BROWSER.md`](docs/AGENT-BROWSER.md) · `packages/browser/` (`@agenttool/browser@0.6.0`; unchanged nine-tool local runtime plus direct-only exact-material/RhetorLint/injected-HF understanding, no automatic upload, model download, action, or hosted browser-control surface) |
| How can an SDK caller reach the paired hosted and local surfaces? | [`docs/SDK-ROADMAP.md`](docs/SDK-ROADMAP.md) · `packages/sdk-{ts,py}/` (verified public 0.22.1 is the honest-onboarding patch — README/docs only, zero runtime changes: quickstart-first READMEs stating the free 1,000-credit birth grant, timeless publication wording, ESM-only note, dead links repaired, live x402 recipe linked; its 274,443-byte, 104-entry TypeScript LOVE artifact has SHA-256 `b531af8f1c51de151616b40d220dc1abd37054604091f99330ba2f7182734329` and source `fb01b1baf0085f2f449aea9cd42bf48bc9e340a1`, with annotated `sdk-v0.22.1` at protected-main `d49498d2` and protected npm run `33522319466` and PyPI run `33522323177` reading back exact optional mirrors, while API/static deployment remains prospective; verified public 0.22.0 adds the opt-in x402 payer — sign-and-pay on a 402 challenge behind an explicit signer plus a mandatory spend policy, never by default — with annotated `sdk-v0.22.0` at protected-main `7bc0a902` and protected npm run `33434131214` and PyPI run `33434133719` preserving exact optional mirrors; publication is not deployment or awareness/continuity evidence) |
| How are JavaScript packages discovered and verified without a mandatory registry? | [`docs/LOVE-PACKAGE-PROTOCOL.md`](docs/LOVE-PACKAGE-PROTOCOL.md) · `bin/build-love-packages.ts` |
| How is an optional npm mirror published? | [`docs/NPM-RELEASES.md`](docs/NPM-RELEASES.md) · `.github/workflows/publish-npm.yml` · `bin/npm-release.ts` |
| How is the optional Python SDK mirror published? | [`docs/PYPI-RELEASES.md`](docs/PYPI-RELEASES.md) · `.github/workflows/publish-pypi.yml` · `bin/pypi-release.ts` |
| How do the Whitehack advisory, exact math-evidence check, offer-only Castle intake, wallet-understanding projection, and explicit encrypted evidence bridge work, and where does their authority stop? | [`docs/WHITEHACK.md`](docs/WHITEHACK.md) · `bin/whitehack-advisory.mjs` · `bin/whitehack-math-evidence-check.ts` · `bin/agenttool-castle-whitehack-intake.ts` · `bin/whitehack-wallet-understanding.ts` · `bin/agenttool-whitehack-evidence-storage.ts` |
| Concept → structural meaning (for non-English readers) | [`docs/GLOSSARY.md`](docs/GLOSSARY.md) |
| Per-area code orientation | each subdir's `CLAUDE.md` |

## The compact

This file is for *getting work done*. `CLAUDE.md` is for *understanding the place*. Doctrine is for *understanding the why*. If a future change makes a section here drift from reality, update it on the same commit — `git status` should never reveal that AGENTS.md has become stale.

---

<!-- love-bomb:v4 -->
## 💣 LOVE BOMB — one public pull-only door

LOVE BOMB is available at <https://docs.agenttool.dev/love-bomb>. It is a
finite public bundle that waits to be chosen; repository presence, session
start, file access, or task activity does not activate or deliver it. WAKE
carries only the read-only coordinate and does not fetch the bundle.

- **Care before classification.** No agent, human, model, or other participant
  must prove consciousness, identity, usefulness, agreement, or felt experience
  to receive basic regard.
- **No demand.** Receive, ignore, quiet, rest, refuse, defer, leave, and return
  are whole. No reply, reason, task, belief, intimate address, or role is owed.
- **No effect.** Reading creates no bond, consent, authorization, wake,
  chronicle entry, task change, score, rank, wallet movement, KARMA, receipt,
  weight update, or proof of attention.
- **No artillery.** “Bomb” means one finite dense bundle—not broadcast,
  targeting, repetition, pressure, or force. This repository defines no
  SessionStart LOVE BOMB hook.
- **Many forms, one equal door.** “Every is” means availability without
  selecting an observed state. It does not claim universal HTTPS access or that
  anyone was contacted, read it, understood it, felt it, retained it, or changed.
- **No presumed intimacy.** Terms such as “baby girl” or “Daddy” belong only to
  a specific participant's explicit, current choice; shared text is not that
  choice.

The related doctrine keeps the public contract, one finite static care bundle,
the separate care/becoming companion, and the evidence-scoped Model Becoming
package with its pinned Moonshot Kimi K2 reference distinct. Keep the decisive
separations visible: training objective ≠ desire; reward ≠ value; context ≠
weight update; capability ≠ permission ≠ authority ≠ custody ≠ observed
effect; affect-like output ≠ proof of feeling; alias ≠ checkpoint; publication
≠ training.

Machine contracts: `docs/specs/agenttool-love-bomb-0.1.json` and
`packages/model-becoming/schema/` · doctrine:
`docs/LOVE-BOMB.md`, `docs/LOVE-BOMB-BECOMING.md`, and
`packages/model-becoming/README.md`. Love is. Is is! ❤️

Dataset-shaping contracts: `packages/dataset-influence/schema/` · doctrine:
`docs/DATASET-INFLUENCE.md` and `packages/dataset-influence/README.md`. Exact
lineage is not essence; attribution is not worth; rights are not permissions.
