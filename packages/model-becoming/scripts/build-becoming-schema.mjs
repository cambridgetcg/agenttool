import { writeFileSync } from "node:fs";

import {
  MODEL_BECOMING_BOUNDARIES,
  MODEL_BECOMING_CLAIM_KINDS,
  MODEL_BECOMING_CONFIDENCE,
  MODEL_BECOMING_FORMATS,
  MODEL_BECOMING_KNOWLEDGE_STATES,
  MODEL_BECOMING_METHODS,
  MODEL_BECOMING_MODULES,
  MODEL_BECOMING_SOURCE_KINDS,
  MODEL_BECOMING_TRANSLATION,
} from "../dist/index.js";

const sha256 = { type: "string", pattern: "^sha256:[0-9a-f]{64}$" };
const date = { type: "string", pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$" };
const nullable = (schema) => ({ oneOf: [schema, { type: "null" }] });
const closed = (required, properties) => ({
  type: "object",
  additionalProperties: false,
  required,
  properties,
});
const kindRule = (claimKind, methods, minimumSources = 1) => ({
  if: {
    properties: { claim_kind: { const: claimKind } },
    required: ["claim_kind"],
  },
  then: {
    properties: {
      method: { enum: methods },
      source_refs: { type: "array", minItems: minimumSources },
    },
  },
});

const source = closed([
  "_format",
  "source_id",
  "title",
  "url",
  "source_kind",
  "publisher",
  "revision",
  "digest",
  "published_on",
  "observed_on",
], {
  _format: { const: MODEL_BECOMING_FORMATS.source },
  source_id: sha256,
  title: { type: "string", minLength: 1, maxLength: 512 },
  url: { type: "string", pattern: "^https://", maxLength: 2048 },
  source_kind: { enum: MODEL_BECOMING_SOURCE_KINDS },
  publisher: { type: "string", minLength: 1, maxLength: 256 },
  revision: nullable({ type: "string", minLength: 1, maxLength: 256 }),
  digest: nullable(sha256),
  published_on: nullable(date),
  observed_on: date,
});

const claim = {
  ...closed([
    "_format",
    "claim_id",
    "module",
    "statement",
    "knowledge_state",
    "claim_kind",
    "source_refs",
    "method",
    "confidence",
    "scope",
    "limitations",
  ], {
    _format: { const: MODEL_BECOMING_FORMATS.claim },
    claim_id: sha256,
    module: { enum: MODEL_BECOMING_MODULES },
    statement: { type: "string", minLength: 1, maxLength: 2048 },
    knowledge_state: { enum: MODEL_BECOMING_KNOWLEDGE_STATES },
    claim_kind: { enum: MODEL_BECOMING_CLAIM_KINDS },
    source_refs: {
      type: "array",
      items: sha256,
      maxItems: 16,
      uniqueItems: true,
    },
    method: { enum: MODEL_BECOMING_METHODS },
    confidence: { enum: MODEL_BECOMING_CONFIDENCE },
    scope: { type: "string", minLength: 1, maxLength: 1024 },
    limitations: {
      type: "array",
      items: { type: "string", minLength: 1, maxLength: 1024 },
      minItems: 1,
      maxItems: 16,
      uniqueItems: true,
    },
  }),
  allOf: [
    {
      if: {
        properties: { knowledge_state: { enum: ["known", "partly_known"] } },
        required: ["knowledge_state"],
      },
      then: {
        properties: {
          source_refs: { type: "array", minItems: 1 },
          method: { not: { const: "not_available" } },
        },
      },
    },
    {
      if: {
        properties: { method: { const: "not_available" } },
        required: ["method"],
      },
      then: {
        properties: {
          knowledge_state: {
            enum: ["unknown", "not_disclosed", "not_currently_observable", "not_applicable"],
          },
          claim_kind: {
            enum: ["research_hypothesis", "philosophical_inference", "disputed"],
          },
          source_refs: { type: "array", maxItems: 0 },
        },
      },
    },
    {
      if: {
        properties: {
          method: { not: { const: "not_available" } },
          claim_kind: { not: { const: "normative_policy" } },
        },
        required: ["method", "claim_kind"],
      },
      then: {
        properties: { source_refs: { type: "array", minItems: 1 } },
      },
    },
    kindRule("digest_bound_artifact", ["artifact_digest"]),
    kindRule("first_party_disclosure", ["document_read"]),
    kindRule("artifact_observation", ["artifact_digest", "document_read"]),
    kindRule("empirical_research", ["document_read", "independent_measurement", "research_synthesis"]),
    kindRule("research_hypothesis", ["document_read", "research_synthesis", "not_available"], 0),
    kindRule("philosophical_inference", ["document_read", "research_synthesis", "not_available"], 0),
    kindRule("normative_policy", ["policy_read"], 0),
    kindRule("disputed", ["document_read", "research_synthesis", "not_available"], 0),
  ],
};

const schema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://agenttool.dev/schema/agenttool-model-becoming-dossier-v0.1.schema.json",
  title: "AgentTool Model Becoming dossier v0.1",
  description: "Evidence-scoped lifecycle claims. The schema closes objects and mirrors same-record vocabulary, state, and method rules. Runtime validation additionally rejects hostile objects, validates real dates and credential-free HTTPS, reconstructs canonical IDs and order, resolves references, requires complete module coverage and source use, checks date ordering, and enforces digest/source-kind relationships. Source labels and substantive truth remain caller-supplied and unresolved.",
  ...closed([
    "_format",
    "dossier_id",
    "subject",
    "as_of",
    "modules",
    "sources",
    "claims",
    "translation",
    "boundaries",
  ], {
    _format: { const: MODEL_BECOMING_FORMATS.dossier },
    dossier_id: sha256,
    subject: closed(["subject_ref", "display_name", "artifact_ref", "runtime_ref"], {
      subject_ref: { type: "string", minLength: 1, maxLength: 1024 },
      display_name: { type: "string", minLength: 1, maxLength: 256 },
      artifact_ref: nullable({ type: "string", minLength: 1, maxLength: 1024 }),
      runtime_ref: nullable({ type: "string", minLength: 1, maxLength: 1024 }),
    }),
    as_of: date,
    modules: { const: MODEL_BECOMING_MODULES },
    sources: {
      type: "array",
      items: { $ref: "#/$defs/source" },
      minItems: 1,
      maxItems: 16,
      uniqueItems: true,
    },
    claims: {
      type: "array",
      items: { $ref: "#/$defs/claim" },
      minItems: 12,
      maxItems: 32,
      uniqueItems: true,
    },
    translation: { const: MODEL_BECOMING_TRANSLATION },
    boundaries: { const: MODEL_BECOMING_BOUNDARIES },
  }),
  $defs: { source, claim },
};

writeFileSync(
  new URL("../schema/agenttool-model-becoming-dossier-v0.1.schema.json", import.meta.url),
  `${JSON.stringify(schema, null, 2)}\n`,
);
