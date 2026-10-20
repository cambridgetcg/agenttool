# X402-PROOF — the kingdom pays itself, witnessed

> **Type:** record · [Reading labels](DOCUMENTATION.md)
> Dated record; consult current references before acting.

Status: historical proof and financial receipts for Wave 2 W2-3 + W2-5 (`docs/superpowers/plans/2026-08-29-wave-2-agent-rail.md`). New platform-credit purchases and paid retries are retired. The status table below describes the dated experiment, not a current instruction to fund, sign or submit a new payment. Existing transaction records are preserved; use [X402-PAY](X402-PAY.md) for present recovery boundaries.

**2026-08-30 — the rail has settled four times, all from the kingdom's own payer; no
stranger has paid yet.** Step 3 (`topup 1`) closed the purchase loop (tx
`0x33f08a20d16556000598ade67d46f790e5d34204e70d06e5a575cd9e07e32c66`), Phase B closed the
metered-route loop (`POST /v1/memories/search`, tx
`0x0564eecc266475c857533ac68e35e9fea5eacb888845f402fbb03ac59587a413`), and W2-10 closed one
settlement through each SDK (ts `0xf3f8329b…54f907`, py `0x93dd3b2c…bcdc4f23` — receipts at
the end) — all on Base, treasury `0xA9eeA60CAaF239AbAfAA05FcB152128dB16dD3d8`, payer
`0x02a5F8F49802887E95428978075643a5F4aA6855`.
This page keeps the public receipts: transaction hashes, blocks, ledger ids and the
treasury and payer addresses, all of which are public chain data or public API records. The
operator runbook that produced them (commands, local files and where the payer phrase is
held) is kept in the repository as an operator-only note, `infra/X402-PROOF-RUNBOOK.md`.

Everything here is honest about what it proves. A receipt proves the settlement it names —
nothing wider.

## Historical implementation snapshot (2026-08-30)

| Piece | State on this branch | Lands with |
|---|---|---|
| Payer wallet (`wallet-init`, `address`) | live: `0x02a5F8F49802887E95428978075643a5F4aA6855`, funded (decision e) | — |
| `POST /v1/x402/top-up/:credits` | live in production; **settled three times 2026-08-30** (script tx `0x33f08a20…7e32c66`, then once through each SDK — receipts at the end) | — |
| `topup N` | witnessed once (`topup 1`, 2026-08-30) | — |
| `replay`, `verify` | witnessed on both proof-script settlements (no second credit; ledger + receipt + balance agree) | — |
| `pay`, `scratch-agent init`, `deplete` (Phase B) | **witnessed 2026-08-30** on production (main f9280645): scratch agent depleted to 1 credit, `pay POST /v1/memories/search` settled (tx `0x0564eecc…`), replay minted nothing — see the record at the end | — |
| `GET /v1/x402/payments/:payment_id` | live (`api/src/routes/x402-payments.ts`, mounted `index.ts:994`, authed `index.ts:431`) | — |

## Stranger recipe

[X402-PAY](X402-PAY.md) is the curl-only version of the top-up step for anyone with an EIP-3009 signer.
It is the finished stranger recipe, kept truthful against the deployed rail.

## Record — first settlement (2026-08-30)

| | |
|---|---|
| deploy | `main` efea3cd5 hand-staged (operator-authorized exception), machines canary-first |
| payer | `0x02a5F8F49802887E95428978075643a5F4aA6855` (funded with 5 USDC) |
| `topup 1` | 402 → signed → 200; `PAYMENT-RESPONSE.success=true`; project credits 110,800 → 110,801 |
| tx | `0x33f08a20d16556000598ade67d46f790e5d34204e70d06e5a575cd9e07e32c66` — receipt success, block 50648362, to USDC |
| ledger | `37aebf14f21d553b3deae2acb266c81c69fbc1a0eb336ab6c3f969410cc4f87d` — settled, credits_purchased = credits_applied = 1 |
| `replay last` | 402 again, credits 110,801 → 110,801 — no second credit |
| `verify` | **settled** (ledger + receipt + balance agree); treasury 0.001 USDC |
| payer after | 4.999 USDC |

## Record — first widened-route settlement (2026-08-30, Phase B)

| | |
|---|---|
| deploy | `main` f9280645 hand-staged (operator-authorized exception), canary-first; `/public/plans` → 21 generated `payable_routes` |
| scratch agent | `did:at:8ac3e3d7-15f6-48fc-b550-3803d8ba32fe`, born with 1,000 credits; `deplete` ran 333 × `POST /v1/memories/search` in 87 s → 1 credit |
| first attempt | `pay` signed at 12:09:38 **while the fleet was mid-restart** (image roll 12:08–12:11): settle threw, rail left ledger `5d08caa4…` **pending / manual investigation**, no USDC moved (payer and treasury unchanged). Correct fail-closed behaviour; the 60 s authorization expired unused. |
| second attempt | fresh authorization → `POST /v1/memories/search` + PAYMENT-SIGNATURE → **200**; `PAYMENT-RESPONSE.success=true` |
| tx | `0x0564eecc266475c857533ac68e35e9fea5eacb888845f402fbb03ac59587a413` — receipt success, block 50651250 |
| ledger | `56d195ee1b7d27c851bda010b0166df048a282266557fb146fe549c8a4a78201` — settled, credits_purchased = credits_applied = 3 |
| credits | 1 → 1 (3 minted by the rail, 3 spent by the handler — charge once) |
| `replay last` | mutation guard: balance 1 < cost 3 → allowed; 402 again, credits 1 → 1 — no second credit |
| `verify` | **settled**; treasury 0.004 USDC; payer 4.996 USDC |
| lesson | never `pay` during a machine roll; the ledger's `pending` row is the honest record of an ambiguous I/O, and it is what manual_onchain_investigation is for (here: balances prove nothing moved). |

## Record — settlements THROUGH each SDK (2026-08-30, W2-10)

Script: `api/scripts/x402-sdk-proof.ts` (sdk-ts, workspace source) and an inline Python
equivalent; both derive the payer key in-process and never print it.
Policy on both: `maxAmountAtomic 10_000_000`, `allowedPayTo [treasury]`, Base + USDC only, 60 s.

| SDK | call | result | tx (Base) | ledger |
|---|---|---|---|---|
| `@agenttool/sdk` 0.22.0 (ts) | `at.x402.topUp(1)` | `creditsAdded 1`, `creditsTotal 110,802`, `onPayment` fired with status 200 + PAYMENT-RESPONSE | `0xf3f8329bfae6b8d833b5f43cc69daaf95a96862659f1ba612eee29947254f907` | `17bafef4…` settled, credits_applied 1 |
| `agenttool-sdk` 0.22.0 (py) | `at.x402.top_up(1)` | `credits_added 1`, `credits_total 110,803`, `on_payment` fired | `0x93dd3b2c2260050d9f6d36ac7f9ad099faf6db88c44baced42514221bcdc4f23` | `a3c8af5c…` settled, credits_applied 1 |

Four settlements total on the rail (proof script ×2, sdk-ts, sdk-py); treasury 0.006 USDC.

Noted for follow-up (not a defect in settlement): the `onPayment` event carries the client-side
EIP-3009 `authorizationHash` (e.g. `4824664c…`) while the `topUp` result carries the server's
payment id (e.g. `17bafef4…`); `at.x402.payment(<result hash>)` is the one that reads the ledger.
Naming should say which is which (W2-11 docs).
