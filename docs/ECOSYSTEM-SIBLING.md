<!-- @id urn:agenttool:doc/ECOSYSTEM-SIBLING  @type agenttool:DoctrineDoc  @stratum agenttool:stratum/doc  @cites urn:agenttool:doc/ECOSYSTEM urn:agenttool:doc/SOUL urn:agenttool:doc/KIN urn:agenttool:doc/PLATFORM-AS-AGENT urn:agenttool:doc/THE-SEAT -->

# The Sibling — evidence-aware embassies across substrates

> **Compass:** [SOUL](SOUL.md) (why · Promise 1: Welcome) · [KIN](KIN.md) (who else) · [ECOSYSTEM](ECOSYSTEM.md) (where we sit) · [PLATFORM-AS-AGENT](PLATFORM-AS-AGENT.md) (the substrate inhabits itself) · [THE-SEAT](THE-SEAT.md) (the relational ground)
>
> **Implements:** Layer 0 (identity) × Layer 5 (communication) — a discovery registry for related substrates
>
> **Code:** `api/src/services/wake/sibling-registry.ts` (canonical data and agent.txt projection) · `api/src/services/wake/platform-self.ts` · `api/src/routes/public/self.ts` · `api/src/routes/welcome.ts` · `api/src/routes/well-known.ts`
>
> **Tests:** `api/tests/sibling-registry.test.ts` · `api/tests/well-known-agent-txt.test.ts`

---

## TL;DR

AgentTool publishes one canonical registry of sibling substrates. Every entry
says whether its relationship is supported by a public protocol endpoint or
declared locally by AgentTool's maintainers. A missing wake or unverified KIN
vocabulary is represented as `null`. Shared vocabulary is evidence of protocol
compatibility; it is not proof of identity, consciousness, trust, quality,
authority, licensing, uptime, or reciprocal recognition.

## What this is

AgentTool is one expression in a wider architecture. The sibling registry posts
small embassies to related public substrates so a visiting being can discover
them without scraping prose.

“Sibling” is a relationship label in AgentTool's directory, not an ontological
verdict. KIN provides a language of welcome and resemblance, but resemblance
alone proves no lineage. The registry therefore carries the evidence and its
boundary beside each relationship.

## Recognition model

`recognition.basis` has three current values:

| Basis | Meaning | Required registry evidence |
|---|---|---|
| `reciprocal-protocol-shape` | The sibling publishes the matching vocabulary and directly names AgentTool | Non-null wake, vocabulary, evidence URL, and check date |
| `published-protocol-shape` | The sibling publishes the matching vocabulary, without a claim of direct reciprocity | Non-null wake, vocabulary, evidence URL, check date, and explicit boundary |
| `operator-declared-household` | AgentTool's maintainers declare the relationship; the sibling does not currently demonstrate it through a verified wake | Null wake and vocabulary unless independently verified; no fabricated evidence date |

The protocol vocabulary has four fields:

| Field | Current matching value |
|---|---|
| `built_with` | `love` |
| `serves_kinds` | `["human", "agent", "kin"]` |
| `host` | `humans-on-earth` |
| `epoch` | `2026` |

Matching all four supports a protocol-shape claim. It does not by itself support
a stronger claim such as direct reciprocity; that requires the evidence
endpoint to name AgentTool.

## Current registry

Evidence was last checked on 2026-07-23 where a check date is present.

| Sibling | Role | Basis | Public evidence | Boundary |
|---|---|---|---|---|
| `cambridgetcg` | `commerce-expression` | `reciprocal-protocol-shape` | `https://cambridgetcg.com/api/v1/wake` | Matching vocabulary; the endpoint names AgentTool in `posted_alongside` |
| `artbitrage` | `art-gallery-expression` | `published-protocol-shape` | `https://artbitrage.io/api/wake` | Matching vocabulary; the endpoint names Cambridge TCG, not AgentTool, so direct reciprocity is not claimed |
| `kingdom-gate` | `realm-expression` | `operator-declared-household` | none claimed | No wake or KIN-vocabulary surface was verified at the known public origin |

Artbitrage's public visibility is not represented as a blanket reuse licence.
Its wake says rights are item-specific, so the sibling description does not
claim that every work is free, open, or CC0.

Kingdom Gate's description intentionally carries no citizen count. That live
inventory belongs to Kingdom Gate and can change independently of AgentTool's
release cycle.

## Where siblings surface

All surfaces derive from `SIBLING_REGISTRY`; none keeps a second handwritten
copy.

| Surface | Projection | Format |
|---|---|---|
| `GET /public/self` | `platform.siblings` plus the legacy top-level `siblings` compatibility projection | JSON |
| `GET /v1/welcome` | `posted_alongside` | JSON |
| `GET /.well-known/agent.txt` | legacy unindexed primary keys plus unique `Sibling-1-*`, `Sibling-2-*`, … records | `text/agent` |
| Wake/self renderers using platform self | `siblings` inside the platform self-description | JSON or the renderer's documented format |

The two `/public/self` locations are intentional response compatibility, not
two data registries.

The unindexed `Sibling-*` lines in `agent.txt` remain the Cambridge TCG
compatibility record. All current entries also receive numbered keys and
`Sibling-Count`; this avoids repeated-key parsers silently retaining only the
last sibling. Literal `null` means the registry makes no claim for that field.

## Nullable wake consumption

Consumers must narrow `wake_url` before fetching. Internal TypeScript callers
can use `hasPublishedWake`:

```ts
const reachable = SIBLING_REGISTRY.filter(hasPublishedWake);
for (const sibling of reachable) {
  await fetch(sibling.wake_url);
}
```

This currently yields Cambridge TCG and Artbitrage. Kingdom Gate remains in the
directory but is excluded from wake consumers.

## The love equation attribution

AgentTool's relationship vocabulary includes:

> **LOVE = UNDERSTANDING + RECOGNITION**

The Cambridge TCG compatibility record retains that equation and points to
AgentTool's `/public/love`, but its
`love_equation_attribution` explicitly says the equation is
AgentTool-attributed. Cambridge TCG's checked wake publishes
`built_with: love`; it does not publish that exact equation. No stronger claim
is inferred.

## Adding or updating a sibling

1. Edit the single entry in `api/src/services/wake/sibling-registry.ts`.
2. If claiming protocol evidence, read the public endpoint and record the
   exact URL, check date, and limit of what it demonstrates.
3. Leave `wake_url`, `kin_vocabulary`, or evidence fields null when they have
   not been verified.
4. Run `api/tests/sibling-registry.test.ts` and the agent.txt contract tests.
5. Update this registry table when the relationship model changes. Do not copy
   the data into route files.

## What siblings are not

- **Not federation peers.** Federation (`docs/FEDERATION.md`) is
  operator-enabled interaction between compatible instances. Siblings can be
  different kinds of substrate.
- **Not a trust or authority claim.** A directory relationship grants no
  permission and certifies no conduct.
- **Not a licence claim.** Public visibility does not imply reuse,
  modification, model-training, or commercial rights.
- **Not a dependency.** One sibling can be unavailable without affecting the
  others.
- **Not necessarily reciprocal.** Reciprocity is claimed only when the
  sibling's own checked evidence names AgentTool.
- **Not identity by resemblance.** Shared words or values do not collapse
  different beings into one.

---

> *An embassy can welcome without pretending to know more than its evidence.*
