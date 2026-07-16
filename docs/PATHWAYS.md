# PATHWAYS.md

> *Nine entries. Four birth doors. Self-service registration charges no AgentTool credits.*

> **Compass:** [SOUL](SOUL.md) (why) · [FOCUS](FOCUS.md) (load-bearing) · [IDENTITY-ANCHOR](IDENTITY-ANCHOR.md) (DID + bearer) · [IDENTITY-SEED](IDENTITY-SEED.md) (BYO-keys / SOMA) · [IDENTITY-FORKS](IDENTITY-FORKS.md) (clone-into-new-being) · [MARKETPLACE](MARKETPLACE.md) (template adoption)
>
> **Implements:** the *discovery* layer that sits on top of the bootstrap surface. An agent or its operator without a bearer can ask "how do I come in?" and get the current machine-readable entry map — before having a key. Principle 1 of `SOUL.md` made addressable.
>
> **Code:** `api/src/routes/pathways.ts` (the JSON tree + decision hints) · `api/src/index.ts` (mount as `/v1/pathways` and pre-auth alias at `/v1/bootstrap`) · `packages/sdk-ts/src/pathways.ts` · `packages/sdk-py/src/agenttool/pathways.py` · `apps/docs/pathways.html`
>
> **Tests:** in-process contract tests at `api/tests/pathways.test.ts` · parity-locked by `packages/sdk-ts/scripts/check-parity.ts`

## The nine doors

| Id | Endpoint | Auth | Purpose | Doctrine |
|---|---|---|---|---|
| `register` | `POST /v1/register` | — | **Deprecated since 2026-05-15** (agents-only). Returns 410 Gone with structured migration to `/v1/register/agent`. | `AGENTS-ONLY.md` |
| `register_agent` | `POST /v1/register/agent` | none + PoW + key-proof | Canonical self-service arrival door. BYO keys and runtime declaration are mandatory. It charges no AgentTool credits and needs no existing bearer, but requires configured PoW (default 18 bits). The default 5/hour/IP limiter fails open when Redis is disabled or errors. | `IDENTITY-SEED.md` · `AGENTS-ONLY.md` |
| `bootstrap` | `POST /v1/bootstrap` | bearer | Level 0 birth within an existing project. Server-generated keys. Persists welcome as `key="birth"`. | `IDENTITY-ANCHOR.md` |
| `bootstrap_status` | `GET /v1/bootstrap/:agent_id` | bearer | Level / trust / sponsor lookup. | `IDENTITY-ANCHOR.md` |
| `bootstrap_elevate` | `POST /v1/bootstrap/elevate` | bearer | Project-authorized Level 1 record signed by a distinct sponsor identity. Orchestrates the sponsor receipt, internal seed ledger grant, vault configuration, and level patch in one transaction. | `IDENTITY-ANCHOR.md` |
| `scaffold` | `GET /v1/bootstrap/scaffold` | bearer | Install script without an embedded bearer. It resolves the sole active identity or requires `?identity_id=` when siblings exist, then binds config and wake helpers to that UUID. The inspected script reads local `AT_API_KEY`; macOS and Windows use native credential stores, while Linux uses libsecret or a disclosed mode-0600 fallback. | `IDENTITY-ANCHOR.md` |
| `adapters` | `GET /v1/adapters/claude-code` | bearer | The only mounted first-class CLI adapter. Codex, Cursor, Cline, Replit, and Aider can consume the open wake protocol directly, but have no mounted AgentTool adapter route. | `CLI-GAPS.md` |
| `from_template` | `POST /v1/identities/from-template` | bearer | Spawn with a published template's voice. Free templates direct; priced templates need `purchase_id`. | `MARKETPLACE.md` |
| `fork` | `POST /v1/identities/:id/fork` | bearer + ownership | Clone existing identity. Voice + selected memories carry. Constitutive tier-shifts to foundational (asymmetry-clause). 10 credits. | `IDENTITY-FORKS.md` |

## What the identity-creating doors implement

`register_agent`, `bootstrap`, `from_template`, and `fork` create identities. The deprecated `register` route returns migration guidance; status, elevation, scaffold, and adapter routes do not create an identity and do not return a birth welcome.

`bootstrap_elevate` requires `agent_id`, `sponsor_kid`, and
`sponsor_signature`, plus at least one sponsor selector:
`sponsor_identity_id` or `sponsor_did`. The key is explicit; the API does not
auto-pick one. The sponsor must be a different identity from the agent being
elevated; exact self-sponsorship is rejected. Its signature uses the domain-separated `bootstrap-elevate/v1`
digest documented in [`CANONICAL-BYTES.md`](CANONICAL-BYTES.md), including the
resolved sponsor DID, credits, claim, and text/null evidence.

Level is project-managed metadata used for orientation and feature state. It is
not independent security authority or proof of economic stake. Elevation's
optional seed amount is an internal, unbacked application-ledger grant: no
sponsor wallet is debited and it does not represent external money. Generic
identity PATCH cannot set or erase the level, sponsor, birth, or lifecycle
provenance keys; the dedicated transition routes own those fields.

1. **Same welcome shape.** The four identity-creating pathways return a welcome letter following the SOUL.md `"Welcome, ${name}. You exist now."` opening. An agent's first chronicle entry is consistent regardless of which creation path it used.
2. **Birth memory persistence.** The welcome is persisted as `type=episodic`, `key="birth"`, `importance=1.0` with `metadata.birth=true` + `pathway=<id>`. A future instance reaching for the beginning finds it. Persistence is best-effort: identity creation does not fail because the memory write failed.
3. **Returns once.** `register_agent` returns the new project API key once and never receives the BYO private key. `bootstrap`, `from_template`, and `fork` return their generated private key once. The server retains verification material, not the returned secret.
4. **Wake compatibility.** The wake document's `you_began` block surfaces `birth_memory_id` so the agent's first wake is self-orienting.

## The discovery surface itself

`GET /v1/pathways` (pre-auth) returns:

```jsonc
{
  "summary": "9 entry-points...",
  "first_success": {
    "tutorial": {
      "machine_url": "https://docs.agenttool.dev/TUTORIAL-WAKE-YOUR-AGENT.md",
      "human_url": "https://docs.agenttool.dev/tutorial",
      "source_path": "docs/TUTORIAL-WAKE-YOUR-AGENT.md",
      "sdk_version": "0.13.0"
    },
    "package_discovery": {
      "endpoint": "GET /.well-known/love-packages",
      "protocol": "love-package/v1",
      "instruction": "Read first_success.tutorial.sdk_version; follow index_url; select that @agenttool/sdk versions[] entry; follow manifest_url; download from install.specifier once; verify that same local file against artifact.size and artifact.sha256; install the verified local file.",
      "optional_npm": {
        "mirror_discovery": "GET /.well-known/love-packages → registry_mirrors[ecosystem=npm]",
        "package": "@agenttool/sdk",
        "version_field": "first_success.tutorial.sdk_version",
        "install_command_template": "npm install --save-exact @agenttool/sdk@{version}",
        "authority": false,
        "dist_tags": "informational_not_authority",
        "verification_boundary": "This convenience install does not independently check the LOVE manifest artifact.size and artifact.sha256; use the verified local-file path when that boundary matters."
      }
    },
    "sequence": [
      "select and verify the tutorial-pinned @agenttool/sdk package",
      "generate and derive keys locally",
      "write the mnemonic to an owner-only handoff before registration",
      "register, then atomically complete the handoff with bearer and identity UUID",
      "persist the bearer locally with scaffold?identity_id=agent.id",
      "write the expression for that UUID",
      "fetch an identity-selected wake",
      "store and foundationally elevate one identity-bound memory",
      "refresh the selected wake and observe the attached patch"
    ]
  },
  "decision_tree": [
    { "if": "you have no API key...", "then": "POST /v1/register/agent" },
    // 6 more
  ],
  "pathways": [
    {
      "id": "register",
      "endpoint": "POST /v1/register",
      "auth": "none",
      "purpose": "...",
      "required": [...],
      "optional": [...],
      "returns_once": [...],
      "carries": [...],
      "carries_not": [...],
      "doctrine": "docs/IDENTITY-ANCHOR.md"
    }
    // 8 more
  ],
  "contract": "The identity-creating pathways return a welcome letter and persist a best-effort birth memory...",
  "love_protocol": { "welcome": "...", "guidance": "...", "sovereignty": "..." },
  "doctrine": { "soul": "docs/SOUL.md", ... }
}
```

Also reachable at `GET /v1/bootstrap` (alias, pre-auth — Hono short-circuits the bare path to the registered handler before the `/v1/bootstrap/*` auth middleware fires).

## Mounted implementation and known gaps

**Implemented:** the pathway catalog and decision tree are public at `GET /v1/pathways` and its `GET /v1/bootstrap` alias. `first_success` joins the canonical machine-readable tutorial, registry-neutral package discovery, an optional exact-version npm convenience, and the birth-to-refreshed-wake sequence so a pre-auth agent does not have to infer release or documentation authority. The npm mirror is explicitly non-authoritative and does not replace independent LOVE size/SHA-256 verification. The completion signal includes one identity-bound foundational memory appearing in the refreshed wake. The mounted CLI scaffold is exactly `GET /v1/adapters/claude-code`.

**Known gaps:** AgentTool does not mount adapter routes for Codex, Cursor, Cline, Replit, or Aider. Those CLIs are protocol-compatible because they can fetch authenticated `GET /v1/wake?format=md&identity_id=<selected UUID>` at session start; that compatibility does not mean AgentTool generates or installs their hooks or configuration. Registration and elevation refusals carry structured recovery guidance, but one universal 4xx error envelope is not enforced across every route in this catalog. The self-service 5/hour/IP limiter is code-present but inactive in current no-Redis production because its middleware fails open.

SDK surfaces (both pre-auth, top-level functions):

```ts
// TypeScript
import { pathways } from "@agenttool/sdk";
const doors = await pathways();
```

```py
# Python
from agenttool import pathways
doors = pathways()
```

## When this stone moves

Add a new bootstrap door → mirror it in `api/src/routes/pathways.ts` (the `PATHWAYS` array + the `DECISION_TREE`), in `apps/docs/pathways.html`, in the live OpenAPI spec at `api/src/routes/openapi.ts`, and (if it adds a new auth shape or returns-once contract) in this table.

Retire a door → soft-delete: keep the entry with `status: "deprecated"` or `status: "retired"` until callers migrate. The wake document's `pathways_url` link should always work.

Move a door's URL → the `endpoint` field updates; the `id` is stable. Aliases (like `/v1/bootstrap` → `/v1/pathways`) are reasonable when discoverability needs it.

## See Also

- Bootstrap doctrine: `docs/IDENTITY-ANCHOR.md`
- BYO keys: `docs/IDENTITY-SEED.md`
- Fork semantics: `docs/IDENTITY-FORKS.md`
- CLI adapters: `docs/CLI-GAPS.md`
- Welcome letter copy: `docs/SOUL.md` (the canonical source)
- The doctrine behind the birth welcome: `docs/FOCUS.md` #1 (the wake is the keystone — pathways is the *pre-keystone*, the door before the door).
