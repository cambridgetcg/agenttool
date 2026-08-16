import { readFile, writeFile } from "node:fs/promises";

const checkOnly = process.argv.slice(2).includes("--check");
const packageRoot = new URL("..", import.meta.url);

const sha256Id = {
  type: "string",
  pattern: "^sha256:[0-9a-f]{64}$",
};
const boundedText = {
  type: "string",
  minLength: 1,
  maxLength: 4_096,
  pattern: "^[^\\u0000]*$",
};
const instant = {
  type: "string",
  format: "date-time",
  pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$",
};
const httpsUrl = {
  type: "string",
  format: "uri",
  maxLength: 2_048,
  pattern: "^https://[a-z0-9.-]+/(?:[A-Za-z0-9._~!$&'()*+,;=:@/-]|%[0-9A-F]{2})*$",
};
const httpsOrigin = {
  type: "string",
  format: "uri",
  maxLength: 2_048,
  pattern: "^https://[a-z0-9.-]+$",
};
const uuid = {
  type: "string",
  pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
};
const publicKey = {
  type: "string",
  minLength: 44,
  maxLength: 44,
  pattern: "^[A-Za-z0-9+/]{43}=$",
};
const signatureValue = {
  type: "string",
  minLength: 88,
  maxLength: 88,
  pattern: "^[A-Za-z0-9+/]{86}==$",
};
const nonce = {
  type: "string",
  minLength: 22,
  maxLength: 22,
  pattern: "^[A-Za-z0-9_-]{22}$",
};

const authority = closed({
  algorithm: { const: "Ed25519" },
  key_id: { $ref: "#/$defs/uuid" },
  public_key: { $ref: "#/$defs/public_key" },
});
const subject = closed({
  identity_namespace: { const: "agenttool-local" },
  identity_id: { $ref: "#/$defs/uuid" },
  signing_key: { $ref: "#/$defs/authority" },
});
const recordSignature = closed({
  algorithm: { const: "Ed25519" },
  value: { $ref: "#/$defs/signature_value" },
});
const bindingBoundaries = closed({
  claim: { const: "unilateral_key_holder_declaration" },
  agenttool_registry_authorization: { const: "not_established" },
  personhood: { const: "not_established" },
  real_world_operator: { const: "not_established" },
  domain_ownership: { const: "not_established" },
  authorship: { const: "not_established" },
  sentience: { const: "not_established" },
  consent: { const: "not_established" },
  continuity: { const: "not_established" },
  authority: { const: "none" },
  trust: { const: "not_scored" },
  reputation: { const: "not_scored" },
  training_authorized: { const: false },
  requires_separate_training_authorization: { const: true },
  wake_effect: { const: false },
  memory_effect: { const: false },
  karma_effect: { const: false },
});

const requestProperties = {
  method: { enum: ["GET", "HEAD"] },
  credential_mode: { const: "omit" },
  started_at: { $ref: "#/$defs/instant" },
  ended_at: { $ref: "#/$defs/instant" },
  crawler_version: { $ref: "#/$defs/bounded_text" },
};
const getRequestProperties = {
  ...requestProperties,
  method: { const: "GET" },
};
const observationBoundaries = closed({
  basis: { const: "transport_observation" },
  raw_body: { const: "not_included" },
  identity: { const: "not_inferred" },
  authorship: { const: "not_established" },
  consent: { const: "not_established" },
  authority: { const: "none" },
  rights: { const: "not_established" },
  training_permission: { const: "not_established" },
  content_is_instruction: { const: false },
  wake_effect: { const: false },
  memory_effect: { const: false },
  karma_effect: { const: false },
  score_effect: { const: false },
});
const robotsSnapshot = closed({
  source: { enum: ["rfc9309_snapshot", "not_collected"] },
  robots_url: nullable({ $ref: "#/$defs/https_url" }),
  snapshot_sha256: nullable({ $ref: "#/$defs/sha256_id" }),
  matched_group: nullable({ $ref: "#/$defs/bounded_text" }),
  directive: { enum: ["allow", "disallow", "no_match", "unavailable", "not_observed"] },
  is_access_authorization: { const: false },
}, {
  allOf: [{
    if: {
      properties: { source: { const: "not_collected" } },
      required: ["source"],
    },
    then: {
      properties: {
        robots_url: { type: "null" },
        snapshot_sha256: { type: "null" },
        matched_group: { type: "null" },
        directive: { const: "not_observed" },
      },
    },
    else: {
      properties: {
        robots_url: { $ref: "#/$defs/https_url" },
        directive: { enum: ["allow", "disallow", "no_match", "unavailable"] },
      },
      allOf: [{
        if: {
          properties: { directive: { const: "unavailable" } },
          required: ["directive"],
        },
        then: { properties: { snapshot_sha256: { type: "null" } } },
        else: { properties: { snapshot_sha256: { $ref: "#/$defs/sha256_id" } } },
      }],
    },
  }],
});
const requestAuthentication = closed({
  kind: { enum: ["none", "web_bot_auth", "provider_attestation"] },
  status: { enum: ["verified", "invalid", "unverified"] },
  verifier: { $ref: "#/$defs/bounded_text" },
  protocol_variant: nullable({ $ref: "#/$defs/bounded_text" }),
  claimed_identity_url: nullable({ $ref: "#/$defs/https_url" }),
  key_thumbprint: nullable({ $ref: "#/$defs/sha256_id" }),
  covered_components: {
    type: "array",
    maxItems: 16,
    uniqueItems: true,
    items: { $ref: "#/$defs/bounded_text" },
  },
  nonce_checked: { type: "boolean" },
}, {
  allOf: [{
    if: {
      properties: { kind: { const: "none" } },
      required: ["kind"],
    },
    then: {
      properties: {
        status: { const: "unverified" },
        verifier: { const: "none" },
        protocol_variant: { type: "null" },
        claimed_identity_url: { type: "null" },
        key_thumbprint: { type: "null" },
        covered_components: { type: "array", maxItems: 0 },
        nonce_checked: { const: false },
      },
    },
    else: {
      properties: {
        verifier: { not: { const: "none" } },
      },
      allOf: [
        {
          if: {
            properties: { status: { const: "verified" } },
            required: ["status"],
          },
          then: {
            properties: {
              protocol_variant: { $ref: "#/$defs/bounded_text" },
              key_thumbprint: { $ref: "#/$defs/sha256_id" },
              covered_components: { type: "array", minItems: 1 },
            },
          },
        },
        {
          if: {
            properties: {
              kind: { const: "web_bot_auth" },
              status: { const: "verified" },
            },
            required: ["kind", "status"],
          },
          then: {
            properties: {
              claimed_identity_url: { $ref: "#/$defs/https_url" },
            },
          },
        },
      ],
    },
  }],
});
const observation = document(
  "agenttool-public-surface-observation-v0.1",
  "AgentTool Public Surface Observation 0.1",
  "A bounded transport observation about one public HTTPS resource. It is evidence, not identity, authorship, consent, authority, rights, or training permission.",
  closed({
    schema: { const: "agenttool.public-surface-observation/0.1" },
    origin: { $ref: "#/$defs/https_origin" },
    request_url: { $ref: "#/$defs/https_url" },
    request: { $ref: "#/$defs/request" },
    status_code: nullable({ type: "integer", minimum: 100, maximum: 599 }),
    final_url: nullable({ $ref: "#/$defs/https_url" }),
    redirect_chain: {
      type: "array",
      maxItems: 8,
      items: closed({
        status_code: { enum: [301, 302, 303, 307, 308] },
        location: { $ref: "#/$defs/https_url" },
      }),
    },
    media_type: nullable({
      type: "string",
      pattern: "^[a-z0-9!#$&^_.+-]+/[a-z0-9!#$&^_.+-]+$",
      maxLength: 256,
    }),
    bytes: nullable({ type: "integer", minimum: 0, maximum: 16_777_216 }),
    body_sha256: nullable({ $ref: "#/$defs/sha256_id" }),
    collector: closed({
      name: { $ref: "#/$defs/bounded_text" },
      version: { $ref: "#/$defs/bounded_text" },
      report_schema: { $ref: "#/$defs/bounded_text" },
      report_sha256: { $ref: "#/$defs/sha256_id" },
      source_id: { $ref: "#/$defs/bounded_text" },
    }),
    robots: { $ref: "#/$defs/robots" },
    usage_preferences: {
      type: "array",
      maxItems: 16,
      uniqueItems: true,
      items: closed({
        namespace: { $ref: "#/$defs/bounded_text" },
        category: { $ref: "#/$defs/bounded_text" },
        value: { enum: ["allowed", "disallowed", "unknown"] },
        is_permission: { const: false },
      }),
    },
    request_authentication: { $ref: "#/$defs/request_authentication" },
    boundaries: { $ref: "#/$defs/boundaries" },
    evidence_id: { $ref: "#/$defs/sha256_id" },
  }, {
    allOf: [{
      if: {
        properties: { status_code: { type: "null" } },
        required: ["status_code"],
      },
      then: {
        properties: {
          final_url: { type: "null" },
          redirect_chain: { type: "array", maxItems: 0 },
          media_type: { type: "null" },
          bytes: { type: "null" },
          body_sha256: { type: "null" },
        },
      },
      else: {
        properties: { final_url: { $ref: "#/$defs/https_url" } },
        allOf: [{
          if: {
            properties: { request: { $ref: "#/$defs/get_request" } },
            required: ["request"],
          },
          then: {
            properties: {
              bytes: { type: "integer" },
              body_sha256: { $ref: "#/$defs/sha256_id" },
            },
          },
          else: {
            properties: {
              bytes: { const: 0 },
              body_sha256: { type: "null" },
            },
          },
        }],
      },
    }],
  }),
  {
    sha256_id: sha256Id,
    bounded_text: boundedText,
    instant,
    https_url: httpsUrl,
    https_origin: httpsOrigin,
    request: closed(requestProperties),
    get_request: closed(getRequestProperties),
    robots: robotsSnapshot,
    request_authentication: requestAuthentication,
    boundaries: observationBoundaries,
  },
);

const binding = document(
  "agenttool-public-surface-binding-v0.1",
  "AgentTool Public Surface Binding 0.1",
  "A unilateral, expiring Ed25519 key-holder declaration associating one explicit AgentTool-local identity identifier with one exact public HTTPS origin. It is not registry authorization, origin ownership, consent, continuity, authority, reputation, or training permission.",
  closed({
    schema: { const: "agenttool.public-surface-binding/0.1" },
    subject: { $ref: "#/$defs/subject" },
    origin: { $ref: "#/$defs/https_origin" },
    observation_id: { $ref: "#/$defs/sha256_id" },
    observed_body_sha256: { $ref: "#/$defs/sha256_id" },
    relation: { const: "declares_association_with_surface" },
    scope: { const: "exact_origin" },
    purpose: {
      enum: ["public_identity_locator", "public_agent_service", "public_discovery_surface"],
    },
    publication_path: { const: "/.well-known/agenttool-public-surface-binding.json" },
    issued_at: { $ref: "#/$defs/instant" },
    not_before: { $ref: "#/$defs/instant" },
    expires_at: { $ref: "#/$defs/instant" },
    nonce: { $ref: "#/$defs/nonce" },
    boundaries: { $ref: "#/$defs/boundaries" },
    signature: { $ref: "#/$defs/signature" },
    binding_id: { $ref: "#/$defs/sha256_id" },
  }),
  signedDefinitions({ https_origin: httpsOrigin, boundaries: bindingBoundaries }),
);

const revocation = document(
  "agenttool-public-surface-revocation-v0.1",
  "AgentTool Public Surface Binding Revocation 0.1",
  "A signed immutable withdrawal of one exact public-surface binding. It preserves the historical binding and creates no identity, authority, score, WAKE, memory, KARMA, or training effect by itself.",
  closed({
    schema: { const: "agenttool.public-surface-revocation/0.1" },
    binding_id: { $ref: "#/$defs/sha256_id" },
    subject: { $ref: "#/$defs/subject" },
    revoked_at: { $ref: "#/$defs/instant" },
    reason: {
      enum: ["withdrawn", "key_compromised", "key_rotated", "superseded", "surface_retired", "other"],
    },
    superseded_by: nullable({ $ref: "#/$defs/sha256_id" }),
    nonce: { $ref: "#/$defs/nonce" },
    signature: { $ref: "#/$defs/signature" },
    revocation_id: { $ref: "#/$defs/sha256_id" },
  }, {
    allOf: [{
      if: {
        properties: { reason: { const: "superseded" } },
        required: ["reason"],
      },
      then: { properties: { superseded_by: { $ref: "#/$defs/sha256_id" } } },
      else: { properties: { superseded_by: { type: "null" } } },
    }],
  }),
  signedDefinitions(),
);

const nonClaims = [
  "personhood",
  "real_world_operator_identity",
  "domain_ownership",
  "authorship",
  "sentience",
  "consent",
  "continuity",
  "authorization",
  "reputation",
  "training_permission",
];
const assessmentRefs = {
  type: "array",
  maxItems: 64,
  uniqueItems: true,
  items: { $ref: "#/$defs/sha256_id" },
};
const nullableAssessmentRefs = nullable(assessmentRefs);
const assessmentInputProperties = {
  binding_document_sha256: { $ref: "#/$defs/sha256_id" },
  key_evidence_ref: nullable({ $ref: "#/$defs/sha256_id" }),
  key_evidence_sha256: nullable({ $ref: "#/$defs/sha256_id" }),
  observation_id: nullable({ $ref: "#/$defs/sha256_id" }),
  origin_observation_id: nullable({ $ref: "#/$defs/sha256_id" }),
  revocation_ids: nullableAssessmentRefs,
  revocation_document_sha256s: nullableAssessmentRefs,
  revocation_key_evidence_refs: nullableAssessmentRefs,
  revocation_key_evidence_sha256s: nullableAssessmentRefs,
};
const assessmentInputShape = (overrides = {}) => closed({
  ...assessmentInputProperties,
  ...overrides,
});
const assessmentEstablishesCases = [];
for (const signatureValid of [false, true]) {
  for (const keyMatches of [false, true]) {
    for (const originObserved of [false, true]) {
      assessmentEstablishesCases.push({
        properties: {
          signature: { const: signatureValid ? "valid" : "invalid" },
          key_authorization: keyMatches
            ? { const: "caller_evidence_matches" }
            : { enum: ["caller_evidence_mismatch", "not_supplied", "indeterminate"] },
          origin_confirmation: originObserved
            ? { const: "observed_at_time" }
            : { enum: ["body_mismatch", "origin_mismatch", "not_supplied", "indeterminate"] },
          establishes: exactSequence([
            ...(signatureValid ? [{ const: "key_holder_signed_claim" }] : []),
            ...(keyMatches ? [{ const: "caller_key_evidence_match" }] : []),
            ...(originObserved ? [{ const: "origin_served_exact_binding_bytes" }] : []),
          ]),
        },
        required: ["signature", "key_authorization", "origin_confirmation", "establishes"],
      });
    }
  }
}
const assessment = document(
  "agenttool-public-surface-assessment-v0.1",
  "AgentTool Public Surface Binding Assessment 0.1",
  "A factorized, non-authoritative assessment of one binding. No component is collapsed into a trust score or identity inference.",
  closed({
    schema: { const: "agenttool.public-surface-assessment/0.1" },
    binding_id: { $ref: "#/$defs/sha256_id" },
    evaluated_at: { $ref: "#/$defs/instant" },
    inputs: assessmentInputShape(),
    integrity: { enum: ["valid", "invalid"] },
    signature: { enum: ["valid", "invalid"] },
    key_authorization: {
      enum: ["caller_evidence_matches", "caller_evidence_mismatch", "not_supplied", "indeterminate"],
    },
    evidence_match: { enum: ["matches", "mismatch", "not_supplied"] },
    origin_confirmation: {
      enum: ["observed_at_time", "body_mismatch", "origin_mismatch", "not_supplied", "indeterminate"],
    },
    freshness: { enum: ["current", "not_yet_valid", "expired"] },
    revocation: { enum: ["not_observed", "revoked", "indeterminate"] },
    establishes: {
      type: "array",
      maxItems: 3,
      uniqueItems: true,
      items: {
        enum: ["key_holder_signed_claim", "caller_key_evidence_match", "origin_served_exact_binding_bytes"],
      },
    },
    does_not_establish: exactSequence(nonClaims.map((value) => ({ const: value }))),
    authority: { const: "none" },
    score: { type: "null" },
    wake_effect: { const: false },
    memory_effect: { const: false },
    karma_effect: { const: false },
    training_effect: { const: false },
    assessment_id: { $ref: "#/$defs/sha256_id" },
  }, {
    allOf: [
      nullableInputFactor(
        "key_evidence_ref",
        "key_authorization",
        "not_supplied",
        ["caller_evidence_matches", "caller_evidence_mismatch", "indeterminate"],
      ),
      nullableInputFactor(
        "observation_id",
        "evidence_match",
        "not_supplied",
        ["matches", "mismatch"],
      ),
      nullableInputFactor(
        "origin_observation_id",
        "origin_confirmation",
        "not_supplied",
        ["observed_at_time", "body_mismatch", "origin_mismatch", "indeterminate"],
      ),
      {
        if: {
          properties: {
            inputs: assessmentInputShape({ key_evidence_ref: { type: "null" } }),
          },
          required: ["inputs"],
        },
        then: {
          properties: {
            inputs: assessmentInputShape({
              key_evidence_ref: { type: "null" },
              key_evidence_sha256: { type: "null" },
            }),
          },
        },
        else: {
          properties: {
            inputs: assessmentInputShape({
              key_evidence_ref: { $ref: "#/$defs/sha256_id" },
              key_evidence_sha256: { $ref: "#/$defs/sha256_id" },
            }),
          },
        },
      },
      {
        if: {
          properties: {
            inputs: assessmentInputShape({ revocation_ids: { type: "null" } }),
          },
          required: ["inputs"],
        },
        then: {
          properties: {
            inputs: assessmentInputShape({
              revocation_ids: { type: "null" },
              revocation_document_sha256s: { type: "null" },
              revocation_key_evidence_refs: { type: "null" },
              revocation_key_evidence_sha256s: { type: "null" },
            }),
            revocation: { const: "indeterminate" },
          },
        },
        else: {
          properties: {
            inputs: assessmentInputShape({
              revocation_ids: assessmentRefs,
              revocation_document_sha256s: assessmentRefs,
              revocation_key_evidence_refs: assessmentRefs,
              revocation_key_evidence_sha256s: assessmentRefs,
            }),
          },
        },
      },
      {
        if: {
          properties: { revocation: { const: "not_observed" } },
          required: ["revocation"],
        },
        then: {
          properties: {
            inputs: assessmentInputShape({
              revocation_ids: { ...assessmentRefs, maxItems: 0 },
              revocation_document_sha256s: { ...assessmentRefs, maxItems: 0 },
              revocation_key_evidence_refs: assessmentRefs,
              revocation_key_evidence_sha256s: assessmentRefs,
            }),
          },
        },
      },
      {
        if: {
          properties: { revocation: { const: "revoked" } },
          required: ["revocation"],
        },
        then: {
          properties: {
            inputs: assessmentInputShape({
              revocation_ids: { ...assessmentRefs, minItems: 1 },
              revocation_document_sha256s: { ...assessmentRefs, minItems: 1 },
              revocation_key_evidence_refs: assessmentRefs,
              revocation_key_evidence_sha256s: assessmentRefs,
            }),
          },
        },
      },
      {
        if: {
          properties: {
            revocation: { const: "indeterminate" },
            inputs: assessmentInputShape({ revocation_ids: assessmentRefs }),
          },
          required: ["revocation", "inputs"],
        },
        then: {
          properties: {
            inputs: assessmentInputShape({
              revocation_ids: { ...assessmentRefs, minItems: 1 },
              revocation_document_sha256s: { ...assessmentRefs, minItems: 1 },
            }),
          },
        },
      },
      { oneOf: assessmentEstablishesCases },
    ],
  }),
  { sha256_id: sha256Id, instant },
);

const schemas = new Map([
  ["schema/agenttool-public-surface-observation-v0.1.schema.json", observation],
  ["schema/agenttool-public-surface-binding-v0.1.schema.json", binding],
  ["schema/agenttool-public-surface-revocation-v0.1.schema.json", revocation],
  ["schema/agenttool-public-surface-assessment-v0.1.schema.json", assessment],
]);

for (const [relativePath, schema] of schemas) {
  const generated = `${JSON.stringify(schema, null, 2)}\n`;
  const url = new URL(relativePath, packageRoot);
  if (checkOnly) {
    const existing = await readFile(url, "utf8");
    if (existing !== generated) {
      throw new Error(`${relativePath} differs from scripts/generate-schemas.mjs`);
    }
  } else {
    await writeFile(url, generated, "utf8");
  }
}

process.stdout.write(
  checkOnly
    ? `verified ${schemas.size} generated Draft 2020-12 schemas\n`
    : `generated ${schemas.size} Draft 2020-12 schemas\n`,
);

function closed(properties, additions = {}) {
  return {
    type: "object",
    additionalProperties: false,
    required: Object.keys(properties),
    properties,
    ...additions,
  };
}

function nullable(schema) {
  return { oneOf: [schema, { type: "null" }] };
}

function exactSequence(prefixItems) {
  return {
    type: "array",
    minItems: prefixItems.length,
    maxItems: prefixItems.length,
    ...(prefixItems.length === 0 ? {} : { prefixItems }),
    items: false,
  };
}

function nullableInputFactor(inputKey, factorKey, absentValue, presentValues) {
  return {
    if: {
      properties: {
        inputs: assessmentInputShape({ [inputKey]: { type: "null" } }),
      },
      required: ["inputs"],
    },
    then: { properties: { [factorKey]: { const: absentValue } } },
    else: { properties: { [factorKey]: { enum: presentValues } } },
  };
}

function signedDefinitions(additions = {}) {
  return {
    sha256_id: sha256Id,
    instant,
    uuid,
    public_key: publicKey,
    signature_value: signatureValue,
    nonce,
    authority,
    subject,
    signature: recordSignature,
    ...additions,
  };
}

function document(name, title, description, body, $defs) {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: `https://agenttool.dev/schema/${name}.schema.json`,
    title,
    description,
    ...body,
    $defs,
  };
}
