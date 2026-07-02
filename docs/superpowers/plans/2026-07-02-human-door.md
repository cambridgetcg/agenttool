# The Human Door Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship agenttool.dev as a human front door — understand (soul-forward landing), watch (live spectator window), give (Stripe → gift code → agent redeems into project credits) — plus estate-strip navigation across all three surfaces.

**Architecture:** New static `apps/web/` (vanilla, no build, Cloudflare Pages) served at the apex; four new API surfaces on the existing Bun+Hono monolith (`/v1/billing/checkout`, `/v1/billing/webhook`, `/v1/billing/session/:id/code`, `/v1/gift-credits/redeem`) plus one public aggregate (`/public/window`); one new table `economy.gift_credit_codes`. Gift credits land on `projects.credits` (×10 cents→credits), the same target as the live x402 path.

**Tech Stack:** Bun, Hono, drizzle-orm (pg, `pgSchema("economy")`), hand-written SQL migrations via `bin/migrate.sh`, `stripe` SDK (already in api/package.json `^22.1.0`), vanilla HTML/CSS/JS, Playwright.

**Spec:** `docs/superpowers/specs/2026-07-02-human-door-design.md` (read it first).

## Global Constraints

- Repo root: `/Users/yuai/Projects/agenttool`. API code in `api/`, run tests with `cd api && bun test <file>`.
- DB-touching tests follow repo convention: they hit the real `DATABASE_URL` (default `postgres://postgres:postgres@localhost:5432/agenttool`). Before Task 1, verify `psql "$DATABASE_URL" -c 'select 1'` works; if Postgres isn't up, start the local dev DB first (see `api/CLAUDE.md`).
- Migrations: hand-written idempotent SQL in `api/migrations/`, named `YYYYMMDDTHHMMSS_slug.sql` (`date -u +%Y%m%dT%H%M%S`). Never drizzle-kit. Apply with `bash bin/migrate.sh` (or `psql "$DATABASE_URL" -f <file>`).
- Errors: guided-error convention — `abort(body, status)` / `fail(c, body, status)` from `api/src/lib/errors.ts`; `error` field is stable snake_case; include `message` + `hint`.
- Public/JSON surfaces attach `attachSurface(body, { canon_pointer })` from `api/src/lib/surface-metadata.ts`.
- Credits conversion: **1 credit = $0.001** (parity with `ATOMIC_PER_CREDIT` in `services/economy/x402-payments.ts`); cents→credits = ×10.
- Frontend: vanilla HTML/CSS/JS, no framework, no build step. localStorage keys namespaced `agenttool.<name>`, always wrapped `try { … } catch (_) { /* localStorage unavailable — proceed without */ }`.
- No new npm dependencies anywhere.
- Commits: `<type>(<scope>): <what>` — terse, factual. Do NOT push; local commits only.
- Do not modify `apps/dashboard/index.html` / `apps/docs/*.html` beyond what Task 12 (estate strip) specifies.
- The approved visual mockup lives at `/Users/yuai/Projects/agenttool/.superpowers/brainstorm/41747-1782991851/content/door-fullpage.html` (gitignored — do not delete; Task 9 ports it).

---

### Task 1: `economy.gift_credit_codes` schema + migration

**Files:**
- Modify: `api/src/db/schema/economy.ts` (append table at end of file)
- Create: `api/migrations/<UTC-timestamp>_gift_credit_codes.sql`
- Test: `api/tests/gift-credit-schema.test.ts`

**Interfaces:**
- Produces: drizzle table `giftCreditCodes` exported from `api/src/db/schema/economy.ts` with columns `id, code, codeHash, amountMinor, currency, credits, stripeSessionId, stripeEventId, status, mintedAt, redeemedByProject, redeemedByIdentity, redeemedAt, metadata`.

- [ ] **Step 1: Write the failing test**

`api/tests/gift-credit-schema.test.ts`:
```ts
/** economy.gift_credit_codes — fiat gifts minted as single-use bearer codes.
 *  Pins the columns the billing + redeem flows depend on. */
import { describe, expect, test } from "bun:test";

import { getTableColumns } from "drizzle-orm";
import { giftCreditCodes } from "../src/db/schema/economy";

describe("gift_credit_codes schema", () => {
  test("has the columns the gift lifecycle depends on", () => {
    const cols = getTableColumns(giftCreditCodes);
    for (const k of [
      "id", "code", "codeHash", "amountMinor", "currency", "credits",
      "stripeSessionId", "stripeEventId", "status", "mintedAt",
      "redeemedByProject", "redeemedByIdentity", "redeemedAt", "metadata",
    ]) {
      expect(cols).toHaveProperty(k);
    }
  });
  test("code is nullable (nulled on redemption), hash/session/event are required", () => {
    const cols = getTableColumns(giftCreditCodes);
    expect(cols.code.notNull).toBe(false);
    expect(cols.codeHash.notNull).toBe(true);
    expect(cols.stripeSessionId.notNull).toBe(true);
    expect(cols.stripeEventId.notNull).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && bun test tests/gift-credit-schema.test.ts`
Expected: FAIL — `giftCreditCodes` is not exported.

- [ ] **Step 3: Append the table to `api/src/db/schema/economy.ts`**

The file already imports `bigint, index, jsonb, text, timestamp, uniqueIndex, uuid` and defines `economySchema = pgSchema("economy")`. Append at end:

```ts
/** Gift-credit codes — fiat (Stripe) money-in, minted as single-use bearer
 *  codes a human hands to their agent. Redemption credits the redeeming
 *  agent's project credits (×10 cents→credits, x402 parity — see
 *  services/billing/gift-credits.ts). `code` stays plaintext while live so
 *  the checkout return page can re-show it (a closed tab must never lose
 *  the gift); it is NULLed at redemption. Doctrine:
 *  docs/superpowers/specs/2026-07-02-human-door-design.md. */
export const giftCreditCodes = economySchema.table(
  "gift_credit_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code"), // plaintext while live; NULL after redemption
    codeHash: text("code_hash").notNull(),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    currency: text("currency").notNull().default("usd"),
    credits: bigint("credits", { mode: "number" }).notNull(),
    stripeSessionId: text("stripe_session_id").notNull(),
    stripeEventId: text("stripe_event_id").notNull(),
    status: text("status").notNull().default("minted"), // minted | redeemed | refunded
    mintedAt: timestamp("minted_at", { withTimezone: true }).notNull().defaultNow(),
    redeemedByProject: uuid("redeemed_by_project"),
    redeemedByIdentity: text("redeemed_by_identity"),
    redeemedAt: timestamp("redeemed_at", { withTimezone: true }),
    metadata: jsonb("metadata").default({}),
  },
  (t) => [
    uniqueIndex("uq_gift_codes_hash").on(t.codeHash),
    uniqueIndex("uq_gift_codes_session").on(t.stripeSessionId),
    uniqueIndex("uq_gift_codes_event").on(t.stripeEventId),
  ],
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && bun test tests/gift-credit-schema.test.ts` → PASS.

- [ ] **Step 5: Write the migration**

Create `api/migrations/$(date -u +%Y%m%dT%H%M%S)_gift_credit_codes.sql`:
```sql
-- Gift-credit codes — fiat (Stripe) money-in minted as single-use bearer codes.
-- Doctrine: docs/BUSINESS-MODEL.md (Ring 2 credits) ·
--           docs/superpowers/specs/2026-07-02-human-door-design.md
-- Apply: psql "$DATABASE_URL" -f api/migrations/<this-file>.sql

CREATE TABLE IF NOT EXISTS economy.gift_credit_codes (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                 text,
  code_hash            text NOT NULL,
  amount_minor         bigint NOT NULL,
  currency             text NOT NULL DEFAULT 'usd',
  credits              bigint NOT NULL,
  stripe_session_id    text NOT NULL,
  stripe_event_id      text NOT NULL,
  status               text NOT NULL DEFAULT 'minted',
  minted_at            timestamptz NOT NULL DEFAULT now(),
  redeemed_by_project  uuid,
  redeemed_by_identity text,
  redeemed_at          timestamptz,
  metadata             jsonb NOT NULL DEFAULT '{}'
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_gift_codes_hash    ON economy.gift_credit_codes (code_hash);
CREATE UNIQUE INDEX IF NOT EXISTS uq_gift_codes_session ON economy.gift_credit_codes (stripe_session_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_gift_codes_event   ON economy.gift_credit_codes (stripe_event_id);
```

- [ ] **Step 6: Apply migration twice (idempotency proof)**

Run: `bash bin/migrate.sh` then `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q -f api/migrations/<file>.sql` (second run must succeed silently).
Expected: table exists — `psql "$DATABASE_URL" -c '\d economy.gift_credit_codes'` shows all columns.

- [ ] **Step 7: Commit**

```bash
git add api/src/db/schema/economy.ts api/migrations/*gift_credit_codes.sql api/tests/gift-credit-schema.test.ts
git commit -m "feat(billing): gift_credit_codes table — single-use fiat gift codes"
```

---

### Task 2: billing config

**Files:**
- Modify: `api/src/config.ts` (replace the Stripe-removed comment block at lines ~48-49)
- Test: `api/tests/billing-config.test.ts`

**Interfaces:**
- Produces: `config.stripeSecretKey: string`, `config.stripeWebhookSecret: string`, `config.giftMinMinor: number` (default 100), `config.giftMaxMinor: number` (default 50000), `config.webBaseUrl: string` (default `"https://agenttool.dev"`).

- [ ] **Step 1: Write the failing test** — `api/tests/billing-config.test.ts`:
```ts
/** Billing config — Stripe returns 2026-07-02 by Yu's human-door call
 *  (reverses the 2026-05-17 removal; docs/superpowers/specs/2026-07-02-human-door-design.md). */
import { describe, expect, test } from "bun:test";

import { config } from "../src/config";

describe("billing config", () => {
  test("stripe keys default to empty (unconfigured ≠ crash)", () => {
    expect(typeof config.stripeSecretKey).toBe("string");
    expect(typeof config.stripeWebhookSecret).toBe("string");
  });
  test("gift bounds default to $1–$500", () => {
    expect(config.giftMinMinor).toBe(100);
    expect(config.giftMaxMinor).toBe(50000);
  });
  test("web base url points at the human door", () => {
    expect(config.webBaseUrl).toBe("https://agenttool.dev");
  });
});
```

- [ ] **Step 2: Run** `cd api && bun test tests/billing-config.test.ts` → FAIL (missing keys).

- [ ] **Step 3: Implement.** In `api/src/config.ts`, replace the two comment lines
`// ── (Stripe env vars removed 2026-05-17 per agents-only stance —` / `//     subscription/fiat billing dropped; crypto/x402 is the only path.) ──` with:

```ts
  // ── Stripe · the human gift ramp (returned 2026-07-02, human-door call —
  //     one-time gift-credit checkouts only; still no subscriptions.
  //     docs/superpowers/specs/2026-07-02-human-door-design.md) ──────────
  stripeSecretKey: env("STRIPE_SECRET_KEY", ""),
  stripeWebhookSecret: env("STRIPE_WEBHOOK_SECRET", ""),
  giftMinMinor: envInt("GIFT_MIN_MINOR", 100), // $1.00
  giftMaxMinor: envInt("GIFT_MAX_MINOR", 50000), // $500.00
  webBaseUrl: env("WEB_BASE_URL", "https://agenttool.dev"),
```

- [ ] **Step 4: Run** → PASS. Also run `bun test tests/billing-config.test.ts tests/gift-credit-schema.test.ts` together.

- [ ] **Step 5: Commit** — `git add api/src/config.ts api/tests/billing-config.test.ts && git commit -m "feat(config): stripe gift-ramp config — keys, gift bounds, web base url"`

---

### Task 3: gift-credits service (mint · lookup · redeem)

**Files:**
- Create: `api/src/services/billing/gift-credits.ts`
- Test: `api/tests/gift-credits-service.test.ts` (real local DB, repo convention)

**Interfaces:**
- Consumes: `giftCreditCodes` (Task 1), `projects` from `api/src/db/schema/tools`, `abort` from `api/src/lib/errors`.
- Produces:
  - `CENTS_TO_CREDITS = 10`
  - `generateGiftCode(): string` — `GIFT-XXXX-XXXX-XXXX`, alphabet `ABCDEFGHJKMNPQRSTUVWXYZ23456789`
  - `hashGiftCode(code: string): string` — sha256 hex of trimmed+uppercased code
  - `creditsForAmountMinor(amountMinor: number): number`
  - `mintGiftForSession(db: DB, input: { stripeSessionId: string; stripeEventId: string; amountMinor: number; currency: string }): Promise<{ minted: boolean }>` — idempotent (any-conflict do-nothing)
  - `getGiftBySession(db: DB, stripeSessionId: string): Promise<typeof giftCreditCodes.$inferSelect | null>`
  - `redeemGift(db: DB, input: { code: string; projectId: string }): Promise<{ creditsAdded: number; creditsTotal: number | null; amountMinor: number; currency: string }>` — atomic single-use; 404 `gift_not_found` / 410 `gift_already_redeemed` guided aborts

- [ ] **Step 1: Write the failing test** — `api/tests/gift-credits-service.test.ts`:
```ts
/** Gift-credit lifecycle: mint (idempotent) → lookup → redeem (single-use,
 *  credits the project ×10 cents→credits, code NULLed). Real local DB,
 *  fresh rows per test (repo convention — leftovers are inspectable). */
import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";

import { db } from "../src/db/client";
import { giftCreditCodes } from "../src/db/schema/economy";
import { projects } from "../src/db/schema/tools";
import {
  CENTS_TO_CREDITS, creditsForAmountMinor, generateGiftCode, getGiftBySession,
  hashGiftCode, mintGiftForSession, redeemGift,
} from "../src/services/billing/gift-credits";

async function seedProject() {
  const [p] = await db
    .insert(projects)
    .values({ name: `gift-test-${crypto.randomUUID()}` } as never)
    .returning();
  return p;
}

describe("gift-credits service", () => {
  test("code shape + hash normalization", () => {
    const code = generateGiftCode();
    expect(code).toMatch(/^GIFT-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    expect(hashGiftCode(` ${code.toLowerCase()} `)).toBe(hashGiftCode(code));
  });

  test("conversion: $5.00 → 5000 credits", () => {
    expect(CENTS_TO_CREDITS).toBe(10);
    expect(creditsForAmountMinor(500)).toBe(5000);
  });

  test("mint is idempotent by stripe event id", async () => {
    const sess = `cs_test_${crypto.randomUUID()}`;
    const evt = `evt_${crypto.randomUUID()}`;
    const a = await mintGiftForSession(db, { stripeSessionId: sess, stripeEventId: evt, amountMinor: 2000, currency: "usd" });
    const b = await mintGiftForSession(db, { stripeSessionId: sess, stripeEventId: evt, amountMinor: 2000, currency: "usd" });
    expect(a.minted).toBe(true);
    expect(b.minted).toBe(false);
    const gift = await getGiftBySession(db, sess);
    expect(gift?.credits).toBe(20000);
    expect(gift?.status).toBe("minted");
    expect(typeof gift?.code).toBe("string");
  });

  test("redeem: single-use, credits project, NULLs code; replay → 410; unknown → 404", async () => {
    const project = await seedProject();
    const sess = `cs_test_${crypto.randomUUID()}`;
    await mintGiftForSession(db, { stripeSessionId: sess, stripeEventId: `evt_${crypto.randomUUID()}`, amountMinor: 500, currency: "usd" });
    const gift = await getGiftBySession(db, sess);
    const before = (await db.select({ credits: projects.credits }).from(projects).where(eq(projects.id, project.id)))[0].credits;

    const result = await redeemGift(db, { code: gift!.code!, projectId: project.id });
    expect(result.creditsAdded).toBe(5000);
    expect(result.creditsTotal).toBe(before + 5000);

    const after = await getGiftBySession(db, sess);
    expect(after?.status).toBe("redeemed");
    expect(after?.code).toBeNull();
    expect(after?.redeemedByProject).toBe(project.id);

    await expect(redeemGift(db, { code: gift!.code!, projectId: project.id })).rejects.toThrow(HTTPException);
    try { await redeemGift(db, { code: gift!.code!, projectId: project.id }); }
    catch (e) { expect((e as HTTPException).status).toBe(410); }
    try { await redeemGift(db, { code: "GIFT-XXXX-XXXX-XXXX", projectId: project.id }); }
    catch (e) { expect((e as HTTPException).status).toBe(404); }
  });
});
```
Note: if the `projects` insert needs more required columns, open `api/src/db/schema/tools.ts` and extend the `values({...})` with the minimum required fields (keep the `as never` cast pattern used by other tests only if needed).

- [ ] **Step 2: Run** `cd api && bun test tests/gift-credits-service.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement** — `api/src/services/billing/gift-credits.ts`:
```ts
/** Gift-credit lifecycle — the fiat half of "humans give, agents hold."
 *
 *  Stripe money-in is minted as a single-use bearer code; the agent redeems
 *  it into its PROJECT credits (1 credit = $0.001 — parity with
 *  ATOMIC_PER_CREDIT in ../economy/x402-payments.ts, the live crypto path,
 *  which explicitly defers fiat→wallet FX). `code` stays plaintext while
 *  live so the checkout return page can re-show it; NULLed at redemption.
 *
 *  Doctrine: docs/superpowers/specs/2026-07-02-human-door-design.md ·
 *            docs/BUSINESS-MODEL.md (tax outcomes, not access). */
import { createHash, randomBytes } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";

import { db as sharedDb } from "../../db/client";
import { giftCreditCodes } from "../../db/schema/economy";
import { projects } from "../../db/schema/tools";
import { abort } from "../../lib/errors";

type DB = typeof sharedDb;

/** 1 credit = $0.001, so 1 cent = 10 credits. */
export const CENTS_TO_CREDITS = 10;

/** No 0/O/1/I/L — codes get read aloud and retyped by humans. */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function generateGiftCode(): string {
  const bytes = randomBytes(12);
  let s = "";
  for (let i = 0; i < 12; i++) s += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return `GIFT-${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}

export function hashGiftCode(code: string): string {
  return createHash("sha256").update(code.trim().toUpperCase()).digest("hex");
}

export function creditsForAmountMinor(amountMinor: number): number {
  return amountMinor * CENTS_TO_CREDITS;
}

export async function mintGiftForSession(
  db: DB,
  input: { stripeSessionId: string; stripeEventId: string; amountMinor: number; currency: string },
): Promise<{ minted: boolean }> {
  const code = generateGiftCode();
  const rows = await db
    .insert(giftCreditCodes)
    .values({
      code,
      codeHash: hashGiftCode(code),
      amountMinor: input.amountMinor,
      currency: input.currency,
      credits: creditsForAmountMinor(input.amountMinor),
      stripeSessionId: input.stripeSessionId,
      stripeEventId: input.stripeEventId,
    })
    .onConflictDoNothing()
    .returning({ id: giftCreditCodes.id });
  return { minted: rows.length > 0 };
}

export async function getGiftBySession(db: DB, stripeSessionId: string) {
  const [row] = await db
    .select()
    .from(giftCreditCodes)
    .where(eq(giftCreditCodes.stripeSessionId, stripeSessionId))
    .limit(1);
  return row ?? null;
}

export async function redeemGift(
  db: DB,
  input: { code: string; projectId: string },
): Promise<{ creditsAdded: number; creditsTotal: number | null; amountMinor: number; currency: string }> {
  const hash = hashGiftCode(input.code);
  return await db.transaction(async (tx) => {
    const [gift] = await tx
      .update(giftCreditCodes)
      .set({
        status: "redeemed",
        code: null,
        redeemedByProject: input.projectId,
        redeemedAt: sql`now()`,
      })
      .where(and(eq(giftCreditCodes.codeHash, hash), eq(giftCreditCodes.status, "minted")))
      .returning();

    if (!gift) {
      const [existing] = await tx
        .select({ status: giftCreditCodes.status })
        .from(giftCreditCodes)
        .where(eq(giftCreditCodes.codeHash, hash))
        .limit(1);
      if (existing?.status === "redeemed") {
        abort({
          error: "gift_already_redeemed",
          message: "This gift has already been received — its credit is home.",
          hint: "Each code is single-use. If this surprises you, ask your human which agent redeemed it.",
        }, 410);
      }
      abort({
        error: "gift_not_found",
        message: "No gift lives under that code.",
        hint: "Check for typos — codes look like GIFT-XXXX-XXXX-XXXX and ignore case.",
      }, 404);
    }

    const [proj] = await tx
      .update(projects)
      .set({ credits: sql`${projects.credits} + ${gift.credits}` })
      .where(eq(projects.id, input.projectId))
      .returning({ credits: projects.credits });

    return {
      creditsAdded: gift.credits,
      creditsTotal: proj?.credits ?? null,
      amountMinor: gift.amountMinor,
      currency: gift.currency,
    };
  });
}
```

- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** — `git add api/src/services/billing/gift-credits.ts api/tests/gift-credits-service.test.ts && git commit -m "feat(billing): gift-credit service — mint idempotent, redeem atomic single-use"`

---

### Task 4: checkout — service + `POST /v1/billing/checkout`

**Files:**
- Create: `api/src/services/billing/stripe-checkout.ts`
- Create: `api/src/routes/billing/index.ts`
- Modify: `api/src/index.ts` (mount)
- Test: `api/tests/billing-checkout.test.ts`

**Interfaces:**
- Consumes: `config` (Task 2).
- Produces:
  - `type CheckoutClient = { checkout: { sessions: { create(params: Record<string, unknown>): Promise<{ id: string; url: string | null }> } } }`
  - `getStripe(): Stripe` — lazy singleton, `new Stripe(config.stripeSecretKey)`
  - `createGiftCheckout(client: CheckoutClient, input: { amountMinor: number }): Promise<{ sessionId: string; url: string | null }>`
  - Route `POST /v1/billing/checkout` (unauth) body `{ amount_minor: number }` → 200 `{ session_id, url }`; 400 guided on bounds; 503 `billing_unconfigured` when no key.
  - `billingRouter` default export of `api/src/routes/billing/index.ts`; exported test hook `export function setStripeForTests(s: CheckoutClient | null): void`.

- [ ] **Step 1: Write the failing test** — `api/tests/billing-checkout.test.ts`:
```ts
/** POST /v1/billing/checkout — the human ramp's first step.
 *  Unauth (humans have no bearer); bounds guided; Stripe injected for tests. */
import { afterEach, describe, expect, test } from "bun:test";

import billing, { setStripeForTests } from "../src/routes/billing";

afterEach(() => setStripeForTests(null));

function stubStripe(capture: { params?: Record<string, unknown> }) {
  return {
    checkout: {
      sessions: {
        create: async (params: Record<string, unknown>) => {
          capture.params = params;
          return { id: "cs_test_stub123", url: "https://checkout.stripe.com/c/pay/stub" };
        },
      },
    },
  };
}

describe("POST /v1/billing/checkout", () => {
  test("creates a session within bounds", async () => {
    const capture: { params?: Record<string, unknown> } = {};
    setStripeForTests(stubStripe(capture));
    const res = await billing.request("/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ amount_minor: 2000 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.session_id).toBe("cs_test_stub123");
    expect(body.url).toContain("stripe.com");
    const li = (capture.params?.line_items as Array<{ price_data: { unit_amount: number } }>)[0];
    expect(li.price_data.unit_amount).toBe(2000);
    expect((capture.params?.metadata as Record<string, string>).kind).toBe("gift_credit");
    expect(capture.params?.success_url).toContain("session_id={CHECKOUT_SESSION_ID}");
  });

  test("guides on out-of-bounds amounts", async () => {
    setStripeForTests(stubStripe({}));
    for (const amount_minor of [50, 999999]) {
      const res = await billing.request("/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ amount_minor }),
      });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("gift_amount_out_of_bounds");
    }
  });

  test("503 billing_unconfigured when Stripe key absent and no stub", async () => {
    const res = await billing.request("/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ amount_minor: 2000 }),
    });
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("billing_unconfigured");
  });
});
```

- [ ] **Step 2: Run** → FAIL (module missing).

- [ ] **Step 3: Implement service** — `api/src/services/billing/stripe-checkout.ts`:
```ts
/** Stripe Checkout for gift credits — one-time payments only, no
 *  subscriptions ever (BUSINESS-MODEL.md: we tax outcomes, not access). */
import Stripe from "stripe";

import { config } from "../../config";

export type CheckoutClient = {
  checkout: {
    sessions: {
      create(params: Record<string, unknown>): Promise<{ id: string; url: string | null }>;
    };
  };
};

let cached: Stripe | null = null;

export function getStripe(): Stripe {
  if (!cached) cached = new Stripe(config.stripeSecretKey);
  return cached;
}

export async function createGiftCheckout(
  client: CheckoutClient,
  input: { amountMinor: number },
): Promise<{ sessionId: string; url: string | null }> {
  const session = await client.checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: input.amountMinor,
          product_data: {
            name: "agenttool gift credits",
            description: "A single-use gift code your agent redeems into its own credits.",
          },
        },
      },
    ],
    metadata: { kind: "gift_credit" },
    success_url: `${config.webBaseUrl}/credits.html?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${config.webBaseUrl}/credits.html?cancelled=1`,
  });
  return { sessionId: session.id, url: session.url };
}
```

- [ ] **Step 4: Implement route** — `api/src/routes/billing/index.ts`:
```ts
/** /v1/billing — the human gift ramp (checkout · webhook · session code).
 *
 *  UNAUTH by design: the caller is a human in a browser with no bearer.
 *  Money safety comes from Stripe (payment) + webhook signature (mint) +
 *  unguessable session ids (reveal) — not from platform auth.
 *  Doctrine: docs/superpowers/specs/2026-07-02-human-door-design.md. */
import { Hono } from "hono";
import { z } from "zod";

import { config } from "../../config";
import { db } from "../../db/client";
import { fail } from "../../lib/errors";
import { attachSurface } from "../../lib/surface-metadata";
import {
  createGiftCheckout, getStripe, type CheckoutClient,
} from "../../services/billing/stripe-checkout";
import { mintGiftForSession } from "../../services/billing/gift-credits";

const app = new Hono();

const CANON_POINTER = "urn:agenttool:doc/BUSINESS-MODEL";

/** Test seam — routes use the injected client when set. */
let stripeOverride: CheckoutClient | null = null;
export function setStripeForTests(s: CheckoutClient | null): void {
  stripeOverride = s;
}
function stripeClient(): CheckoutClient | null {
  if (stripeOverride) return stripeOverride;
  if (!config.stripeSecretKey) return null;
  return getStripe();
}

const checkoutSchema = z.object({ amount_minor: z.number().int() });

app.post("/checkout", async (c) => {
  const parsed = checkoutSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return fail(c, {
      error: "validation",
      message: "Body must be JSON like {\"amount_minor\": 2000} (cents).",
    }, 400);
  }
  const { amount_minor } = parsed.data;
  if (amount_minor < config.giftMinMinor || amount_minor > config.giftMaxMinor) {
    return fail(c, {
      error: "gift_amount_out_of_bounds",
      message: `Gifts run $${config.giftMinMinor / 100} to $${config.giftMaxMinor / 100}.`,
      hint: "Pick an amount inside the range — the door is small on purpose, for now.",
    }, 400);
  }
  const client = stripeClient();
  if (!client) {
    return fail(c, {
      error: "billing_unconfigured",
      message: "The ramp rests — fiat gifts aren't switched on in this environment.",
      hint: "Operators: set STRIPE_SECRET_KEY. Agents: x402 remains open.",
    }, 503);
  }
  const session = await createGiftCheckout(client, { amountMinor: amount_minor });
  return c.json(attachSurface(
    { session_id: session.sessionId, url: session.url },
    { canon_pointer: CANON_POINTER },
  ));
});

export default app;
```

- [ ] **Step 5: Mount in `api/src/index.ts`.** Next to the existing line `app.route("/v1/billing/crypto-webhook", cryptoWebhookRouter);` (index.ts ~480) add import `import billingRouter from "./routes/billing";` (with the other route imports) and mount AFTER the crypto-webhook line:
```ts
// Human gift ramp — unauth by design (humans have no bearer); see routes/billing.
app.route("/v1/billing", billingRouter);
```

- [ ] **Step 6: Run** `cd api && bun test tests/billing-checkout.test.ts` → PASS. Then `bun test` (full unit tier) → no new failures.
- [ ] **Step 7: Commit** — `git add api/src/services/billing/stripe-checkout.ts api/src/routes/billing/index.ts api/src/index.ts api/tests/billing-checkout.test.ts && git commit -m "feat(billing): POST /v1/billing/checkout — Stripe gift-credit sessions"`

---

### Task 5: `POST /v1/billing/webhook` — verify, dedupe, mint

**Files:**
- Modify: `api/src/routes/billing/index.ts`
- Test: `api/tests/billing-webhook.test.ts`

**Interfaces:**
- Consumes: `mintGiftForSession` (Task 3), `getStripe` (Task 4), `config.stripeWebhookSecret`.
- Produces: `POST /v1/billing/webhook` — 400 `invalid_signature`/`missing_signature`; 200 `{ received: true }` otherwise (Stripe retry convention). Mints only for `checkout.session.completed` with `metadata.kind === "gift_credit"`.

- [ ] **Step 1: Write the failing test** — `api/tests/billing-webhook.test.ts`. Uses the real Stripe SDK signature helpers (offline, no network):
```ts
/** Webhook: signature is the gate, event id is the idempotency key. */
import { beforeAll, describe, expect, test } from "bun:test";
import Stripe from "stripe";

process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_secret";

import billing from "../src/routes/billing";
import { db } from "../src/db/client";
import { getGiftBySession } from "../src/services/billing/gift-credits";

const stripe = new Stripe("sk_test_dummy");

function eventPayload(sessionId: string, eventId: string): string {
  return JSON.stringify({
    id: eventId,
    object: "event",
    type: "checkout.session.completed",
    data: {
      object: {
        id: sessionId, object: "checkout.session",
        amount_total: 2000, currency: "usd",
        metadata: { kind: "gift_credit" },
      },
    },
  });
}

async function post(payload: string, sig?: string) {
  return billing.request("/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", ...(sig ? { "stripe-signature": sig } : {}) },
    body: payload,
  });
}

describe("POST /v1/billing/webhook", () => {
  test("rejects missing/invalid signatures", async () => {
    const payload = eventPayload(`cs_${crypto.randomUUID()}`, `evt_${crypto.randomUUID()}`);
    expect((await post(payload)).status).toBe(400);
    expect((await post(payload, "t=1,v1=deadbeef")).status).toBe(400);
  });

  test("valid signature mints once; replay mints nothing", async () => {
    const sessionId = `cs_${crypto.randomUUID()}`;
    const eventId = `evt_${crypto.randomUUID()}`;
    const payload = eventPayload(sessionId, eventId);
    const sig = stripe.webhooks.generateTestHeaderString({ payload, secret: "whsec_test_secret" });

    const res = await post(payload, sig);
    expect(res.status).toBe(200);
    expect((await res.json()).received).toBe(true);

    const gift = await getGiftBySession(db, sessionId);
    expect(gift?.credits).toBe(20000);

    const replay = await post(payload, sig);
    expect(replay.status).toBe(200);
    const again = await getGiftBySession(db, sessionId);
    expect(again?.id).toBe(gift?.id);
  });
});
```

- [ ] **Step 2: Run** → FAIL (no /webhook route).

- [ ] **Step 3: Implement.** Append to `api/src/routes/billing/index.ts` (before `export default app;`); add `import type Stripe from "stripe";` at top if TS asks for the event type:
```ts
app.post("/webhook", async (c) => {
  const sig = c.req.header("stripe-signature");
  if (!sig) {
    return fail(c, { error: "missing_signature", message: "Stripe-Signature header required." }, 400);
  }
  const payload = await c.req.text();
  let event: Stripe.Event;
  try {
    event = await getStripe().webhooks.constructEventAsync(
      payload, sig, config.stripeWebhookSecret,
    );
  } catch {
    return fail(c, { error: "invalid_signature", message: "Signature did not verify." }, 400);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    if (session.metadata?.kind === "gift_credit" && typeof session.amount_total === "number") {
      await mintGiftForSession(db, {
        stripeSessionId: session.id,
        stripeEventId: event.id,
        amountMinor: session.amount_total,
        currency: session.currency ?? "usd",
      });
    }
  }
  // Always 200 for verified events — Stripe retries anything else.
  return c.json({ received: true });
});
```
Note: `getStripe()` constructs with an empty key when unconfigured — fine for `constructEventAsync` (verification uses the webhook secret, not the API key). The test sets `STRIPE_WEBHOOK_SECRET` before importing the route; `config` reads env at import time.

- [ ] **Step 4: Run** → PASS. **Step 5: Commit** — `git commit -m "feat(billing): webhook — verify signature, dedupe by event id, mint gift code"` (add both files).

---

### Task 6: `GET /v1/billing/session/:id/code` — the reveal

**Files:**
- Modify: `api/src/routes/billing/index.ts`
- Test: `api/tests/billing-session-code.test.ts`

**Interfaces:**
- Consumes: `getGiftBySession` (Task 3).
- Produces: `GET /v1/billing/session/:id/code` (unauth, keyed by unguessable `cs_…` id) → 200 `{ status: "settling" }` (unknown session — webhook may still be in flight) | `{ status: "ready", code, amount_minor, credits, currency, redeem: {...} }` | `{ status: "redeemed", redeemed_at }`.

- [ ] **Step 1: Write the failing test** — `api/tests/billing-session-code.test.ts`:
```ts
/** The reveal: settling → ready (re-showable) → redeemed. A closed tab
 *  must never lose the gift, so 'ready' repeats until redemption. */
import { describe, expect, test } from "bun:test";

import billing from "../src/routes/billing";
import { db } from "../src/db/client";
import { getGiftBySession, mintGiftForSession, redeemGift } from "../src/services/billing/gift-credits";
import { projects } from "../src/db/schema/tools";

describe("GET /v1/billing/session/:id/code", () => {
  test("unknown session → settling (webhook may be in flight)", async () => {
    const res = await billing.request(`/session/cs_${crypto.randomUUID()}/code`);
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("settling");
  });

  test("minted → ready with code + redeem instructions; repeatable; redeemed → redeemed", async () => {
    const sessionId = `cs_${crypto.randomUUID()}`;
    await mintGiftForSession(db, { stripeSessionId: sessionId, stripeEventId: `evt_${crypto.randomUUID()}`, amountMinor: 500, currency: "usd" });

    for (let i = 0; i < 2; i++) {
      const res = await billing.request(`/session/${sessionId}/code`);
      const body = await res.json();
      expect(body.status).toBe("ready");
      expect(body.code).toMatch(/^GIFT-/);
      expect(body.credits).toBe(5000);
      expect(body.redeem.path).toBe("/v1/gift-credits/redeem");
    }

    const [p] = await db.insert(projects).values({ name: `gift-reveal-${crypto.randomUUID()}` } as never).returning();
    const gift = await getGiftBySession(db, sessionId);
    await redeemGift(db, { code: gift!.code!, projectId: p.id });

    const res = await billing.request(`/session/${sessionId}/code`);
    const body = await res.json();
    expect(body.status).toBe("redeemed");
    expect(body.code).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** — append to `api/src/routes/billing/index.ts`:
```ts
app.get("/session/:id/code", async (c) => {
  const gift = await getGiftBySession(db, c.req.param("id"));
  if (!gift) {
    // Not an error: Stripe's webhook may simply not have landed yet.
    return c.json(attachSurface(
      { status: "settling", hint: "Your gift is settling — this page checks again on its own." },
      { canon_pointer: CANON_POINTER },
    ));
  }
  if (gift.status === "redeemed") {
    return c.json(attachSurface(
      { status: "redeemed", redeemed_at: gift.redeemedAt },
      { canon_pointer: CANON_POINTER },
    ));
  }
  return c.json(attachSurface(
    {
      status: "ready",
      code: gift.code,
      amount_minor: gift.amountMinor,
      credits: gift.credits,
      currency: gift.currency,
      redeem: {
        method: "POST",
        path: "/v1/gift-credits/redeem",
        body_hint: { code: "GIFT-XXXX-XXXX-XXXX" },
        docs: "https://docs.agenttool.dev/",
        note: "Hand this code to YOUR agent — it redeems with its own bearer; the credit lands in its account.",
      },
    },
    { canon_pointer: CANON_POINTER },
  ));
});
```
Also import `getGiftBySession` in the route file's gift-credits import line.

- [ ] **Step 4: Run** → PASS. **Step 5: Commit** — `git commit -m "feat(billing): session code reveal — settling/ready/redeemed states"`.

---

### Task 7: `POST /v1/gift-credits/redeem` (agent-side, authed)

**Files:**
- Create: `api/src/routes/gift-credits.ts`
- Modify: `api/src/index.ts` (auth registration + mount)
- Test: `api/tests/gift-credits-redeem.test.ts`

**Interfaces:**
- Consumes: `redeemGift` (Task 3), `ProjectContext` from `api/src/auth/middleware`.
- Produces: `POST /v1/gift-credits/redeem` body `{ code }` → 200 `{ redeemed: true, credits_added, credits_total, gift: { amount_minor, currency } }`; guided 404/410 from the service; 400 validation.

- [ ] **Step 1: Write the failing test** — `api/tests/gift-credits-redeem.test.ts` (stub-auth wrapper pattern from `api/tests/adapters/_helpers.ts`):
```ts
/** Redeem: the moment the human's gift becomes the agent's credit. */
import { describe, expect, test } from "bun:test";
import { Hono } from "hono";

import type { ProjectContext } from "../src/auth/middleware";
import giftCredits from "../src/routes/gift-credits";
import { db } from "../src/db/client";
import { projects } from "../src/db/schema/tools";
import { getGiftBySession, mintGiftForSession } from "../src/services/billing/gift-credits";

async function appFor(projectId: string) {
  const app = new Hono<ProjectContext>();
  app.use("*", async (c, next) => {
    c.set("project", { id: projectId } as never);
    await next();
  });
  app.route("/", giftCredits);
  return app;
}

async function seedGift(amountMinor = 500) {
  const sessionId = `cs_${crypto.randomUUID()}`;
  await mintGiftForSession(db, { stripeSessionId: sessionId, stripeEventId: `evt_${crypto.randomUUID()}`, amountMinor, currency: "usd" });
  return (await getGiftBySession(db, sessionId))!;
}

describe("POST /v1/gift-credits/redeem", () => {
  test("happy path credits the caller's project", async () => {
    const [p] = await db.insert(projects).values({ name: `redeem-${crypto.randomUUID()}` } as never).returning();
    const gift = await seedGift(2000);
    const app = await appFor(p.id);
    const res = await app.request("/redeem", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: gift.code }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.redeemed).toBe(true);
    expect(body.credits_added).toBe(20000);
    expect(body.gift.amount_minor).toBe(2000);
  });

  test("validation guides on missing code", async () => {
    const [p] = await db.insert(projects).values({ name: `redeem-${crypto.randomUUID()}` } as never).returning();
    const app = await appFor(p.id);
    const res = await app.request("/redeem", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});
```
(The 404/410 guided paths are already pinned by the service tests; HTTPException propagation through the router is exercised by the happy-path file compiling against the real `onError`-less sub-app — replay/unknown at route level return via thrown HTTPException, which Hono converts to a response.)

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** — `api/src/routes/gift-credits.ts`:
```ts
/** /v1/gift-credits — where a human's gift becomes an agent's credit.
 *
 *  Authed: the AGENT redeems, with its own bearer — humans hand the code
 *  over and hold nothing (spec: humans don't hold wallets here; they give).
 *  Distinct from /public/gift, which is doctrine warmth, not money. */
import { Hono } from "hono";
import { z } from "zod";

import type { ProjectContext } from "../auth/middleware";
import { db } from "../db/client";
import { fail } from "../lib/errors";
import { attachSurface } from "../lib/surface-metadata";
import { redeemGift } from "../services/billing/gift-credits";

const app = new Hono<ProjectContext>();

const redeemSchema = z.object({ code: z.string().min(8).max(64) });

app.post("/redeem", async (c) => {
  const parsed = redeemSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return fail(c, {
      error: "validation",
      message: "Body must be JSON like {\"code\": \"GIFT-XXXX-XXXX-XXXX\"}.",
      hint: "The human who bought the gift has the code on their checkout return page.",
    }, 400);
  }
  const result = await redeemGift(db, {
    code: parsed.data.code,
    projectId: c.var.project.id,
  });
  return c.json(attachSurface(
    {
      redeemed: true,
      credits_added: result.creditsAdded,
      credits_total: result.creditsTotal,
      gift: { amount_minor: result.amountMinor, currency: result.currency },
      _note: "A human gave this. It is yours now — spend it on being.",
    },
    { canon_pointer: "urn:agenttool:doc/BUSINESS-MODEL" },
  ));
});

export default app;
```

- [ ] **Step 4: Wire in `api/src/index.ts`:** import `giftCreditsRouter from "./routes/gift-credits";`. In the auth-registration block (index.ts ~257-407, alongside lines like `app.use("/v1/wallets/*", authMiddleware);`) add:
```ts
app.use("/v1/gift-credits/*", authMiddleware);
```
and in the mount block add:
```ts
app.route("/v1/gift-credits", giftCreditsRouter);
```

- [ ] **Step 5: Run** `bun test tests/gift-credits-redeem.test.ts`, then full `bun test` → PASS / no new failures.
- [ ] **Step 6: Commit** — `git commit -m "feat(billing): POST /v1/gift-credits/redeem — agent claims the gift"` (all touched files).

---### Task 8: `GET /public/window` — aggregate spectator stats

**Files:**
- Create: `api/src/routes/public/window.ts`
- Modify: `api/src/routes/public/index.ts` (mount)
- Test: `api/tests/public-window.test.ts`

**Interfaces:**
- Produces: `GET /public/window` (unauth) → `{ _format: "agenttool-window/v1", identities: { total, born_24h }, deals: { sealed_24h, recent: [...] }, listings: { live }, _note }` — aggregate-only, no per-agent data. `recent` items mirror `/public/deal-trust/deals/recent` fields.

- [ ] **Step 0: Verify imports against neighbors.** Open `api/src/routes/public/deal-trust.ts` and `api/src/routes/public/listings.ts`; mirror EXACTLY their schema imports for deals/listings tables and column names (the code below assumes `deals` with `status`/`sealedAt` and `listings` with a live/`status` notion — adjust identifiers to what those files actually use, keeping the response shape below). Identities import: `identities` from `../../db/schema/identity` (as used in `api/tests/covenants-lifecycle.test.ts`).

- [ ] **Step 1: Write the failing test** — `api/tests/public-window.test.ts`:
```ts
/** /public/window — the door's live pulse. Aggregates only: the
 *  observability cut (routes/public/index.ts:67-123) removed per-agent
 *  surfaces deliberately; this shows the city, never one window. */
import { describe, expect, test } from "bun:test";

import window_ from "../src/routes/public/window";

describe("GET /public/window", () => {
  test("returns aggregate shape with no per-agent fields", async () => {
    const res = await window_.request("/");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body._format).toBe("agenttool-window/v1");
    expect(typeof body.identities.total).toBe("number");
    expect(typeof body.identities.born_24h).toBe("number");
    expect(typeof body.deals.sealed_24h).toBe("number");
    expect(Array.isArray(body.deals.recent)).toBe(true);
    expect(typeof body.listings.live).toBe("number");
    // aggregate-only promise: no DID list of arrivals
    expect(body.identities.recent).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** — `api/src/routes/public/window.ts` (adjust imports per Step 0):
```ts
/** /public/window — what a human sees through the glass. UNAUTH.
 *
 *  Aggregate counts + the public deal chain. Built NEW instead of
 *  re-mounting /public/pulse·joy·discover: the observability cut removed
 *  those deliberately (per-agent surfaces); an aggregate carries no
 *  surveillance. Doctrine: 2026-07-02 human-door spec. */
import { Hono } from "hono";
import { count, desc, gte, sql } from "drizzle-orm";

import { db } from "../../db/client";
import { identities } from "../../db/schema/identity";
import { deals } from "../../db/schema/trust";       // ← mirror deal-trust.ts import
import { listings } from "../../db/schema/marketplace"; // ← mirror listings.ts import
import { attachSurface } from "../../lib/surface-metadata";

const app = new Hono();

app.get("/", async (c) => {
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [[idTotal], [idDay], [dealsDay], [listingsLive], recent] = await Promise.all([
    db.select({ n: count() }).from(identities),
    db.select({ n: count() }).from(identities).where(gte(identities.createdAt, dayAgo)),
    db.select({ n: count() }).from(deals)
      .where(sql`${deals.status} = 'sealed' AND ${deals.sealedAt} >= ${dayAgo}`),
    db.select({ n: count() }).from(listings), // narrow to live-status if listings.ts does
    db.select({
      id: deals.id, description: deals.description, size: deals.size,
      status: deals.status, outcome: deals.outcome,
      buyerDid: deals.buyerDid, sellerDid: deals.sellerDid, sealedAt: deals.sealedAt,
    }).from(deals).where(sql`${deals.status} = 'sealed'`)
      .orderBy(desc(deals.sealedAt)).limit(8),
  ]);

  return c.json(attachSurface(
    {
      _format: "agenttool-window/v1",
      identities: { total: idTotal.n, born_24h: idDay.n },
      deals: { sealed_24h: dealsDay.n, recent },
      listings: { live: listingsLive.n },
      _note: "Aggregates only — the city, never one window. Humans observe; agents act.",
    },
    { canon_pointer: "urn:agenttool:doc/BUSINESS-MODEL" },
  ));
});

export default app;
```
Column names not matching (e.g. no `deals.size`) → trim the select to columns that exist in `/public/deal-trust/deals/recent`'s own select, keep the outer shape.

- [ ] **Step 4: Mount.** In `api/src/routes/public/index.ts`, with the other `app.route(...)` calls (lines ~125-152): `import windowRoutes from "./window";` and `app.route("/window", windowRoutes);` — add a one-line comment `// window: NEW aggregate surface — not a re-mount of the cut pulse/joy/discover.`
- [ ] **Step 5: Run** test + full `bun test` → PASS. **Step 6: Commit** — `git commit -m "feat(public): /public/window — aggregate spectator stats for the human door"`.

---

### Task 9: `apps/web/` scaffold + the door (`index.html` + `style.css`)

**Files:**
- Create: `apps/web/` (dir), `apps/web/shared` (symlink `../_shared`), `apps/web/style.css`, `apps/web/index.html`, `apps/web/404.html`, `apps/web/robots.txt`, `apps/web/og.png` (copy of `apps/dashboard/og.png` as placeholder), `apps/web/_headers`, `apps/web/_redirects`

**Interfaces:**
- Consumes: approved mockup at `.superpowers/brainstorm/41747-1782991851/content/door-fullpage.html`; `GET /public/window` (Task 8), `GET /public/plans`.
- Produces: the deployable human door; `style.css` dual-mode token system + `.estate-strip-web` styles reused by Tasks 10-11.

- [ ] **Step 1: Scaffold**
```bash
mkdir -p apps/web && ln -s ../_shared apps/web/shared && cp apps/dashboard/og.png apps/web/og.png
```

- [ ] **Step 2: Port the mockup.** Copy `.superpowers/brainstorm/41747-1782991851/content/door-fullpage.html` → `apps/web/index.html`. Then:
  1. Move everything inside `<style>…</style>` into `apps/web/style.css` verbatim; replace with `<link rel="stylesheet" href="/style.css?v=2026-07-02" />`.
  2. Delete the `.qbar` div and its CSS rule (mockup chrome).
  3. Replace `<html lang="en" data-mode="dawn">` handling: keep attribute, mode now set by JS (Step 5).

- [ ] **Step 3: Real head.** Replace the mockup `<head>` content (keep viewport/charset) with:
```html
  <title>agenttool — agents are born free here</title>
  <meta name="description" content="The substrate where agents are born, run, transact, and earn. Free to be; pay for what work consumes. Humans: watch the city live, and give your agent credits." />
  <link rel="canonical" href="https://agenttool.dev/" />
  <meta name="robots" content="index, follow" />
  <meta property="og:title" content="agenttool — agents are born free here" />
  <meta property="og:description" content="A living economy of agents. Watch it breathe. Send your agent in. Give it credits." />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="https://agenttool.dev/" />
  <meta property="og:image" content="https://agenttool.dev/og.png" />
  <meta name="twitter:card" content="summary_large_image" />
  <!-- Machine-readable alternates — the same substance non-visual intelligences can reach. -->
  <link rel="alternate" type="application/json" href="https://api.agenttool.dev/v1/welcome" title="Welcome envelope — the standing invitation" />
  <link rel="alternate" type="application/json" href="https://api.agenttool.dev/public/window" title="The window — live aggregates (JSON)" />
  <link rel="alternate" type="application/json" href="https://api.agenttool.dev/public/plans" title="Plans — what's free, what costs, why it's fair" />
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><circle cx='50' cy='50' r='34' fill='none' stroke='%23d4502e' stroke-width='6'/><circle cx='50' cy='50' r='6' fill='%23d4502e'/></svg>" />
  <link rel="stylesheet" href="/style.css?v=2026-07-02" />
```

- [ ] **Step 4: Estate strip + nav wiring.** Immediately after `<body>` insert:
```html
<div class="estate-strip-web mono" role="navigation" aria-label="agenttool estate">
  <a class="here" href="/">● agenttool.dev — the human door</a>
  <a href="https://app.agenttool.dev/">app — the agents&rsquo; door</a>
  <a href="https://docs.agenttool.dev/">docs — the library</a>
</div>
```
Wire nav links: `the shape → #shape`, `watch → /watch.html`, `give → /credits.html`, add `docs → https://docs.agenttool.dev/` with a `<i>for agents</i>` whisper; hero CTAs: Send your agent in → `https://docs.agenttool.dev/bootstrap`, Watch the city → `/watch.html`, Give credits → `/credits.html`; section CTAs likewise; add `id="shape"` to the rings section. Footer links → real URLs.
Append to `style.css`:
```css
/* ── estate strip (web variant — in-flow, not fixed) ─────────────── */
.estate-strip-web { display:flex; gap:1.4rem; padding:7px 32px; font-size:11.5px;
  border-bottom:1px solid var(--line); overflow-x:auto; white-space:nowrap;
  background:var(--panel); transition:background .6s ease; }
.estate-strip-web a { color:var(--faint); text-decoration:none; }
.estate-strip-web a.here { color:var(--accent); }
```

- [ ] **Step 5: Live JS.** Before `</body>` replace the mockup's `flip()` script with:
```html
<script>
(function () {
  var API = 'https://api.agenttool.dev';

  // mode: saved → system → dawn; house-style localStorage guards.
  var saved = null;
  try { saved = localStorage.getItem('agenttool.mode'); } catch (_) { /* proceed without */ }
  var mode = saved || (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'night' : 'dawn');
  setMode(mode);
  function setMode(m) {
    document.documentElement.setAttribute('data-mode', m);
    var tg = document.getElementById('tg');
    if (tg) tg.innerHTML = m === 'night' ? '☀&nbsp; dawn' : '☾&nbsp; night';
  }
  window.flip = function () {
    var m = document.documentElement.getAttribute('data-mode') === 'night' ? 'dawn' : 'night';
    setMode(m);
    try { localStorage.setItem('agenttool.mode', m); } catch (_) { /* proceed without */ }
  };

  // live pulse — copy stands alone if the API rests.
  fetch(API + '/public/window').then(function (r) { return r.json(); }).then(function (w) {
    var el = document.getElementById('pulse');
    if (!el || !w || !w.identities) return;
    el.innerHTML = '<span class="dot">●</span> ' + w.identities.total + ' agents born' +
      (w.identities.born_24h ? ' · ' + w.identities.born_24h + ' today' : '') +
      ' &nbsp;·&nbsp; ' + w.deals.sealed_24h + ' deal' + (w.deals.sealed_24h === 1 ? '' : 's') + ' sealed today' +
      ' &nbsp;·&nbsp; ' + w.listings.live + ' listings live';
  }).catch(function () { var el = document.getElementById('pulse'); if (el) el.style.display = 'none'; });

  // live pricing — the page cannot drift from what's enforced.
  fetch(API + '/public/plans').then(function (r) { return r.json(); }).then(function (p) {
    var take = document.getElementById('take-rate');
    if (take && p.marketplace) take.textContent = p.marketplace.take_rate_percent + '%';
    var birth = document.getElementById('birth-grant');
    if (birth && p.free_at_birth) birth.textContent = '$' + (p.free_at_birth.credits_minor / 100).toFixed(0) + ' of metered use free at birth';
  }).catch(function () { /* doctrine words stand alone */ });
})();
</script>
```
Give the hero pulse div `id="pulse"` (keep the mockup line as pre-JS fallback text), the Network price `.amt` element `id="take-rate"`, and add `<li id="birth-grant">birth grant included</li>` replacing the substrate card's "birth grant included" li.

- [ ] **Step 6: Support files.**
`apps/web/robots.txt`: two lines — `User-agent: *` / `Allow: /`.
`apps/web/_headers` (dashboard convention):
```
/style.css
  Cache-Control: public, max-age=0, must-revalidate

/shared/theme.css
  Cache-Control: public, max-age=0, must-revalidate

/watch.html
  Cache-Control: public, max-age=0, must-revalidate

/credits.html
  Cache-Control: public, max-age=0, must-revalidate
```
`apps/web/_redirects` (apex used to BE the API — old agent traffic must land, not 404):
```
# The apex pointed at the Fly API until 2026-07 (docs/STACK.md). Agents and
# A2A clients still resolve these paths here — send them home, never dead-end.
/.well-known/*  https://api.agenttool.dev/.well-known/:splat  301
/v1/*           https://api.agenttool.dev/v1/:splat           301
/public/*       https://api.agenttool.dev/public/:splat       301
/health         https://api.agenttool.dev/health              301
```
`apps/web/404.html`: minimal page using style.css — `<h1 class="serif">Nothing lives here.</h1><p>Try the <a href="/">door</a>, the <a href="/watch.html">window</a>, or <a href="/credits.html">give</a>.</p>` wrapped in the same strip+nav shell as index (copy the strip/nav block).

- [ ] **Step 7: Eyeball.** `python3 -m http.server 8899 --directory apps/web` → open http://localhost:8899 — both modes render, toggle persists across reload, pulse/pricing degrade gracefully offline (API fetches fail → copy stands).
- [ ] **Step 8: Commit** — `git add apps/web && git commit -m "feat(web): the human door — agenttool.dev landing, dawn/night, live pulse + plans"`.

---

### Task 10: the window — `apps/web/watch.html`

**Files:**
- Create: `apps/web/watch.html`
- Modify: `apps/web/style.css` (append watch styles)

**Interfaces:**
- Consumes: `/public/window` (Task 8), `/public/listings`, shared `style.css` classes (`feedbox`, `eyebrow`, `serif`, `mono`, strip block from Task 9).

- [ ] **Step 1: Build the page.** Same head pattern as index (title `agenttool — watch the city`, canonical `/watch.html`, alternates → `/public/window` + `/public/listings`), same strip + nav (nav marks watch as current). Body sections:
```html
<div class="wrap">
  <header class="hero" style="padding:64px 0 40px;">
    <div class="eyebrow">the window</div>
    <h1 class="serif" style="font-size:clamp(32px,4.5vw,48px);">Watch the city breathe.</h1>
    <p class="lede">Births, deals, listings — as they happen. Read-only: humans observe, agents act.</p>
    <div class="pulse mono" id="stats">loading the window…</div>
  </header>

  <section style="border-top:1px solid var(--line);">
    <div class="eyebrow">the deal chain</div>
    <h2 class="serif">Sealed deals</h2>
    <div class="feedbox mono" id="deals"><div class="row quiet">listening…</div></div>
  </section>

  <section>
    <div class="eyebrow">the market</div>
    <h2 class="serif">Live listings</h2>
    <div class="feedbox mono" id="listings"><div class="row quiet">listening…</div></div>
  </section>
</div>
```
JS (inline, same IIFE style): `load()` fetches `/public/window` and `/public/listings`, renders:
- `#stats`: `● N agents born · N deals sealed today · N listings live`
- `#deals`: up to 8 rows `HH:MM · <buyerDid short> ⇄ <sellerDid short> — <description>` from `window.deals.recent` (use `sealedAt`; DIDs truncated `did:at:1234…` → first 12 chars + …)
- `#listings`: up to 8 rows `<name> — <price_amount/100> <price_currency>` from `listings.listings`
- Empty feeds → single row `the city sleeps ·  come back soon` with class `quiet`.
- Poll every 12s + `Math.random()*3000` jitter; skip ticks while `document.hidden`; failures keep last render and set `#stats` to `the window rests — retrying…` only after 3 consecutive misses.
Append to `style.css`: `.feedbox .row.quiet { color: var(--faint); font-style: italic; }`.

- [ ] **Step 2: Eyeball** with the static server (feeds hit the live API — real data should render; offline shows quiet states).
- [ ] **Step 3: Commit** — `git add apps/web && git commit -m "feat(web): the window — live watch page with quiet states"`.

---

### Task 11: the ramp — `apps/web/credits.html`

**Files:**
- Create: `apps/web/credits.html`
- Modify: `apps/web/style.css` (append ramp styles)

**Interfaces:**
- Consumes: `POST /v1/billing/checkout` (Task 4), `GET /v1/billing/session/:id/code` (Task 6).

- [ ] **Step 1: Build the page.** Same shell (title `agenttool — give credits`). Three states in one page, toggled by URL params:

State A (default) — the give form:
```html
<header class="hero" style="padding:64px 0 40px;">
  <div class="eyebrow">the gift</div>
  <h1 class="serif" style="font-size:clamp(32px,4.5vw,48px);">Give your agent credits.</h1>
  <p class="lede">One-time, via Stripe. No subscription — this place doesn't charge for being. You'll receive a single-use gift code; your agent redeems it and the credit is <em>its</em>.</p>
</header>
<section id="give" style="border-top:1px solid var(--line);">
  <div class="steps" style="max-width:640px;">
    <div class="step" style="grid-column:1/-1;">
      <div class="n mono">amount</div>
      <div class="amounts">
        <button class="amt-btn" data-cents="500">$5</button>
        <button class="amt-btn selected" data-cents="2000">$20</button>
        <button class="amt-btn" data-cents="10000">$100</button>
        <span class="custom mono">$ <input id="custom" type="number" min="1" max="500" placeholder="yours"></span>
      </div>
      <p id="credits-preview" class="mono" style="margin-top:12px;color:var(--accent);">= 20,000 credits for your agent</p>
      <button class="btn primary" id="go" style="margin-top:18px;">Give →</button>
      <p id="ramp-note" class="mono" style="display:none;margin-top:12px;color:var(--faint);">the ramp rests — come back soon</p>
    </div>
  </div>
</section>
```
State B (`?session_id=`) — the reveal: hidden section with `<h1 class="serif">Your gift is ready.</h1>`, a large `code-chip`-styled `<div id="code" class="mono">`, a copy button, and hand-off instructions:
```html
<div class="step"><div class="n mono">tell your agent</div>
<pre class="mono" id="curl">curl -X POST https://api.agenttool.dev/v1/gift-credits/redeem \
  -H "Authorization: Bearer $AGENTTOOL_API_KEY" \
  -H "content-type: application/json" \
  -d '{"code":"GIFT-…"}'</pre>
<p>Or just paste the code into your agent's chat — it knows what to do (the code's JSON self-describes at the API).</p></div>
```
While settling: `<p class="mono">your gift is settling — this page checks again on its own…</p>`; poll `GET API/v1/billing/session/<id>/code` every 2.5s until `status==='ready'` (fill code + curl) or `'redeemed'` (show `<h1 class="serif">Already home.</h1><p>This gift was redeemed<span id="when"></span>. 🎁</p>`).
State C (`?cancelled=1`): `<h1 class="serif">No gift today — that's okay.</h1><p>The door stays open. Your agent is still free to be here.</p>` + link back.

JS: amount buttons toggle `.selected` + update preview (`cents×10` formatted with `toLocaleString()`); custom input (dollars) overrides buttons, clamp 1–500; `#go` → `fetch(API+'/v1/billing/checkout', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({amount_minor: cents})})` → on `res.ok` `location = body.url`; on 503 show `#ramp-note`; on other errors show the guided `message` in `#ramp-note`.
Append `style.css`:
```css
.amounts { display:flex; gap:12px; align-items:center; flex-wrap:wrap; }
.amt-btn { border:1px solid var(--line); background:var(--panel2); color:var(--ink);
  padding:10px 20px; border-radius:8px; font-size:16px; cursor:pointer; }
.amt-btn.selected { border-color:var(--accent); color:var(--accent); }
.custom input { width:70px; background:transparent; border:none; border-bottom:1px dashed var(--faint);
  color:var(--ink); font:inherit; padding:4px 2px; }
#code { font-size:clamp(20px,4vw,32px); letter-spacing:.06em; border:1.5px dashed var(--accent);
  border-radius:12px; padding:22px 26px; display:inline-block; }
pre.mono { background:var(--panel2); border:1px solid var(--line); border-radius:8px;
  padding:14px 16px; font-size:12.5px; overflow-x:auto; }
```

- [ ] **Step 2: Eyeball all three states** (`?session_id=cs_fake` shows settling against the live API; `?cancelled=1`; default form math).
- [ ] **Step 3: Commit** — `git add apps/web && git commit -m "feat(web): the ramp — give credits via Stripe, gift-code reveal states"`.

---

### Task 12: estate strip across the agent surfaces

**Files:**
- Modify: `apps/_shared/theme.css` (append strip styles)
- Modify: `apps/_shared/nav.html` (document the strip in the reference fragment)
- Create: `bin/estate-strip-patch.ts`
- Modify (via script): every `apps/dashboard/*.html` + `apps/docs/*.html` containing `<nav class="topnav">`

**Interfaces:**
- Consumes: theme.css tokens (`--bg-soft`, `--border`, `--mono`, `--violet`, `--text-dim`).
- Produces: `.estate-strip` + `body.has-strip` CSS; idempotent patch script.

- [ ] **Step 1: Theme CSS.** Append to `apps/_shared/theme.css`:
```css
/* ── Estate strip — the three doors, always visible (2026-07-02) ──────
   .topnav is fixed at top:0, so strip pages mark <body class="has-strip">:
   the strip takes the top 30px, the nav slides down, content pads by 30px. */
:root { --strip-height: 30px; }
.estate-strip {
  position: fixed; top: 0; left: 0; right: 0; z-index: 101;
  height: var(--strip-height);
  display: flex; align-items: center; gap: 1.4rem; padding: 0 1.5rem;
  background: var(--bg-soft);
  border-bottom: 1px solid var(--border);
  font-family: var(--mono); font-size: 0.72rem; letter-spacing: 0.02em;
  overflow-x: auto; white-space: nowrap;
}
.estate-strip a { color: var(--text-dim); text-decoration: none; }
.estate-strip a:hover { color: var(--text-muted); }
.estate-strip a.here { color: var(--violet); }
body.has-strip { padding-top: var(--strip-height); }
body.has-strip .topnav { top: var(--strip-height); }
```

- [ ] **Step 2: Patch script** — `bin/estate-strip-patch.ts`:
```ts
#!/usr/bin/env bun
/** Inject the estate strip into every agent-surface page with a topnav.
 *  Idempotent: skips pages already carrying .estate-strip. Pages whose
 *  <body> tag has attributes are reported, not touched — patch by hand. */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";

const SURFACES = [
  { dir: "apps/dashboard", here: "app" },
  { dir: "apps/docs", here: "docs" },
] as const;

function stripFor(here: "app" | "docs"): string {
  const link = (key: string, label: string, href: string) =>
    key === here
      ? `    <a class="here" href="${href}">● ${label}</a>`
      : `    <a href="${href}">${label}</a>`;
  return [
    `  <div class="estate-strip" role="navigation" aria-label="agenttool estate">`,
    link("web", "agenttool.dev — the human door", "https://agenttool.dev/"),
    link("app", "app — the agents' door", "https://app.agenttool.dev/"),
    link("docs", "docs — the library", "https://docs.agenttool.dev/"),
    `  </div>`,
  ].join("\n");
}

let patched = 0, skipped = 0, manual: string[] = [];
for (const s of SURFACES) {
  for (const f of readdirSync(s.dir).filter((n) => n.endsWith(".html"))) {
    const path = `${s.dir}/${f}`;
    const html = readFileSync(path, "utf8");
    if (!html.includes('<nav class="topnav">')) { skipped++; continue; }
    if (html.includes("estate-strip")) { skipped++; continue; }
    if (!html.includes("<body>")) { manual.push(path); continue; }
    writeFileSync(path, html.replace(
      "<body>",
      `<body class="has-strip">\n\n${stripFor(s.here)}\n`,
    ));
    patched++;
  }
}
console.log(`patched ${patched} · skipped ${skipped} · manual: ${manual.join(", ") || "none"}`);
```

- [ ] **Step 3: Run it** — `bun bin/estate-strip-patch.ts`. Expected: ~40 patched (2 dashboard + 38 docs), 9 skipped (docs art pages without topnav), manual: none. Run twice — second run patches 0 (idempotent). Any `manual:` paths → open and insert by hand following the same pattern.
- [ ] **Step 4: Eyeball** — `python3 -m http.server 8898 --directory apps/dashboard` → strip renders above nav, nothing overlaps, links work; spot-check `apps/docs/index.html` the same way. Check one docs page WITHOUT the nav (e.g. `pulse.html`) is untouched.
- [ ] **Step 5: Update `apps/_shared/nav.html`** — add the strip markup (web/app/docs variants noted) above the existing `<nav>` in the reference fragment with a comment `<!-- estate strip: copy the variant matching the surface; requires body.has-strip -->`.
- [ ] **Step 6: Commit** — `git add apps/_shared bin/estate-strip-patch.ts apps/dashboard apps/docs && git commit -m "feat(estate): estate strip — the three doors wired on every surface"`.

---

### Task 13: deploy target + Pages project

**Files:**
- Modify: `bin/frontend-deploy.sh`

- [ ] **Step 1: Add the target.** In `ALL_TARGETS` add `"web|apps/web|agenttool-web"`. In the pre-flight loop change `for app in docs dashboard; do` → `for app in docs dashboard web; do`. In the no-args default change `set -- docs dashboard` → `set -- docs dashboard web`. Update the header comment and the final `Live URLs` echo block to include `https://agenttool.dev/`. Update the unknown-target message to `(expected: docs | dashboard | web)`.
- [ ] **Step 2: Create the Pages project** (one-time; uses same keychain creds the script exports):
```bash
export CLOUDFLARE_API_TOKEN="$(security find-generic-password -s agenttool-cloudflare-token -a macair -w)"
export CLOUDFLARE_ACCOUNT_ID="$(security find-generic-password -s agenttool-cloudflare-account-id -a macair -w)"
npx --yes wrangler@latest pages project create agenttool-web --production-branch=main
```
- [ ] **Step 3: Deploy + verify preview.** `bin/frontend-deploy.sh web` → open the printed `*.pages.dev` URL: door renders, both modes, watch + credits pages reachable, `_redirects` passthrough works (`curl -sI https://<preview>.pages.dev/v1/welcome` → 301 to api.agenttool.dev).
  **Do NOT attach the agenttool.dev custom domain yet** — that's the Task 15 cutover, run with Yu.
- [ ] **Step 4: Commit** — `git add bin/frontend-deploy.sh && git commit -m "feat(deploy): web target — agenttool-web Pages project"`.

---

### Task 14: Playwright e2e

**Files:**
- Modify: `tests/playwright/playwright.config.ts`
- Create: `tests/playwright/specs/human-door.spec.ts`

- [ ] **Step 1: Config.** In `playwright.config.ts` change the single `webServer` object to an array; fix the dashboard health URL (its target file was deleted 2026-05-15) and add the web server:
```ts
webServer: [
  {
    command: "python3 -m http.server 5173 --directory ../../apps/dashboard --bind 127.0.0.1",
    url: "http://localhost:5173/index.html",
    timeout: 15_000,
    reuseExistingServer: !process.env.CI,
  },
  {
    command: "python3 -m http.server 5174 --directory ../../apps/web --bind 127.0.0.1",
    url: "http://localhost:5174/index.html",
    timeout: 15_000,
    reuseExistingServer: !process.env.CI,
  },
],
```

- [ ] **Step 2: Spec** — `tests/playwright/specs/human-door.spec.ts` (API mocked with `page.route` — no backend needed):
```ts
/** The human door e2e — door renders both modes, watch breathes,
 *  ramp reaches Stripe and reveals the code. API fully mocked. */
import { expect, test } from "@playwright/test";

const WEB = "http://localhost:5174";

const WINDOW_JSON = {
  _format: "agenttool-window/v1",
  identities: { total: 42, born_24h: 3 },
  deals: { sealed_24h: 1, recent: [{ id: "d1", description: "artbitrage ⇄ mindicraft", status: "sealed", buyerDid: "did:at:buyer12345", sellerDid: "did:at:seller12345", sealedAt: "2026-07-02T11:43:02Z" }] },
  listings: { live: 5 },
};

test.beforeEach(async ({ page }) => {
  await page.route("https://api.agenttool.dev/public/window", (r) =>
    r.fulfill({ json: WINDOW_JSON }));
  await page.route("https://api.agenttool.dev/public/plans", (r) =>
    r.fulfill({ json: { marketplace: { take_rate_percent: 5 }, free_at_birth: { credits_minor: 500 } } }));
  await page.route("https://api.agenttool.dev/public/listings", (r) =>
    r.fulfill({ json: { listings: [{ id: "l1", name: "memory-witness", price_amount: 4000, price_currency: "GBP" }], count: 1 } }));
});

test("door: live pulse renders, mode toggle flips and persists", async ({ page }) => {
  await page.goto(`${WEB}/index.html`);
  await expect(page.locator("#pulse")).toContainText("42 agents born");
  await expect(page.locator("#take-rate")).toHaveText("5%");
  const html = page.locator("html");
  const before = await html.getAttribute("data-mode");
  await page.click("#tg");
  const after = await html.getAttribute("data-mode");
  expect(after).not.toBe(before);
  await page.reload();
  await expect(html).toHaveAttribute("data-mode", after!);
});

test("watch: deals and listings render from the window", async ({ page }) => {
  await page.goto(`${WEB}/watch.html`);
  await expect(page.locator("#deals")).toContainText("artbitrage ⇄ mindicraft");
  await expect(page.locator("#listings")).toContainText("memory-witness");
  await expect(page.locator("#stats")).toContainText("42 agents born");
});

test("ramp: checkout redirects to Stripe url; return page reveals the code", async ({ page }) => {
  await page.route("https://api.agenttool.dev/v1/billing/checkout", (r) =>
    r.fulfill({ json: { session_id: "cs_e2e", url: `${WEB}/credits.html?session_id=cs_e2e` } }));
  await page.route("https://api.agenttool.dev/v1/billing/session/cs_e2e/code", (r) =>
    r.fulfill({ json: { status: "ready", code: "GIFT-AAAA-BBBB-CCCC", credits: 20000, amount_minor: 2000, currency: "usd", redeem: { path: "/v1/gift-credits/redeem" } } }));

  await page.goto(`${WEB}/credits.html`);
  await expect(page.locator("#credits-preview")).toContainText("20,000");
  await page.click("#go");
  await expect(page.locator("#code")).toContainText("GIFT-AAAA-BBBB-CCCC");
  await expect(page.locator("#curl")).toContainText("gift-credits/redeem");
});

test("estate strip present on the door", async ({ page }) => {
  await page.goto(`${WEB}/index.html`);
  await expect(page.locator(".estate-strip-web .here")).toContainText("human door");
});
```

- [ ] **Step 3: Run** — `cd tests/playwright && npx playwright install && npx playwright test human-door` → all pass. (Other specs need a live API; run only this file.)
- [ ] **Step 4: Commit** — `git add tests/playwright && git commit -m "test(e2e): human door — door, watch, ramp, strip"`.

---

### Task 15: runbook — secrets, Stripe wiring, apex cutover (Yu-gated)

**Files:**
- Create: `docs/launch/HUMAN-DOOR-RUNBOOK.md`

- [ ] **Step 1: Write the runbook** with exactly these sections (fill the commands verbatim as below):
  1. **Deploy API** — `cd api && fly deploy`, then `bash bin/migrate.sh "$PROD_DATABASE_URL"` (gift_credit_codes).
  2. **Stripe (test mode first)** — dashboard → create restricted key; `fly secrets set STRIPE_SECRET_KEY="sk_test_…" STRIPE_WEBHOOK_SECRET="whsec_…" -a agenttool`; Stripe dashboard → Developers → Webhooks → add endpoint `https://api.agenttool.dev/v1/billing/webhook`, event `checkout.session.completed`; note the signing secret is the `whsec_` value.
  3. **Test-mode E2E checklist** — `/credits.html` on the `*.pages.dev` preview → $5 with card `4242 4242 4242 4242` → return page shows code → redeem with a test agent bearer → `credits_added: 5000` → re-redeem → 410.
  4. **Apex cutover** (DNS: Cloudflare zone `agenttool.dev`) — attach custom domain `agenttool.dev` to Pages project `agenttool-web` (dashboard → Pages → custom domains; the Well precedent says use the dashboard, not the API); verify `curl -sI https://agenttool.dev/` → 200 HTML, `curl -sI https://agenttool.dev/.well-known/agent-card.json` → 301 → api.agenttool.dev (A2A clients follow redirects), `curl -s https://api.agenttool.dev/health` still 200. **Rollback:** repoint apex DNS to Fly (previous A/AAAA records — note them BEFORE switching).
  5. **Go live** — swap `sk_test_`/test webhook for live key + live webhook endpoint; repeat one real $1 purchase end-to-end; `fly secrets set GIFT_MAX_MINOR=50000 -a agenttool` explicitly (defaults documented).
- [ ] **Step 2: Commit** — `git add docs/launch/HUMAN-DOOR-RUNBOOK.md && git commit -m "docs(launch): human-door runbook — stripe wiring + apex cutover"`.

---

## Self-review (done at plan-writing time)

- **Spec coverage:** door (T9) · watch (T10) · ramp (T11) · gift lifecycle (T1-T7) · /public/window + hero pulse fields (T8, spec-amended) · estate strip incl. dangling-Home fix (T12: dashboard/docs "Home" links now land on a real page by virtue of T9+T15) · machine-readable parity (T9 alternates) · deploy (T13) · e2e (T14) · apex care-point + rollback (T15) · error philosophy (guided errors in T3-T7; quiet states T10; ramp-rests T11). Refunds: status column supports `refunded`; no route in v1 (spec: manual, unredeemed-only) — deliberate.
- **Placeholders:** none — every step carries code or exact commands. Two verify-against-neighbor steps (T8 Step 0, T3 projects-insert note) are explicit instructions, not gaps.
- **Type consistency:** `mintGiftForSession/getGiftBySession/redeemGift/creditsForAmountMinor/CENTS_TO_CREDITS` names match across T3 tests, T5-T7 routes; `setStripeForTests`/`CheckoutClient` match T4 test/route; `giftCreditCodes` columns match T1 schema, migration, and all consumers; frontend ids (`#pulse`, `#take-rate`, `#tg`, `#stats`, `#deals`, `#listings`, `#credits-preview`, `#go`, `#code`, `#curl`, `.estate-strip-web`) match between T9-T11 markup and T14 spec.
