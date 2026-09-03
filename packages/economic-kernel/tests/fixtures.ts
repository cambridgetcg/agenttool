import {
  LedgerAccountRegistry,
  SCHEMAS,
  UnitRegistry,
  amount,
  createEconomicQuote,
  createPriceRevision,
  registerEffectAttempt,
  registerPaymentAttempt,
  type EconomicQuote,
  type EffectAttempt,
  type PaymentAttempt,
  type PriceRevision,
  type PriceRevisionSeed,
} from "../src/index.js";

export const GBP = "iso4217:gbp:minor";
export const BASE_USDC = "caip19:eip155:8453/erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913:atomic";
export const PROJECT_CREDIT = "agenttool:project-api-credit/1";
export const WALLET_CREDIT = "agenttool:wallet-credit/1";
export const START = "2026-09-02T00:00:00.000Z";
export const ACTION_DIGEST = `sha256:${"1".repeat(64)}`;

export function makeUnits(): UnitRegistry {
  return new UnitRegistry([
    {
      schema: SCHEMAS.unit,
      unit_id: GBP,
      dimension: "FIAT",
      decimals: 2,
      ledger_domain: "ledger:gbp",
      transferability: "TRANSFERABLE",
    },
    {
      schema: SCHEMAS.unit,
      unit_id: BASE_USDC,
      dimension: "TOKEN",
      decimals: 6,
      ledger_domain: "ledger:base-usdc",
      transferability: "TRANSFERABLE",
    },
    {
      schema: SCHEMAS.unit,
      unit_id: PROJECT_CREDIT,
      dimension: "ENTITLEMENT",
      decimals: 0,
      ledger_domain: "ledger:project-credit",
      transferability: "NONTRANSFERABLE",
    },
    {
      schema: SCHEMAS.unit,
      unit_id: WALLET_CREDIT,
      dimension: "ENTITLEMENT",
      decimals: 0,
      ledger_domain: "ledger:wallet-credit",
      transferability: "NONTRANSFERABLE",
    },
  ]);
}

export function makeAccounts(units = makeUnits()): LedgerAccountRegistry {
  return new LedgerAccountRegistry([
    account("account:gbp-user", "ledger:gbp", GBP, "ASSET"),
    account("account:gbp-clearing", "ledger:gbp", GBP, "LIABILITY"),
    account("account:usdc-user", "ledger:base-usdc", BASE_USDC, "ASSET"),
    account("account:usdc-clearing", "ledger:base-usdc", BASE_USDC, "LIABILITY"),
    account("account:project-user", "ledger:project-credit", PROJECT_CREDIT, "ASSET"),
    account("account:project-issuer", "ledger:project-credit", PROJECT_CREDIT, "LIABILITY"),
    account("account:wallet-user", "ledger:wallet-credit", WALLET_CREDIT, "ASSET"),
    account("account:wallet-issuer", "ledger:wallet-credit", WALLET_CREDIT, "LIABILITY"),
  ], units);
}

function account(
  accountId: string,
  ledgerDomain: string,
  unitId: string,
  accountKind: "ASSET" | "LIABILITY",
) {
  return {
    schema: SCHEMAS.ledgerAccount,
    account_id: accountId,
    ledger_domain: ledgerDomain,
    unit_id: unitId,
    account_kind: accountKind,
  };
}

export function price(overrides: Partial<PriceRevisionSeed> = {}): PriceRevision {
  return createPriceRevision({
    schema: SCHEMAS.priceRevision,
    price_book_id: "pricebook:project-credit",
    revision: "1",
    input_unit_id: BASE_USDC,
    output_unit_id: PROJECT_CREDIT,
    input_atomic_per_lot: "1000",
    output_atomic_per_lot: "1",
    effective_from: START,
    effective_until: null,
    supersedes_price_revision_id: null,
    rounding: "EXACT_ONLY",
    ...overrides,
  }, makeUnits()) as PriceRevision;
}

export function paymentSeed(overrides: Record<string, unknown> = {}) {
  return {
    attempt_id: "payment:attempt-1",
    payment_idempotency_key: "payment-key:order-1",
    quote: quote(),
    created_at: START,
    ...overrides,
  };
}

export function effectSeed(overrides: Record<string, unknown> = {}) {
  const fixedQuote = quote();
  return {
    attempt_id: "effect:attempt-1",
    effect_idempotency_key: "effect-key:order-1",
    action_digest: ACTION_DIGEST,
    quote_id: fixedQuote.quote_id,
    payment_attempt_id: "payment:attempt-1",
    created_at: START,
    ...overrides,
  };
}

export function quote(overrides: Record<string, unknown> = {}): EconomicQuote {
  const units = makeUnits();
  return createEconomicQuote({
    schema: SCHEMAS.quote,
    action_digest: ACTION_DIGEST,
    payer_ref: "actor:payer-1",
    payee_ref: "actor:merchant-1",
    input: amount(BASE_USDC, "1000", units),
    output: amount(PROJECT_CREDIT, "1", units),
    price_revision: price(),
    issued_at: START,
    expires_at: "2026-09-03T00:00:00.000Z",
    ...overrides,
  }, units) as EconomicQuote;
}

export function registeredPayment() {
  return registerPaymentAttempt([], paymentSeed(), makeUnits());
}

export function registeredEffect() {
  return registerEffectAttempt([], effectSeed());
}

export function nextTime(index: number): string {
  return new Date(Date.parse(START) + index * 1_000).toISOString();
}

export function asPayment(value: Readonly<PaymentAttempt>): PaymentAttempt {
  return value as PaymentAttempt;
}

export function asEffect(value: Readonly<EffectAttempt>): EffectAttempt {
  return value as EffectAttempt;
}
