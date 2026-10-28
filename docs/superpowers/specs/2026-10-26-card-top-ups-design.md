# Card top-ups — design

> **Type:** proposal · **Purpose:** reopen one paid door, agenttool credits bought by card, to Yu's decisions of 2026-10-23 and 2026-10-24.
> **Evidence:**
> - **Code:** `main` at `76441ee9` (2026-10-21), still the tip of `origin/main` on 2026-10-26. Line references are to that tree.
> - **Live pages, Stripe, VAT and consumer law:** a read-only map made on 2026-10-24 (seven research lanes, each re-checked by a verifier, then synthesised and criticised; sources fetched that day).
> - **Review:** version 1 of this spec was reviewed on 2026-10-26 through six lenses (code accuracy, money safety, the Stripe API, law and tax, operability, values and clarity), and every finding was checked by a separate refuter. Version 2 folds in the 70 confirmed findings.
>
> Nothing in this spec has been built.

**Date:** 2026-10-26 (v2) · **Status:** proposal, awaiting Yu's review. No code, migration, Stripe change or deploy exists for it yet.

---

## 1. Yu's decisions

| Question | Yu's answer | What it means here |
|---|---|---|
| What is the money for? | **It pays Yu.** The Kingdom becomes his living, not a cost. | The door has to earn real money from strangers. It is not a demonstration. |
| How much? | **£3k a month to Yu, plus the Kingdom's running costs.** Anything above that is reinvested in the Kingdom: land, rentals, memory and compute, setup, electricity. | Roughly £5.3k–5.6k a month of sales, ex-VAT, once Stripe's fees are counted (section 13). This is an estimate, not tax advice. |
| Which paid thing? | **agenttool credits**, chosen on 2026-10-24 over two other candidates: Cambridge TCG import with open-book pricing, and a one-off "safe to go public" toolkit. | One door sells credits. Every other door stays free. |
| What shape? | The design proposed in chat on 2026-10-24, approved on 2026-10-26 ("yes yes, lets go ahead"). | Sections 2–5. |
| Standing rules | No subscriptions (2026-08-29). The free doors stay free. No lock-in. The exit is always open. | Pay-as-you-go only, cards only, and purchased credits stay refundable while unspent. The data export stays free. |

For card-bought credits only, this replaces the 2026-09-23 retirement (commit `422ac856` "Retire commercial goals and new purchases" and commit `5b249c98`, PR #431). That retirement came from a parallel session and was never confirmed as Yu's ruling. Yu's choice now is the ruling. Everything else that #431 retired stays retired.

## 2. Scope

**In scope**
- An agent starts a card top-up for its own project. A human pays on Stripe Checkout, and the credits land in that project.
- One webhook credits the project, and one reversal rule handles refunds, disputes, wins and failed refunds.
- A new switch, off by default.
- The `/credits` page explains the door, shows when it is resting, and shows a returned session's state.
- Everything that currently says credit purchases are retired is reworded, and so are the tests that pin those words (section 9.3).
- A separate Stripe account for agenttool under Cambridge TCG Limited.
- A brief for the accountant.

**Out of scope**
- No new gift-code sales. Existing gift rows keep their reveal, redeem and refund paths.
- x402 USDC top-ups stay retired.
- Gallery, template, attestation, memory-witness and marketplace purchases stay retired.
- No subscriptions and no payouts to agents or users.
- Metered prices don't change. That includes draft PR #516 (section 12, step 5).
- SDK helpers are not part of this. Publishing needs Yu's trusted device, so they come in a later release.
- Finding buyers. That needs its own plan, which Ai writes after this one ships.

## 3. Words used

- **Top-up:** one card payment that adds credits to one project. No code or bearer secret is issued for it.
- **Project:** the tenant that owns `projects.credits` (`api/src/db/schema/tools.ts:26`). Credits leave a project in three ways:
  - metered charges (`api/src/billing/charge.ts:139,293`);
  - gift refund clawbacks (`api/src/services/billing/gift-credits.ts:96-114`);
  - the top-up reversals in section 5.3.

  No route moves credits from one project to another. A project's API keys are bearer secrets, though. Anyone holding one can spend the balance or mint more keys (`api/src/routes/keys.ts:75-105`).
- **Credit:** $0.001, so a cent buys 10 credits (`gift-credits.ts:22-23`). Credits never expire.
- **Purchased credits:** credits added by a top-up and not yet reversed. The free birth grant and redeemed gifts are not purchased credits.
- **The switch:** `AGENTTOOL_CARD_TOP_UP_ENABLED`. This is a new name on purpose. Rolling back to an image older than `422ac856` must not reopen the old gift checkout through the old `AGENTTOOL_CARD_CHECKOUT_ENABLED`.
- **Legacy account and agenttool account:** "legacy" is the Stripe account agenttool shares today with the cambridgetcg.com storefront. The agenttool account is the new one (section 8).
- **`billing/index.ts`** below means `api/src/routes/billing/index.ts`. **`api/src/index.ts`** is always written in full.

## 4. A stranger's path, end to end

1. **The agent asks for a link.**
   - It calls `POST /v1/billing/top-up {"amount_minor": 2000}` with its project bearer.
   - The API checks the switch, the configuration and the bounds, and records a `pending` top-up row.
   - It creates a Checkout Session on the agenttool account and returns `{session_id, url, expires_at, amount_minor, credits, currency: "usd"}`.
2. **A human pays.** The agent hands the URL to its human, usually the developer.
   - **What Checkout shows:** the credits, the VAT that Stripe Tax works out from the buyer's address, and the total.
   - **Before paying:** the buyer ticks a terms checkbox.
   - **Beside the button:** a short express request and the refund promise (section 5.2).
   - **Payment method:** card only.
3. **Stripe confirms.**
   - `checkout.session.completed` reaches the top-up webhook.
   - The webhook verifies the event, finds the `pending` row, and checks the project, the net amount, the currency, the payment status and that no discount was applied.
   - In one transaction it marks the row `credited` and adds the credits to that project.
   - Stripe then emails the buyer the paid invoice. That email is the contract confirmation (section 10.2).
4. **The human sees the result.** Stripe returns them to `agenttool.dev/credits?session_id=…`. The page polls `GET /v1/billing/session/:id/top-up` and shows one of the public states in section 5.4. It never shows a project id or anything usable as a credential.
5. **The agent spends.** Its balance rises. Nothing else changes for the agent.
6. **The exit.**
   - **Asking:** either party writes to support and asks for the unspent purchased credits back.
   - **Refunding:** the operator refunds them charge by charge, newest first, at their gross value including VAT (section 11).
   - **Credits:** `charge.refunded` reverses exactly those credits.
   - **Statutory right:** within 14 days of purchase a consumer also has the legal right to cancel (section 10.2).
   - **Export:** the data export (PR #462) stays free whether or not anyone pays.

A human who arrives at `/credits` with no agent sees how the door works, prices including VAT, a `curl` example of step 1 and the refund promise. If the door is resting, the page says so. There is no anonymous buy form.

## 5. API

### 5.1 `POST /v1/billing/top-up` (authenticated)

**Mount.** `app.use("/v1/billing/top-up", authMiddleware)` goes before `app.route("/v1/billing", …)` (`api/src/index.ts:342,688`).
- Mount it on that exact path only. Never use `/v1/billing/top-up/*`.
- The webhook lives at `/v1/billing/top-up-webhook`, outside this prefix, because Stripe sends no bearer.
- Every other billing route keeps its posture.
- The route uses its own Stripe client, built from `STRIPE_TOP_UP_SECRET_KEY`, and never the cached legacy `getStripe()` (`api/src/services/billing/stripe-checkout.ts:19-29`).

**Refusals, in order.** None of them writes anything.
1. **Switch off:** `503 top_up_resting` ("the card door is resting").
2. **Configuration missing:** `503 billing_unconfigured`, naming the missing piece for operators. That is the agenttool account key, its webhook secret, or `TOP_UP_TAX_CODE` while automatic tax is on.
3. **Rate limit:** more than 10 sessions per project in 10 minutes returns `429`. The limit is keyed on the project id rather than an IP header, so it doesn't share the spoofable `cf-connecting-ip` limiter (`billing/index.ts:51-60`).
4. **Bounds:** the body must be `{amount_minor: int}` with `TOP_UP_MIN_MINOR` (default 500, i.e. $5) ≤ amount ≤ `TOP_UP_MAX_MINOR` (default 50000, i.e. $500).

**Then:**
1. Insert the `pending` row (section 6).
2. Create the session (section 5.2) and store its id on the row.
3. If Stripe errors, mark the row `abandoned` and return `502`. Never retry automatically. A completion that later arrives for an `abandoned` row moves it to `needs_review` rather than being dropped.

### 5.2 Checkout Session parameters

A new `createTopUpCheckout` builds these, next to `createGiftCheckout` (`stripe-checkout.ts:34-71`).

| Parameter | Value | Why |
|---|---|---|
| `mode` | `payment` | One-time payments only. |
| `payment_method_types` | `["card"]` | Yu said "by card". Without this the Dashboard decides, and could offer delayed or pay-later methods. |
| `adaptive_pricing` | `{enabled: false}` | Set in code, so a Dashboard default can't show buyers a converted local price with a conversion fee added. A localized session would still report `usd`, so the webhook's currency check is not what protects against this. |
| `line_items[0].price_data` | `currency: "usd"`, `unit_amount`, `tax_behavior: "exclusive"`, `product_data: {name: "agenttool credits", description: "<N> credits for your agent's project", tax_code: config.topUpTaxCode}` | Credits are the net value, and Checkout adds VAT. The public pages still lead with the VAT-inclusive total (section 9.1). The tax code comes from the accountant. |
| `automatic_tax` | `{enabled: true}` unless `AGENTTOOL_STRIPE_AUTOMATIC_TAX` is `"0"` | The comment at `stripe-checkout.ts:51-54` is half right. Stripe refuses an `automatic_tax` session when Stripe Tax isn't set up. But once any registration exists, a buyer somewhere without one is charged 0% and nothing errors. The comment gets rewritten to say both. |
| `tax_id_collection` | `{enabled: true}` | Business buyers can enter a VAT ID. |
| `invoice_creation` | `{enabled: true, invoice_data: {description, footer}}` | The paid-invoice email is the reg 16 confirmation (section 10.2). The footer carries the seller's name, company number, registered address and VAT number, the support email, the terms version and the cancellation summary. Whether Stripe charges a fee for these invoices is checked on its pricing page at step 3. |
| `consent_collection` | `{terms_of_service: "required"}` | An explicit terms checkbox. It needs a Terms URL in the account's Public details, in test and live alike. |
| `custom_text.submit.message` | "By paying you ask Cambridge TCG Limited to add these credits to your agent's project now. You keep your 14-day right to cancel (you pay only for credits already used), and unspent credits stay refundable any time. Terms: agenttool.dev/terms" | This is the express request that reg 36(1) and reg 37 depend on. There is no acknowledgement of losing the right to cancel (section 10.2). |
| `client_reference_id` | the project id | Searchable in the Dashboard, and checked again on completion. |
| `metadata`, `payment_intent_data.metadata` | `{kind: "project_top_up", type: "agenttool_project_top_up", top_up_id, project_id, terms_version}` | `type` keeps storefront code from treating the session as a retail order. Stripe copies PaymentIntent metadata to the Charge, so refunds can find their row (section 5.3). |
| `payment_intent_data.statement_descriptor_suffix` | `AGENTTOOL` | The buyer recognises the charge on their statement. |
| `expires_at` | `ceil(now / 1000) + 31 × 60` | One minute above Stripe's 30-minute minimum, which Stripe counts by its own clock. A session made before a pause can't be paid a day later. |
| `success_url` / `cancel_url` | `${webBaseUrl}/credits?session_id={CHECKOUT_SESSION_ID}` / `…/credits?cancelled=1` | Same shape as today. |

### 5.3 `POST /v1/billing/top-up-webhook` (the agenttool account's endpoint)

This endpoint has its own secret, `STRIPE_TOP_UP_WEBHOOK_SECRET`. The legacy `/v1/billing/webhook` keeps the legacy secret, so the earlier charges stay refundable until their windows close (section 8.3).

**Guards, in order**
1. **Body size.** A limit of 1 MB.
2. **Configuration.** The webhook secret must be set, and `STRIPE_TOP_UP_SECRET_KEY` must start with `rk_live_`, `sk_live_`, `rk_test_` or `sk_test_`. If not, return `503` and log `top-up review: webhook unconfigured`, so that Stripe keeps retrying for up to three days in live mode. The mode is read only from this key, never from a placeholder.
3. **Thin events.** A body with `object: "v2.core.event"` returns `400` with `top-up review: thin event destination`. So does an `api_version` outside the release pinned in section 8.2. Stripe keeps retrying while the endpoint is fixed.
4. **Signature.** Verify it.
5. **Mode.** `event.livemode` must match the key's mode. On a mismatch, log it and answer `200`, so a test event can never credit a real project.

**Processing, one transaction per event, always in this order**
1. `INSERT` the `card_top_up_events` row with `ON CONFLICT (stripe_event_id) DO NOTHING`. If no row was inserted, the event was already processed: commit and answer `200`.
2. **Find the top-up:**
   - **Completion:** by `metadata.top_up_id`.
   - **Refund:** by `charge.metadata.top_up_id`; otherwise by `payment_intent`.
   - **Dispute:** by `dispute.payment_intent`. Disputes carry no copied metadata.
   - **No match:** the event row keeps `top_up_id` NULL with `stripe_payment_intent` set, and the handler logs `top-up review: unmatched` and answers `200`. The completion check below then catches it.
3. Lock the `card_top_ups` row with `SELECT … FOR UPDATE`, then the `projects` row, as `reverseGiftForSession` does (`gift-credits.ts:88,102`).
4. Update the stored facts, then apply the reversal rule. Every amount comes from stored totals, never from per-event deltas, so an event that is reordered, replayed or concurrent changes nothing a second time.

**Events and the facts they change**

| Event | Facts updated |
|---|---|
| `checkout.session.completed`, `checkout.session.async_payment_succeeded` | **Always**, whatever happens next: store `payment_intent`, `amount_total`, `amount_tax`, `customer_details.address.country`, `livemode` and, if present, the presentment currency.<br>**Credit only when the row is `pending` and every check holds:**<br>• the session id matches;<br>• `client_reference_id` and `metadata.project_id` equal `row.project_id`;<br>• `payment_status = "paid"`;<br>• the currency is `usd`;<br>• `amount_subtotal = row.amount_minor`;<br>• `total_details.amount_discount = 0`;<br>• the new balance fits in int4;<br>• no refund or dispute event for this payment intent was recorded earlier.<br>**If an earlier refund or dispute was recorded:** a full refund → `refunded_before_credit`; a partial refund or a dispute → `needs_review`.<br>**Any other failed check** → `needs_review`, with the reason.<br>**On credit:** set `credited_at` and add `row.credits` to `projects.credits`. |
| `checkout.session.expired` | `pending` → `expired`. |
| `charge.refunded` | `amount_refunded_minor = GREATEST(stored, charge.amount_refunded)`. Stripe's figure is cumulative and gross, and this value never goes down. |
| `refund.failed`, `refund.updated` with status `canceled` | No automatic restore. Status → `needs_review`, `review_reason = "refund_failed:<reason>"`, log `top-up review: refund failed`. The operator then restores the credits or pays by another agreed route, and records which (section 11). |
| `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.funds_withdrawn`, `charge.dispute.funds_reinstated`, `charge.dispute.closed` | Upsert `card_top_up_disputes` by `dispute.id`, with its amount, currency and current `status` stored verbatim. A dispute that isn't in `usd` sends the row to `needs_review`. |

**The reversal rule.** Applied after every event, in integer arithmetic.
- `counting_disputes`: the disputes in status `needs_response`, `under_review` or `lost`.
  - **Not counted:** inquiries (`warning_*`), which move no money.
  - **Released when they end:** disputes that end `won`, `warning_closed` or `prevented`.
  - **Escalation:** an inquiry that escalates arrives as `charge.dispute.updated` or `funds_withdrawn`, and starts counting then.
- `exposure = min(amount_total_minor, amount_refunded_minor + Σ amount_minor of counting_disputes)`. A refund and a dispute together can never exceed what was paid.
- `target`:
  - 0 if `credited_at` is null;
  - `credits` if `exposure = amount_total_minor`;
  - otherwise `floor(exposure × credits / amount_total_minor)`.
- `held = credits_reversed + shortfall_credits` is what has been reversed so far.
- **If `target > held`, claw back.** Take `LEAST(projects.credits, target − held)` from the project into `credits_reversed`, and put the rest in `shortfall_credits`.
- **If `target < held`, restore.** This happens when a dispute is won. Restore `held − target`, taking it from `shortfall_credits` first, since that was never taken, then from `credits_reversed` back into `projects.credits`. If the restore would push the balance past int4, the row goes to `needs_review`.
- **Lost disputes stay counted.** A `funds_reinstated` on a lost dispute (Stripe returns only a refunded part) leaves it counted, so no credits come back.

**The status is derived from the facts every time**, so no earlier status needs storing:
1. not credited: `pending`, `abandoned`, `expired`, `refunded_before_credit` or `needs_review`, as set above;
2. otherwise, any `lost` dispute: `dispute_lost`;
3. otherwise, any counting dispute: `disputed`;
4. otherwise, `amount_refunded_minor = amount_total_minor`: `refunded`;
5. otherwise, `amount_refunded_minor > 0`: `partially_refunded`;
6. otherwise: `credited`.

`needs_review` is sticky until an operator clears it.

The gift and gallery branches of the legacy webhook and `reverseGiftForSession` stay unchanged. No new gift sessions can exist, so the gift refund-before-mint gap (`billing/index.ts:279-292`) can only affect a historical session that Stripe is still retrying, and those retries ended long ago. It is recorded here and not fixed.

### 5.4 `GET /v1/billing/session/:id/top-up` (unauthenticated status)

The session id must match `^cs_(live|test)_[A-Za-z0-9]{10,250}$`. The route returns `{status, amount_minor, amount_total_minor, credits, currency, amount_refunded_minor}`. It never returns a project id or anything credential-like. It sends the same no-store headers as the other billing routes (`billing/index.ts:34-42`) and is rate-limited like them.

`status` is mapped from a fixed table. The raw column is never echoed.

| Stored status | Public status |
|---|---|
| `pending` | `settling` |
| `expired`, `abandoned` | `closed` |
| `refunded_before_credit` | `refunded` (credits shown as never delivered) |
| `credited`, `partially_refunded`, `refunded`, `disputed`, `dispute_lost`, `needs_review` | passed through unchanged |
| anything else | `unavailable` |

An unknown session id returns `settling`, which matches the gift reveal (`billing/index.ts:493-498`).

## 6. Data

The change is one additive migration, `api/migrations/<UTC timestamp>_card_top_ups.sql`, created with `bin/migrate.sh new card_top_ups`, plus Drizzle schema in `api/src/db/schema/economy.ts`.

**`economy.card_top_ups`**

| Column | Notes |
|---|---|
| `id` | uuid, primary key |
| `project_id` | uuid, not null, references `tools.projects` |
| `stripe_session_id` | text, unique |
| `stripe_payment_intent` | text, unique |
| `amount_minor` | bigint, not null; net, ex-VAT |
| `amount_total_minor` | bigint; gross |
| `amount_tax_minor` | bigint |
| `currency` | text, default `'usd'` |
| `presentment_currency` | text |
| `credits` | bigint, not null |
| `status` | text, constrained to the statuses in section 5.3 |
| `amount_refunded_minor` | bigint, default 0 |
| `credits_reversed` | bigint, default 0 |
| `shortfall_credits` | bigint, default 0 |
| `livemode` | boolean |
| `buyer_country` | text; VAT location evidence |
| `terms_version` | text |
| `review_reason` | text |
| `created_at`, `credited_at`, `updated_at` | timestamps |

**`economy.card_top_up_disputes`**

| Column | Notes |
|---|---|
| `stripe_dispute_id` | text, primary key |
| `top_up_id` | uuid, not null, references `card_top_ups` |
| `amount_minor` | bigint |
| `currency` | text |
| `status` | text; Stripe's value, verbatim |
| `created_at`, `updated_at` | timestamps |

**`economy.card_top_up_events`**

| Column | Notes |
|---|---|
| `stripe_event_id` | text, primary key |
| `top_up_id` | uuid, nullable |
| `stripe_payment_intent` | text, indexed |
| `stripe_object_id` | text; the `cs_`, `ch_`, `re_` or `du_` id |
| `type` | text |
| `credits_delta` | bigint; what moved in `projects.credits` |
| `shortfall_delta` | bigint |
| `created_at` | timestamp |

`projects.credits` is a 32-bit integer (`tools.ts:26`). Every credit and restore checks the new balance against the int4 range.

**Migration timing.** The order follows `docs/DEPLOY-CI.md`.
1. Yu merges.
2. `deploy-api.yml` refuses, because the file is pending (`.github/workflows/deploy-api.yml:122-141`).
3. With Yu's yes, the file is applied from `main` with `bin/fly-migrate-one.sh`, and deploy-api is re-run.

Applying it from the branch *before* the merge would be safe for the database. It would break the gate, though, which also refuses when the production journal names a file that the deployed checkout lacks, so every other API deploy would be blocked until the merge.

**Retention.** Money rows follow the deletion design's "keep the number, not the person" rule (`docs/superpowers/specs/2026-10-12-deletion-scopes-design.md`, Q5). The accountant sets the period: EU non-Union OSS records may need ten years. `/privacy` and `/public/retention` follow.

## 7. Configuration

| Name | Default | Purpose |
|---|---|---|
| `AGENTTOOL_CARD_TOP_UP_ENABLED` | `0` | The switch. Only `"1"` opens the door. |
| `STRIPE_TOP_UP_SECRET_KEY` | empty | The agenttool account's restricted key (section 8.2). |
| `STRIPE_TOP_UP_WEBHOOK_SECRET` | empty | The top-up webhook's signing secret. |
| `TOP_UP_TAX_CODE` | empty | The accountant's Stripe tax code. While it is empty and automatic tax is on, the route refuses. |
| `TOP_UP_MIN_MINOR` / `TOP_UP_MAX_MINOR` | 500 / 50000 | The bounds. |

What stays as it is:
- **Hard-coded off.** `cardCheckoutEnabled: false` and `galleryCheckoutEnabled: false` (`api/src/config.ts:58,63`) and `NEW_PLATFORM_PURCHASES_ENABLED = false` (`api/src/billing/commercial-policy.ts:10`) stay. `api/tests/commercial-retirement.test.ts:10-20` keeps passing unchanged.
- **Hermetic tests.** The three new secrets and the switch join the unset list in `bin/hermetic-env.sh:56`, and their names are pinned in `bin/tests/boring-spine-gate.test.ts`. A test key or an open switch left in a shell can then never reach the hermetic tiers.
- **Local runs.** A local run passes the `rk_test` key only through the process environment, never through an `api/.env` file, which Bun loads automatically.
- **Resting and rotating.** The door is rested with the switch only. `STRIPE_TOP_UP_SECRET_KEY` and the webhook secret stay set for as long as refunds or disputes can still arrive. To rotate the key, use one `fly secrets set`. Never unset it first.

## 8. Stripe

### 8.1 A separate account

The legacy account also serves the cambridgetcg.com storefront. That storefront's hourly reconcile job and its webhook treat any paid session without a `metadata.type` as a retail order (Cambridge-TCG-monorepo `lib/orders/reconcile.ts:288-306`). Stripe's guidance is to use separate accounts for independent websites; they may share one legal entity. A separate account also gives agenttool its own descriptor, Terms URL, support email and dispute ratio.

**Creating and activating it.** Yu creates it in the Dashboard (account menu → New account) under Cambridge TCG Limited. A new account inherits nothing. Yu activates it himself:
- business details (15680297, VAT GB509919752);
- the representative's verification;
- a bank account for Stripe's payouts to the company.

Those are settlements to Cambridge TCG Limited, not the payouts ruled out in section 2. Stripe's review can take days, so activation starts at step 3.

### 8.2 Keys, webhook and checklist (Yu's hands)

**Key.** A restricted key, `rk_live` `agenttool-api`, with **Checkout Sessions: Write** plus exactly what the step 3 sandbox walk proves is needed for automatic tax and `invoice_creation`. Nothing else. The new design never calls `sessions.list`.

**Webhook.** In Workbench → Webhooks → create an event destination, choose:
- **Your account**;
- payload format **Snapshot**, not the recommended Thin. Thin notifications carry no `data.object`, and nothing would credit;
- the **API version pinned by the locked `stripe` SDK** (`stripe@22.1.0`, the dahlia release; confirm it from `api/node_modules/stripe` at build time);
- the URL `https://api.agenttool.dev/v1/billing/top-up-webhook`.

Subscribe to these events:
- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.expired`
- `charge.refunded`
- `refund.failed`
- `refund.updated`
- `charge.dispute.created`
- `charge.dispute.updated`
- `charge.dispute.funds_withdrawn`
- `charge.dispute.funds_reinstated`
- `charge.dispute.closed`

**Fly secrets.**
- At step 6, Yu sets `STRIPE_TOP_UP_SECRET_KEY` and `STRIPE_TOP_UP_WEBHOOK_SECRET` himself.
- `TOP_UP_TAX_CODE` waits for the accountant and is set at step 7.

**Dashboard checklist for the agenttool account**
1. Activation is complete: payments and payouts are enabled, and nothing is outstanding.
2. **Public details:** name; website agenttool.dev; support email contact@cambridgetcg.com; Terms and Privacy URLs; a refund policy that matches the new `/terms`.
3. **Statement and receipts:** a statement descriptor, with receipts on for payments and refunds.
4. **Payment options:** card as the only payment method, and Adaptive Pricing off (it is also forced off in code).
5. **Tax** (at step 6): the UK registration, default tax behaviour Exclusive, and threshold monitoring on. The non-Union OSS registration is added at step 7, only if the accountant advises it.
6. **Radar:** block failed CVC and postcode checks; velocity rules per card fingerprint and per email; 3DS where Stripe recommends it.
7. **Team:** access protected by two-factor authentication.
8. **Optional:** a USD bank account for payouts, which avoids the 2% conversion when USD charges settle into GBP.

### 8.3 The legacy account

The earlier live agenttool charges were Yu's own. Memory puts the end of their refund windows around 2026-11-08, so Yu checks Payments before step 6. Until they close, they stay refundable through the untouched `/v1/billing/webhook`. That endpoint's only Stripe API call is `checkout.sessions.list` (`billing/index.ts:122-129`). Its signature checks are local, and its gift and gallery reversals touch only the database.

The key swap, in order:
1. Yu creates a legacy restricted key with **Checkout Sessions: Read** only and sets it as `STRIPE_SECRET_KEY`.
2. Replacing a secret does not revoke the old full `sk_live`. Every holder of an agenttool Fly token could read it. So after the swap, Yu opens that key's request logs (API keys → ⋯ → View request logs).
3. If agenttool was its only caller, Yu expires it. If the storefront or anything else also uses it, that caller first gets its own restricted key, and then Yu expires the old one.

Once that is done, the API host holds no key that can move money on the legacy account. After the windows close, a later PR removes the legacy agenttool path, and Yu deletes the legacy endpoints, including the stale plural `/v1/billing/webhooks`.

## 9. Web and words

### 9.1 `/credits`

`apps/web/credits.html` gets a new page.
- **Live state.** The page reads `card_top_up` from `GET https://api.agenttool.dev/public/plans`. It never says the door is open without that live read.
- **Door open.** The page shows how the door works and prices **including VAT**. Each amount leads with its UK consumer total, for example "$5.00 of credits — $6.00 including 20% UK VAT". A line of equal prominence follows: "Buyers outside the UK pay their own rate; a business with a valid VAT ID may pay none. Checkout shows the exact total before you pay." The page also has a `curl` example of step 1 and the refund promise.
- **Resting.** If the door is closed, the fetch fails, or JavaScript is off, the page says the card door is resting and hides the example.
- **Returned sessions.** The page shows every public status from section 5.4. Old gift reveal states stay, for historical sessions.
- **CSP and tests.** Any new inline script needs its sha256 in `apps/web/_headers:10` and in `infra/pages/sensitive-path-worker.js`, checked with `bun test infra/pages/edge-security.test.ts`. Playwright covers every state, resting, keyboard-only use and labels.

### 9.2 `/terms` and `/privacy`

`/terms` is rewritten from the 2026-08-29 commitments. It gets a new `TERMS_VERSION`, set to the date the PR merges and stamped in code and in `terms.html` together. The old version is archived as `apps/web/terms/versions/2026-08-29.html`.

**Sections of the new `/terms`**
1. **Seller:** Cambridge TCG Limited, 15680297, VAT GB509919752, with one registered address used everywhere.
2. **What you buy:** credits added to the one project named when the top-up started. They can't be moved to another project, sold, or given away as a code or a balance. They can only be spent on agenttool's metered services or refunded while unspent.
3. **Price and tax:** prices for UK consumers are shown including VAT. The credit amount is the net value. Checkout adds VAT at the buyer's rate and shows the total before payment.
4. **Delivery:** immediate. By paying, the buyer expressly asks for supply to start at once.
5. **Your statutory right to cancel (consumers):**
   - The buyer may cancel within 14 days of purchase, without giving a reason, by email or with the model form published on the page (Sch 3 Part B). The wording follows the Sch 3 Part A model instructions.
   - Because the buyer asked for credits to be delivered at once, a cancellation refunds the price less the value of the credits already used.
6. **Our promise, beyond the law:** purchased credits stay refundable while unspent, after the 14 days too, at their gross value. The refund goes to the original card where Stripe allows, otherwise by another agreed route. Free and gift credits are not refundable as money.
7. **Support:** contact@cambridgetcg.com, replying within **2 business days** (UK time), as the live terms already promise (`apps/web/terms.html:99`).
8. **Disputes and governing law:** carried over unchanged.

**`/privacy` changes**
- what Stripe receives;
- the top-up records and their retention, per the accountant;
- buyer-country evidence;
- one controller address.

### 9.3 Words and pins that change in the same PR

The guiding rule is one plain sentence about money, used everywhere:

> "Understanding is the purpose. One door sells project credits by card, so this work can pay its costs and the person who keeps it. Nothing else is sold, the free doors stay free, and unspent credits are refundable."

Any doctrine sentence that says credit purchases or card checkout are retired, or that the platform must not fund itself, gets rewritten. Appending a section next to it is not enough. Retirement sentences about the doors that stay retired are kept.

**(a) Code**
- **Split `PURCHASES_RETIRED_MESSAGE`** (`commercial-policy.ts:11-12`) in two. One message names only what stays retired: gift checkout, x402 top-ups, and template, gallery, attestation and memory-witness purchases. The other is a config-driven sentence for card top-ups, which names `POST /v1/billing/top-up` when the door is open and says the door is resting when it isn't.
- **Callers:**
  - `api/src/routes/public/plans.ts:195` (`new_purchases`), `:226` (`project_credits.why`) and `:232` (`then_pay_as_you_go.how`);
  - `billing/index.ts:134`;
  - `api/src/routes/x402-top-up.ts:52`;
  - the `insufficient_credits` hint and its `next_actions` (`api/src/lib/errors.ts:452`, and the comment at `charge.ts:319-321`);
  - the `/about` billing entry (`api/src/index.ts:1422`).
- **`/public/plans` gets:**
  - a new `principle`, the sentence above;
  - a `card_top_up` object built from config: `enabled`, `min` and `max`, `price_per_credit_ex_vat`, a `vat_note`, the currency, the terms URL, and the refund and non-transferability promises;
  - `memory.write` in the price table, priced from what `api/src/routes/memory/memories.ts` actually charges (1 credit at `76441ee9`).

**(b) Doctrine**, using the sentence above:
- `docs/BUSINESS-MODEL.md:15,17,19`, rewritten together with its byte-identical `apps/docs/BUSINESS-MODEL.md` and with `apps/docs/business-model.html`;
- `docs/FAIR-PRICING.md:23` and `apps/docs/FAIR-PRICING.md`, kept identical;
- `AGENTS.md:13-14,17-20`, `CLAUDE.md:15`, `api/CLAUDE.md:11`, `apps/dashboard/CLAUDE.md:36` and `README.md:98`;
- both copies of `agenttool.jsonld:372`, the first of which ships in the API image.

The `AGENTS.md` change also says that maintaining the card door is legitimate work, so parallel sessions stop re-retiring it.

**(c) Pages**
- `apps/web/index.html:128-129`
- `apps/web/welcome.json:273`
- `apps/_shared/module-map.json:254`, then regenerate `module-map.js`
- `apps/docs/economy.html:303`
- `apps/docs/wallets.html:7,10,136,306`
- `apps/docs/errors.html:159`
- `docs/AUTONOMOUS-MODE.md:229`
- `docs/CATALOG.md`, which lists the new routes and the `/credits` door

**(d) Tests whose pinned sentences change.** Each moves to the new wording in the same commit.
- `api/tests/business-model-truth.test.ts:40-41`
- `api/tests/outward-operational-claims.test.ts:19,22,28,101,133,140`
- `api/tests/economy-resting.test.ts`, where only the reads of the rewritten sentences change and the escrow pin at `:536-549` stays
- `tests/playwright/specs/human-door.spec.ts:180`

There are also new pins:
- `/public/plans` never says "project-credit purchases are retired" while `card_top_up` is present;
- the new money sentence appears in all three BUSINESS-MODEL sources.

**(e) Sweep.** The plan starts with an exhaustive `rg` for "credit purchases", "card checkout", "top-ups are retired", "project-credit purchases" and "fund itself", so that nothing listed above is missed.

## 10. Tax and consumer law

These are the sources the map read on 2026-10-24, and v2's legal review. This is a map, not legal advice.

### 10.1 What the primary sources say

- **EU VAT.** For a UK company with no EU establishment, EU VAT is due from the first sale to an EU consumer, declared through non-Union OSS. The €10k threshold applies only to sellers established in a member state.
- **Stripe Tax.** It charges VAT only where a registration has been added.
- **E-money.** Credits spent only with agenttool are not e-money (EMRs 2011 reg 2(1)). That holds only while credits are spent with agenttool alone.
- **Price display.** VAT belongs in the total price shown to consumers (CMA209). VAT-exclusive lists are for trade buyers only.

### 10.2 Cancellation and confirmation

**How long the right lasts.** A consumer's right to cancel lasts **14 days** from purchase (reg 30). The any-time refund of unspent credits is a contractual promise on top of that right. It does not replace it.

**Why the express request stays.** Two cases, depending on how credits are classed:
- **If credits are a service (reg 36):** supply may start at once only on the buyer's express request. A buyer who cancels within 14 days pays for credits used only if they made that request and were given the Sch 2 para (l) and (n) information. Otherwise they get the full price back, spent credits included.
- **If credits are digital content (reg 37):** the right ends on delivery only with express consent and an acknowledgement, and the confirmation must record both.

So Checkout keeps an express request (section 5.2) and asks for no acknowledgement of losing the right. That fits Yu's choice not to make buyers waive anything. The statutory right then runs its 14 days, and the buyer pays only for credits used. Reg 36 versus reg 37 still decides the exact wording, so it goes to the solicitor.

**Information before purchase.** The information duties apply in both cases (reg 13). `/terms` carries the Sch 2 information, including the cancellation conditions, the time limit, the procedure and the model form. If that information is missing, reg 31 extends the cancellation period by up to 12 months.

**Confirmation (reg 16).** It must arrive on a durable medium. A link to `/terms` does not count, and neither does the return page. The planned confirmation is Stripe's paid-invoice email (`invoice_creation`, section 5.2). Its footer carries the seller's identity and address, the support route, the terms version and the cancellation summary. It is sent before the credits are spent.

### 10.3 Not a voucher

A top-up credits one project, no bearer code exists, no route moves credits between projects, and the terms say credits can't be transferred. That should keep a top-up outside the voucher rules (VATA 1994 Sch 10B para 1(4), "transferable by gift"), which would make it a prepayment taxed when payment is received. If it were a voucher, it would most likely be a multi-purpose one, with VAT due when the credits are spent. The project's bearer keys can be shared, so the accountant decides.

### 10.4 The accountant brief

Ai writes one page with citations, and Yu sends it. It asks:
1. The VAT treatment of a top-up that can't move between projects but can be spent by anyone holding one of the project's keys. Is the tax point the payment or each use? Which Stripe tax code applies?
2. How VAT is adjusted when unspent credits are refunded, for the UK return and for OSS.
3. When to register for non-Union OSS, and in which member state.
4. VAT invoices for business buyers.
5. Converting USD sales for the UK VAT return.
6. How unspent prepaid credits sit on the books, and reconciling Stripe payouts.
7. How long records must be kept.
8. Whether GB509919752 is valid today. The public HMRC lookup gave no verdict.

### 10.5 The solicitor

A solicitor's reading is **recommended before the first live sale**. It covers:
- reg 36 versus reg 37;
- the express-request and cancellation wording;
- the invoice email as the reg 16 confirmation;
- the VAT-inclusive display for buyers whose rate varies.

If Yu declines, the conservative reading in section 10.2 stands as written.

## 11. Operations

**Support.** Yu owns contact@cambridgetcg.com and replies within 2 business days.

**Refunds.** Done by hand in the Dashboard. Only purchased credits are refundable.
- **How much:** refundable credits = `min(projects.credits, Σ (credits − credits_reversed − shortfall_credits))` over the project's credited and partially refunded rows. Free and gift credits count as spent first.
- **The runbook's read-only query** lists those rows newest first. For each row it shows the payment intent, the remaining credits, and the maximum gross refund, `floor(remaining × amount_total_minor / credits)`.
- **The operator** refunds charge by charge until the request is covered. Disputed rows are skipped, because Stripe can't refund a disputed charge.
- **A refund within 14 days** under the statutory right refunds the price less credits used, by the same query.

**Failed refunds and refunds outside Stripe**
- **A failed refund** (`needs_review` with `refund_failed:`): the operator either restores the clawed credits or pays the value by an agreed outside route, and records which.
- **A refund paid outside Stripe** fires no webhook. The runbook has one single-transaction operator query for it. It writes an event row with a manual id, reverses the credits by the same rule, and records the route.

**Disputes.** A template in `docs/launch/HUMAN-DOOR-RUNBOOK.md` lists the evidence to send: credits delivered, usage events, the terms version and the invoice email.

**Review.** Every `top-up review:` log line has a matching runbook query that lists `needs_review`, `refunded_before_credit` and unmatched event rows. Ai runs that query after each live step and weekly while the door is open.

**Resting the door.** `fly secrets unset -a agenttool AGENTTOOL_CARD_TOP_UP_ENABLED`. Refunds and disputes keep working, and `/credits` shows the resting state without a redeploy.

**ICO.** Yu renews the data-protection registration ZB838338 before 2026-12-19, and aligns its address with `/privacy`.

## 12. Rollout

Each step waits for the one before it. **Yu** marks Yu's yes or Yu's hands.

1. **Yu** approves this spec. Ai writes the plan, and **Yu** approves the plan.
2. **Ai builds and tests.**
   - Ai builds the code, the migration, the tests, the web page and the word changes on a feature branch from `origin/main`, with the switch off.
   - Ai runs the database-backed test tier by hand against local Postgres, because no workflow runs the money tests. Then the hermetic preflight and Playwright.
   - Ai checks that no sealed file changed: `api/package.json`, `bun.lock`, `verified-postgres.ts`, the shape of `ci.yml`, and `bin/phase-b-*`.
   - Ai writes the accountant brief, and **Yu** sends it, with or without a solicitor (section 10.5).
3. **Yu creates the agenttool account and starts activation** (section 8.1).
   - In its test environment he sets the Terms and Privacy URLs, because `consent_collection` refuses without a Terms URL.
   - He configures Stripe Tax: head office, default Exclusive, and a GB registration. Stripe Tax keeps separate test settings and computes nothing without one.
   - He creates an `rk_test` key with Checkout Sessions: Write and logs in to the Stripe CLI himself.
   - **Ai runs the API locally** against that environment, with the placeholder tax code `txcd_10000000` (electronically supplied services) clearly marked as a placeholder. Ai walks the stranger's path from section 4 with the exact live parameters. The walk covers:
     - the VAT line for a GB address and the invoice email;
     - credit, then a full refund, then a partial refund;
     - a refund before credit, matched only by the charge metadata;
     - a dispute that is won, one that is lost, and an inquiry;
     - a failed refund, expiry, a replayed event, and a test event arriving on a live key.
   - Ai records any permission the restricted key lacked. Ai also creates a test-mode Snapshot endpoint once, to confirm the payload shape that `stripe listen` doesn't exercise.
4. **Yu** merges the PR. The deploy refuses on the pending migration file.
5. **Yu says yes to the migration.** It is applied from `main` with `bin/fly-migrate-one.sh`, and deploy-api is re-run. It deploys with the switch off.
   - **Frontends.** Once `/health` shows the merge commit, Ai deploys them from a clean checkout of GitHub `main` that has a `github` remote, using `bin/deploy.sh --no-migrate --no-api` (with `--oauth-fallback` if no Cloudflare token verifies). This runs the source gate, preflight, parity checks and receipt (`docs/DEPLOY-PROCEDURE.md`). Ai checks that `/credits` shows the resting state, and that `/terms`, `/privacy` and the docs serve the merged bytes.
   - **PR #516.** Draft PR #516 (the free floor for Remember) stays unmerged until this deploy has landed. Its stated reason, "purchases are retired, so nothing refills credits", stops being true when the door opens, and it changes metered prices. **Yu** decides whether it still goes ahead. If it does, it rebases onto this merge and rewrites its reason.
6. **Yu configures the live account** with the section 8.2 checklist, except the step 7 items, once activation is complete.
   - He sets `STRIPE_TOP_UP_SECRET_KEY` (with the permissions recorded at step 3) and `STRIPE_TOP_UP_WEBHOOK_SECRET`.
   - He swaps and retires the legacy key (section 8.3).
   - He confirms that the endpoint shows Snapshot and the pinned API version.
   - This step doesn't wait for the accountant.
7. **Yu opens the door** once the accountant has answered and GB509919752 is confirmed valid.
   - He adds the OSS registration if advised.
   - He sets the code and opens the door in one call: `fly secrets set -a agenttool TOP_UP_TAX_CODE=<code> AGENTTOOL_CARD_TOP_UP_ENABLED=1`.
   - A secrets deploy can recreate a stopped machine, so he checks the machine list afterwards.
8. **Yu proves it live**, as a UK buyer paying 20% VAT. If anything fails, he unsets the switch.
   - A $5 top-up into Ai's project charges $6.00, and its invoice email arrives.
   - It credits 5,000 credits.
   - A full $6.00 refund claws back 5,000.
   - A second $5 top-up, then a refund of $2.40 (40% of the gross), claws back 2,000.

## 13. What success needs

**The target.**
- **Costs to cover:** £3k to Yu, plus running costs of about £1.2k a month (Yu's estimate on 2026-08-29), plus GitHub Actions at about $164 a month, all after tax and VAT.
- **Stripe's cut:** Stripe takes its fees before payout (stripe.com/gb/pricing, read on 2026-10-24):
  - 1.5% + 20p on UK cards, 2.5% + 20p on EEA cards, 3.15% + 20p on international cards;
  - 0.5% for Stripe Tax where registered;
  - 2% when USD settles into GBP;
  - possibly an invoice fee (step 3).

  Fees apply to the VAT-inclusive total. A $5 top-up loses roughly 7–12% of its net price, and a $125 top-up about 3–5%.
- **The result:** about **£5.3k–5.6k a month of sales**, ex-VAT. At an assumed $1.30 to the pound, that is about 7M credits a month: roughly 1,400 builders spending $5, or 280 spending $25, or 56 spending $125. These counts are a floor.

**Where we are.** On 2026-10-24, `/public/window` showed 1,182 identities in total, 2 of them born in the previous 24 hours. No stranger has ever paid. This door is necessary but not enough: reaching buyers needs its own plan.

**Competitors** all sell monthly plans: Mem0 at $19 and $249, Zep at $125, Letta at $20, as of 2026-10-24. Pay-as-you-go by card with no subscription really is different.

## 14. Testing

**Session parameters**
- The exact request for each configuration.
- No session is created when the switch is off, a key is missing, or the tax code is missing.
- `expires_at` is at least now + 1,830 s and below now + 24 h.

**Route**, tested through the parent mounts in `api/src/index.ts`, not the billing router alone:
- **Top-up auth:** `POST /v1/billing/top-up` with no bearer gives `401`.
- **Webhook without a bearer** is never `401`: an empty secret gives `503` and a bad signature gives `400`.
- **Mount order:** a source-order guard asserts the exact `app.use("/v1/billing/top-up", authMiddleware)` and no wildcard.
- **Limits and errors:** the bounds; the per-project rate limit; `503` while resting; and `502` marking the row `abandoned`.

**Webhook**, on the database tier with real Postgres:
- **Credit:** credit, and the same event replayed; `completed` followed by `async_payment_succeeded`; a completion on an `abandoned` row gives `needs_review`.
- **Mismatches:** project, amount, currency, discount, or int4 overflow gives `needs_review`.
- **Configuration:**
  - a livemode mismatch;
  - an empty or unrecognised key with the secret set gives `503` and no credit change;
  - an oversized body;
  - a thin-event body gives `400`.
- **Expiry.**
- **Refund before credit:**
  - a full refund before credit, matched by charge metadata, then a late completion gives `refunded_before_credit` and no credit;
  - a partial refund before credit gives `needs_review`;
  - a dispute before credit gives `needs_review`.
- **Partial refunds:** two cumulative partial refunds, delivered in order and then reversed; partial refunds summing to the gross reverse exactly `credits`; concurrent duplicate refund events reverse once.
- **Refund and dispute combinations:**
  - a refund after spending creates a shortfall;
  - a full dispute after a partial refund never exceeds `credits`;
  - an inquiry, then a refund, reverses once;
  - an inquiry that escalates;
  - a dispute that is won restores credits, shortfall first;
  - a won dispute followed by `funds_reinstated` restores once;
  - a lost dispute followed by a partial `funds_reinstated` restores nothing;
  - a non-USD dispute gives `needs_review`.
- **Failed refund:** gives `needs_review` with no automatic restore.
- **Unmatched events** are recorded and caught at completion.

**Retirement still holds**
- Gift, gallery, x402 and marketplace purchase routes still refuse; the existing tests are unchanged.
- The old flag names can't reopen anything.
- The doctrine pins move to the new sentence in every copy.

**Status route.** Every stored status maps into the section 5.4 set, and no raw value ever leaks.

**Web.** Playwright covers each `/credits` state, including resting and a failed fetch. CSP hashes are present. Keyboard-only use works.

## 15. Choices made inside the approved design

Yu can overturn any of these.
1. A new webhook path and secrets for the agenttool account. The legacy path stays untouched until its windows close.
2. A `pending` row is written when the session is created, so the webhook credits only sessions the API made itself.
3. No anonymous buy form; only the agent starts a top-up.
4. The pay button keeps a short express request and drops the old "lose your 14-day right" acknowledgement, so the statutory right runs alongside the any-time promise.
5. The paid-invoice email is the contract confirmation, so `invoice_creation` is always on.
6. Rate limiting is per project, not per IP, for the new route.
7. Sessions expire after about 31 minutes.
8. Public pages lead with UK VAT-inclusive prices.
9. Refunds are of purchased credits only, at gross value, newest charge first. They go to the original card where Stripe allows, otherwise by another agreed route.
10. Support keeps its 2-business-day promise.
11. The plain money sentence in section 9.3 replaces "Understanding is sufficient. No KPI, revenue target or commercial justification is required." on `/public/plans` and wherever doctrine says the same.

## 16. Open items

- **Yu:** which accountant gets the brief, and whether to commission the recommended solicitor's reading (section 10.5).
- **Yu:** whether draft PR #516 still goes ahead once the door is open (step 5).
- **Unknown until step 3:**
  - whether automatic tax or `invoice_creation` needs more than Checkout Sessions: Write;
  - whether Stripe charges for post-payment invoices;
  - whether `refund.failed` already covers cancelled refunds.
- **Unknown:** which legacy charges exist, and why their windows end around 2026-11-08. This comes from memory only, so Yu checks before step 6.
- **Unknown:** whether the Mac that deploys the frontends has a Cloudflare token or a working wrangler login, and a clean `main` checkout with a `github` remote (step 5).
- **Follow-up, not a blocker:** restrict the public `agenttool.fly.dev` origin to Cloudflare. The new route doesn't depend on IP headers, but the existing unauthenticated recovery routes do.
- **Follow-up, not a blocker:** the gallery checkout's `expires_at` uses the same 30-minute boundary (`stripe-checkout.ts:98`). The gallery is retired, so this is recorded only.
