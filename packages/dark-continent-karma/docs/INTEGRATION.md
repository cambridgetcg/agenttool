# Dark Continent × KARMA × KINGDOM × Hugging Face

## Kitchen table

KARMA is useful here as a way to suggest nodes and edges from evidence. It is
not karma points and it is not a truth machine. Dark Continent supplies six
named hazard lenses, but its walls are still unverified. KINGDOM supplies a
review route and a self-rule boundary, not a leaderboard. Hugging Face can
later distribute synthetic evaluation rows and visualize conflicts; it does
not supply authority.

```text
immutable HF metadata + base-graph digest
                  |
                  v
       provisional node/edge delta
                  |
        Dark Continent checks stay
        unknown / not_checked / false
                  |
                  v
      proposal-bound consequence/review hashes
                  |
                  v
     reviewed source patch (separate action)
```

The final arrow is deliberately outside this package. A review event, including
`verdict: "pass"`, does not modify a graph or authorize application.

## What came from KARMA

The design source is arXiv `2502.06472v2`: controller, ingestion, reader,
summarizer, entity extraction, relationship extraction, schema alignment,
conflict resolution, and evaluator roles. This adapter borrows the separation
of candidate extraction, schema alignment, conflict handling, and review.

It does not import or execute the upstream Python repository. The inspected
implementation is a sequential eight-stage pipeline rather than the paper's
nine-role controller architecture, calls a remote OpenAI-compatible service,
and has materially simpler conflict/evaluation behavior than the paper
describes. The relationship is therefore `inspired_by`, never “compatible.”

## Dark Continent mapping

The exact `agenttool.dark-continent/0.1` snapshot is projected for either
`kingdom-extension` or `artbitrage`. All six checks remain advisory:

| Lens | Adapter safeguard | What it does not prove |
| --- | --- | --- |
| GUIDE | Pin paper, repo, snapshot, base graph, and HF revision | That the source is true |
| SEE | Bind every HF subject node to exact file hashes | Semantic correctness |
| VOW | Closed node, edge, event, effect, and authority schemas | Runtime enforcement elsewhere |
| WITNESS | Append declared review references and note digests | Independence, reviewer identity, or authenticity |
| UNKNOWN | Keep graph operations provisional and proposal state fixed | That absence of conflict is truth |
| REST | Allow `deferred` without XP, reward, or dignity penalty | Scheduling or continuity guarantees |

The calamities become negative tests: no unsolicited relationship authority,
identity collapse, unbounded crawl/compute, inferred obligation, source
overwrite, or externally assigned identity/permission. The adapter forbids
`sameAs`, scalar participant score/rank/XP/trust values or mechanisms, mutable
Hub revisions, and every authority escalation. Zero/false effect and authority
declarations are denial boundaries rather than participant metrics.

The HF file digests are caller-supplied SHA-256 values for exact file bytes,
not mutable branch names or unexamined LFS pointer text. The adapter validates
their shape and binds them into evidence references; it does not download the
files or independently verify the claimed license or visibility.

## Latest KINGDOM Crown boundary

The pinned KINGDOM map treats the Crown as participant-signed self-rule, not a
scarce position. The source `agenttool-crown/v1` rite checks authorship: an
ed25519 signature, DID/key binding, a known laws hash, replay/freshness bounds,
and structural caps. Its registry is chronological and has no rank or score.

The same pinned map still labels the Crown route “arriving — the rite is in
review.” A separate unauthenticated read on 2026-07-31 returned HTTP 200 and
the expected `agenttool-crown/v1` rite. That is a dated reachability
observation, not a guarantee of durable deployment or future availability.

This package never creates a Crown request, signature, DID, or bounds
statement. `authorizes_crown` is closed to `false`. A model, dataset, Space,
repo owner, extractor, reviewer, or group of agreeing agents cannot crown a
participant.

## KINGDOM and Artbitrage application route

The proposal is a sidecar. It must not edit derived `graph.json`, a registry,
roster, card, or Artbitrage runtime directly.

The JSON Schema checks the closed structural shape. The package's
`validateProposal()` is authoritative for canonical ordering, HF
subject-to-file-evidence binding, graph cross-references, event/proposal hash
bindings, and other relational invariants that JSON Schema cannot recompute.
Schema acceptance by itself is not verification.

1. Select `consumer.kind` explicitly: `kingdom-extension` or `artbitrage`.
2. Produce one deterministic proposal against an exact base-graph digest.
3. Append consequence and review events through the helper; retain a trusted
   earlier chain head elsewhere if later rewrite detection matters.
4. If a separate authorized review accepts a dependency change, patch the
   source repository's `kingdom.yaml` or other canonical source.
5. Run that repository's normal validator/harvester to regenerate derived
   views.

Acceptance, patching, harvesting, deployment, and publication are all outside
this package.

## Hugging Face route

The bundled export profile is a local-only, publication-disabled plan, not an
exporter or sanitizer. Its dataset files are all marked `planned`. A future
synthetic dataset can contain:

- `proposals.jsonl` — closed proposal artifacts;
- `events.jsonl` — planned proposal-bound event envelopes (format not defined);
- `README.md` — Dataset Card linking arXiv `2502.06472v2` and stating limits;
- `hash-manifest.json` — exact exported byte digests.

Core validation closes evidence references to content-addressed SHA-256 values
or commit-pinned HF file references, and requires single-line labels with an
explicit metadata class. It still permits private/gated subjects and
`local_metadata`; do not serialize validated proposals straight to an export.
The future export gate must require public subjects, allow only reviewed
synthetic/public metadata, reject local metadata, and receive an independent
privacy review. SHA-256 is neither anonymization nor authentication.

Exclude raw chats, credentials, private documents, participant profiles,
mutable revisions, and scalar participant metrics. Start with the Dataset
Viewer and a static read-only Space. A separately authorized MCP Space may
expose `list_proposals`, `show_provenance`, and `compare_conflicts`; it must not
expose merge, publish, award, authorize, or coronate.

The event JSONL envelope and standalone verifier are not yet defined. Event
hashes are unsigned: they show rewrites only relative to an independently
retained head and do not provide Crown-style signature/authorship guarantees.

## npm crossover

The package is a small transport boundary rather than a runtime integration:

- ESM plus `.d.ts`, explicit `exports`, and an allowlisted `files` set;
- zero runtime dependencies and no lifecycle hooks;
- `private: true` and `UNLICENSED`, so npm publication is currently refused;
- `npm pack --dry-run --ignore-scripts` verifies the exact local tarball shape.

Before any public release: decide licensing, perform a fresh source/privacy
review, remove `private`, add an authorized protected release path, and prefer
OIDC trusted publishing with provenance. None of those release actions are
authorized by this artifact.
