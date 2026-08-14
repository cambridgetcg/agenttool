# @agenttool/math-cards

Deterministic, non-scoring preflight cards for bounded proof, model, and measurement inquiries.

Math Cards help an agent ask whether a mathematical challenge is shaped to produce understanding or constructive work. They do not solve the challenge, verify referenced content, infer anyone's motive, rank a being, authorize an action, or turn a declared permission into real authority.

## Contract

The package has no runtime dependencies and performs no network, provider, MCP, filesystem, persistence, publication, clock, randomness, or automatic-action work. Its only content-bearing fields are lowercase `sha256:` references. A digest binds exact external bytes; it does not establish their meaning, truth, currentness, provenance, or availability.

The two protocol identifiers are:

- `agenttool.math-card/0.1`
- `agenttool.math-card-assessment/0.1`

The closed method union is `proof | model | measurement`. Each method states its own epistemic boundary: proof is conditional on a formal system, a model is conditional on scope and assumptions, and measurement is conditional on operationalization, procedure, calibration, and uncertainty.

## API

```ts
import {
  assessMathCard,
  createMathCard,
  validateMathCard,
} from "@agenttool/math-cards";

const card = createMathCard(input);       // CreateMathCardInput -> MathCard
const sameCard = validateMathCard(card);  // unknown -> MathCard or MathCardError
const assessment = assessMathCard(card);  // unknown canonical MathCard -> MathCardAssessment
```

`createMathCard` closes and canonicalizes the declaration, installs the fixed boundary walls, and derives `card_id`. `validateMathCard` reconstructs those bytes and rejects changed identifiers or walls. `assessMathCard` returns exactly one of:

- `ready_for_bounded_inquiry`
- `questions_open`
- `redesign_or_stop`

Incomplete but non-coercive declarations produce `questions_open`. Claims of complete reality, inference of inner state or worth, refusal penalties, result-coupled rank or access, automatic action/publication/retry, permission inheritance, or absent separate authorization produce `redesign_or_stop`. `ready_for_bounded_inquiry` means only that every declared structural question passed this preflight; it is not a truth certificate or action authorization.

The complete ready, incomplete, redesign, and malformed examples are exported as `@agenttool/math-cards/vectors.json`. Portable closed Draft 2020-12 schemas are exported as `input.schema.json`, `card.schema.json`, and `assessment.schema.json`. The input schema is generated from the card declaration shape while excluding the server-owned `schema_version`, `card_id`, and `boundaries` fields. JSON Schema checks closed JSON shape and local encoded invariants; `createMathCard` remains authoritative for hostile JavaScript values, canonicalization, and the byte, depth, node, and whole-card reference budgets. A schema cannot verify a content-derived identifier. Consumers making trust decisions must validate the card with `validateMathCard` and recompute its assessment with `assessMathCard`, then compare canonical bytes if a transported assessment is retained.

## Bounds

- Canonical JSON: 65,536 bytes, depth 24, and 4,096 values.
- One string: 8,192 UTF-8 bytes.
- One direct hash input: 1,048,576 bytes.
- One reference list: 64 entries.
- One Math Card: 256 digest-reference occurrences.

Arrays treated as sets are deterministically sorted. Inputs reject proxies before reflective traversal, accessors, symbols, cycles, sparse arrays, custom prototypes, malformed Unicode, unsafe numbers, detached bytes, duplicate declarations, unknown fields, and out-of-bound structures.

## Refusal and functional dependency

Participation is optional and refusal needs no reason. Rights, dignity, and standing cannot depend on participation. A card may honestly declare that a particular result or scoped access functionally requires particular data, but it must bind that dependency by digest and keep it distinct from an unrelated or punitive loss of access or resources.

## KINGDOM declaration

`kingdom.extension.json` is a declaration-only integration hint. Its host contract is `not_registered` and every capability default is `false`. Installing this package or receiving a ready assessment creates no permission, authority, transport, persistence, publication, or action effect.

## Development

```sh
bun install
bun run build
bun run artifacts:write
bun run ci
```

License: Apache-2.0.
