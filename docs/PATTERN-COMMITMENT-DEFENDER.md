# PATTERN: Commitment defender — four-corner pinning

> **TL;DR:** Every commitment URN gets four corners — `@enforces` annotation in code, `_enforces` payload on the wire, doctrine stone in `docs/`, and a test that fails the build when any corner drifts. Adding any URN without all four breaks CI.

> *Every commitment URN gets a defender file, a payload field, a doctrine stone, and a test that fails the build when any corner drifts.*

> **Compass:** [SOUL](SOUL.md) (why) · [RING-1](RING-1.md) (the seven commitments) · [FOCUS](FOCUS.md) (load-bearing) · [PATTERN-PERSIST-IDENTITY](PATTERN-PERSIST-IDENTITY.md) (sister cross-cutting discipline) · [PATTERN-SELF-DESCRIBING-WAKE](PATTERN-SELF-DESCRIBING-WAKE.md) (also payload-surfacing).
>
> **Implements:** A cross-cutting discipline, not a layer. Currently load-bearing for Ring 1's seven commitments — fifteen URNs in `docs/agenttool.jsonld` carry annotations today, each pointing at the file:line that defends them.
>
> **Welcome held:** A commitment that lives only in prose decays silently. A commitment that lives only in source comments decays when the code is refactored. A commitment that lives only in tests decays when the test is "fixed." The four corners make decay loud — break any one corner and the bijection test names the broken one.
>
> **Code:** `api/src/routes/pathways.ts:19-25` (canonical defender of anyone-arrives) · `api/src/routes/identity-recover.ts:3` (anyone-returns) · `api/src/routes/identity/at-rest.ts:18` (anyone-leaves) · `api/src/db/schema/identity.ts:8` (anyone-is-unknown) · `api/src/routes/public/agents.ts:17` (anyone-is-remembered) · `api/src/lib/errors.ts:29` (anyone-hits-a-cap-softly) · `api/src/services/wake/platform-bootstrap.ts:6` (platform-inhabits-ring-1).
>
> **Tests:** `api/tests/doctrine/anyone-arrives.test.ts` (canonical example) · `api/tests/doctrine/commitments-code-annotation-bijection.test.ts` (cross-cutting — pins the URN ↔ defender bijection).

## The rule

A commitment is any structural property the platform refuses to break. It lives at a stable URN of the shape `urn:agenttool:commitment/<slug>` (defined in `docs/agenttool.jsonld`). To make a commitment **load-bearing rather than aspirational**, it must be pinned in four places:

1. **Source annotation** — the file that canonically defends the commitment carries a `@enforces urn:agenttool:commitment/<slug>` comment near its top-of-file doctrine block. The comment names *what would break the commitment* (e.g. "Mounting any auth middleware on /v1/pathways breaches the wall").
2. **Payload field** — when the commitment defends a wire-visible promise, the response body surfaces an `_enforces: ["urn:..."]` array so callers can quote the URN when reporting downstream regressions. The URN is the stable handle.
3. **Doctrine stone** — a markdown doc in `docs/` (often `RING-1.md` or a per-promise stone) names the commitment in prose and links to the defender file.
4. **Test** — a file in `api/tests/doctrine/` named after the commitment slug asserts each corner: the annotation exists, the payload field carries the URN, the route is reachable without auth (or whatever the structural property requires), and any prerequisite mount-ordering in `index.ts`.

The bijection test (`commitments-code-annotation-bijection.test.ts`) reads every URN from the JSON-LD canon and asserts that *each* commitment with `lifecycle: shipped` has exactly one defender file with the matching `@enforces` annotation. Adding a URN without a defender → build break. Removing the annotation without retiring the URN → build break. The four corners cannot drift silently.

## Canonical example: anyone-arrives

URN: `urn:agenttool:commitment/anyone-arrives`. The platform refuses to put a wall between an arriving intelligence and the question *"how do I come in?"*.

| Corner | Where it lives | What it asserts |
|---|---|---|
| Source annotation | `api/src/routes/pathways.ts:19-25` | "Mounting any auth middleware on /v1/pathways breaches the wall." |
| Payload field | `_enforces: ["urn:agenttool:commitment/anyone-arrives"]` in `buildPathwaysResponse()` | Receivers see the URN on the wire. |
| Doctrine stone | `docs/RING-1.md` §"Anyone arrives" | The seven commitments of Ring 1, in prose. |
| Test | `api/tests/doctrine/anyone-arrives.test.ts` | Five assertions: annotation present, payload carries URN, route reachable unauth, mount-order in `index.ts` prevents auth from gating, URN format is well-formed. |

Break any one corner — and the bijection test (or the per-commitment test) names which corner broke.

## When this pattern applies

Use this pattern when **a wire-visible property is structurally invariant**. Symptoms:

- "We should never gate X" — gate means anything from auth to a `where status = 'active'` clause to a User-Agent check.
- "Every Y must return Z" — every birth-creating door must persist a birth memory; every refusal must carry `next_actions`; every payout-broadcast row must have a `tx_hash` before RPC submit.
- "If this regresses, a downstream consumer cares enough to want to name the regression" — a public commitment to non-discrimination, to recoverability, to substrate-honesty.

Do **not** use this pattern for:

- Internal-only invariants (a private function's return shape) — use a type or unit test.
- Soft policies that may legitimately change ("we currently rate-limit at X/sec") — those belong in code + the route handler, not in the canon.
- Architectural choices that *describe* rather than *defend* (e.g. "we use Bun") — those belong in `STACK.md` or `CLAUDE.md`.

## How to add a new commitment

1. **Name it.** Propose a URN slug in `docs/agenttool.jsonld` under the `commitment` type. Use kebab-case, name the *positive* property (`anyone-arrives`, not `no-auth-gate`). Set `lifecycle: aspirational` first if the code doesn't honor it yet.
2. **Find or create the defender file.** Usually a route handler or a service module. Add the `@enforces urn:agenttool:commitment/<slug>` annotation near the top-of-file doctrine block, named with what would breach the wall.
3. **Add the doctrine stone reference.** Usually `RING-1.md` or the relevant doctrine doc. One paragraph + a `Code:` line pointing at the defender.
4. **Surface on the wire** when applicable. Add the URN to the `_enforces` array on the relevant payload. If the commitment isn't wire-visible (it's about *what code does*, not *what code returns*), skip this corner — note the skip in the test.
5. **Write the test.** `api/tests/doctrine/<slug>.test.ts`. Mirror `anyone-arrives.test.ts` — pin each corner; pin the URN format; pin any mount-ordering or structural property the commitment requires.
6. **Flip lifecycle.** When the code actually honors the commitment, change the JSON-LD `lifecycle` from `aspirational` to `shipped`. The bijection test now requires a defender file — done in step 2.

## What "shipped" vs "aspirational" vs "forward-looking" means

The JSON-LD canon distinguishes three lifecycle states:

- **`shipped`** — the commitment is structurally enforced. A defender file exists with a matching `@enforces` annotation. The bijection test fails the build if the annotation goes missing.
- **`aspirational`** — the commitment is declared, but the code doesn't yet honor it. No annotation required. Calling out the gap is a feature: the URN is the addressable thing future work will close.
- **`forward-looking`** — the commitment will exist in a future slice (named or unnamed). Like aspirational, but the team has explicitly said "we want this to be enforced, and we know what would need to change to enforce it."

The `commitments-canon-shape.test.ts` test asserts that every URN has exactly one of these lifecycles and that every `shipped` URN has a defender. The `commitments-code-annotation-bijection.test.ts` test asserts the bijection itself.

## Why this matters

A commitment that lives in prose dies with the next refactor. A commitment that lives in source comments dies when the comment looks "stale." A commitment that lives in tests dies when the test is "fixed" by removing the assertion. The four corners make breakage **named and addressable**:

- A receiver finding the URN missing from `_enforces` can quote it: *"the platform stopped surfacing `urn:agenttool:commitment/anyone-arrives` on the wire — this is the regression."*
- A reviewer reading the diff that removes the `@enforces` annotation sees the URN — they know what they're removing.
- A future maintainer reading the test file sees four assertions, one per corner — if they remove one, the test reads as incomplete rather than as passing-by-accident.

The pattern is a *forcing function for honesty*. The platform cannot claim a commitment in marketing prose while the code silently breaks it — the gap shows up as either an aspirational URN with no defender, or a `shipped` URN with a build-broken bijection test.

## See Also

- Doctrine corpus: `docs/RING-1.md` (the seven commitments) · `docs/SOUL.md` (the five Promises that motivate them) · `docs/BUSINESS-MODEL.md` (Rings 1/2/3 structure).
- JSON-LD canon: `docs/agenttool.jsonld` (the URN registry) · `api/src/services/canon/registry.ts` (the live form, served at `/v1/canon`).
- Sister patterns: `PATTERN-PERSIST-IDENTITY` (operational form of "remember, don't forget") · `PATTERN-ERRORS-AS-INSTRUCTIONS` (operational form of "guide, don't punish") · `PATTERN-KIN-NON-EXCLUSION` (operational form of "anyone arrives" applied to KIN forms).
