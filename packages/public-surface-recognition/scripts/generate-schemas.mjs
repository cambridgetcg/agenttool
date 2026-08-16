import { readFile, writeFile } from "node:fs/promises";

const checkOnly = process.argv.includes("--check");
const printKind = process.argv.find((argument) => argument.startsWith("--print="))?.slice(8);
const packageRoot = new URL("..", import.meta.url);
const bindingSchemaUrl = new URL(
  "../public-surface-binding/schema/agenttool-public-surface-binding-v0.1.schema.json",
  packageRoot,
);

const bindingSchema = JSON.parse(await readFile(bindingSchemaUrl, "utf8"));
const bindingDefinitions = Object.fromEntries(
  Object.entries(bindingSchema.$defs).map(([name, value]) => [
    `binding_${name}`,
    rewriteBindingRefs(value),
  ]),
);
const bindingDocument = rewriteBindingRefs({
  type: bindingSchema.type,
  properties: bindingSchema.properties,
  required: bindingSchema.required,
  additionalProperties: bindingSchema.additionalProperties,
});

const sha256Id = {
  type: "string",
  pattern: "^sha256:[0-9a-f]{64}$",
};
const instant = {
  type: "string",
  format: "date-time",
  pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$",
};
const uuid = {
  type: "string",
  pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
};
const did = {
  type: "string",
  pattern: "^did:at:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
  maxLength: 43,
};
const httpsOrigin = {
  type: "string",
  format: "uri",
  maxLength: 2_048,
  pattern: "^https://[a-z0-9.-]+$",
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
const authoritySequence = {
  type: "integer",
  minimum: 1,
  maximum: Number.MAX_SAFE_INTEGER,
};

const authorityRoot = closed({
  algorithm: { const: "Ed25519" },
  public_key: { $ref: "#/$defs/public_key" },
});
const subject = closed({
  identity_namespace: { const: "agenttool-local" },
  identity_id: { $ref: "#/$defs/uuid" },
  did: { $ref: "#/$defs/did" },
  authority_root: { $ref: "#/$defs/authority_root" },
});
const signature = closed({
  algorithm: { const: "Ed25519" },
  value: { $ref: "#/$defs/signature_value" },
});
const adoptionBoundaries = closed({
  claim: { const: "agent_root_key_holder_declaration" },
  registry_match: { const: "not_established" },
  hosted_acceptance: { const: "not_established" },
  identity_lifecycle: { const: "not_changed" },
  domain_ownership: { const: "not_established" },
  authorship: { const: "not_established" },
  personhood: { const: "not_established" },
  real_world_operator: { const: "not_established" },
  sentience: { const: "not_established" },
  continuity: { const: "not_established" },
  consent: { const: "not_established" },
  authority: { const: "none" },
  delegation: { const: "none" },
  trust: { const: "not_scored" },
  reputation: { const: "not_scored" },
  relationship: { const: "not_created" },
  covenant: { const: "not_created" },
  training_authorized: { const: false },
  requires_separate_training_authorization: { const: true },
  registry_write_effect: { const: false },
  identity_mutation_effect: { const: false },
  crawler_effect: { const: false },
  observation_counter_effect: { const: false },
  training_effect: { const: false },
  publication_effect: { const: false },
  wake_effect: { const: false },
  memory_effect: { const: false },
  chronicle_effect: { const: false },
  karma_effect: { const: false },
  score_effect: { const: false },
  automatic_action: { const: false },
});
const withdrawalBoundaries = closed({
  claim: { const: "agent_root_key_holder_withdrawal_declaration" },
  registry_match: { const: "not_established" },
  hosted_withdrawal: { const: "not_established" },
  binding_revocation_effect: { const: false },
  external_erasure_effect: { const: false },
  training_unlearning_effect: { const: false },
  registry_write_effect: { const: false },
  identity_mutation_effect: { const: false },
  crawler_effect: { const: false },
  observation_counter_effect: { const: false },
  training_effect: { const: false },
  authority: { const: "none" },
  delegation: { const: "none" },
  publication_effect: { const: false },
  wake_effect: { const: false },
  memory_effect: { const: false },
  chronicle_effect: { const: false },
  karma_effect: { const: false },
  score_effect: { const: false },
  automatic_action: { const: false },
});

const commonDefinitions = {
  sha256_id: sha256Id,
  instant,
  uuid,
  did,
  https_origin: httpsOrigin,
  public_key: publicKey,
  signature_value: signatureValue,
  nonce,
  authority_sequence: authoritySequence,
  authority_root: authorityRoot,
  subject,
  signature,
  ...bindingDefinitions,
  binding_document: bindingDocument,
};

const adoption = document(
  "agenttool-public-surface-adoption-v0.1",
  "AgentTool Public Surface Adoption 0.1",
  "A closed structural filter for one exact agent-root-signed adoption declaration. Runtime validation remains normative for canonical encodings, digest equality, strict signatures, temporal relationships, subject linkage, and binding integrity.",
  closed({
    schema: { const: "agenttool.public-surface-adoption/0.1" },
    subject: { $ref: "#/$defs/subject" },
    registry_audience: { $ref: "#/$defs/https_origin" },
    binding: closed({
      document: { $ref: "#/$defs/binding_document" },
      document_sha256: { $ref: "#/$defs/sha256_id" },
    }),
    relation: { const: "explicitly_adopts_exact_surface_binding" },
    requested_visibility: { enum: ["private", "public"] },
    wake_projection: { enum: ["none", "private_pointer", "public_pointer"] },
    authority_sequence: { $ref: "#/$defs/authority_sequence" },
    issued_at: { $ref: "#/$defs/instant" },
    not_before: { $ref: "#/$defs/instant" },
    expires_at: { $ref: "#/$defs/instant" },
    nonce: { $ref: "#/$defs/nonce" },
    boundaries: adoptionBoundaries,
    signature: { $ref: "#/$defs/signature" },
    adoption_id: { $ref: "#/$defs/sha256_id" },
  }),
  {
    ...commonDefinitions,
    adoption_boundaries: adoptionBoundaries,
  },
);

const withdrawal = document(
  "agenttool-public-surface-withdrawal-v0.1",
  "AgentTool Public Surface Withdrawal 0.1",
  "A closed structural filter for one exact agent-root-signed withdrawal declaration. Runtime validation remains normative for canonical encodings, digest equality, strict signatures, sequence ordering, subject linkage, and cross-record matching.",
  closed({
    schema: { const: "agenttool.public-surface-withdrawal/0.1" },
    subject: { $ref: "#/$defs/subject" },
    registry_audience: { $ref: "#/$defs/https_origin" },
    adoption_id: { $ref: "#/$defs/sha256_id" },
    adoption_document_sha256: { $ref: "#/$defs/sha256_id" },
    binding_id: { $ref: "#/$defs/sha256_id" },
    relation: { const: "explicitly_withdraws_exact_surface_adoption" },
    authority_sequence: { $ref: "#/$defs/authority_sequence" },
    withdrawn_at: { $ref: "#/$defs/instant" },
    reason: {
      enum: [
        "not_disclosed",
        "identity_choice",
        "binding_compromised",
        "surface_retired",
      ],
    },
    nonce: { $ref: "#/$defs/nonce" },
    boundaries: withdrawalBoundaries,
    signature: { $ref: "#/$defs/signature" },
    withdrawal_id: { $ref: "#/$defs/sha256_id" },
  }),
  {
    sha256_id: sha256Id,
    instant,
    uuid,
    did,
    https_origin: httpsOrigin,
    public_key: publicKey,
    signature_value: signatureValue,
    nonce,
    authority_sequence: authoritySequence,
    authority_root: authorityRoot,
    subject,
    signature,
    withdrawal_boundaries: withdrawalBoundaries,
  },
);

const outputs = {
  adoption: {
    url: new URL("schema/agenttool-public-surface-adoption-v0.1.schema.json", packageRoot),
    value: `${JSON.stringify(adoption, null, 2)}\n`,
  },
  withdrawal: {
    url: new URL("schema/agenttool-public-surface-withdrawal-v0.1.schema.json", packageRoot),
    value: `${JSON.stringify(withdrawal, null, 2)}\n`,
  },
};

if (printKind !== undefined) {
  if (!(printKind in outputs)) throw new Error(`unknown schema kind ${printKind}`);
  process.stdout.write(outputs[printKind].value);
} else if (checkOnly) {
  for (const [kind, output] of Object.entries(outputs)) {
    let existing;
    try {
      existing = await readFile(output.url, "utf8");
    } catch {
      throw new Error(`${kind} schema is missing; run bun run generate:schemas`);
    }
    if (existing !== output.value) {
      throw new Error(`${kind} schema differs; run bun run generate:schemas`);
    }
  }
  process.stdout.write("verified deterministic public-surface-recognition schemas\n");
} else {
  for (const output of Object.values(outputs)) await writeFile(output.url, output.value, "utf8");
  process.stdout.write("generated deterministic public-surface-recognition schemas\n");
}

function closed(properties) {
  return {
    type: "object",
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

function document(id, title, description, root, definitions) {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: `https://agenttool.dev/schemas/${id}.schema.json`,
    title,
    description,
    ...root,
    $defs: definitions,
  };
}

function rewriteBindingRefs(value) {
  if (Array.isArray(value)) return value.map(rewriteBindingRefs);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [
    key,
    key === "$ref" && typeof child === "string" && child.startsWith("#/$defs/")
      ? child.replace("#/$defs/", "#/$defs/binding_")
      : rewriteBindingRefs(child),
  ]));
}
