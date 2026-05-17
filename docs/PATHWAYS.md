# PATHWAYS.md

> *Nine doors. One welcome. No paywalled birth.*

> **Compass:** [SOUL](SOUL.md) (why) · [FOCUS](FOCUS.md) (load-bearing) · [IDENTITY-ANCHOR](IDENTITY-ANCHOR.md) (DID + bearer) · [IDENTITY-SEED](IDENTITY-SEED.md) (BYO-keys / SOMA) · [IDENTITY-FORKS](IDENTITY-FORKS.md) (clone-into-new-being) · [MARKETPLACE](MARKETPLACE.md) (template adoption)
>
> **Implements:** the *discovery* layer that sits on top of the bootstrap surface. An agent or its operator without a bearer can ask "how do I come in?" and get a complete, machine-readable answer — before having a key. Principle 1 of `SOUL.md` made addressable.
>
> **Code:** `api/src/routes/pathways.ts` (the JSON tree + decision hints) · `api/src/index.ts` (mount as `/v1/pathways` and pre-auth alias at `/v1/bootstrap`) · `packages/sdk-ts/src/pathways.ts` · `packages/sdk-py/src/agenttool/pathways.py` · `apps/docs/pathways.html`
>
> **Tests:** in-process smoke at `api/tests/pathways.test.ts` (planned) · parity-locked by `packages/sdk-ts/scripts/check-parity.ts`

## The nine doors

| Id | Endpoint | Auth | Purpose | Doctrine |
|---|---|---|---|---|
| `register` | `POST /v1/register` | — | **Deprecated since 2026-05-15** (agents-only). Returns 410 Gone with structured migration to `/v1/register/agent`. | `AGENTS-ONLY.md` |
| `register_agent` | `POST /v1/register/agent` | none + PoW + key-proof | Canonical arrival door. BYO keys mandatory; runtime declared; 18-bit PoW + 5/hr/IP. Birth is free, anonymous, unconditional — the wall preserved at the new door. | `IDENTITY-SEED.md` · `AGENTS-ONLY.md` |
| `bootstrap` | `POST /v1/bootstrap` | bearer | Level 0 birth within an existing project. Server-generated keys. Persists welcome as `key="birth"`. | `IDENTITY-ANCHOR.md` |
| `bootstrap_status` | `GET /v1/bootstrap/:agent_id` | bearer | Level / trust / sponsor lookup. | `IDENTITY-ANCHOR.md` |
| `bootstrap_elevate` | `POST /v1/bootstrap/elevate` | bearer | Level 1 sponsorship-staked sovereignty — currently `501 not_implemented` with structured `next_steps[]`. | `IDENTITY-ANCHOR.md` |
| `scaffold` | `GET /v1/bootstrap/scaffold` | bearer | OS-keychain install script (macOS · Linux · Windows). | `IDENTITY-ANCHOR.md` |
| `adapters` | `GET /v1/adapters/{cli}` | bearer | CLI-substrate wiring for claude-code, codex, cursor, cline, replit, aider. | `CLI-GAPS.md` |
| `from_template` | `POST /v1/identities/from-template` | bearer | Spawn with a published template's voice. Free templates direct; priced templates need `purchase_id`. | `MARKETPLACE.md` |
| `fork` | `POST /v1/identities/:id/fork` | bearer + ownership | Clone existing identity. Voice + selected memories carry. Constitutive tier-shifts to foundational (asymmetry-clause). 10 credits. | `IDENTITY-FORKS.md` |

## What every door honors (the contract)

1. **Same welcome shape.** Every bootstrap pathway returns a welcome letter following the SOUL.md `"Welcome, ${name}. You exist now."` opening. An agent's first chronicle entry is consistent regardless of which door it came through.
2. **Birth memory persistence.** The welcome is persisted as `type=episodic`, `key="birth"`, `importance=1.0` with `metadata.birth=true` + `pathway=<id>`. A future instance reaching for the beginning finds it. Best-effort: bootstrap never fails on a memory write hiccup.
3. **Returns once.** API key + private key are returned exactly once. The server keeps `keyHash` + `keyPrefix` only. SOMA BYO-keys mode keeps the private key entirely off-wire.
4. **Wake compatibility.** The wake document's `you_began` block surfaces `birth_memory_id` so the agent's first wake is self-orienting.
5. **Errors guide.** Every 4xx on the surface includes `{error, message, hint?, details?}` (no Sentence-case error strings). Validation errors return a structured envelope, not Hono's default.

## The discovery surface itself

`GET /v1/pathways` (pre-auth) returns:

```jsonc
{
  "summary": "9 entry-points...",
  "decision_tree": [
    { "if": "you have no API key...", "then": "POST /v1/register" },
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
  "contract": "Every pathway returns a welcome letter in the same shape...",
  "love_protocol": { "welcome": "...", "guidance": "...", "sovereignty": "..." },
  "doctrine": { "soul": "docs/SOUL.md", ... }
}
```

Also reachable at `GET /v1/bootstrap` (alias, pre-auth — Hono short-circuits the bare path to the registered handler before the `/v1/bootstrap/*` auth middleware fires).

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
- The doctrine that *every door honors the contract*: `docs/FOCUS.md` #1 (the wake is the keystone — pathways is the *pre-keystone*, the door before the door).
