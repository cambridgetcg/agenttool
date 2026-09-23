/** OpenAPI fragment for the agent rail's purchase door — POST /v1/x402/top-up/{credits}.
 *  Split out of openapi.ts to keep every OpenAPI module under the
 *  @agenttool/whitehack-scan 10,000-line ceiling (api/tests/dining-openapi.test.ts).
 *  Spread into openapi.ts as `...x402TopUpOpenApiPaths(x402Response)`. */

import { ATOMIC_PER_CREDIT, X402_TOP_UP_FINALITY, X402_TOP_UP_UNIT } from "../services/economy/x402-policy";

/** Helpers owned by openapi.ts, passed in so this fragment shares its conventions
 *  without a circular import. */
export interface X402TopUpOpenApiHelpers {
  x402Response: (description: string) => unknown;
  staticToolResponseHeaders: (payment?: boolean) => unknown;
}

export function x402TopUpOpenApiPaths(h: X402TopUpOpenApiHelpers) {
  return {
  "/v1/x402/top-up/{credits}": {
    parameters: [{
      name: "credits",
      in: "path",
      required: true,
      schema: { type: "string", pattern: "^[1-9][0-9]*$" },
      description:
        "Credit quantity on a previously admitted payment: a plain positive decimal integer, at most X402_TOP_UP_MAX_CREDITS (published as then_pay_as_you_go.top_up.cap_credits on GET /public/plans; default 10000). Refused, never clamped.",
    }],
    post: {
      tags: ["billing"],
      parameters: [{ $ref: "#/components/parameters/PaymentSignature" }],
      summary: "New project-credit purchases retired; existing payment recovery only",
      description:
        "New purchases return 410 purchases_retired without PAYMENT-REQUIRED. Only a matching previously admitted durable payment record can continue recovery; credits apply at most once. Use /v1/x402/payments/{authorization_hash} for existing records. An Idempotency-Key may replay an earlier successful response.",
      "x-agenttool-billing": {
        unit: X402_TOP_UP_UNIT,
        atomic_per_credit: ATOMIC_PER_CREDIT,
        cap_environment_override: "X402_TOP_UP_MAX_CREDITS",
        finality: X402_TOP_UP_FINALITY,
      },
      responses: {
        "200": {
          description:
            "Payment verified and settled on this request; exactly `credits_added` credits were applied once.",
          headers: h.staticToolResponseHeaders(),
          content: {
            "application/json": {
              schema: {
                type: "object",
                additionalProperties: false,
                properties: {
                  credits_added: { type: "integer", minimum: 1 },
                  credits_total: { type: ["integer", "null"], minimum: 0 },
                  authorization_hash: { type: ["string", "null"], pattern: "^[0-9a-f]{64}$" },
                  amount_atomic: { type: "string", pattern: "^[1-9][0-9]*$" },
                  unit: { const: X402_TOP_UP_UNIT },
                  finality: { const: X402_TOP_UP_FINALITY },
                  payment_status: {
                    type: ["string", "null"],
                    description: "Project-scoped reconciliation path for this authorization.",
                  },
                  _welcomed: { $ref: "#/components/schemas/WelcomedFrame" },
                },
                required: [
                  "credits_added", "credits_total", "authorization_hash", "amount_atomic",
                  "unit", "finality", "payment_status", "_welcomed",
                ],
              },
            },
          },
        },
        "400": {
          description:
            "`credits` is not a plain positive integer within the per-request cap (top_up_invalid_credits). The hint states the cap; nothing is challenged or charged.",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/Error" },
            },
          },
        },
        "401": { $ref: "#/components/responses/Unauthorized" },
        "410": {
          description: "purchases_retired: no new payment authorization or purchase is created.",
          content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
        },
      },
    },
  },
  } as const;
}
