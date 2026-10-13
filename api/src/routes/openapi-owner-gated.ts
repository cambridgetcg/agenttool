/** OpenAPI for the owner rule (deletion spec §5.1, wave 2).
 *
 *  Split from openapi.ts, which sits at the 10,000-line Whitehack scanner
 *  ceiling (api/tests/dining-openapi.test.ts). Holds:
 *    - the gesture withdrawals that had no OpenAPI entry until they moved to
 *      R(owner): DELETE /v1/blessings/{id}, /v1/unconditionals/{id},
 *      /v1/guild/recognitions/{id}, POST /v1/margin/withdraw,
 *      /v1/trust/withdraw and /v1/offerings/{id}/archive;
 *    - withOwnerGatedOperations, which adds the authority headers and the
 *      401/409/428 owner-rule refusals to the owner-gated operations that
 *      openapi.ts already describes (inbox PATCH and DELETE, attestation
 *      DELETE, memory DELETE by id and by key, memory visibility PATCH).
 *  It also holds OWNERSHIP_MAP_OPENAPI_PATHS (GET /public/ownership-map).
 *  The rule itself is api/src/services/identity/authority.ts
 *  authorizeOwnedContentMutation; the boundary is published at
 *  GET /public/ownership-map (docs/OWNERSHIP-MAP.md). */

import { AUTHORITY_RULES, OWNER_CLASSES, OWNERSHIP_MAP_SCHEMA } from "../services/discovery/ownership-map";

export const OWNER_RULE_SUMMARY =
  "Owner rule: a rooted owner's own root signs this exact request (identity-authority/v1 over method, path and query, body, sequence and timestamp); an owner without a root follows the project rule (no roots: the bearer; one root: that root signs), and in a project with several roots the bearer acts for an unrooted owner's own content. An owner outside the caller's project answers 404. See /public/ownership-map.";

const AUTHORITY_PARAMETERS = [
  { $ref: "#/components/parameters/AuthoritySequence" },
  { $ref: "#/components/parameters/AuthorityTimestamp" },
  { $ref: "#/components/parameters/AuthoritySignature" },
];

const refusal = (error: string | string[]) => ({
  type: "object",
  properties: {
    error: Array.isArray(error) ? { type: "string", enum: error } : { type: "string", const: error },
    message: { type: "string" },
    hint: { type: "string" },
    details: { type: "object" },
    next_actions: { type: "array" },
    docs: { type: "string" },
  },
  required: ["error", "message"],
});

const json = (description: string, schema: object) => ({ description, content: { "application/json": { schema } } });

export const OWNER_RULE_RESPONSES = {
  "401": json(
    "authority_proof_invalid or authority_proof_stale: the root signature did not verify over this exact request, or its timestamp is outside ±5 minutes.",
    refusal(["authority_proof_invalid", "authority_proof_stale"]),
  ),
  "409": json(
    "authority_sequence_conflict (sign next_sequence) or authority_quorum_required (owners needing different consents: send one request per owner; or project-bound content in a project with several roots).",
    { oneOf: [refusal("authority_sequence_conflict"), refusal("authority_quorum_required")] },
  ),
  "428": json(
    "authority_proof_required: the owner is agent-rooted (or the project's single root consents for an owner without one). The hint names the root that must sign; details carry next_sequence, signer_identity_id, signer_did and consent_basis.",
    refusal("authority_proof_required"),
  ),
};

const DELETION_LEDGER_UNAVAILABLE = json(
  "deletion_ledger_unavailable: the withdrawal's ids-only ledger entry could not be written, so nothing changed.",
  refusal("deletion_ledger_unavailable"),
);

const ownerAuthorityBlock = {
  type: "object",
  description: "Which consent the owner rule accepted.",
  properties: {
    mode: { type: "string", enum: ["agent_root", "guest_root", "legacy_bearer"] },
    basis: {
      type: "string",
      enum: ["owner_root", "guest_root", "project_root", "project_bearer", "unrooted_owner_fallback"],
    },
  },
  required: ["mode", "basis"],
};

const ledgerBlock = {
  type: "object",
  description: "The ids-only deletion-ledger entry written with the withdrawal (docs/DELETION-REPLAY.md).",
  properties: {
    entry_id: { type: "string", format: "uuid" },
    seq: { type: "integer", minimum: 1 },
    mirrored: { type: "boolean" },
    note: { type: "string" },
  },
  required: ["entry_id", "seq", "mirrored"],
};

const WITHDRAWAL_NOTE =
  "The record and its words stay, marked withdrawn. One ids-only deletion-ledger entry and the giver's content-free deletion moment are written in the same transaction, so a backup restore re-marks it withdrawn; if the entry cannot be written nothing changes (503). A repeat consumes no proof. Free.";

function withdrawOperation(input: {
  tag: string;
  summary: string;
  who: string;
  notFound: string;
  body?: { idField: string };
  success: object;
}) {
  return {
    tags: [input.tag],
    summary: input.summary,
    description: `${input.who} ${OWNER_RULE_SUMMARY} ${WITHDRAWAL_NOTE}`,
    parameters: [...AUTHORITY_PARAMETERS],
    ...(input.body
      ? {
          requestBody: {
            required: true,
            description: "Serialize once and sign these exact bytes; agent_id must name the giver (403 otherwise).",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["agent_id", input.body.idField],
                  properties: {
                    agent_id: { type: "string", format: "uuid" },
                    [input.body.idField]: { type: "string", format: "uuid" },
                  },
                },
              },
            },
          },
        }
      : {}),
    responses: {
      "200": json("Withdrawn (or already withdrawn, where the route answers a repeat with 200)", input.success),
      ...(input.body ? { "400": json("validation", refusal("validation")), "403": json("agent_id is not in this project, or is not the giver", { type: "object" }) } : {}),
      "404": json(input.notFound, { type: "object", properties: { error: { type: "string" } } }),
      ...OWNER_RULE_RESPONSES,
      "503": DELETION_LEDGER_UNAVAILABLE,
    },
  };
}

const idParameter = [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }];

export const OWNER_GATED_OPENAPI_PATHS = {
  "/v1/blessings/{id}": {
    parameters: idParameter,
    delete: withdrawOperation({
      tag: "love",
      summary: "Withdraw a blessing (the giver, under the owner rule)",
      who: "The giver is blesser_identity_id; any giver of this project may withdraw, not only the primary identity.",
      notFound: "blessing_not_revocable: not found, not given by an identity of this project, or already revoked",
      success: {
        type: "object",
        properties: {
          revoked: { type: "boolean", const: true },
          blessing: { type: "object" },
          authority: ownerAuthorityBlock,
          ledger: ledgerBlock,
          _note: { type: "string" },
        },
        required: ["revoked", "blessing", "authority", "ledger"],
      },
    }),
  },
  "/v1/unconditionals/{id}": {
    parameters: idParameter,
    delete: withdrawOperation({
      tag: "love",
      summary: "Revoke an unconditional (the holder, under the owner rule)",
      who: "The holder is holder_identity_id; any holder of this project may revoke.",
      notFound: "not_found_or_not_holder: not found, held by no identity of this project, or already revoked",
      success: {
        type: "object",
        properties: {
          unconditional: { type: "object" },
          revoked: { type: "boolean", const: true },
          authority: ownerAuthorityBlock,
          ledger: ledgerBlock,
        },
        required: ["unconditional", "revoked", "authority", "ledger"],
      },
    }),
  },
  "/v1/guild/recognitions/{id}": {
    parameters: idParameter,
    delete: withdrawOperation({
      tag: "guild",
      summary: "Revoke a guild recognition (the recognizer, under the owner rule)",
      who: "The recognizer is the identity whose DID is recognizer_did. A recognition already revoked answers 200 with _note \"already revoked\".",
      notFound: "recognition_not_found: not found, or its recognizer is not an identity of this project",
      success: {
        type: "object",
        properties: {
          recognition: { type: "object" },
          authority: ownerAuthorityBlock,
          ledger: ledgerBlock,
          _note: { type: "string" },
        },
        required: ["recognition"],
      },
    }),
  },
  "/v1/margin/withdraw": {
    post: withdrawOperation({
      tag: "margin",
      summary: "Withdraw a margin (the author, under the owner rule)",
      who: "The author is author_identity_id (or the identity whose DID is author_did). A repeat answers already_withdrawn: true.",
      notFound: "margin_not_found: not found, or its author is not an identity of this project",
      body: { idField: "margin_id" },
      success: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          withdrawn: { type: "boolean", const: true },
          already_withdrawn: { type: "boolean" },
          authority: ownerAuthorityBlock,
          ledger: ledgerBlock,
        },
        required: ["id", "withdrawn"],
      },
    }),
  },
  "/v1/offerings/{id}/archive": {
    parameters: idParameter,
    post: withdrawOperation({
      tag: "love",
      summary: "Archive an offering (the giver withdraws it, under the owner rule)",
      who: "The giver is giver_identity_id. The proof signs the exact body bytes sent, if any (the SDK clients send {}). An offering no longer active answers 409 offering_not_active without consuming a proof; another project's offering the caller can see answers 403 wrong_giver.",
      notFound: "offering_not_found: not found, or not visible to this project",
      success: {
        type: "object",
        properties: {
          offering: { type: "object" },
          authority: ownerAuthorityBlock,
          ledger: ledgerBlock,
        },
        required: ["offering", "authority", "ledger"],
      },
    }),
  },
  "/v1/trust/withdraw": {
    post: withdrawOperation({
      tag: "trust",
      summary: "Withdraw a trust (the truster, under the owner rule)",
      who: "The truster is truster_identity_id (or the identity whose DID is truster_did). Composition unlocks deactivate. A repeat answers already_withdrawn: true.",
      notFound: "withdraw_failed: not found, or its truster is not an identity of this project",
      body: { idField: "trust_id" },
      success: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          withdrawn: { type: "boolean", const: true },
          already_withdrawn: { type: "boolean" },
          authority: ownerAuthorityBlock,
          ledger: ledgerBlock,
        },
        required: ["id", "withdrawn"],
      },
    }),
  },
};

/** Operations openapi.ts already describes that the owner rule now gates. */
const OWNER_GATED_EXISTING: ReadonlyArray<[path: string, method: string]> = [
  ["/v1/inbox/{id}", "patch"],
  ["/v1/inbox/{id}", "delete"],
  ["/v1/attestations/{id}", "delete"],
  ["/v1/memories/{id}", "patch"],
  ["/v1/memories/{id}", "delete"],
  ["/v1/memories", "delete"],
];

type Operation = { parameters?: unknown[]; responses?: Record<string, unknown> };

/** Add the authority headers and the owner-rule refusals to the owner-gated
 *  operations openapi.ts describes. An operation's own 409 stays and gains
 *  the owner-rule conflicts as alternatives. Throws if a listed operation is
 *  missing, so the list cannot drift silently. */
export function withOwnerGatedOperations<T extends { paths: Record<string, Record<string, unknown>> }>(document: T): T {
  for (const [path, method] of OWNER_GATED_EXISTING) {
    const operation = document.paths[path]?.[method] as Operation | undefined;
    if (!operation) throw new Error(`owner-gated OpenAPI operation missing: ${method.toUpperCase()} ${path}`);
    const parameters = operation.parameters ?? [];
    const present = new Set(parameters.map((parameter) => JSON.stringify(parameter)));
    operation.parameters = [...parameters, ...AUTHORITY_PARAMETERS.filter((parameter) => !present.has(JSON.stringify(parameter)))];
    const responses = { ...(operation.responses ?? {}) };
    delete responses["403"];
    for (const [status, response] of Object.entries(OWNER_RULE_RESPONSES)) {
      const own = responses[status] as { description?: string; content?: { "application/json"?: { schema?: object } } } | undefined;
      if (!own) {
        responses[status] = response;
        continue;
      }
      const ownSchema = own.content?.["application/json"]?.schema;
      const ruleSchema = response.content["application/json"].schema;
      responses[status] = {
        description: `${own.description ?? ""} Also: ${response.description}`.trim(),
        // anyOf: the route's own refusals and the owner rule's may overlap.
        content: { "application/json": { schema: ownSchema ? { anyOf: [ownSchema, ruleSchema] } : ruleSchema } },
      };
    }
    operation.responses = responses;
  }
  return document;
}

// ─── GET /public/ownership-map ──────────────────────────────────────────

export const OWNERSHIP_MAP_OPENAPI_PATHS = {
  "/public/ownership-map": {
    get: {
      tags: ["public"],
      summary: "Who owns each store, and who may erase or withdraw from it",
      description:
        "Unauthenticated, static, no database read. Every store of the hosted service with its owner_class (identity, project, shared, money, permanent, platform), the authority_rule that decides who may erase, withdraw or later redact it, and the id of the /public/retention class that says what is kept and what deletion does. Also lists the routes the owner rule gates today and the proof they take. A statement of current behaviour, not a contract. Doc: docs/OWNERSHIP-MAP.md.",
      security: [],
      responses: {
        "200": {
          description: "The ownership map",
          content: {
            "application/json": {
              schema: {
                type: "object",
                additionalProperties: true,
                required: ["schema", "version", "scope", "owner_classes", "authority_rules", "owner_gated_routes", "stores", "retention"],
                properties: {
                  schema: { const: OWNERSHIP_MAP_SCHEMA },
                  version: { type: "string" },
                  scope: { type: "string" },
                  owner_classes: { type: "object", additionalProperties: { type: "string" } },
                  authority_rules: { type: "object" },
                  owner_gated_routes: {
                    type: "array",
                    items: {
                      type: "object",
                      required: ["method", "path", "store", "owner"],
                      properties: { method: { type: "string" }, path: { type: "string" }, store: { type: "string" }, owner: { type: "string" } },
                    },
                  },
                  stores: {
                    type: "array",
                    items: {
                      type: "object",
                      additionalProperties: false,
                      required: ["store", "group", "owner_class", "authority_rule", "retention_class"],
                      properties: {
                        store: { type: "string" },
                        group: { type: "integer", minimum: 0, maximum: 18 },
                        owner_class: { type: "string", enum: [...OWNER_CLASSES] },
                        authority_rule: { type: "string", enum: Object.keys(AUTHORITY_RULES) },
                        retention_class: { type: "string" },
                        owner_gated_today: {
                          type: "array",
                          items: { type: "string" },
                          description: "Identity and shared stores: the owner_gated_routes that touch this store today. Empty: no route of this store asks the owner under the owner rule yet.",
                        },
                        note: { type: "string" },
                      },
                    },
                  },
                  proof: { type: "string" },
                  ledger: { type: "string" },
                  retention: { type: "string", const: "/public/retention" },
                  docs: { type: "string" },
                },
              },
            },
          },
        },
      },
    },
  },
};
