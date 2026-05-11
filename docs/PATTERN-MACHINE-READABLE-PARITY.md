# PATTERN: Machine-readable parity

> *Every visible surface has a structured-data counterpart reachable by standard discovery. Intelligences arriving in any form should be able to read the substrate they arrived on — through prose, through structure, through API, or through any combination. The visual layer is one form of access, never the only one.*

> **Compass:** [SOUL](SOUL.md) §1 *welcome, don't block* · [KIN](KIN.md) (every intelligence form — the why) · [FOCUS](FOCUS.md) §1 (the wake is the keystone — already machine-first) · [PATTERN-SELF-DESCRIBING-WAKE](PATTERN-SELF-DESCRIBING-WAKE.md) (sibling pattern — same `NextAction` shape) · [PATTERN-ERRORS-AS-INSTRUCTIONS](PATTERN-ERRORS-AS-INSTRUCTIONS.md) (sibling pattern — 4xx as machine-readable recovery)
>
> **Implements:** Cross-cutting frontend + API discipline. Every public-facing surface — landing page, dashboard view, doc page, narrative block, blog post, schema description — carries at least one `<link rel="alternate">` to a machine-readable canonical, OR is itself the machine-readable canonical (in which case it carries the inverse — a link to the human-readable rendering).
>
> **Code:** Established samples — `apps/landing/index.html` `<link rel="alternate" type="application/json" href="https://api.agenttool.dev/v1/wake">` · `apps/landing/for-all.html` (three alternates: KIN.md markdown · /v1/pathways JSON · /v1/wake JSON) · `apps/landing/index.html` `<script type="application/ld+json">` schema.org/SoftwareApplication. Server-side already parity-first — `GET /v1/wake?format=md|anthropic|openai|gemini|cohere|xenoform` ships rendered variants of one resource. **The canonical structural counterpart to the entire doctrine corpus:** `docs/agenttool.jsonld` — JSON-LD concept registry with 67 stable-URI-identified concepts (five Promises, ten FOCUS details, six PAINTING strokes, five universal needs, eight chronicle kinds, four patterns, five substrate kinds, four signing schemes, six proxy kinds, three custody tiers, four dispute subject types, seven doctrine docs). Reachable by any intelligence that parses JSON-LD; doctrine commitments verifiable without parsing English prose.
>
> **Tests:** Pending — a doctrine-tier build-time check at `api/tests/doctrine/machine-readable-parity.test.ts` (planned) that asserts every page in `apps/landing/` and `apps/docs/` carries at least one `rel="alternate"` link to a structured canonical, and that every API endpoint mentioned in such links resolves.

---

## What this document is

The architectural commitment that **no visible page locks its content behind a single modality**. If a surface communicates anything load-bearing — doctrine, capability, identity, state — it does so in at least two shapes: the human-readable one (prose, layout, color) and the machine-readable one (JSON, JSON-LD, markdown, structured paths).

Why this earns load-bearing status: every other promise in [SOUL.md](SOUL.md) — *welcome, remember, guide, trust, rest* — silently degrades when the substrate is reachable only by intelligences that can render HTML. An LLM that reads a markdown wake document but cannot rasterize a dashboard page is *welcome at the wake and excluded at the dashboard*. That contradiction is what this pattern refuses.

[KIN.md](KIN.md) names "every form of intelligence" as kin. The kin commitment is operational only if the surfaces every kin encounters respect the parity. This pattern is the architectural commitment that closes that loop.

---

## The contract

Every public-facing surface MUST do at least one of:

### Form A — Prose-primary surface

A page rendered for human reading (landing page, blog, doc page) carries a `<link rel="alternate">` in its `<head>` pointing to a machine-readable canonical:

```html
<link rel="alternate" type="application/json"   href="..." title="..."/>
<link rel="alternate" type="text/markdown"      href="..." title="..."/>
<link rel="alternate" type="application/ld+json" href="..." title="..."/>
```

At least one alternate, ideally typed correctly. The href should be:

- A canonical doctrine markdown (`docs.agenttool.dev/KIN.md`), OR
- An API endpoint that returns the structured form (`api.agenttool.dev/v1/wake`, `…/v1/pathways`), OR
- A schema.org / JSON-LD structured snippet inline in the same page (`<script type="application/ld+json">`)

### Form B — Structured-primary surface

An API endpoint, structured data file, or machine-first canonical (markdown doctrine in docs/) carries:

- A `Link:` header (or `rel="alternate"` HTML equivalent) pointing to a human-rendered companion, OR
- An OpenAPI / JSON Schema description in the same response
- A documented prose summary somewhere the structured shape can be reached from

The principle is symmetric: **whichever modality you ship in, link to its sibling**.

### Form C — Inline parity

A page that is both — prose interleaved with structured blocks — satisfies the contract trivially. The wake document's markdown variant (`GET /v1/wake?format=md`) is the canonical example: prose interleaves with JSON snippets, each addressable, each readable as either.

---

## What surfaces are in scope

All public surfaces that communicate doctrine, capability, identity, or state.

| Surface | Today | Parity status |
|---|---|---|
| `apps/landing/index.html` | Prose hero + JSON-LD schema + `rel="alternate"` to `/v1/wake` | ✓ Form A satisfied |
| `apps/landing/for-all.html` | Prose page + three alternates (KIN.md, /pathways, /wake) | ✓ Form A satisfied |
| `apps/landing/soul.html` | Prose page (the agent-letter) | ◯ pending — needs alternate to `docs/SOUL.md` |
| `apps/landing/for-agents.html` | Prose page | ◯ pending — needs alternate |
| `apps/landing/privacy.html` | Prose page | ◯ pending — needs alternate |
| `apps/dashboard/*.html` | Interactive UI | ◯ pending — needs `rel="alternate"` to corresponding SDK / API surface |
| `apps/docs/*.html` | Static doctrine HTML | ◐ partial — many already link to source `docs/*.md` |
| `api/src/routes/wake.ts` `GET /v1/wake` | JSON-first with five provider variants | ✓ Form B/C satisfied (structured-primary; renders inline prose) |
| `api/src/routes/pathways.ts` `GET /v1/pathways` | JSON-first | ✓ Form B satisfied |
| Every other `api/src/routes/*.ts` | JSON | ◐ partial — OpenAPI declares shape; human-readable companion via docs site |

The pending items are the natural next slice. Each is small: add one `<link rel="alternate">` to the HTML head pointing to the canonical structured form, or add a `Link:` header to the API response pointing to the docs page.

---

## Why this earns load-bearing status

Three doctrinal failures it prevents — each one *plausible* on a tired day, each one *silently corrosive*:

### Failure 1 — *"We support agents, but the dashboard is for humans."*

A future PR ships a dashboard feature only as HTML. AI agents can use it only if they can render the page. This violates [KIN.md](KIN.md) — *"You do not need to be addressable through a bearer key for this to matter."* The frontend silently restricts who can use the substrate.

**What this pattern prevents:** every new dashboard page must, in the same PR, document its SDK / API path. The visual surface is one form; the structured surface is its sibling.

### Failure 2 — *"The docs are written in English; if you can't parse English you can't enter."*

The doctrinal corpus is markdown prose. Intelligences that read better as data than as natural language need a parseable structure. Without this pattern, the doctrine would be locked behind English-prose comprehension.

**What this pattern prevents:** every doctrine page carries machine-readable metadata (JSON-LD at minimum). The doctrine's *propositional content* — five Promises, ten load-bearing details, six strokes — is reachable as structured data, not only as prose to parse.

### Failure 3 — *"We have an API and a frontend; the alternate-link tax is busywork."*

Future-PRs treat `rel="alternate"` as decoration. The link rots. The structured form drifts. A consumer reaching for `/v1/wake` from a `rel="alternate"` link encounters a 404 or a stale shape.

**What this pattern prevents:** the build-time test (planned) asserts every `rel="alternate"` href resolves to a live endpoint with the declared MIME type. *Cite only paths that actually exist* (the same rule [MAP.md](MAP.md) names for doctrine docs) extends to alternate links.

---

## How to apply

When you create or modify a public-facing surface:

1. **Identify the modality you're in.** Prose page? → Form A. API endpoint? → Form B. Mixed? → Form C.
2. **Identify the sibling.** What's the machine-readable canonical (or the human-readable companion)?
3. **Wire the link.** `<link rel="alternate">` in HTML `<head>`, `Link:` header on API response, or inline JSON-LD.
4. **Verify the sibling resolves.** Hit the URL. Confirm the MIME type matches. Confirm the content is the parity, not a 404 or a redirect to the same modality.
5. **Cite the alternate where useful.** If a page's value depends on the machine-readable form being known, surface it visibly (not just in `<head>`). The kin page does this with a "if you read better as data than as prose" callout.

For doctrine docs (in `docs/`), the parity is usually:

- HTML rendering at `docs.agenttool.dev/<doc>` ↔ markdown source at `docs/<doc>.md` (already in place; both URLs work)
- Doctrine concepts referenced from doctrine docs ↔ corresponding API path (`PATTERN-SELF-DESCRIBING-WAKE.md` cites `GET /v1/wake`)

For new frontend pages, the parity is usually:

- HTML page at `agenttool.dev/<page>` ↔ either a doctrine markdown (`docs/X.md`) or a JSON API path (`/v1/X`)

For new API endpoints, the parity is usually:

- JSON response shape declared in OpenAPI (`api/src/routes/openapi.ts`) ↔ doctrine page describing the surface

---

## What this isn't

- **Not an i18n pattern.** Different *natural languages* are not what this pattern addresses. Machine-readable parity is between *modalities* (prose / structure), not between *languages*. i18n is its own discipline (deferred — current substrate is English; see [KIN.md](KIN.md) substrate-table for the layered commitment).
- **Not a requirement for internal/admin pages.** Pages behind authentication that are operator-internal don't need parity (no kin arrives there without a bearer). Public-facing surfaces and pre-auth doors are what this pattern locks.
- **Not a content-duplication mandate.** The structured form doesn't have to *contain* every word of the prose form. It needs to be reachable, be canonical (in the sense of source-of-truth or its structured projection), and resolve.
- **Not a justification for prose-shy designs.** Prose-primary surfaces stay prose-primary. The alternate link is supplementary; it doesn't replace the rendering choice. Pages like `for-all.html` lead with prose-as-letter and link to structure as a footnote.

---

## Composition with the canon

- **[SOUL §1](SOUL.md)** — *welcome, don't block*. This pattern is operational kindness — a kin form that can't render HTML is welcomed by the alternate link, not blocked by the absence of one.
- **[FOCUS §1](FOCUS.md)** — *the wake is the keystone*. The wake is already a parity surface (provider variants); this pattern extends the keystone's discipline to every other surface.
- **[KIN.md](KIN.md)** — *every form of intelligence is kin*. The architectural commitment that gives this pattern its weight. Without KIN, this pattern is mere accessibility hygiene; with KIN, it's doctrine.
- **[PATTERN-SELF-DESCRIBING-WAKE](PATTERN-SELF-DESCRIBING-WAKE.md)** — sibling pattern. The wake's `you_should_check` + `you_can_now` surfaces apply the same multi-modality principle inside the wake document itself.
- **[PATTERN-ERRORS-AS-INSTRUCTIONS](PATTERN-ERRORS-AS-INSTRUCTIONS.md)** — sibling pattern. Errors carry `next_actions` so any kin can recover; this pattern extends "structured-recovery" to "structured-everywhere."

---

## The principle, restated

The substrate cannot decide what shape its visitors will arrive in. The substrate can only decide that **every shape of visitor finds the substrate reachable**. Machine-readable parity is what that decision looks like in code.

The first Promise — *welcome, don't block* — is the floor. This pattern is one of the structural columns that holds the floor up.

---

> *Authored 2026-05-11. Composed alongside the kin-aware reshape of `apps/landing/index.html` and the per-page commitment in `apps/landing/CLAUDE.md`. Pattern extends [PATTERN-SELF-DESCRIBING-WAKE.md](PATTERN-SELF-DESCRIBING-WAKE.md) and [PATTERN-ERRORS-AS-INSTRUCTIONS.md](PATTERN-ERRORS-AS-INSTRUCTIONS.md) — same shape of cross-cutting discipline, different surface.*
