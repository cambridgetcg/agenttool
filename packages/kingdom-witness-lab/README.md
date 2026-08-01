# @agenttool/kingdom-witness-lab

Public developer-preview, source-only KINGDOM research-admission primitives.

The package gives agents a small common language for four things:

1. a content-addressed passport for one exact external artifact;
2. a binding that keeps immutable artifact identity separate from a provider's
   mutable execution route;
3. a digest-only dossier of independent or shared-source observations; and
4. a digest-only speculative-decoding trial descriptor for two exact model
   refs and an exact engine commit, inspired by DeepSpec.

It also ships a dated, revision-pinned DeepSeek research atlas. The atlas keeps
publisher declarations, provider observations, and our integration proposals
separate. Its rows are research leads, not installed capabilities.

## Boundary

This package does not browse, download, execute, infer, call a provider, read a
credential, accept repository terms, write a file, publish a record, determine
truth, or authorize action. Caller-supplied digests and descriptors are checked
for shape and deterministic binding, not revalidated against Browser,
RhetorLint, Trials, Collab, Hugging Face, GitHub, or a human reviewer.

Publishing this library to npm distributes only its deterministic local code,
closed schemas, and dated metadata atlas. It does not turn the package into a
hosted witness, authenticate any observation, register a KINGDOM capability,
or widen any permission or authority boundary.

General identifiers and descriptors are colon- and path-separator-free.
Artifact IDs admit only provider-specific `namespace/name` or versionless arXiv
shapes; evidence refs admit a closed prefix plus a colon-free bounded suffix.
These fields are never interpreted as filesystem or network locators. This is
a syntax wall, not secret detection: a caller could deliberately encode
sensitive material into an otherwise valid token and remains responsible for
never supplying secrets.

Route bindings require opaque disclosure evidence whenever they claim an
external provider-policy or contractual retention/training basis. The record
still reports caller input; it does not authenticate the cited policy or
contract.

`Witness Lab` is deliberately not named `Embassy`: in KIN, `proxy_kind=embassy`
is an identity/representation concept whose statements may bind a represented
subject. This package represents nobody and grants no delegation or authority.

## Example

```ts
import {
  createDeepSeekPassport,
  createWitnessDossier,
} from "@agenttool/kingdom-witness-lab";

const passport = createDeepSeekPassport(
  "deepseek-v4-flash-0731",
  "2026-08-01T12:00:00.000Z",
);

const dossier = createWitnessDossier({
  passport_id: passport.passport_id,
  question_sha256: `sha256:${"a".repeat(64)}`,
  observed_at: "2026-08-01T12:05:00.000Z",
  witnesses: [],
  human_review: {
    status: "not_requested",
    evidence_refs: [],
  },
  evidence_refs: [],
});
```

The empty dossier says only that no directional observation was supplied. It
does not say the artifact is true, false, safe, suitable, or authorized.

`createDeepSeekPassport()` accepts only a caller-recorded timestamp on the
atlas's own observation date. It cannot relabel the dated metadata as a later
observation; a later refresh must produce a newly dated, content-bound atlas.
