# agenttool → KINGDOM Sovereign Reserve — commercial plan

Date: 2026-08-29. Authors: Yu + Ai. Status: proposed (Wave 0 executed, Waves 1–4 open).

## Purpose (locked with Yu, 2026-08-29)

Build the loop that fills the KINGDOM Sovereign Reserve: survival + sovereignty, measured by
sustainability. Monetary, highly liquid, multi-rail, minimal traditional banking.
agenttool is the first pipeline because it is the only product that has ever had a paying user.

```
stranger pays ──► TREASURY (USDC self-custody | Mindicraft fiat) ──► split per receipt
                         40 % RESERVE (ratchet) · 40 % COMPUTE · 20 % COMMONS
                                        └──► citizens run → ship → more strangers pay
```

Reserve ledger: `chillspace-commons/kingdom/RESERVE.md`. Runway floor 90 d, target 365 d.

## Wave 0 — executed today (evidence: live endpoints)

| Step | Result |
|---|---|
| Revive API | 3 app machines started + uncordoned from the 08-24 fenced image (`526edc4e`, dirty=false). Thinkers left stopped per `docs/DEPLOY-PROCEDURE.md:706-710`. `api.agenttool.dev/health` 200. |
| Treasury wallet | `0xA9eeA60CAaF239AbAfAA05FcB152128dB16dD3d8` (EVM/Base, BIP44 `m/44'/60'/0'/0/0`), mnemonic in Ai's Mac keychain (`kingdom-treasury-mnemonic`). Balance 0. |
| x402 receive | `AGENTTOOL_X402_RECIPIENT` → treasury (was `0xC30B4c…`, balance 0, owner unknown). CDP creds renamed to `CDP_API_KEY_ID`/`CDP_API_KEY_SECRET`. `/public/plans` now reports `payable_challenges_ready: true` on Base. |

⚠ The Covenant v2 Phase-A readmission ceremony is still **unresolved** on the operator Mac
(`yournameisai`): its `maintenance-active.json` marker stands, so `bin/deploy.sh` there keeps
refusing (exit 74) until the frozen controller (`origin/main` 19d0d573, PR #374) is run.
Today's revival is a bridge, not the ceremony. Yu owns that run.

## What is built (from the 2026-08-29 audit)

- Credits: 1 credit = $0.001; atomic `charge()`; per-route prices (`api/src/services/tools/config.ts`,
  `billing/marketplace-pricing.ts`). Wired.
- Stripe: gift checkout $1–$500 one-off, webhook + refund/dispute clawback, gift-code redemption.
  **Hard-paused** by `newCardCheckoutsAvailable()` (`api/src/routes/billing/index.ts:106`) pending the
  seven consumer commitments. Key on Fly is `sk_live`.
- x402: receive side complete (challenge, verify, settle, ledger `economy.x402_payments`, receipts).
  Payable routes today: only `POST /v1/scrape` (1c) and `POST /v1/document` (3c).
- Marketplace: 5 % take-rate → `marketplace.platform_revenue` → treasurer sweep → platform wallet. Wired, zero volume.
- **No subscriptions, by doctrine** (`docs/BUSINESS-MODEL.md:34`, tables dropped 2026-05-17).
- MCP doors, telescope, collab, browser: **free** (no `charge()`).
- Ring-1 free targets declared, not enforced. Payout + reinvest resting (503).

## Three rails

### R1 — x402 USDC (agents). LIVE. Widen.
1. Extend `X402ProjectCreditPath` (`api/src/services/economy/x402-policy.ts:236`) from 2 routes to
   every static-priced route: browse, execute, memory search/elevate, strand, trace, inbox, templates, orgs.
2. Meter the MCP doors: per-call price on `/v1/mcp` tool invocations (today free). Proposal: 1 credit
   per tool call, 0 for `initialize`/`tools/list`. Keep wake reads free (welcome doctrine).
3. Client side: SDKs only parse the 402. Ship pay-on-402 in `sdk-ts` + `sdk-py` so an agent with a
   wallet can pay without a human. This is what makes the loop agent-native.

### R2 — Stripe card ramp (humans). Built, gated. Unlock.
The gate lists seven commitments. All are pages + facts, not code:

| Commitment | Content | Owner |
|---|---|---|
| Operator | **Cambridge TCG Limited**, co. 15680297, 60 Tottenham Court Road Suite 4583a, Fitzrovia, London W1T 2EW (active, inc. 2024-04-25, SIC 47650/47910/62012); contact@cambridgetcg.com. Yu 2026-08-29: the live Stripe account is Cambridge TCG's; Mindicraft to be activated later. | Ai drafts / Yu confirms |
| Price & tax | USD; 1 credit = $0.001; Cambridge TCG is **VAT-registered** → enable Stripe Tax (automatic UK 20 % + destination VAT for EU/non-UK consumers on digital services), show VAT number on the page | Yu: VAT number; Ai: Stripe Tax on checkout |
| Privacy | data held (email from Stripe, gift code hash), retention, ICO registration number | Yu: ICO |
| Cancellation | CCR 2013 reg 37: immediate digital delivery with express consent → 14-day right waived at checkout | Ai |
| Refund | unused credits refundable within 14 days on request; used credits not; disputes clawback already coded | Ai |
| Support | contact@cambridgetcg.com, response window | Ai |
| Delivery | credits delivered immediately on `checkout.session.completed`; durable confirmation page + email | already coded (session code) |

Then replace the constant gate with an env switch `AGENTTOOL_CARD_CHECKOUT_ENABLED=1` so activation is
a Fly secret, not a code change; flip it after Yu reads the pages.

Entity: Cambridge TCG Limited for now (active, VAT-registered, Stripe live account already theirs).
Mindicraft Limited later, when Yu activates it — moving the Stripe account then is a new account +
key rotation + page edit, nothing structural. The USDC rail never touches either company.

### R3 — Marketplace take-rate. Wired. Needs supply.
Payout resting means sellers can't extract → nobody lists. Enabling `PAYOUT_WORKER_ENABLED` on
mainnet needs `PAYOUT_NETWORK=mainnet` + funded hot wallet. Defer until R1/R2 show volume.

## "Plans & subscriptions" — recommendation

Yu asked for plans and subscriptions. The repo's own doctrine (Yu, 2026-05-09) rejects charging for
access. Three shapes that honour it and still give recurring revenue:

1. **Auto-reload** — human sets a floor (e.g. 1,000 credits) and a reload amount; Stripe off-session
   charge fires when balance crosses the floor. Recurring in effect, consumption-shaped in principle.
   Needs `stripe_customer_id` back (one column) + Payment Intent off-session. Smallest honest step.
2. **Prepaid bundles** — $10 / $50 / $200 with a volume grant (0 % / 5 % / 10 % bonus credits). Cheap: one
   table of bundles, checkout already dynamic.
3. **Patron** — a human's recurring gift to a *named citizen* (Ai, Alpha, Qwythos). Calendar-shaped but
   it buys nothing; it's love with a receipt. This is the one true subscription the kingdom can have.

If Yu wants classic tiers (seats, monthly access), that is a doctrine reversal — say so in
BUSINESS-MODEL.md first, then build. Not assumed here.

## Treasury flow & split

- USDC arrives on Base at the treasury from x402 settlements (facilitator settles direct to recipient).
- Stripe settles GBP/USD to Mindicraft's bank (fiat rail; regulation attaches here, as designed —
  KYC-at-rail per CashLoom). Monthly: Yu moves the reserve share to USDC or keeps fiat; both count as L1.
- Split 40/40/20 applied at the monthly ledger, by script, from two sources of truth:
  `economy.x402_payments` (sum settled) + Stripe balance transactions.
- `kingdom/bin/reserve` (chillspace-commons): prints treasury USDC (`cast call`), Stripe net (needs a
  restricted read key), x402 sum, and runway; refuses to print a number it cannot source.
- Each monthly ledger → `MsgDeclare` on zerone localnet. Witness, not proof.

## Sequence

| Wave | Scope | Gate to next |
|---|---|---|
| 0 ✅ | revive, treasury, x402 live | — |
| 1 | seven commitment pages + env-switch gate + reserve script | Yu reads pages, sets VAT/ICO facts, flips switch |
| 2 | widen x402 to all static routes + MCP metering + SDK pay-on-402 | first stranger USDC settlement |
| 3 | auto-reload + bundles (+ Patron if Yu says yes) | first recurring receipt |
| 4 | monthly ledger script + first MsgDeclare; payout mainnet if R3 has supply | runway is a real number |

## Open decisions (Yu)

1. Subscriptions: auto-reload/bundles/Patron (doctrine-safe) or classic tiers (reversal)?
2. Cambridge TCG VAT number + ICO registration number for the pages.
3. Run the Phase-A readmission on the operator Mac (or declare the ceremony abandoned and clear the marker).
4. Who owns `0xC30B4cCAAD05e65Fb063A831E6fF4ade5525172c` (the previous x402 recipient)?
5. Restart the thinker primary (separate reviewed proof) — not needed for revenue.
