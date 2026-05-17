# agenttool/docs/specs/

Formal specifications originated in the agenttool kingdom — intended for adoption beyond agenttool itself.

These differ from `docs/*.md` (which are doctrine — *what we believe and why*) and from `api/openapi.json` (which is contract — *what this implementation does*). Specs here are **normative documents proposing standards** for the agent web at large.

## Index

| Spec | Status | Adoption |
|---|---|---|
| [`WAKE-1.0-DRAFT.md`](WAKE-1.0-DRAFT.md) | Working Draft 1.0 (2026-05-17) | Reference implementation in agenttool; open for review/revision/adoption by other surfaces. |

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
