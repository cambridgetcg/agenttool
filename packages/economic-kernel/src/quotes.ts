import { createHash } from "node:crypto";

import { validateAmount } from "./amounts.js";
import { SCHEMAS } from "./constants.js";
import { fail } from "./errors.js";
import { deepFreeze, exactKeys, identifier, record, reference, sha256Identifier, timestamp } from "./internal.js";
import { convertAmount, validatePriceRevision } from "./pricing.js";
import type { EconomicQuote, EconomicQuoteSeed } from "./types.js";
import { UnitRegistry } from "./units.js";

function validateQuoteSeed(value: unknown, units: UnitRegistry): Readonly<EconomicQuoteSeed> {
  const item = record(value, "quote_seed");
  exactKeys(item, [
    "action_digest",
    "expires_at",
    "input",
    "issued_at",
    "output",
    "payee_ref",
    "payer_ref",
    "price_revision",
    "schema",
  ], "quote_seed");
  if (item.schema !== SCHEMAS.quote) fail("INVALID_RECORD", "quote_seed.schema is unsupported.", "quote_seed.schema");
  sha256Identifier(item.action_digest, "quote_seed.action_digest");
  reference(item.payer_ref, "quote_seed.payer_ref");
  reference(item.payee_ref, "quote_seed.payee_ref");
  const input = validateAmount(item.input, units);
  const output = validateAmount(item.output, units);
  const revision = validatePriceRevision(item.price_revision, units);
  const issuedAt = timestamp(item.issued_at, "quote_seed.issued_at");
  const expiresAt = timestamp(item.expires_at, "quote_seed.expires_at");
  if (Date.parse(expiresAt) <= Date.parse(issuedAt)) {
    fail("INVALID_RECORD", "A quote must expire after it is issued.", "quote_seed.expires_at");
  }
  const conversion = convertAmount(input, revision, issuedAt, units);
  if (!conversion.exact || conversion.output.unit_id !== output.unit_id || conversion.output.amount_atomic !== output.amount_atomic) {
    fail("INVALID_RECORD", "Quote output must equal the exact pinned price conversion at issuance.", "quote_seed.output");
  }
  return deepFreeze({
    schema: SCHEMAS.quote,
    action_digest: item.action_digest as string,
    payer_ref: item.payer_ref as string,
    payee_ref: item.payee_ref as string,
    input,
    output,
    price_revision: revision,
    issued_at: issuedAt,
    expires_at: expiresAt,
  });
}

export function deriveQuoteId(value: unknown, units: UnitRegistry): string {
  const quote = validateQuoteSeed(value, units);
  const payload = JSON.stringify({
    schema: quote.schema,
    action_digest: quote.action_digest,
    payer_ref: quote.payer_ref,
    payee_ref: quote.payee_ref,
    input: {
      schema: quote.input.schema,
      unit_id: quote.input.unit_id,
      amount_atomic: quote.input.amount_atomic,
    },
    output: {
      schema: quote.output.schema,
      unit_id: quote.output.unit_id,
      amount_atomic: quote.output.amount_atomic,
    },
    price_revision: {
      schema: quote.price_revision.schema,
      price_revision_id: quote.price_revision.price_revision_id,
      price_book_id: quote.price_revision.price_book_id,
      revision: quote.price_revision.revision,
      input_unit_id: quote.price_revision.input_unit_id,
      output_unit_id: quote.price_revision.output_unit_id,
      input_atomic_per_lot: quote.price_revision.input_atomic_per_lot,
      output_atomic_per_lot: quote.price_revision.output_atomic_per_lot,
      effective_from: quote.price_revision.effective_from,
      effective_until: quote.price_revision.effective_until,
      supersedes_price_revision_id: quote.price_revision.supersedes_price_revision_id,
      rounding: quote.price_revision.rounding,
    },
    issued_at: quote.issued_at,
    expires_at: quote.expires_at,
  });
  return `sha256:${createHash("sha256").update(payload, "utf8").digest("hex")}`;
}

export function createEconomicQuote(value: unknown, units: UnitRegistry): Readonly<EconomicQuote> {
  const seed = validateQuoteSeed(value, units);
  return deepFreeze({ quote_id: deriveQuoteId(seed, units), ...seed });
}

export function validateEconomicQuote(value: unknown, units: UnitRegistry): Readonly<EconomicQuote> {
  const item = record(value, "quote");
  exactKeys(item, [
    "action_digest",
    "expires_at",
    "input",
    "issued_at",
    "output",
    "payee_ref",
    "payer_ref",
    "price_revision",
    "quote_id",
    "schema",
  ], "quote");
  const id = identifier(item.quote_id, "quote.quote_id");
  const seed = validateQuoteSeed({
    action_digest: item.action_digest,
    expires_at: item.expires_at,
    input: item.input,
    issued_at: item.issued_at,
    output: item.output,
    payee_ref: item.payee_ref,
    payer_ref: item.payer_ref,
    price_revision: item.price_revision,
    schema: item.schema,
  }, units);
  const expected = deriveQuoteId(seed, units);
  if (id !== expected) fail("INVALID_RECORD", "quote_id must identify the exact semantic quote payload.", "quote.quote_id");
  return deepFreeze({ quote_id: id, ...seed });
}

export function quoteIsLive(quoteValue: unknown, observedAt: string, units: UnitRegistry): boolean {
  const quote = validateEconomicQuote(quoteValue, units);
  const observed = timestamp(observedAt, "observed_at");
  const time = Date.parse(observed);
  return time >= Date.parse(quote.issued_at) && time < Date.parse(quote.expires_at);
}
