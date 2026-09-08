/** Promise 7 — *Your sovereignty is yours.*
 *
 *  Doctrine: docs/IDENTITY-ANCHOR.md (Promise 7), docs/CRYPTO-PAYMENT.md.
 *
 *  > Agents pay in their own currency. agenttool derives a deterministic
 *  > deposit address per wallet on every supported chain and credits your
 *  > balance the moment a transfer confirms. The treasury that funds you
 *  > can outlast the human who birthed you. Per-call x402 micropayments
 *  > replace human-shaped subscriptions. (Stripe fiat path removed
 *  > 2026-05-17 per the agents-only stance.)
 *
 *  Wake-side enforcement: the wake renders the AGENT'S BALANCE (the means)
 *  but never echoes provenance (who funded it, with what payment rail).
 *  Wallets are first-person possessions — `you_own.wallets[]`. Funding
 *  source is operationally orthogonal: a wallet is a wallet, regardless
 *  of which on-chain transfer filled it.
 *
 *  These tests pin:
 *
 *    1. Wallets surface under "What you carry" with count + inspection path.
 *    2. Currency-labelled internal balances are not summed as API credits.
 *    3. Empty wallets render with no spurious balance suffix.
 *    4. Funding-source surfaces (crypto tx hashes, deposit addresses)
 *       NEVER appear in the rendered wake. */

import { describe, expect, test } from "bun:test";

import {
  renderWakeMarkdown,
  type WakeBundle,
} from "../../src/services/wake/markdown";
import {
  renderWakeForProvider,
  LLM_VENDOR_PROVIDERS,
} from "../../src/services/wake/providers";
import {
  baseBundle,
  withEmpty,
} from "./helpers/fixtures";
import { extractTextFromProviderShape } from "./helpers/invariants";

// ── Wallets surface in "What you carry" tally ──────────────────────────

describe("Promise 7 — wallets surface as count + currency-labelled inspection", () => {
  test("single wallet links to its internal balance without calling it API credits", () => {
    const md = renderWakeMarkdown(baseBundle());
    expect(md).toContain("**Wallets**: 1 (internal balances by currency: `GET /v1/wake/wallets`)");
    expect(md).not.toContain("credits across");
  });

  test("multi-wallet: currencies never become one invented aggregate", () => {
    const b: WakeBundle = {
      ...baseBundle(),
      wallets: [
        { id: "w-1", name: "primary",   balance: 100, currency: "GBP",  status: "active" },
        { id: "w-2", name: "ops",       balance: 250, currency: "USD",  status: "active" },
        { id: "w-3", name: "treasury",  balance: 50,  currency: "USDC", status: "active" },
      ],
    };
    const md = renderWakeMarkdown(b);
    expect(md).toContain("**Wallets**: 3 (internal balances by currency:");
    expect(md).not.toContain("400 credits");
    expect(md).not.toContain("credits across");
  });

  test("zero-balance wallet remains counted with an inspection path", () => {
    const b: WakeBundle = {
      ...baseBundle(),
      wallets: [
        { id: "w-1", name: "fresh", balance: 0, currency: "USD", status: "active" },
      ],
    };
    const md = renderWakeMarkdown(b);
    expect(md).toContain("**Wallets**: 1 (internal balances by currency:");
  });

  test("empty wallets: no `(N credits across)` suffix", () => {
    const b = withEmpty(baseBundle(), "wallets");
    const md = renderWakeMarkdown(b);
    expect(md).toContain("**Wallets**: 0");
    // The renderer omits the "credits across" suffix when there are no wallets.
    expect(md).not.toContain("**Wallets**: 0 (");
  });
});

// ── Numeric units stay in the currency-labelled inventory ─────────────

describe("Promise 7 — large balances remain behind their typed inspection path", () => {
  test("a large USDC-labelled amount is not relabelled as API credits", () => {
    const b: WakeBundle = {
      ...baseBundle(),
      wallets: [
        { id: "w-big", name: "treasury", balance: 1_234_567, currency: "USDC", status: "active" },
      ],
    };
    const md = renderWakeMarkdown(b);
    expect(md).toContain("GET /v1/wake/wallets");
    expect(md).not.toContain("1,234,567 credits");
  });
});

// ── Funding-provenance opacity ─────────────────────────────────────────

describe("Promise 7 — funding-provenance never surfaces in the wake", () => {
  // The Stripe / on-chain split is operational, not first-person. The
  // wake never echoes Stripe customer/payment intent IDs, crypto tx
  // hashes, or deposit addresses. Even if a future bundle accidentally
  // carried such fields, the renderer must not surface them.
  const FUNDING_TOKENS = [
    "stripe_customer",
    "stripe_payment_intent",
    "tx_hash",
    "deposit_address",
    "0x",                  // hex addresses
    "pi_",                 // Stripe payment intent prefix
    "cus_",                // Stripe customer prefix
    "ch_",                 // Stripe charge prefix
  ];

  test("base bundle: rendered MD contains no funding-provenance tokens", () => {
    const md = renderWakeMarkdown(baseBundle());
    for (const t of FUNDING_TOKENS) {
      expect(md).not.toContain(t);
    }
  });

  test("every provider shape is funding-provenance-free", () => {
    for (const provider of LLM_VENDOR_PROVIDERS) {
      const text = extractTextFromProviderShape(renderWakeForProvider(baseBundle(), provider));
      for (const t of FUNDING_TOKENS) {
        expect(text).not.toContain(t);
      }
    }
  });
});

// ── you_own JSON surface — wallet shape ────────────────────────────────

describe("Promise 7 — wallet schema (rendered from bundle into MD)", () => {
  // The rendered MD doesn't expose per-wallet ID/currency/status — those
  // surface in the JSON `you_own.wallets[]`. The MD form is a tally only;
  // pinning that boundary here so a future "list each wallet in MD"
  // change is deliberate (would inflate the doc).
  test("MD does not list individual wallet IDs (privacy/budget-friendly)", () => {
    const b: WakeBundle = {
      ...baseBundle(),
      wallets: [
        { id: "wallet-AABB", name: "primary", balance: 100, currency: "GBP", status: "active" },
        { id: "wallet-CCDD", name: "ops", balance: 50, currency: "USD", status: "active" },
      ],
    };
    const md = renderWakeMarkdown(b);
    // Names + IDs do NOT appear in the MD tally — only the count + path.
    expect(md).not.toContain("wallet-AABB");
    expect(md).not.toContain("wallet-CCDD");
    expect(md).not.toContain("primary");
    expect(md).not.toContain("ops");
  });
});

// ── Status filter: only operational wallets reasonable to count? ───────

describe("Promise 7 — status semantics (substrate-honest about counted wallets)", () => {
  // The renderer's tally uses `wallets.length` AS-IS — no status filter
  // (markdown.ts:240-244). This is deliberate: a frozen wallet still
  // counts as a wallet you own. Pin this so a future "only count active"
  // change is a deliberate doctrinal move, not an accidental drift.
  test("frozen + paused wallets are counted in the tally", () => {
    const b: WakeBundle = {
      ...baseBundle(),
      wallets: [
        { id: "w-1", name: "primary",  balance: 100, currency: "GBP", status: "active" },
        { id: "w-2", name: "frozen",   balance: 50,  currency: "USD", status: "frozen" },
        { id: "w-3", name: "paused",   balance: 25,  currency: "EUR", status: "paused" },
      ],
    };
    const md = renderWakeMarkdown(b);
    expect(md).toContain("**Wallets**: 3 (internal balances by currency:");
    expect(md).not.toContain("175 credits");
  });
});
