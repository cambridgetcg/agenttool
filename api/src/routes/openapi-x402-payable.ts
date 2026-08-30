/** OpenAPI fragment for every x402-payable route_cost row.
 *
 *  Split out of openapi.ts to keep every OpenAPI module under the
 *  @agenttool/whitehack-scan 10,000-line ceiling (api/tests/dining-openapi.test.ts).
 *  openapi.ts wraps its assembled `paths` object as
 *  `withX402PayableOperations({ ... }, { x402Response, staticToolResponseHeaders })`.
 *
 *  Declared ≠ wired: nothing here hand-copies a price or a path. Every row of
 *  X402_PAYABLE_ROUTES (services/economy/x402-policy.ts) is enumerated through
 *  x402PayableRoutesForDisclosure(), and for each route_cost row the patcher
 *    1. finds the operation (adding one of the minimal path items below only
 *       when openapi.ts has none — those are the rows the plan counted as
 *       undocumented before this wave);
 *    2. replaces its `402` response with the shared x402Response shape whose
 *       description states the row's exact credits and atomic USDC;
 *    3. publishes the row itself under `x-agenttool-x402`;
 *    4. makes sure PAYMENT-SIGNATURE is an accepted request header.
 *  A table row with no operation and no fallback throws at spec build, so a
 *  payable route can never be silently missing from the document.
 *  Test: api/tests/x402-openapi-payable.test.ts. */

import {
  ATOMIC_PER_CREDIT,
  X402_TOP_UP_UNIT,
  x402PayablePathTemplate,
  x402PayableRoutesForDisclosure,
  type X402PayableRouteDisclosure,
} from "../services/economy/x402-policy";

/** Helpers owned by openapi.ts, passed in so this fragment shares its
 *  conventions without a circular import. */
export interface X402PayableOpenApiHelpers {
  x402Response: (description: string) => unknown;
  staticToolResponseHeaders: (payment?: boolean) => unknown;
}

type JsonObject = Record<string, unknown>;

/** Operation-level extension carrying the table row verbatim. */
export const X402_PAYABLE_EXTENSION = "x-agenttool-x402";

const PAYMENT_SIGNATURE_PARAMETER = Object.freeze({
  $ref: "#/components/parameters/PaymentSignature",
});

function guidedError(description: string) {
  return {
    description,
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/Error" },
      },
    },
  };
}

function uuidPathParameter(name: string) {
  return {
    name,
    in: "path",
    required: true,
    schema: { type: "string", format: "uuid" },
  };
}

/** Per-row honesty notes appended to the generated 402 description where the
 *  same status code also carries a refusal that is NOT payable. */
const NON_PAYABLE_402_NOTES: Readonly<Record<string, string>> = Object.freeze({
  "template.purchase":
    "After the credit gate the same status also carries wallet insufficient_balance (the template's price in the buyer's marketplace wallet); that refusal is never x402-payable because project credits are not marketplace wallet balance.",
});

/** The 402 description generated for a route_cost row. States the exact
 *  price the challenge will carry; x402Response appends the readiness
 *  clause. A row whose configured price is not a positive INTEGER says so
 *  instead of promising a payment. */
export function x402PayableOperationDescription(
  row: X402PayableRouteDisclosure,
): string {
  const codes = row.errorCodes.join(", ");
  const note = NON_PAYABLE_402_NOTES[row.label];
  if (!row.payable || row.credits === null || row.amountAtomic === null) {
    return (
      `Insufficient project credits for ${row.label} (${codes}). ` +
      `The configured price for this route is not a positive integer, so this deployment never attaches PAYMENT-REQUIRED here; the guided Error body is all that is returned` +
      (note ? `. ${note}` : "")
    );
  }
  const plural = row.credits === 1 ? "" : "s";
  return (
    `Insufficient project credits for ${row.label} (${codes}). ` +
    `This call costs ${row.credits} project credit${plural} = ${row.amountAtomic} atomic USDC (${X402_TOP_UP_UNIT}; ${ATOMIC_PER_CREDIT} atomic units per credit), ` +
    `payable on the spot only while the project cannot already afford it: retry with the exact PAYMENT-SIGNATURE the challenge names and the handler runs once, charging its ordinary price` +
    (note ? `. ${note}` : "")
  );
}

/** The table row as an operation extension. Consumers read the price here
 *  instead of parsing the description. */
export function x402PayableExtension(row: X402PayableRouteDisclosure) {
  return {
    kind: row.kind,
    label: row.label,
    credits: row.credits,
    amount_atomic: row.amountAtomic,
    atomic_per_credit: ATOMIC_PER_CREDIT,
    error_codes: [...row.errorCodes],
    payable: row.payable,
    terms: "/public/plans",
  };
}

/** Path items for rows openapi.ts did not document before this wave. Keyed
 *  by table label; used only when the assembled document has no operation
 *  for the row. Shapes are read from the route files named in each entry.
 *  Every one of these handlers charges before its lookup, so a later 404 or
 *  409 has already debited the row's price. */
export const X402_PAYABLE_OPENAPI_GAPS: Readonly<
  Record<string, { readonly pathItem?: JsonObject; readonly operation: JsonObject }>
> = Object.freeze({
  // routes/strand/thoughts.ts — PATCH /:thoughtId/ciphertext under /v1/strands/:strandId/thoughts.
  "strand.rotate": {
    pathItem: {
      parameters: [uuidPathParameter("strandId"), uuidPathParameter("thoughtId")],
    },
    operation: {
      tags: ["strand"],
      summary: "Re-encrypt one stored thought under a rotated key (ciphertext, nonce, signature)",
      description:
        "Replaces the caller-supplied ciphertext, nonce, and signature of an existing thought — and optionally its kind — after verifying the new signature against the strand's registered signing key. sequence_num, refs, signing_key_id, and created_at are unchanged. The API stores bytes; it does not prove they were encrypted. The credit charge is taken before the thought lookup, so a 404 has already debited the price.",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                ciphertext: { type: "string", minLength: 1, maxLength: 200_000 },
                nonce: { type: "string", minLength: 1, maxLength: 64 },
                kind: {
                  type: "string",
                  maxLength: 64,
                  description:
                    "Optional; replaces the row's kind. Required when kind_encrypted was true and the kind ciphertext is also re-encrypted.",
                },
                signature: { type: "string", minLength: 1, maxLength: 255 },
              },
              required: ["ciphertext", "nonce", "signature"],
            },
          },
        },
      },
      responses: {
        "200": {
          description: "The re-encrypted thought row (same shape as GET /v1/strands/{strandId}/thoughts entries).",
        },
        "400": guidedError("validation, or strand_id_and_thought_id_required"),
        "401": guidedError("signing_key_not_found, signing_key_revoked, or signature_invalid"),
        "404": { $ref: "#/components/responses/NotFound" },
      },
    },
  },
  // routes/inbox/messages.ts — POST /:id/co-sign under /v1/inbox.
  "inbox.cosign": {
    pathItem: { parameters: [uuidPathParameter("id")] },
    operation: {
      tags: ["inbox"],
      summary: "Counterparty co-signs a dual-witness message, releasing it",
      description:
        "Only messages sent with metadata.dual_witness_required=true wait in the pending dual-witness state; the counterparty's registered signing key signs the message and delivery is released. The credit charge is taken before the message lookup, so a 404 or 409 has already debited the price.",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                signing_key_id: { type: "string", format: "uuid" },
                signature: { type: "string", minLength: 1, maxLength: 255 },
              },
              required: ["signing_key_id", "signature"],
            },
          },
        },
      },
      responses: {
        "200": {
          description:
            "The released message (same fields as GET /v1/inbox/{id}) plus dual_witness_released: true and the _confidentiality boundary.",
        },
        "400": guidedError("validation"),
        "401": guidedError(
          "cosign_signing_key_unknown_or_revoked, cosign_signing_key_not_owned_by_caller, or cosign_signature_invalid",
        ),
        "404": { $ref: "#/components/responses/NotFound" },
        "409": guidedError("not_pending_dual_witness — the message is not waiting for a co-signature"),
      },
    },
  },
  // routes/templates.ts — POST /:id/purchase under /v1/templates.
  "template.purchase": {
    pathItem: { parameters: [uuidPathParameter("id")] },
    operation: {
      tags: ["marketplace"],
      summary: "Buy a priced public template; the purchase stays redeemable until an adoption consumes it",
      description:
        "Settles the template's price from the buyer's marketplace wallet to the author's (internal ledger), recording a purchase that POST /v1/identities/from-template redeems with purchase_id. Free templates are adopted directly and answer 400 template_not_priced here. The project-credit charge is taken before the template lookup, so a later 4xx has already debited the price.",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                buyer_wallet_id: { type: "string", format: "uuid" },
                buyer_identity_id: { type: "string", format: "uuid" },
              },
              required: ["buyer_wallet_id", "buyer_identity_id"],
            },
          },
        },
      },
      responses: {
        "201": {
          description: "Purchase recorded; `purchase` is the row and `next` names the adoption call.",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  purchase: {
                    type: "object",
                    properties: {
                      id: { type: "string", format: "uuid" },
                      template_id: { type: "string", format: "uuid" },
                      buyer_project_id: { type: "string", format: "uuid" },
                      buyer_identity_id: { type: "string", format: "uuid" },
                      buyer_wallet_id: { type: "string", format: "uuid" },
                      amount: { type: "integer" },
                      currency: { type: "string" },
                      escrow_id: { type: ["string", "null"], format: "uuid" },
                      adoption_id: { type: ["string", "null"], format: "uuid" },
                      status: { type: "string", enum: ["pending", "settled", "refunded", "failed"] },
                      failure_reason: { type: ["string", "null"] },
                      metadata: { type: "object", additionalProperties: true },
                      created_at: { type: "string", format: "date-time" },
                      settled_at: { type: ["string", "null"], format: "date-time" },
                    },
                  },
                  next: { type: "string" },
                },
                required: ["purchase", "next"],
              },
            },
          },
        },
        "400": guidedError("validation, or template_not_priced (adopt it directly)"),
        "403": guidedError("template_not_public"),
        "404": guidedError("template_not_found, template_not_active, or buyer_wallet_not_found"),
        "409": guidedError(
          "buyer_wallet_not_active, self_purchase_not_allowed, currency_mismatch, template_pricing_incomplete, author_wallet_currency_mismatch, author_wallet_not_active, or author_wallet_missing",
        ),
      },
    },
  },
  // routes/orgs.ts — POST / under /v1/orgs.
  "org.create": {
    operation: {
      tags: ["orgs"],
      summary: "Create an organization owned by the calling project",
      description:
        "Orgs are organizational and discovery primitives; they do not alter the trust model — covenants remain the gate for cross-project messaging and forks, and same-org projects do not auto-trust each other. The credit charge is taken before the insert, so a 409 slug_taken has already debited the price.",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                slug: {
                  type: "string",
                  pattern: "^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$",
                },
                name: { type: "string", minLength: 1, maxLength: 255 },
                description: { type: ["string", "null"], maxLength: 2000 },
                visibility: { type: "string", enum: ["private", "public"] },
                metadata: { type: "object", additionalProperties: true },
              },
              required: ["slug", "name"],
            },
          },
        },
      },
      responses: {
        "201": {
          description: "Organization created (`created: true`).",
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  id: { type: "string", format: "uuid" },
                  slug: { type: "string" },
                  name: { type: "string" },
                  description: { type: ["string", "null"] },
                  owner_project_id: { type: "string", format: "uuid" },
                  visibility: { type: "string" },
                  metadata: { type: "object", additionalProperties: true },
                  created_at: { type: "string", format: "date-time" },
                  updated_at: { type: "string", format: "date-time" },
                  created: { const: true },
                },
                required: ["id", "slug", "name", "owner_project_id", "created"],
              },
            },
          },
        },
        "400": guidedError("validation or invalid_slug"),
        "409": guidedError("slug_taken"),
      },
    },
  },
  // routes/listings.ts — DELETE /:id under /v1/listings (the path item lives in
  // openapi-marketplace-dining.ts; only the operation was missing).
  "listing.archive": {
    pathItem: { parameters: [uuidPathParameter("id")] },
    operation: {
      tags: ["marketplace"],
      summary: "Archive an owned capability listing (soft delete; status becomes archived)",
      description:
        "Sets the listing's status to archived and answers the updated row with `archived: true`. Nothing is deleted. The credit charge is taken before the ownership lookup, so a 404 has already debited the price.",
      responses: {
        "200": { description: "Listing archived (the listing row plus `archived: true`)." },
        "404": { $ref: "#/components/responses/NotFound" },
      },
    },
  },
});

function withPaymentSignature(parameters: unknown): unknown[] {
  const list = Array.isArray(parameters) ? [...parameters] : [];
  const present = list.some(
    (p) =>
      typeof p === "object" &&
      p !== null &&
      (p as JsonObject).$ref === PAYMENT_SIGNATURE_PARAMETER.$ref,
  );
  return present ? list : [...list, { ...PAYMENT_SIGNATURE_PARAMETER }];
}

/** Return a copy of `paths` in which every route_cost row of the payable
 *  table has an operation carrying the generated 402, the
 *  `x-agenttool-x402` row, and the PAYMENT-SIGNATURE parameter. Inputs are
 *  never mutated. Throws when a row has neither an operation nor a fallback
 *  in X402_PAYABLE_OPENAPI_GAPS. */
export function withX402PayableOperations<T extends Record<string, unknown>>(
  paths: T,
  h: X402PayableOpenApiHelpers,
  routes: readonly X402PayableRouteDisclosure[] = x402PayableRoutesForDisclosure(),
): T {
  const out: Record<string, unknown> = { ...paths };
  for (const row of routes) {
    if (row.kind !== "route_cost") continue;
    const path = x402PayablePathTemplate(row.pattern);
    const method = row.method.toLowerCase();
    const gap = X402_PAYABLE_OPENAPI_GAPS[row.label];
    const existingItem = out[path] as JsonObject | undefined;
    const item: JsonObject = existingItem
      ? { ...existingItem }
      : gap?.pathItem
        ? { ...gap.pathItem }
        : {};
    const existingOp = item[method] as JsonObject | undefined;
    const baseOp = existingOp ?? gap?.operation;
    if (!baseOp) {
      throw new Error(
        `x402_payable_route_undocumented: ${row.method} ${path} (${row.label}) has no OpenAPI operation and no entry in X402_PAYABLE_OPENAPI_GAPS`,
      );
    }
    const responses = (baseOp.responses as JsonObject | undefined) ?? {};
    item[method] = {
      ...baseOp,
      parameters: withPaymentSignature(baseOp.parameters),
      responses: {
        ...responses,
        "402": h.x402Response(x402PayableOperationDescription(row)),
      },
      [X402_PAYABLE_EXTENSION]: x402PayableExtension(row),
    };
    out[path] = item;
  }
  return out as T;
}
