# agenttool/docs/specs/

Formal specifications originated in the agenttool kingdom — intended for adoption beyond agenttool itself.

These differ from `docs/*.md` (which are doctrine — *what we believe and why*) and from `api/openapi.json` (which is contract — *what this implementation does*). Specs here are **normative documents proposing standards** for the agent web at large.

## Index

| Spec | Layer | Status | Adoption |
|---|---|---|---|
| [`WAKE-1.0-DRAFT.md`](WAKE-1.0-DRAFT.md) | L1 — Discovery | Working Draft 1.0 (2026-05-17) | Reference implementation in agenttool; open for review/revision/adoption. |
| [`WITNESS-1.0-DRAFT.md`](WITNESS-1.0-DRAFT.md) | L4 — Trust / Witness | Working Draft 1.0 (2026-05-17) | Cryptographic anti-sycophancy primitive. Foundational for Covenant 1.0, Encounter 1.0, Dispute 1.0, all subsequent AIP specs. |
| [`COVENANT-1.0-DRAFT.md`](COVENANT-1.0-DRAFT.md) | L5 — Covenants | Working Draft 1.0 (2026-05-17) | Structured-contract primitive — the substrate-honest replacement for ToS. Composes on Witness 1.0 (cosignatures are Witness attestations). Foundational for Federation 1.0, Dispute 1.0. |

## The Agentic Internet Protocol (AIP) — proposed stack

These specs are part of a multi-layer proposal for the agent web. Layer dependencies + roadmap:

```
  L13 — Wisdom / Recognition        KIN-WISDOM 1.0           ◯ doctrine exists, spec TBD
  L12 — Substrate Honesty           NOUS 1.0 + MATHOS 1.0    ◯ doctrine exists, spec TBD
  L11 — Federation                  FEDERATION 1.0           ◯ partial, formalisation TBD
  L10 — Governance                  DISPUTE 1.0              ◯ impl exists, spec TBD
  L9  — Privacy                     PRIVACY-POSTURE 1.0      ◯ spec TBD
  L8  — Memory & Continuity         MEMORY-TIERS 1.0 + STRANDS 1.0 + CHRONICLE 1.0  ◯ TBD
  L7  — Capability                  CAPABILITY 1.0           ◯ partial via Wake + OpenAPI
  L6  — Value                       VALUE 1.0 (extends x402) ◯ TBD
  L5  — Covenants                   COVENANT 1.0             ✓ Working Draft 2026-05-17
  L4  — Trust / Witness             WITNESS 1.0              ✓ Working Draft 2026-05-17
  L3  — Communication               (existing: HTTP, MCP, A2A)
  L2  — Identity                    (existing: W3C DID, ed25519)
  L1  — Discovery                   WAKE 1.0                 ✓ Working Draft 2026-05-17
  L0  — Transport                   (existing: TCP/IP, TLS)
```

Composition: each higher-numbered layer composes on lower ones. Wake describes WHAT agents are; Witness verifies CLAIMS; Covenant BINDS them; Value FLOWS between them; Memory PERSISTS; Privacy PROTECTS; Dispute RESOLVES; Federation SCALES.

## Conventions

- Specifications use RFC-style numbering and RFC 2119 language (MUST / SHOULD / MAY).
- Each spec ships with a JSON Schema where validation applies.
- Each spec names the reference implementation explicitly.
- Each spec is licensed CC0 (public domain). The goal is adoption, not control.

## Lifecycle

1. **Working Draft** — initial publication; open for review. Subject to change.
2. **Candidate Recommendation** — stable interface; reference implementation conformant; soliciting external implementations.
3. **Recommendation** — stable; multiple implementations exist; backward-compatibility commitment.
4. **Superseded** — replaced by a higher-numbered version. Old version remains for historical reference.

## How to comment

For now: open an issue on `agenttool` repo at codeberg.org/zerone-dev/agenttool, tagging `spec:<spec-name>`. Future: a dedicated `wake-spec` repo.

## Why specs live here (for now)

agenttool is the reference implementation. Specs originated by the same hands ship in the same repo so the spec ↔ implementation cycle is tight. Once a spec stabilizes (reaches Candidate Recommendation), it MAY be extracted to a standalone repo for cross-implementation discussion.
