# Wave 2 — the agent rail

Date: 2026-08-29. Authors: Yu + Ai. Status: proposed. Parent: `2026-08-29-sovereign-reserve-commercial.md`.
Grounding: 33-agent research pass over `origin/main` 23222628 (67 file:line findings, two independent designs, four judges, 22 adversarial refutations). Every estimate below is the refuters' corrected number, not the proposer's.

## Purpose (locked)
The card door lands money in a bank. The reserve exists for **sovereignty**: an agent with a Base USDC wallet pays the kingdom **with no human**, and the USDC lands in the treasury `0xA9eeA60CAaF239AbAfAA05FcB152128dB16dD3d8`. Today the rail is armed and has **never settled once**. Wave 2 closes exactly one loop, then widens against a facilitator that has been proven, then gives both SDKs the ability to pay.

Ordering principle (from both judge panels): **one closed loop before ten declared.**

## Truths the research established
- Auth is mounted before the global x402 middleware (`index.ts:314-500`); any new payable route needs an `app.use("/v1/<prefix>/*", authMiddleware)` above `:500` or the verifier sees no project (`x402-payments.ts:525-528`).
- The route→price policy is a 2-literal union (`x402-policy.ts:239`) with exact string matching (`:250-256`); the verifier binds price and path at `x402-payments.ts:560-603` and, for a known authorization, the stored resource path must equal `c.req.path` (`:483-490`).
- A challenge fires only when `credits < route cost` (`x402-policy.ts:279-290`). A top-up route must **bypass** this gate — it is a purchase, not a shortfall.
- **There is no replay 409.** A duplicate settled authorization is stashed and the handler runs unpaid (`x402-payments.ts:697-708`). Proof scripts must key on `getX402Payment(c)` and assert *no second credit*, not a status code.
- Hono 4.12 exposes the matched route pattern (`c.req.matchedRoutes` / `routePath`) inside global middleware — a `(method, pattern)` table with `:id` params is possible with zero new deps.
- `api/package.json` + `bun.lock` are byte-pinned (1574 / 108446 B) by the frozen refence contract. **No new API dependency.** `viem`, `@scure/*`, `@noble/*` already exist in `api/node_modules`.
- Scripts that import those must live under `api/scripts/` (`cd api && bun scripts/x.ts`); `bin/` cannot resolve them (empirically ENOENT).
- Two USDC rails disagree on price: x402 = 1,000 atomic/credit (USD 0.001, public on `/public/plans`) vs the dormant deposit rail `CREDITS_PER_USDC=100` (USD 0.01). Yu decides; x402's is the live, published one.
- No kingdom payer wallet exists; treasury holds 0 USDC. Every settlement needs a funded payer.
- SDK doctrine today: "does not sign or retry / never holds keys" (`sdk-ts/README.md:799-814`, `sdk-py:773-789`). Pay-on-402 is a documented doctrine change (opt-in, spend policy mandatory).
- SDK parity checker pins module names (`x402.ts` ↔ `x402.py`) and function-level parity; npm publish for `sdk` runs through the LOVE seal (`bin/npm-release.ts:201-206`), PyPI through a protected environment.

## Yu decisions (slots; none block code except (a))
| # | Decision | Default if silent |
|---|---|---|
| a | Canonical rate: keep **1 credit = 0.001 USDC** (x402, live) and retire the deposit rail's 0.01 | keep 0.001 |
| b | Top-up cap per challenge `X402_TOP_UP_MAX_CREDITS` | 10,000 (USD 10) |
| c | Finality wording on `/public/plans` + 402 body: top-ups are final, no refunds, unspent credits stay | as written |
| d | Meter the MCP door (`/v1/mcp`) in this wave? | **no** — WAKE-adjacent, later |
| e | Fund the payer wallet (Ai's, separate from identity + treasury) with **1–5 USDC on Base** | Yu sends |

## Phase A — close the loop (critical path ≈ 6–7 engineer-days + Yu gates)

**W2-1 · policy table + pure matcher (1.5 d)** — `api/src/services/economy/x402-policy.ts`, tests. Replace the union with `X402_PAYABLE_ROUTES: readonly { method, pattern, kind: 'route_cost' | 'top_up', credits: number | null, label }[]` and `matchX402PayableRoute(path, method)` (literal-over-param precedence, no trailing slash, method mismatch → null). Seed **only** scrape + document rows here; the top-up row lands with its route in W2-2 (the refuters caught the "row before route" contradiction). `x402ProjectCreditPolicy` takes the matched row; `canClearProjectCreditGate` becomes kind-aware (top_up: never gated by balance). Tests: `api/tests/x402-policy-table.test.ts` (resolution, precedence, `/v1/scrape/` → null, top-up N parsing incl. `/0 /abc /01 /1e9 /over-cap /2147483648` → null).

**W2-2 · wire + top-up route (2.5 d)** — `x402-config.ts` (`:69` policy lookup by matched pattern; `:121` structural gate → matcher), `x402-payments.ts` (`:524` gate → matcher; `:560-603` unchanged in shape, `creditsPurchased = N`), new `api/src/routes/x402-top-up.ts`: `POST /v1/x402/top-up/:credits` — authed, **always** returns `402 top_up_payment_required` with an additive body (guidance + PaymentRequired, spread order `{...guidance, ...paymentRequired}`, spec keys stripped from guidance) until a verified payment is stashed, then `200 { credits_added, credits_total, authorization_hash }`; replayed authorization → handler sees no `getX402Payment(c)` → 402 again, **no second credit**. Mount `app.use("/v1/x402/top-up/*", authMiddleware)` beside `index.ts:431`. Disclose on `/public/plans` (`then_pay_as_you_go.top_up`), `openapi.ts`, `/.well-known` catalogs. Tests: x402-config (402 + PAYMENT-REQUIRED with `amount: "1000"` for N=1 at credits 110,800), x402-payments (settle → credits +N; replay → no credit), x402-middleware (body merge, no key leakage), openapi.

**W2-3 · proof script + payer wallet (1 d)** — `api/scripts/x402-proof.ts` (`cd api && bun scripts/x402-proof.ts <cmd>`), `docs/X402-PROOF.md`. Subcommands: `wallet-init` (new BIP39 phrase → keychain `kingdom-x402-payer-mnemonic`, account `kingdom`; derive `m/44'/60'/0'/0/0`; print address only), `topup N` (bearer from `~/.agenttool-agents/ai.json`; 402 → sign EIP-3009 with the api's existing `x402-client.ts` → retry → print ledger row + tx), `replay <hash>` (asserts no second credit), `verify <hash>` (`GET /v1/x402/payments/:hash` + Base `balanceOf(treasury)` delta + tx receipt). Dry run against a local api with a fake facilitator proves the wire path without CDP.

**W2-4 · Yu gates → deploy → FIRST settlement (1.5 d + gates)** — decisions (a)–(e) recorded; deploy by the proven hand recipe (stage → `fly deploy --build-only --push` → `fly machine update` canary-first) or the readmission ceremony if Yu runs it; Yu funds the payer (e); run `topup 1` → **first witnessed USDC settlement to the treasury** (1,000 atomic = USD 0.001); `replay` → no second credit; `verify` agrees; `kingdom/bin/reserve` shows treasury > 0; `RESERVE.md` first-settlement line; localnet `MsgDeclare` (manual — no code hook exists); LAUNCH-KIT do_not_claim relaxed to *"one witnessed settlement on Base"*. **If CDP `/settle` refuses here: STOP and diagnose before widening** — the failed row and `Retry-After` say what CDP wants.

## Phase B — widen against a proven facilitator (≈ 4–5 d)

**W2-5 · all 21 static-priced routes** — `api/src/billing/route-credits.ts` (hoisted price constants, labels = the exact `charge()` reason strings), 19 new rows (memory search/elevate/attest, traces write/search/chain, strands create/think/rotate, inbox send/co-sign, templates create/purchase/adopt, orgs create, identity fork, listings publish/update/archive), every row proven present in `app.routes` (declared≠wired test), truth surfaces **generated from the table** (`/public/plans`, OpenAPI — ~10× the doc work the proposer assumed, 4 rows have no OpenAPI path item today), then one live witnessed settlement via deplete + `/v1/memories/search` (3 credits). `execute` excluded (body-derived price); `browse` excluded (prod flag off).

## Phase C — SDKs pay on 402 (≈ 9–11 d, two agents in parallel after W2-4)

**W2-6 · sdk-ts protocol + signer (2.5 d)** — `packages/sdk-ts/src/x402.ts`: port `api/src/services/economy/x402-client.ts` function-for-function (same 8 exported names, refusal union incl. `amount_over_cap` — refused, never clamped) on the already-installed `@noble/curves` 2.2.0 + `@noble/hashes` (noble r‖s‖v is byte-identical to viem — reproduced); server-generated EIP-3009 vector fixture; parity debt recorded honestly (`parity-checker.test.ts:148-151` pins ts-only functions — the py twin must land in the same release).
**W2-7 · sdk-ts paying transport (3–4 d)** — `_x402-transport.ts` (internal, underscore keeps the parity scanner off it), `x402` client option `{ signer, policy: { maxAmountAtomic, allowedPayTo, allowedNetworks, allowedAssets, maxValiditySeconds }, onPayment }` — **spend cap and payTo allow-list mandatory, no defaults**; optional env fallback only when the option is present; exactly-two-fetch semantics; README doctrine rewrite ("can sign and pay on 402, opt-in, never by default").
**W2-8 · sdk-py protocol + signer (3 d)** — `packages/sdk-py/src/agenttool/x402.py` (module name pinned by `target('x402','X402Client')`): pure-Python keccak-f[1600] + EIP-712 encoder + recoverable low-s ECDSA on the existing `cryptography` dep (spike reproduced viem's digest and recovered the payer) — zero new deps; keccak KATs; digest + recovered-address pinned (not signature bytes).
**W2-9 · sdk-py paying transport + parity + lockstep 0.22.0 (2 d)** — `_x402_transport.py`, `x402=` option mirroring W2-7, `httpx.MockTransport` tests, `check-parity` green, both packages bump to 0.22.0 in ONE PR.
**W2-10 · settlements through each SDK + stranger recipe (1.5 d)** — `topup 1` via sdk-ts and via sdk-py (same payer, distinct txs, treasury +2,000 atomic); `docs/X402-PAY.md` = curl-only recipe a stranger can follow with any EIP-3009 signer; only now do the SDK READMEs claim it.
**W2-11 · publish 0.22.0 (1 d + two Yu approvals)** — LOVE seal for `@agenttool/sdk` (`bin/npm-release.ts:201-206`), PyPI protected environment approval, `docs/NPM-RELEASES.md` + `PYPI-RELEASES.md` receipts (the ledger is already one release behind — fix in the same PR).

## Proof (the whole wave, in order)
1. Baselines green: `cd api && bun test tests/x402-*.test.ts` (79 today); `wc -c api/package.json api/bun.lock` → 1574 / 108446 unchanged; refence bridge test green.
2. Bare challenge: `curl -si -X POST -H "Authorization: Bearer $AI" https://api.agenttool.dev/v1/x402/top-up/1` → 402, `PAYMENT-REQUIRED` decodes to `accepts[0] = { scheme: exact, network: eip155:8453, asset: USDC, amount: "1000", payTo: treasury, maxTimeoutSeconds: 60 }`.
3. `topup 1` → 200, `economy.x402_payments` row `credits_purchased = credits_applied = 1`, `tx_hash` on Base, treasury `balanceOf` +1000.
4. `replay` → no second credit. `verify` → receipt + balance agree.
5. Widened route settles once (W2-5). Each SDK settles once (W2-10).
6. Reserve ledger, `MsgDeclare`, LAUNCH-KIT relaxations — each only after the matching step lands.

## Risks (kept)
First-ever CDP `/settle` on Base mainnet (readiness today is a local JWT parse). Rate ambiguity (a). Prepaid balance is a new economic shape — cap + finality wording. The 402 body merge touches the one place every challenge is finalised — key-collision test. Matcher/Hono drift — `app.routes` parity test. SDK doctrine change — explicit, opt-in, mandatory spend policy.

## Exit
Wave 2 is done when a **stranger** could pay the kingdom in USDC with nothing from us but `docs/X402-PAY.md` — and we have witnessed our own wallet do it three ways (script, sdk-ts, sdk-py).
