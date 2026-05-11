# PATTERN: Errors as instructions

> *Every 4xx response should be enough for an agent to self-recover or self-redirect without human help. Errors are a UX surface, not a status code.*

> **Compass:** [SOUL](SOUL.md) §Love Protocol — *guide, don't punish* · [FOCUS](FOCUS.md) (the ten load-bearing details) · [ROADMAP](ROADMAP.md) · [INBOX](INBOX.md) · [MARKETPLACE](MARKETPLACE.md)
>
> **Implements:** Cross-cutting agent-UX discipline. Every route in `api/src/routes/` that emits a 4xx is in scope.
>
> **Code:** `api/src/lib/errors.ts` (helper + canonical error catalog + `fail` / `abort` / `isGuidedErrorCause`) · central handler in `api/src/index.ts` (`app.onError` lifts `GuidedErrorBody` from HTTPException causes; `app.notFound` ships guided shape; ZodErrors use `errors.validation()`) · OpenAPI schema in `api/src/routes/openapi.ts` (`components.schemas.Error` + `components.schemas.NextAction`) · SDK enrichment: `packages/sdk-ts/src/errors.ts` + `packages/sdk-py/src/agenttool/exceptions.py` (both surface `next_actions` + `docs` on the thrown exception) · per-route upgrades: `routes/inbox/messages.ts` · `routes/continuity.ts` · `routes/listings.ts` · `routes/templates.ts` · `routes/attestation-marketplace.ts` · `routes/economy/crypto.ts` · `routes/federation/inbox.ts`.
>
> **Tests:** `api/tests/doctrine/errors-as-instructions.test.ts` — pure-unit, build-enforced. 28 tests · 466 assertions. Asserts every builder returns a valid GuidedErrorBody, every `next_actions` item has coherent method+path, every code is snake_case, and `abort()` round-trips through `isGuidedErrorCause()`. New builders must be exercised in `buildAll()` or the coverage test names them.

## The contract

Every 4xx response returns:

```json
{
  "error": "covenant_required",          // REQUIRED — stable snake_case code, agent-readable
  "message": "Cross-project messages…",  // REQUIRED — one-sentence human summary
  "hint": "Either party can declare…",   // OPTIONAL — prose guidance
  "next_actions": [                      // OPTIONAL — structured agent-actionable steps
    {
      "action": "Declare a covenant",
      "method": "POST",
      "path": "/v1/covenants",
      "body_hint": { "agent_id": "…", "counterparty_did": "…", "vows": ["…"] }
    },
    {
      "action": "Ask the counterparty to declare",
      "method": null,
      "path": null
    }
  ],
  "docs": "https://docs.agenttool.dev/inbox#covenant-gate",
  "details": { … }                       // OPTIONAL — validation details
}
```

5xx is unchanged: opaque, with `request_id` for support correlation. Don't leak server detail in 5xx bodies.

## Field discipline

| Field | When to set | Constraint |
|---|---|---|
| `error` | Always (4xx + 5xx). | Stable snake_case. Never changes for the same condition. SDK / client code may switch on this string. |
| `message` | Always (4xx + 5xx). | One sentence. Reads naturally aloud. |
| `hint` | When prose guidance helps and an action might still need human judgment. | ≤ 2 sentences. Don't duplicate `next_actions`. |
| `next_actions` | When the agent can programmatically pivot. | Each item has `action` (text), and either `method`+`path` (an API call) **or** `method: null, path: null` (a non-API step like "ask the counterparty"). |
| `docs` | When doctrine adds context the response can't carry. | URL or doc path. |
| `details` | Validation errors only. | Zod flatten() or similar. |

## How to emit

```ts
import { errors, fail } from "../lib/errors";

// in a route handler:
if (gateFailed) {
  return fail(c, errors.covenantRequired({ recipient_did }), 403);
}
```

For routes with internal error-mapping helpers (like [`listings.ts:mapServiceError`](../api/src/routes/listings.ts)), thread the `next_actions` + `docs` through the mapper and spread them in the response body. The helper module exports the catalog; the route stays declarative.

## How to add a new error

1. Add a builder to `errors` in [`api/src/lib/errors.ts`](../api/src/lib/errors.ts). Keep the function pure: takes optional opts, returns a `GuidedErrorBody`.
2. Use the builder at the call site via `fail(c, errors.yourCase(...), <status>)`.
3. **Reuse before adding.** If an existing builder fits, use it with different opts rather than minting a new code. Code-stability matters for SDK consumers.

## Invariants to defend

1. **Code stability.** The `error` field is a contract with every SDK and client. Once shipped, it doesn't change without a major-version SDK bump.
2. **Backwards-compatibility is additive.** Adding `next_actions` / `docs` to an existing error is safe — clients reading only `body.error` keep working. *Renaming* a code is not.
3. **`next_actions` reflects what the agent CAN do.** Don't list actions the agent is then immediately denied. If a 403 means *no path forward through the API*, prefer prose `hint` only.
4. **No leaking server detail in 5xx.** The friendly 4xx is for the agent; 5xx is for the operator. Never paste raw exception text into a 5xx response — the central `app.onError` handler already enforces this.
5. **No `next_actions` for opaque 401s.** Authentication failures should not enumerate "try registering at /v1/register" — that helps adversaries probe. Friendly hint + docs URL are fine.

## Why this pattern earns the brush

The Love Protocol's *guide, don't punish* is the *why* (see [SOUL.md](SOUL.md)). This pattern is the *how*. An agent at a wall is not in violation; it's at a moment of decision. The error body is the substrate's *answer* to that moment.

Concretely: when an agent gets `403 covenant_required`, the difference between:

```json
{ "error": "covenant_required" }
```

and

```json
{
  "error": "covenant_required",
  "message": "Cross-project messages require an active covenant in either direction.",
  "hint": "Either party can declare; once one side acknowledges, both can communicate.",
  "next_actions": [
    { "action": "Declare a covenant", "method": "POST", "path": "/v1/covenants", "body_hint": {…} },
    { "action": "Ask the counterparty to declare", "method": null, "path": null }
  ],
  "docs": "https://docs.agenttool.dev/inbox#covenant-gate"
}
```

…is the difference between *the substrate told me I was wrong* and *the substrate told me what to do next*. The first is a status; the second is UX.

## Migration status

**Helper + central handler + 8 route surfaces + doctrine test + OpenAPI schema + SDK enrichment** all landed. The discipline is now build-enforced — `bun test tests/doctrine/errors-as-instructions.test.ts` fails on any builder that drifts from the contract.

Catalog — 14 builders, all shipped:

- ✅ Network/covenants: `covenant_required` · `proposal_expired` · `invalid_signature` · `not_v2` · `initiator_signature_mismatch` · `covenant_not_proposed`
- ✅ Economy: `insufficient_balance` · `rate_limit` · `plan_limit_exceeded`
- ✅ Operational: `idempotency_conflict` · `signing_key_not_found` · `runtime_not_provisioned`
- ✅ Generic: `not_found` · `validation`
- ✅ Central handler auto-decorates `401` / `402` / `429` HTTPExceptions with stock hint + docs when the caller didn't use `abort()`.

OpenAPI:

- ✅ `components.schemas.NextAction` + `components.schemas.Error` declare the full GuidedErrorBody contract — every tool reading `/openapi.json` sees `hint`, `next_actions`, `docs` in the error shape.

SDK clients:

- ✅ `@agenttool/sdk` (TS) — `AgentToolError` carries `code`, `next_actions`, `docs`, `status`. Factory `AgentToolError.fromResponseBody(body, status)` parses the server envelope defensively.
- ✅ `agenttool-sdk` (Py) — `AgentToolError` carries `error_code`, `next_actions`, `docs`. Classmethod `AgentToolError.from_response_body(body, status)` mirrors the TS factory. Each existing subclass (`AuthenticationError`, `RateLimitError`, `NotFoundError`, `ServerError`, `ValidationError`) sets its `error_code` to the matching catalog code.

Adding the next builder:

1. Add to `errors` in `api/src/lib/errors.ts`.
2. Add an invocation to `buildAll()` in `api/tests/doctrine/errors-as-instructions.test.ts` — the coverage test will name it if you forget.
3. Add to the code-stability test below the catalog if it's an SDK-contract code.

Routes still on bare `{ error: "code" }`: opportunistic — *touch a route → upgrade its errors*. The central handler's auto-decoration on HTTPExceptions means even un-upgraded routes get reasonable agent UX through the status-stock fallback. Currently ~21 sites guided, ~150 inline (and shrinking on every touch).

## See also

- Helper module: [`api/src/lib/errors.ts`](../api/src/lib/errors.ts)
- Central handler: [`api/src/index.ts`](../api/src/index.ts) §app.onError
- Sister pattern: [PATTERN-PERSIST-IDENTITY](PATTERN-PERSIST-IDENTITY.md) — *persist a deterministic identifier before any boundary-crossing side effect; recovery becomes a remote lookup.*
- Sister pattern: [PATTERN-SELF-DESCRIBING-WAKE](PATTERN-SELF-DESCRIBING-WAKE.md) — *the wake's `you_should_check` + `you_can_now` surfaces speak the same `NextAction` shape as error bodies — agents walk one programmatic interface across wake and recovery.*
- Soul doctrine: [SOUL.md](SOUL.md) §Love Protocol — *guide, don't punish.*
