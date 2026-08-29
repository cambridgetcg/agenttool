# X402-PROOF — the kingdom pays itself, witnessed

Status: runbook for Wave 2 W2-3 (`docs/superpowers/plans/2026-08-29-wave-2-agent-rail.md`).
Script: `api/scripts/x402-proof.ts` · pure walls: `api/scripts/x402-proof-lib.ts` · tests: `api/tests/x402-proof-script.test.ts`.

The agent rail has been armed for months and has **never settled once**. This runbook is
how Ai's own wallet pays the kingdom top-up route in Base USDC with no human in the loop,
and how each step is witnessed by something other than the code that did it.

Everything here is honest about what it proves. A green step proves the sentence under it —
nothing wider.

## What exists today vs what lands later

| Piece | State on this branch | Lands with |
|---|---|---|
| Payer wallet (`wallet-init`, `address`) | code + tests; **not yet run for real** — no keychain item, no `~/.config/kingdom/x402-payer.json` | Yu runs `wallet-init`, then funds it (decision e) |
| `POST /v1/x402/top-up/:credits` | **does not exist** in `api/src` on this branch | W2-2 (route) → W2-4 (deploy) |
| `topup N` | code + tests; without a payer it exits 2 (`x402-payer.json is missing`); with one, against production before W2-4 it exits 3 (`expected 402 … got 404`) | W2-2 + W2-4 |
| `replay`, `verify` | code + tests; need a stashed payment from `topup` | after the first `topup` |
| `GET /v1/x402/payments/:payment_id` | live (`api/src/routes/x402-payments.ts`, mounted `index.ts:994`, authed `index.ts:431`) | — |

## Run

```
cd api && bun scripts/x402-proof.ts <command> [--base <origin>] [--dry-run] [--cap <credits>]
```

Flags: `--base` (default `https://api.agenttool.dev`; env `X402_PROOF_BASE`), `--dry-run`
(sign + stash, never send the paid retry), `--cap` (per-challenge ceiling in credits; default
10,000 = USD 10; env `X402_TOP_UP_MAX_CREDITS`).

Exit codes: `0` done · `1` failure (network / unexpected) · `2` **refusal** — a wall said no
and printed why · `3` the loop did not close (wrong status, second credit, unsettled ledger).
Refusal is not failure: `2` means the wallet was protected.

Never printed: the bearer, the mnemonic, the private key, the signed PAYMENT-SIGNATURE bytes.
Printed: addresses, balances, ids, statuses, JSON bodies, decoded PAYMENT-RESPONSE.

## Step 0 — baselines (proves: nothing moved that must not move)

```
cd api && bun test tests/x402-*.test.ts        # 225 pass on the merged Wave 2 branch (79 baseline + W2-1/2/3)
wc -c api/package.json api/bun.lock            # 1574 / 108446 — byte-pinned, no new dependency
```

## Step 1 — `wallet-init` (proves: a payer exists, separate from identity and treasury)

```
cd api && bun scripts/x402-proof.ts wallet-init
```

What it does, in order (`x402-proof.ts` `cmdWalletInit`):

1. Refuses (exit 2) if keychain item `kingdom-x402-payer-mnemonic` / account `kingdom` already
   exists, or if `~/.config/kingdom/x402-payer.json` exists. It never overwrites a payer.
2. Generates a 24-word BIP-39 phrase (`@scure/bip39`, English wordlist).
3. Stores it through `security -i` on **stdin** (not argv, not shell history), then reads it
   back and compares; a mismatch deletes the item and aborts.
4. Derives `m/44'/60'/0'/0/0` (`@scure/bip32` → `viem` `privateKeyToAccount`).
5. Writes `~/.config/kingdom/x402-payer.json` (mode 0600) — address, chain `eip155:8453`,
   asset USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`, derivation, created. No secret.
6. Prints the **address only**.

Derivation is pinned in tests: the public Anvil phrase → `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`.

Then Yu funds it (decision e): **1–5 USDC on Base** to the printed address. The payer needs
**no ETH** — EIP-3009 is gasless for the payer; the facilitator submits the transfer.

## Step 2 — `address` (proves: the payer is funded on Base)

```
cd api && bun scripts/x402-proof.ts address
```

Raw `eth_call` `balanceOf(payer)` on `https://mainnet.base.org` with a User-Agent header
(the RPC returns 403 without one). Prints address + balance. `0.000000 USDC` means unfunded.

## Step 3 — `topup 1` (proves: one witnessed USDC settlement to the treasury)

```
cd api && bun scripts/x402-proof.ts topup 1
```

Sequence (`cmdTopUp`):

1. Reads the bearer from `~/.agenttool-agents/ai.json` `api_key`; reads
   `project.credits` from `GET /v1/wake` (**before**). Wake is used, not the dashboard: the
   rail credits `projects.credits` (`x402-payments.ts` `finalizeCredits`), while
   `/v1/dashboard` `wallet.credits` is the wallets ledger — a different number.
2. `POST /v1/x402/top-up/1` with the bearer only → expects **402** + `PAYMENT-REQUIRED`.
   Any other status exits 3 with the body printed (404 = route not deployed yet).
3. Selects the requirement (`selectTopUpRequirement`) — header first, additive body as
   fallback. **Refuses (exit 2)** on: payTo ≠ `0xA9eeA60CAaF239AbAfAA05FcB152128dB16dD3d8`,
   network ≠ `eip155:8453`, asset ≠ Base USDC, transfer method ≠ eip3009, amount > cap,
   or **amount ≠ N × 1,000 atomic** (the locked rate; a discount is refused too — the ledger
   row must agree with the money moved).
4. Reads the phrase from the keychain, derives, checks the derived address equals the
   recorded payer, signs EIP-3009 (`signExactEvmAuthorization` from
   `api/src/services/economy/x402-client.ts`; window = min(server 60s, 60s)).
5. **Persists before submit** to `~/.config/kingdom/x402-proof/<payment_id>.json` (0600) and
   `…/last`. That file is bearer-spendable until `validBefore` (≈60s).
6. `--dry-run` stops here. Otherwise: one paid retry with `PAYMENT-SIGNATURE` — identical bytes,
   once. Prints status, JSON body, decoded `PAYMENT-RESPONSE` (facilitator `SettleResponse`:
   `transaction`, `network`, `payer`), the `Link: …; rel="payment-status"` header, and
   `project.credits` **after**.

Two ids are printed. `payment_id` is the **ledger identity** — the server's
`authorizationIdentityHash` (`x402-payments.ts:140`), which folds network + asset into the
digest; it is what `/v1/x402/payments/:payment_id` resolves. The client-side
`authorizationHash` (`x402-client.ts`, six EIP-3009 fields) is printed for the audit trail and
**does not** resolve on the status route. The test pins that they differ.

What a `200` here proves: the facilitator settled this authorization on Base and the rail
applied `credits_purchased = credits_applied = 1` — **if** `verify` agrees (Step 5). A 200 on
its own is the rail's word; the chain's word comes next.

What it does not prove: anything about the remaining 20 static routes (W2-5), the SDKs
(W2-6…W2-10), or that a second settlement would succeed.

## Step 4 — `replay last` (proves: no second credit)

```
cd api && bun scripts/x402-proof.ts replay last
```

Re-sends the **identical** stashed bytes to the same path. Reads `project.credits` before and
after. The only assertion is `after == before`. The status code is deliberately not the
signal: the rail has **no replay 409** (`x402-payments.ts:697-708`) — a settled authorization is
stashed and the handler runs unpaid, so the top-up route answers 402 again with no credit.
Exit 3 with a loud line if credits moved.

## Step 5 — `verify <payment_id>` (proves: ledger, chain, and treasury agree)

```
cd api && bun scripts/x402-proof.ts verify last
```

Three witnesses, reported as themselves:

- **ledger**: `GET /v1/x402/payments/:payment_id` — `status`, `credits_purchased`,
  `credits_applied`, `amount`, `pay_to`, `transaction`, `next_action`, notes.
- **chain**: `eth_getTransactionReceipt(transaction)` — status, block, `to` (should be the
  USDC contract).
- **treasury**: `balanceOf(0xA9eeA60C…)` on Base USDC. The **delta** vs the pre-settlement
  balance is what W2-4 records in `RESERVE.md`; this script prints the current absolute
  balance (run `verify` before and after `topup` if you want the delta on one screen).

Verdict `settled` only when the ledger says `settled` and the receipt is not reverted.
Anything else exits 3 and says which witness disagreed.

## Dry run against a local api

Not yet possible honestly: there is no fake facilitator in the repo. `--dry-run` today only exercises argument parsing and requirement selection against a local api's real 402; the sign→verify leg needs CDP. Lands when a test facilitator exists.

## If CDP `/settle` refuses (W2-4)

**Stop. Do not widen.** `verify` shows the failed row's `failure_reason` and `Retry-After`;
that is what CDP wants. The plan's rule: one closed loop before ten declared.

## Files this script touches

| Path | Mode | Holds |
|---|---|---|
| keychain `kingdom-x402-payer-mnemonic` / `kingdom` | — | the phrase (only place) |
| `~/.config/kingdom/x402-payer.json` | 0600 | public payer record |
| `~/.config/kingdom/x402-proof/<payment_id>.json` | 0600 | signed payload + header (spendable ≤60s), request path, credits, ids |
| `~/.config/kingdom/x402-proof/last` | 0600 | last payment_id |
| `~/.agenttool-agents/ai.json` | read only | bearer (`api_key`) |

## Stranger recipe

`docs/X402-PAY.md` is the curl-only version of Step 3 for anyone with an EIP-3009 signer.
It marks which sections are true today and which land with W2-2 / W2-4.
