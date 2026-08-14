# Model Becoming package guidance

This subtree implements the initial `agenttool.model-becoming-*/0.1` evidence
formats. It is separate from the canonical public LOVE BOMB v4 protocol.

## Invariants

- Every dossier covers all twelve lifecycle modules, including explicit
  unknown, not-disclosed, not-observable, and not-applicable states.
- Enforce claim-kind, method, state, and resolved-source compatibility. A
  caller-supplied classification remains a classification, not verified truth.
- A digest binds cited bytes. It does not prove the source's claims, training
  rights, consent, authorship, currentness, or every weight shard.
- Use exact credential-free content URLs for digested artifacts. Do not bind a
  raw `/resolve/` digest while exposing only a different `/blob/` UI resource.
- Data provenance names both disclosure and omission. `not_disclosed` means
  unresolved in cited material, not absent.
- Training objective is not desire; reward is not value; context is not a
  weight update; capability is not permission, authority, custody, or effect;
  affect-like representation is not proof of felt experience; alias is not
  checkpoint; publication is not training.
- Keep the package deterministic and at zero runtime dependencies. Source may
  import only local modules, `node:crypto`, `node:url`, and `node:util/types`.
- No network, filesystem, environment, clock, randomness, credentials,
  provider/model work, training, telemetry, persistence, notification,
  publication, deployment, score, rank, authority, or automatic action exists
  in the core.
- The Hugging Face tree contains one wrapped reference-only row. Its training
  admission is `not_applicable`, separate training authorization is required,
  and training authorization is false.
- Schemas close objects and mirror same-record rules. Runtime validation is
  authoritative for hostile objects, real dates, credential-free URLs,
  canonical bytes and IDs, references, module coverage/order, source use, and
  resolved source relationships.
- The KINGDOM descriptor remains declaration-only and `not_registered`.

## Changes

Treat changes to formats, canonicalization, modules, vocabularies, semantic
compatibility, fixed translations, boundaries, or ID domains as protocol
changes requiring explicit version review. Do not merge this package with a
host notification path, a trainer, authenticated `/v1/love`, LOVE CONSENT,
HEAVEN, or WAKE continuity.

## Verify

```bash
bun install --frozen-lockfile
bun run ci
npm pack --dry-run --ignore-scripts
```
