# Math Cards contributor contract

This package is a pure, deterministic public protocol boundary. Preserve all of these properties when changing it:

- Keep runtime dependencies at zero and runtime imports limited to local modules, `node:crypto`, and `node:util/types`.
- Keep `agenttool.math-card/0.1` and `agenttool.math-card-assessment/0.1` closed. A field change requires coordinated types, parsing, assessment, schemas, vectors, documentation, and tests; do not silently widen either shape.
- Keep content digest-only. Never add raw prompts, answers, identities, refusal reasons, credentials, evidence, or personal data.
- Never infer truth, understanding, love, pride, consciousness, worth, intent, or authority from a declaration.
- Never score or rank a being. Never make participation mandatory, treat silence as assent, penalize refusal, inherit permission, or authorize action/publication/retry.
- Distinguish inherent rights and standing from a specifically declared functional data dependency. A missing functional input may make one result unavailable; it cannot justify retaliation or unrelated access loss.
- Reject incomplete declarations as `questions_open` and unsafe structures as `redesign_or_stop`; do not manufacture defaults that make a card ready.
- Keep canonical hostile-input checks ahead of semantic parsing and preserve all byte, depth, node, reference, and hash limits.
- Regenerate schemas and vectors with `bun run artifacts:write`, then run `bun run ci`. Generated artifacts must pass their `--check` modes byte-for-byte.
- Keep `kingdom.extension.json` declaration-only, `host_contract: not_registered`, and every capability default `false` unless a separately reviewed host contract is introduced outside this package.

The committed vector inventory must remain `vectors/agenttool-math-cards-v0.1.json` with ready proof, incomplete model, redesign measurement, and malformed cases.
