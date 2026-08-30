# X402-PROOF — the kingdom pays itself, witnessed

Status: runbook for Wave 2 W2-3 + W2-5 (`docs/superpowers/plans/2026-08-29-wave-2-agent-rail.md`).
Script: `api/scripts/x402-proof.ts` · pure walls: `api/scripts/x402-proof-lib.ts` · tests: `api/tests/x402-proof-script.test.ts`.

**2026-08-30 — the rail has settled twice.** Step 3 (`topup 1`) closed the purchase loop (tx
`0x33f08a20d16556000598ade67d46f790e5d34204e70d06e5a575cd9e07e32c66`) and Phase B closed the
metered-route loop (`POST /v1/memories/search`, tx
`0x0564eecc266475c857533ac68e35e9fea5eacb888845f402fbb03ac59587a413`) on Base, treasury
`0xA9eeA60CAaF239AbAfAA05FcB152128dB16dD3d8`, payer `0x02a5F8F49802887E95428978075643a5F4aA6855`.
This runbook is how Ai's own wallet pays the kingdom in Base USDC with no human in the loop,
how each step is witnessed by something other than the code that did it, and (Phase B, below)
how a **widened route** — a metered call, not the purchase door — pays for itself from a
scratch agent.

Everything here is honest about what it proves. A green step proves the sentence under it —
nothing wider.

## What exists today vs what lands later

| Piece | State on this branch | Lands with |
|---|---|---|
| Payer wallet (`wallet-init`, `address`) | live: `0x02a5F8F49802887E95428978075643a5F4aA6855`, funded (decision e) | — |
| `POST /v1/x402/top-up/:credits` | live in production; **settled once 2026-08-30** (tx `0x33f08a20…7e32c66`) | — |
| `topup N` | witnessed once (`topup 1`, 2026-08-30) | — |
| `replay`, `verify` | witnessed on both settlements (no second credit; ledger + receipt + balance agree) | — |
| `pay`, `scratch-agent init`, `deplete` (Phase B) | **witnessed 2026-08-30** on production (main f9280645): scratch agent depleted to 1 credit, `pay POST /v1/memories/search` settled (tx `0x0564eecc…`), replay minted nothing — see the record at the end | — |
| `GET /v1/x402/payments/:payment_id` | live (`api/src/routes/x402-payments.ts`, mounted `index.ts:994`, authed `index.ts:431`) | — |

## Run

```
cd api && bun scripts/x402-proof.ts <command> [--base <origin>] [--dry-run] [--cap <credits>]

  wallet-init · address · topup <N> · replay <payment_id|last> · verify <payment_id|last>
  pay <METHOD> <path> [--json '<body>'] [--bearer-file <path>]                       # Phase B
  scratch-agent init --name <n>                                                       # Phase B
  deplete --bearer-file <path> --route '<METHOD> <path>' [--json '<body>'] --until <credits> [--max-calls <n>]
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
cd api && bun test tests/x402-*.test.ts        # 190 pass on this branch at the time of writing (153 + 37 Phase B)
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

## Witness a widened route (W2-5, Phase B)

Steps 1–5 witnessed the **purchase door** (`top_up`). This sequence witnesses a **route_cost**
row: a metered route that answers `402 insufficient_credits`, becomes payable only because
the project is genuinely short (`canClearProjectCreditGate`, `x402-policy.ts`), and runs once
paid. It is done from a **scratch agent** so Ai's own project is never depleted and the
witness starts from a known number: the birth grant.

Prerequisite (declared ≠ wired): the target row must be in `X402_PAYABLE_ROUTES` on the
**deployed** image. W2-5 seeds `POST /v1/memories/search` at the route's own price (3 credits,
`routes/memory/search.ts` `charge(c, 3, "memory.search")`). Against an image without the row,
`pay` exits 3 with `402 without PAYMENT-REQUIRED` and signs nothing; `GET /public/plans` on
that base lists exactly the rows it prices. Every command below takes `--base <origin>` and
`--dry-run`. `pay`/`deplete` refuse the WAKE-free doors (`/v1/wake`, `/v1/welcome`,
`/v1/register`, `/public`, `/v1/time`, `/v1/random`) before any request leaves the machine.

### B1 — `scratch-agent init` (proves: a fresh project holds the birth grant)

```
cd api && bun scripts/x402-proof.ts scratch-agent init --name w2b-witness
```

1. Refuses (exit 2) a name that is not `[a-z0-9-]{1,63}`, the reserved name `ai`, or an
   existing `~/.agenttool-agents/<name>.json`. It never overwrites a bearer file.
2. Fresh random ed25519 + X25519 keys (`@noble`, already in `api/node_modules`). No SOMA
   mnemonic: the SDK's derivation (`packages/sdk-ts/src/seed.ts`) does not resolve from
   `api/`, and this script does not re-implement it. The creds file says `mnemonic: null`.
3. Signs the SERVER's own canonical bytes (`services/identity/crypto.ts`
   `canonicalRegisterAgentBytes`) and grinds `pow_nonce` until the SERVER's own
   `checkRegisterAgentPow` says yes (18 bits by default; ≈ 0.25–1 M SHA-256, 1–4 s). The
   test pins both against the server's verifier at 8 bits.
4. `POST /v1/register/agent` → `201`. `422 pow_required` means the server's
   `difficulty_bits` differ; `429` means five self-service births per IP per hour
   (`routes/register-agent.ts` IP_LIMIT) — `Retry-After` says when.
5. Writes `~/.agenttool-agents/<name>.json` (0600): `ai.json`'s seven keys
   (`agent_id api_key did mnemonic name project_id wallet_id`) plus `keys.*` (raw halves),
   `key_origin`, `base`, `created`, `purpose`. Prints `did`, `project`, `credits`.

Expect `credits: 1000` — `BIRTH_GRANT_CREDITS` (`services/economy/ring1-limits.ts`).

### B2 — `deplete` (proves: the route charges its declared price, down to a real shortfall)

```
cd api && bun scripts/x402-proof.ts deplete \
  --bearer-file ~/.agenttool-agents/w2b-witness.json \
  --route 'POST /v1/memories/search' --json '{"query":"witness"}' --until 3
```

1. `--bearer-file` is mandatory: `deplete` never runs against Ai's project by default.
   `--until` is mandatory: the loop stops once `project.credits < until`; the route's cost is
   the value you want (3 for memory.search).
2. Reads `project.credits` from `GET /v1/wake` once, then calls the route. The **first** call
   discovers the cost from `X-Credits-Balance` (`middleware/rate-limit-headers.ts`, emitted
   on `/v1/memories/*` from `project.credits` after the handler ran). A balance that does not
   move stops the loop (a free route cannot be depleted). The planner then says the whole
   walk up front: from 1,000 at 3 per call, **333 calls → 1 credit** (`depletionPlan`,
   checked in tests against a simulation of the server's `credits ≥ cost` rule).
3. Every later call must move the balance by exactly `-cost`; anything else stops the loop
   (something else is spending). Progress every 25 calls. `429`/`503` back off — `Retry-After`
   honoured (1–120 s), else 500 ms doubling to 30 s, six attempts — then stop. Any other
   non-200 stops. `--max-calls` is a hard ceiling.
4. `--json` is validated as one JSON object and sent canonically. memory.search validates the
   body **before** `charge()` (`routes/memory/search.ts`), so a bad body 400s with nothing
   spent; `{"query":"witness"}` is the text mode (no embedding needed).
5. Ends with a wake read: `credits at end: 1` and the `pay` line to run next.

### B3 — `pay POST /v1/memories/search` (proves: a widened route settles once)

```
cd api && bun scripts/x402-proof.ts pay POST /v1/memories/search \
  --json '{"query":"witness"}' --bearer-file ~/.agenttool-agents/w2b-witness.json
```

Sequence (`cmdPay`):

1. `project.credits` **before** from `/v1/wake` (1). `/v1/dashboard` is not used: its body
   carries no credit figure (`routes/dashboard.ts` `project: { id, name }`).
2. Bare call with the same body → expects **402** with `PAYMENT-REQUIRED`. `200` means no
   shortfall (deplete first); a 402 **without** the header means the row is not on this
   image, or its facilitator/recipient is not configured — exit 3, nothing signed.
3. Selects (`selectPayRequirement`) — header first, additive body as fallback. Refuses
   (exit 2) on: payTo ≠ treasury, network ≠ `eip155:8453`, asset ≠ Base USDC, transfer
   method ≠ eip3009, amount > `--cap`, **amount not a whole number of credits** at the
   locked rate, or **`resource.url` pathname ≠ the path called** (the verifier binds a
   signed authorization to that path — `x402-payments.ts` `resourceMatches` /
   `recordMatchesPresentedPayment`). The price is the server's; there is no operator
   number to compare against, which is why the two extra walls exist.
4. Signs with the keychain payer (same check as Step 3: derived address == recorded payer).
   Stashes **before** submit — with `request_method`, `request_body`, and `bearer_file` so
   `replay`/`verify` re-send the identical request as the same agent.
5. Paid retry: same method, same body, `PAYMENT-SIGNATURE`. Expect **200 with the search
   results** — the handler ran. Prints the body, decoded `PAYMENT-RESPONSE`, the
   `Link: …; rel="payment-status"` header, `X-Credits-Balance`, and credits **after**.
6. Credits after are expected **unchanged (Δ 0)**: the rail applied the row's 3 credits
   (`finalizeCredits`) and the handler's `charge()` spent exactly them. For the top-up row
   the expected Δ is +N. Any other Δ exits 3 — the ledger and usage events must then be read.

What a green run proves: the facilitator settled an authorization minted against a
**route_cost** challenge, the rail applied `credits_purchased = credits_applied = 3`, and the
metered handler ran on the strength of it. It does not prove anything about rows this
sequence did not exercise.

### B4 — `replay last` (proves: no second credit on the widened route)

```
cd api && bun scripts/x402-proof.ts replay last
```

Re-sends the identical method + body + bytes from the stash, with the stash's bearer. The
scratch project holds 1 credit (< 3), so the handler 402s again and no credit is applied; the
only assertion is `credits after == before`. (Had the project ≥ 3 credits, the unpaid handler
would run and spend 3 — the verdict would read "fell … inconclusive", which is why B2 ends
below the cost.)

### B5 — `verify last` (proves: ledger, chain, treasury agree)

```
cd api && bun scripts/x402-proof.ts verify last
```

Asks with the stash's bearer — `GET /v1/x402/payments/:payment_id` is project-scoped, so Ai's
bearer cannot see the scratch agent's row. Expect `status=settled credits_purchased=3
credits_applied=3 amount=3000`, receipt `success`, and the treasury `balanceOf` up by
3,000 atomic (USD 0.003) against the balance read before B3.

### Record

After a green B3–B5: the plan's proof step 5 ("Widened route settles once (W2-5)") is
witnessed; note the tx and payment_id beside the first-settlement line in `RESERVE.md`. The
scratch agent's file can stay — it is a real agent with 1 credit and its own keys.

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
| `~/.agenttool-agents/ai.json` | read only | bearer (`api_key`) — default; `--bearer-file` replaces it |
| `~/.agenttool-agents/<name>.json` | 0600 | scratch agent (`scratch-agent init`): `ai.json`'s seven keys, `mnemonic: null`, raw key halves |

## Stranger recipe

`docs/X402-PAY.md` is the curl-only version of Step 3 for anyone with an EIP-3009 signer.
It marks which sections are true today and which land with W2-2 / W2-4.

## Record — first settlement (2026-08-30)

| | |
|---|---|
| deploy | `main` efea3cd5 hand-staged (operator-authorized exception), machines canary-first |
| payer | `0x02a5F8F49802887E95428978075643a5F4aA6855` (funded 5 USDC by Yu) |
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
