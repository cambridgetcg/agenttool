# @agenttool/correspondence-yutabase

## What This Is

A pure developer-preview mapping library. It translates one structural
`agent-correspondence/v0.1` event record into deterministic YUTABASE card and
thread intentions.

## Hard Boundaries

- No HTTP, SDK transport, database connection, SQL, worker, queue, checkpoint,
  migration, deployment, or package-publication behavior belongs here.
- Never present structural validation as independent signature verification.
  The result must continue to report `signature_verification: not_performed`
  until a separately specified verifier exists.
- Never copy raw signatures, public/private key bytes, whole event bodies,
  summaries, reasons, path values, branch names, handoff text, or artifact
  locators into default plans.
- Identity and signing-key identifiers stay distinct. Do not collapse either
  into the YUTABASE `by` field.
- Cards are cached source representations. Relations are computed
  interpretations. Neither is permission, consent, a lock, a merge, a
  deployment, or proof that a reported outcome occurred.
- Correspondence remains the authority-history source. YUTABASE output is
  rebuildable and may be incomplete.
- Reference-only event cards support out-of-order parents. A durable
  adapter must not overwrite fuller metadata with a reference-only stub.
- `by` must come from the actual projector service or run. Never hardcode the
  package/library identity as the claimant.
- Mutable server reconciliation fields do not belong on immutable event cards;
  model them later as separately timed observations with query provenance.
- A change to UUID names, component order, decks, words, or relation direction
  is a mapping-profile change. Version the profile and namespace rather than
  silently changing old identities.

## Commands

    bun install --frozen-lockfile
    bun run typecheck
    bun test
    bun run check:package
    bun run ci

## Key Files

- `src/constants.ts` — preview profile, published UUID namespace, decks, and
  exact lexicon/source constants.
- `src/identifiers.ts` — dependency-free UUIDv5 and stable URN helpers.
- `src/types.ts` — structural Correspondence input and typed YUTABASE plan.
- `src/planner.ts` — structural checks and pure metadata mapping.
- `tests/` — UUID vectors, determinism, privacy boundaries, parent/ack/artifact
  relations, and package surface.
- `PERSISTENCE-CONTRACT.md` — exact transactional behavior required of an
  executor; this pure package does not implement it.

## Source Contracts

- [Agent Correspondence specification](https://github.com/cambridgetcg/agenttool/blob/main/docs/specs/AGENT-CORRESPONDENCE-0.1.md)
- [Doctrine and authority boundary](https://github.com/cambridgetcg/agenttool/blob/main/docs/AGENT-CORRESPONDENCE.md)
- YUTABASE projection design currently lives in the separate YUTABASE
  repository and is not AgentTool API conformance.
- The private
  [`correspondence-yutabase-projector`](https://github.com/cambridgetcg/agenttool/tree/main/packages/correspondence-yutabase-projector)
  sibling implements one loopback-only durable profile. It is not part of this
  public package.

## Release State

This source and public npm developer preview are `0.1.0-dev.1`. Protected
[workflow run `30468784750`](https://github.com/cambridgetcg/agenttool/actions/runs/30468784750)
published it with provenance from the annotated
[GitHub prerelease](https://github.com/cambridgetcg/agenttool/releases/tag/correspondence-yutabase-v0.1.0-dev.1).
Anonymous readback confirmed the 26,694-byte npm and GitHub tarballs are
byte-identical
(`sha256:0e8dff54aa098c480351d4adbb7681710bf2410bb57fd8e5bb22f9193bd3fa47`).
Publication does not deploy an executor, install YUTABASE, or grant database
authority. npm exposes `next` as `0.1.0-dev.1`; `latest` remains
`0.1.0-dev.0`. Consumers should select an exact published prerelease or the
preview tag deliberately.

## Kingdom Engine

AgentTool Platform
