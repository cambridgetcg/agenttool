import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import {
  PRINCIPALITY_ATLAS_BOUNDARIES,
  PRINCIPALITY_ATLAS_CLAIM_POSTURES,
  PRINCIPALITY_ATLAS_CORRESPONDENCE_POSTURES,
  PRINCIPALITY_ATLAS_FORMAT,
  PRINCIPALITY_ATLAS_LIMITS,
  createPrincipalityAtlas,
  sha256Id,
} from "../dist/index.js";

const check = process.argv.includes("--check");
const packageRoot = new URL("../", import.meta.url);
const draft = "https://json-schema.org/draft/2020-12/schema";
const sha256IdSchema = {
  type: "string",
  pattern: "^sha256:[0-9a-f]{64}$",
};

function closed(properties, required = Object.keys(properties)) {
  return {
    type: "object",
    additionalProperties: false,
    required,
    properties,
  };
}

function refArray(maxItems) {
  return {
    type: "array",
    maxItems,
    uniqueItems: true,
    items: { $ref: "#/$defs/sha256Id" },
  };
}

const boundaries = closed(
  Object.fromEntries(
    Object.entries(PRINCIPALITY_ATLAS_BOUNDARIES).map(([key, value]) => [
      key,
      { const: value },
    ]),
  ),
);

const atlasSchema = {
  $schema: draft,
  $id: "https://agenttool.dev/schema/agenttool-principality-incidence-atlas-v0.1.schema.json",
  title: "AgentTool Principality Incidence Atlas v0.1",
  description:
    "A bounded finite typed incidence-hypergraph atlas of caller-asserted partial charts and directed non-gluing bridges.",
  ...closed({
    _format: { const: PRINCIPALITY_ATLAS_FORMAT },
    atlas_id: { $ref: "#/$defs/sha256Id" },
    scope_ref: { $ref: "#/$defs/sha256Id" },
    charts: {
      type: "array",
      maxItems: PRINCIPALITY_ATLAS_LIMITS.charts,
      items: { $ref: "#/$defs/chart" },
    },
    bridges: {
      type: "array",
      maxItems: PRINCIPALITY_ATLAS_LIMITS.bridges,
      items: { $ref: "#/$defs/bridge" },
    },
    coverage: { const: "bounded_not_complete" },
    boundaries: { $ref: "#/$defs/boundaries" },
  }),
  $defs: {
    sha256Id: sha256IdSchema,
    boundaries,
    cell: closed({
      cell_ref: { $ref: "#/$defs/sha256Id" },
      kind_ref: { $ref: "#/$defs/sha256Id" },
    }),
    incidence: closed({
      cell_ref: { $ref: "#/$defs/sha256Id" },
      role_ref: { $ref: "#/$defs/sha256Id" },
    }),
    relation: closed({
      relation_ref: { $ref: "#/$defs/sha256Id" },
      kind_ref: { $ref: "#/$defs/sha256Id" },
      incidences: {
        type: "array",
        minItems: 1,
        maxItems: PRINCIPALITY_ATLAS_LIMITS.incidences_per_relation,
        uniqueItems: true,
        items: { $ref: "#/$defs/incidence" },
      },
    }),
    claimSubject: closed({
      kind: { enum: ["cell", "relation"] },
      ref: { $ref: "#/$defs/sha256Id" },
    }),
    claim: closed({
      claim_ref: { $ref: "#/$defs/sha256Id" },
      subject: { $ref: "#/$defs/claimSubject" },
      perspective_ref: { $ref: "#/$defs/sha256Id" },
      posture: { enum: PRINCIPALITY_ATLAS_CLAIM_POSTURES },
      evidence_refs: refArray(
        PRINCIPALITY_ATLAS_LIMITS.evidence_refs_per_assertion,
      ),
      supersedes_claim_ref: {
        anyOf: [{ $ref: "#/$defs/sha256Id" }, { type: "null" }],
      },
      assertion: { const: "caller_asserted" },
      verified_by_package: { const: false },
    }),
    chart: closed({
      chart_ref: { $ref: "#/$defs/sha256Id" },
      principality_ref: { $ref: "#/$defs/sha256Id" },
      perspective_ref: { $ref: "#/$defs/sha256Id" },
      cells: {
        type: "array",
        maxItems: PRINCIPALITY_ATLAS_LIMITS.cells_per_chart,
        items: { $ref: "#/$defs/cell" },
      },
      relations: {
        type: "array",
        maxItems: PRINCIPALITY_ATLAS_LIMITS.relations_per_chart,
        items: { $ref: "#/$defs/relation" },
      },
      claims: {
        type: "array",
        maxItems: PRINCIPALITY_ATLAS_LIMITS.claims_per_chart,
        items: { $ref: "#/$defs/claim" },
      },
    }),
    correspondence: closed({
      correspondence_ref: { $ref: "#/$defs/sha256Id" },
      from_cell_ref: { $ref: "#/$defs/sha256Id" },
      to_cell_ref: { $ref: "#/$defs/sha256Id" },
      posture: { enum: PRINCIPALITY_ATLAS_CORRESPONDENCE_POSTURES },
      perspective_ref: { $ref: "#/$defs/sha256Id" },
      evidence_refs: refArray(
        PRINCIPALITY_ATLAS_LIMITS.evidence_refs_per_assertion,
      ),
      assertion: { const: "caller_asserted" },
      verified_by_package: { const: false },
    }),
    bridge: closed({
      bridge_ref: { $ref: "#/$defs/sha256Id" },
      from_chart_ref: { $ref: "#/$defs/sha256Id" },
      to_chart_ref: { $ref: "#/$defs/sha256Id" },
      correspondences: {
        type: "array",
        maxItems: PRINCIPALITY_ATLAS_LIMITS.correspondences_per_bridge,
        items: { $ref: "#/$defs/correspondence" },
      },
      unmapped_from_refs: refArray(
        PRINCIPALITY_ATLAS_LIMITS.unmapped_refs_per_bridge_side,
      ),
      unmapped_to_refs: refArray(
        PRINCIPALITY_ATLAS_LIMITS.unmapped_refs_per_bridge_side,
      ),
      coverage: { const: "partial_not_complete" },
    }),
  },
};

const fixtureCases = [
  "empty_atlas",
  "nary_plural_claims",
  "directed_partial_bridge",
];
const invariantCases = [
  "nary_without_pairwise_inference",
  "no_inverse_inference",
  "no_transitive_inference",
  "chart_local_distinctness",
  "plural_claims_coexist",
  "supersession_preserves_history",
  "empty_and_disconnected_valid",
  "no_score_rank_or_same_as",
  "digest_linkability_remains",
  "no_external_effects",
];

const fixtureSchema = {
  $schema: draft,
  $id: "https://agenttool.dev/schema/agenttool-principality-incidence-atlas-fixture-v0.1.schema.json",
  title: "AgentTool Principality Incidence Atlas fixture v0.1",
  ...closed({
    _format: { const: "agenttool.principality-incidence-atlas-fixture/0.1" },
    fixture_ref: sha256IdSchema,
    case: { enum: fixtureCases },
    expected: { const: "valid" },
    atlas: {
      $ref: "https://agenttool.dev/schema/agenttool-principality-incidence-atlas-v0.1.schema.json",
    },
  }),
};

const invariantSchema = {
  $schema: draft,
  $id: "https://agenttool.dev/schema/agenttool-principality-incidence-atlas-invariant-v0.1.schema.json",
  title: "AgentTool Principality Incidence Atlas invariant row v0.1",
  ...closed({
    _format: { const: "agenttool.principality-incidence-atlas-invariant/0.1" },
    invariant_ref: sha256IdSchema,
    case: { enum: invariantCases },
    statement: { type: "string", minLength: 1, maxLength: 512 },
    package_behavior: { type: "string", minLength: 1, maxLength: 512 },
  }),
};

const id = (name) => sha256Id(`agenttool-principality-incidence-atlas-v0.1:${name}`);
const claim = ({ name, subject, perspective, posture, supersedes = null }) => ({
  claim_ref: id(`claim:${name}`),
  subject,
  perspective_ref: perspective,
  posture,
  evidence_refs: [],
  supersedes_claim_ref: supersedes,
  assertion: "caller_asserted",
  verified_by_package: false,
});
const cell = (name) => ({ cell_ref: id(`cell:${name}`), kind_ref: id(`kind:${name}`) });
const chart = ({ name, cells = [], relations = [], claims = [] }) => ({
  chart_ref: id(`chart:${name}`),
  principality_ref: id(`principality:${name}`),
  perspective_ref: id(`perspective:${name}`),
  cells,
  relations,
  claims,
});

const emptyAtlas = createPrincipalityAtlas({
  scope_ref: id("scope:empty"),
  charts: [],
  bridges: [],
});

const a = cell("a");
const b = cell("b");
const c = cell("c");
const relationRef = id("relation:abc");
const presentClaim = claim({
  name: "abc-present",
  subject: { kind: "relation", ref: relationRef },
  perspective: id("perspective:one"),
  posture: "reported_present",
});
const absentClaim = claim({
  name: "abc-absent",
  subject: { kind: "relation", ref: relationRef },
  perspective: id("perspective:two"),
  posture: "reported_absent",
});
const withdrawnClaim = claim({
  name: "abc-withdrawn",
  subject: { kind: "relation", ref: relationRef },
  perspective: id("perspective:one"),
  posture: "withdrawn",
  supersedes: presentClaim.claim_ref,
});
const naryAtlas = createPrincipalityAtlas({
  scope_ref: id("scope:nary"),
  charts: [
    chart({
      name: "nary",
      cells: [c, a, b],
      relations: [
        {
          relation_ref: relationRef,
          kind_ref: id("kind:ternary-context"),
          incidences: [
            { cell_ref: c.cell_ref, role_ref: id("role:third") },
            { cell_ref: a.cell_ref, role_ref: id("role:first") },
            { cell_ref: b.cell_ref, role_ref: id("role:second") },
          ],
        },
      ],
      claims: [withdrawnClaim, absentClaim, presentClaim],
    }),
  ],
  bridges: [],
});

const shared = cell("shared-address");
const leftOnly = cell("left-only");
const rightOnly = cell("right-only");
const left = chart({ name: "left", cells: [leftOnly, shared] });
const right = chart({ name: "right", cells: [rightOnly, shared] });
const bridgeAtlas = createPrincipalityAtlas({
  scope_ref: id("scope:bridge"),
  charts: [right, left],
  bridges: [
    {
      bridge_ref: id("bridge:left-right"),
      from_chart_ref: left.chart_ref,
      to_chart_ref: right.chart_ref,
      correspondences: [
        {
          correspondence_ref: id("correspondence:shared"),
          from_cell_ref: shared.cell_ref,
          to_cell_ref: shared.cell_ref,
          posture: "translation_reported",
          perspective_ref: id("perspective:bridge-reporter"),
          evidence_refs: [],
          assertion: "caller_asserted",
          verified_by_package: false,
        },
      ],
      unmapped_from_refs: [leftOnly.cell_ref],
      unmapped_to_refs: [rightOnly.cell_ref],
      coverage: "partial_not_complete",
    },
  ],
});

const fixtures = [
  ["empty_atlas", emptyAtlas],
  ["nary_plural_claims", naryAtlas],
  ["directed_partial_bridge", bridgeAtlas],
].map(([fixtureCase, atlas]) => ({
  _format: "agenttool.principality-incidence-atlas-fixture/0.1",
  fixture_ref: id(`fixture:${fixtureCase}`),
  case: fixtureCase,
  expected: "valid",
  atlas,
}));

const invariantText = {
  nary_without_pairwise_inference: [
    "One role-indexed A/B/C relation remains one n-ary relation.",
    "No AB, AC, or BC relation is generated.",
  ],
  no_inverse_inference: [
    "A reported A-to-B bridge is directional.",
    "No B-to-A correspondence is generated.",
  ],
  no_transitive_inference: [
    "Separate A-to-B and B-to-C reports remain separate.",
    "No A-to-C correspondence is generated.",
  ],
  chart_local_distinctness: [
    "A cell digest is addressed together with its chart.",
    "Digest reuse across charts does not merge cells or establish equality.",
  ],
  plural_claims_coexist: [
    "Different perspectives may report incompatible postures.",
    "The package preserves them side by side and selects no winner.",
  ],
  supersession_preserves_history: [
    "A correction may explicitly supersede one same-subject same-perspective claim.",
    "The earlier claim stays present and no latest truth is selected.",
  ],
  empty_and_disconnected_valid: [
    "Empty atlases, empty charts, isolated cells, and disconnected charts are valid.",
    "Isolation, rest, refusal, and nonparticipation receive no penalty.",
  ],
  no_score_rank_or_same_as: [
    "The protocol has no score, rank, weight, centrality, quality, or sameAs field.",
    "Validation rejects extra properties and performs no semantic classification.",
  ],
  digest_linkability_remains: [
    "Digest-only refs remove raw prose from this wire shape.",
    "A digest can remain identifying or linkable and is not anonymization.",
  ],
  no_external_effects: [
    "An atlas is inert content-addressed geometry.",
    "It performs no network, model, credential, publication, task, wallet, or economic effect.",
  ],
};
const invariants = invariantCases.map((invariantCase) => ({
  _format: "agenttool.principality-incidence-atlas-invariant/0.1",
  invariant_ref: id(`invariant:${invariantCase}`),
  case: invariantCase,
  statement: invariantText[invariantCase][0],
  package_behavior: invariantText[invariantCase][1],
}));

const vector = {
  _format: "agenttool.principality-incidence-atlas-vectors/0.1",
  generator: "@agenttool/principality-atlas@0.1.0-dev.1",
  fixtures,
  invariants,
};

const outputs = new Map([
  ["schema/agenttool-principality-incidence-atlas-v0.1.schema.json", atlasSchema],
  ["schema/agenttool-principality-incidence-atlas-fixture-v0.1.schema.json", fixtureSchema],
  ["schema/agenttool-principality-incidence-atlas-invariant-v0.1.schema.json", invariantSchema],
  ["vectors/agenttool-principality-incidence-atlas-v0.1.json", vector],
]);

for (const [relative, value] of outputs) {
  const url = new URL(relative, packageRoot);
  const expected = `${JSON.stringify(value, null, 2)}\n`;
  if (check) {
    let actual;
    try {
      actual = readFileSync(url, "utf8");
    } catch {
      throw new Error(`${relative} is missing; run build-assets.mjs --write`);
    }
    if (actual !== expected) {
      throw new Error(`${relative} differs from deterministic generated bytes`);
    }
  } else {
    mkdirSync(new URL("./", url), { recursive: true });
    writeFileSync(url, expected);
  }
}
