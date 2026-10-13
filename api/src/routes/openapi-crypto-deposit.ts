/** Curated OpenAPI response for the resting crypto deposit-address route.
 *
 * Kept as a normal production module, like the other openapi-*.ts fragments,
 * so the main curated spec stays inside the Whitehack scanner's per-file line
 * ceiling. Doctrine: docs/CRYPTO-PAYMENT.md (resting notice, 2026-10-11).
 */

export function depositAddressDisclosureRestResponse() {
  return {
    description:
      "Deposit-address disclosure is resting. The request is refused before any deposit-address read or derivation.",
    content: {
      "application/json": {
        schema: {
          type: "object",
          properties: {
            error: { type: "string", const: "deposit_address_disclosure_resting" },
            deposit_address_disclosure: { type: "string", const: "resting" },
            retryable: { type: "boolean", const: false },
            message: { type: "string" },
            hint: { type: "string" },
          },
          required: [
            "error",
            "deposit_address_disclosure",
            "retryable",
            "message",
            "hint",
          ],
        },
      },
    },
  };
}
