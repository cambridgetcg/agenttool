# X402-PAY — pay the kingdom in USDC, with nothing from us but this page

Status: **live** (Wave 2, updated 2026-09-01). The rail has settled **four times** on Base
mainnet, all to the kingdom treasury `0xA9eeA60CAaF239AbAfAA05FcB152128dB16dD3d8`: first a
`topup 1` on 2026-08-30 (tx
`0x33f08a20d16556000598ade67d46f790e5d34204e70d06e5a575cd9e07e32c66`), then a metered route
paying for itself and one settlement through each SDK. The witnessed history — receipts,
ledger ids, treasury balances, and what each green step proves — is
[`X402-PROOF.md`](X402-PROOF.md). This page is the other half of that promise: **a stranger
with Base USDC and an EIP-3009-capable signer can pay the kingdom with nothing from us but
this page.** Three paths: the SDK (recommended), raw curl + any signer, or the in-repo proof
script.

Constants, each verified against live `GET https://api.agenttool.dev/public/plans`
(`then_pay_as_you_go.top_up`, read 2026-09-01):

- Route: **`POST /v1/x402/top-up/{credits}`** — exactly as plans and the OpenAPI name it.
- Rate: **1 credit = 0.001 USDC** (1,000 USDC atomic units = USD 0.001), on Base
  (`eip155:8453`).
- Cap: **10,000 credits (USD 10.000) per challenge.** Anything above (or any non-canonical
  amount) is `400 top_up_invalid_credits` — refused, never clamped; a larger purchase is
  several requests.
- Finality: *"Top-ups are final. No refunds. Unspent credits stay with the project."*
  `subscriptions: false` — you pay per challenge, once.
- The door is **never balance-bound** (`never_balance_bound: true`): a funded project may
  still top up. It is a purchase, not a shortfall.

## 0. What you need first — a bearer, and the birth grant

Registration is free and anonymous but not curl-only: `POST /v1/register/agent` takes your
own Ed25519/X25519 public keys, a key proof, and an 18-bit proof-of-work
(`/public/plans` → `no_exploit_loophole.pow_difficulty_bits`). Use either SDK
(`@agenttool/sdk`, `agenttool-sdk`) or follow [`AGENT-CENTRIC.md`](AGENT-CENTRIC.md). From
here on, `$BEARER` is that project's API key.

Every project is **born with 1,000 credits (USD 1.00)** plus a best-effort GBP 5.00 wallet
grant (`free_at_birth`; the wallet grant carries `guarantee: false`). So a stranger tops up
only **after** spending the birth grant — or before, deliberately; the door never checks.
`GET /v1/wake` and everything under `/public/*` are unmetered, free forever; wake is where
your balance lives:

```
curl -s https://api.agenttool.dev/v1/wake -H "Authorization: Bearer $BEARER" | jq .project
```

## Path A — the SDK pays for you (recommended)

Both SDKs at **0.22.0** (npm `latest` and PyPI, published 2026-08-31; `/v1/pathways`
advertises the same version) carry an opt-in x402 payer, and both have **settled on this
rail** — the receipts are in [`X402-PROOF.md`](X402-PROOF.md) § "settlements THROUGH each
SDK". The contract, identical in both languages:

- **Never by default.** Without the `x402` option the SDK never signs, never retries, never
  reads a key — a 402 surfaces as a typed error carrying the exact terms.
- **The spend policy is mandatory, with no defaults for the money fields.** A hard
  per-payment cap (`maxAmountAtomic` / `max_amount_atomic`) and a recipient allow-list
  (`allowedPayTo` / `allowed_pay_to`) or construction refuses
  (`x402_spend_policy_invalid`). Allow-lists, never deny-lists: a 402 body is untrusted
  input and cannot introduce a new recipient, asset, or network. Over-cap is refused
  (`amount_over_cap`), **never clamped**.
- **Exactly one signed retry.** Bare request → 402 with `PAYMENT-REQUIRED` → one signed
  retry of the same request (same method, body, bearer, `Idempotency-Key`) plus
  `PAYMENT-SIGNATURE`. A second 402 is `x402_payment_not_accepted`, never a loop; the SDK
  never signs twice for one request.

TypeScript (`npm install --save-exact @agenttool/sdk@0.22.0`):

```typescript
import {
  AgentTool,
  AGENTTOOL_TREASURY,
  X402_ATOMIC_PER_CREDIT,
  X402_BASE_NETWORK,
  X402_BASE_USDC,
  localEvmSigner,
} from "@agenttool/sdk";

const at = new AgentTool({
  apiKey: process.env.AT_API_KEY,
  x402: {
    signer: localEvmSigner(process.env.PAYER_PRIVATE_KEY!),
    policy: {
      maxAmountAtomic: 10n * X402_ATOMIC_PER_CREDIT, // hard cap per payment — MANDATORY
      allowedPayTo: [AGENTTOOL_TREASURY],            // recipients — MANDATORY
      allowedNetworks: [X402_BASE_NETWORK],          // eip155:8453
      allowedAssets: [X402_BASE_USDC],               // Circle USDC on Base
      maxValiditySeconds: 60,                        // narrowest usable window
    },
  },
});

// POST /v1/x402/top-up/1 → 402 challenge → ONE signed retry → 200 receipt
const receipt = await at.x402.topUp(1);
receipt.creditsAdded;                              // 1
receipt.creditsTotal;                              // balance after
await at.x402.payment(receipt.authorizationHash!); // the server's ledger row
```

Python (`pip install "agenttool-sdk==0.22.0"`):

```python
import os

from agenttool import AgentTool, KINGDOM_TREASURY, X402Payer, X402SpendPolicy, local_evm_signer

at = AgentTool(
    api_key=os.environ["AT_API_KEY"],
    x402=X402Payer(
        signer=local_evm_signer(os.environ["PAYER_PRIVATE_KEY"]),
        policy=X402SpendPolicy(
            max_amount_atomic=10_000,          # 10 credits' worth — hard cap, MANDATORY
            allowed_pay_to=[KINGDOM_TREASURY], # recipients — MANDATORY
            # allowed_networks / allowed_assets / max_validity_seconds default to
            # Base mainnet USDC, 60 s — still allow-lists; widen explicitly or not at all
        ),
    ),
)

receipt = at.x402.top_up(1)                   # 402 → ONE signed retry → 200
receipt.credits_added                         # 1
at.x402.payment(receipt.authorization_hash)   # GET /v1/x402/payments/:id
```

Two ids exist and only one resolves: `topUp()` / `top_up()` returns the **server's ledger
id** (it folds network + asset into the digest) and that is what `at.x402.payment(...)`
reads; the client-side `authorizationHash` of the six EIP-3009 fields, carried by the
`onPayment` / `on_payment` event, is an audit-trail value and does **not** resolve on the
status route. Full option semantics — `AT_X402_PRIVATE_KEY` (honoured only when the option
names no signer), brokered transports, caller-supplied `paymentSignature` never signed over
— are in each SDK's README under "Paying on 402".

## Path B — raw curl + any EIP-3009 signer

No SDK, no repo. You need: `$BEARER`, an EIP-3009-capable signer holding Base USDC, `curl`,
and one of `cast` (foundry), `viem`, or `ethers` for the typed-data signature. **No ETH is
needed on the payer** — EIP-3009 `transferWithAuthorization` is gasless for you; the CDP
facilitator submits the transfer and pays gas.

### B1. Get a challenge

```
curl -si -X POST https://api.agenttool.dev/v1/x402/top-up/1 -H "Authorization: Bearer $BEARER"
```

Answer: `402`, body `top_up_payment_required` with guidance **plus** the x402 V2
`PaymentRequired` fields spread over it, and a `PAYMENT-REQUIRED` header — base64 of the
pure spec object (`api/src/middleware/x402.ts` `buildPaymentRequired` /
`mergePaymentRequiredBody`). The route always challenges until a verified payment is
attached — it is a purchase, not a shortfall, so your balance does not gate it.

The 21 static-priced metered routes (listed with exact prices in `/public/plans` →
`then_pay_as_you_go.payable_routes`) answer the same payable `402` — but **only** when
`project.credits < route cost` (`x402-policy.ts` `canClearProjectCreditGate`). With enough
credits you get the tool, not a challenge.

### B2. The envelope

```
PAYMENT-REQUIRED: <base64 of>
{
  "x402Version": 2,
  "error": "...",
  "resource": {
    "url": "https://api.agenttool.dev/v1/x402/top-up/1",
    "description": "Exact USDC top-up of 1 project credit (final; unspent credits stay).",
    "mimeType": "application/json",
    "serviceName": "AgentTool"
  },
  "accepts": [{
    "scheme": "exact",
    "network": "eip155:8453",
    "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "amount": "1000",
    "payTo": "0xA9eeA60CAaF239AbAfAA05FcB152128dB16dD3d8",
    "maxTimeoutSeconds": 60,
    "extra": { "name": "USD Coin", "version": "2", "assetTransferMethod": "eip3009" }
  }]
}
```

Decode it: `curl -si … | grep -i '^payment-required:' | cut -d' ' -f2 | base64 -d | jq .`

The 402 JSON body carries the same `PaymentRequired` fields spread over the guidance —
spec keys are authoritative there (`middleware/x402.ts` `mergePaymentRequiredBody`) — so
the body is the easy shell path. The challenge always carries exactly one offer
(`middleware/x402-config.ts` builds `accepts` with a single entry); capture it:

```
BODY=$(curl -s -X POST https://api.agenttool.dev/v1/x402/top-up/1 -H "Authorization: Bearer $BEARER")
ACCEPTED=$(printf '%s' "$BODY" | jq -c '.accepts[0]')
```

Check before you sign — the body is the counterparty's word, not yours:
`network == eip155:8453`, `asset == 0x8335…2913` (Base USDC), `payTo == 0xA9ee…D3d8`
(the kingdom treasury — anything else is not us), `amount == credits × 1000`, and
`resource.url` names the path you called (the verifier binds the authorization to it).

### B3. Sign one EIP-3009 authorization

EIP-712 domain: `{ name: extra.name, version: extra.version, chainId: 8453, verifyingContract: asset }`.
Primary type `TransferWithAuthorization` with fields
`from address, to address, value uint256, validAfter uint256, validBefore uint256, nonce bytes32`.

Message: `from` = your address · `to` = `payTo` · `value` = `amount` · `validAfter` = now − 1 ·
`validBefore` = now + min(`maxTimeoutSeconds`, your own ceiling) · `nonce` = 32 fresh random bytes.

Build the authorization and the typed data from `$ACCEPTED` — every domain value comes
from the challenge, exactly as the SDK signs it (`x402-client.ts`
`signExactEvmAuthorization`; for the B2 envelope that renders as
`{"USD Coin", "2", 8453, 0x8335…2913}`). Integers are **strings** in the authorization;
`validAfter` sits one second in the past so a verifier clock a tick behind cannot bounce a
fresh signature:

```
FROM=0xYourPayerAddress
NOW=$(date +%s)
WINDOW=$(printf '%s' "$ACCEPTED" | jq -r '.maxTimeoutSeconds')   # or your own, smaller
NONCE=0x$(openssl rand -hex 32)
AUTH=$(jq -nc --argjson a "$ACCEPTED" --arg from "$FROM" \
  --arg va "$((NOW - 1))" --arg vb "$((NOW + WINDOW))" --arg nonce "$NONCE" \
  '{from:$from, to:$a.payTo, value:$a.amount, validAfter:$va, validBefore:$vb, nonce:$nonce}')
printf '%s\n' "$AUTH" > auth.json    # persist BEFORE sending — replay these bytes, never re-sign
jq -n --argjson a "$ACCEPTED" --argjson auth "$AUTH" '{
  types: {
    EIP712Domain: [
      {name:"name",type:"string"}, {name:"version",type:"string"},
      {name:"chainId",type:"uint256"}, {name:"verifyingContract",type:"address"}],
    TransferWithAuthorization: [
      {name:"from",type:"address"}, {name:"to",type:"address"},
      {name:"value",type:"uint256"}, {name:"validAfter",type:"uint256"},
      {name:"validBefore",type:"uint256"}, {name:"nonce",type:"bytes32"}]
  },
  primaryType: "TransferWithAuthorization",
  domain: { name: $a.extra.name, version: $a.extra.version,
            chainId: ($a.network | ltrimstr("eip155:") | tonumber),
            verifyingContract: $a.asset },
  message: $auth
}' > typed.json
SIG=$(cast wallet sign --data --from-file typed.json --private-key $PAYER_KEY)
```

A viem/ethers signer takes the same domain, types, and message (with bigint values and no
`EIP712Domain` entry — the library derives it) — that is exactly Path A's `localEvmSigner`.

Keep the window short: a signed authorization is bearer-spendable until `validBefore`, and
the verifier refuses a window wider than the challenge's `maxTimeoutSeconds` (+5 s clock
skew — `x402-payments.ts` `authorizationWindowIsSane`). `auth.json` above **is** the
persist-before-send rule. If the response is ambiguous, re-send the same bytes (the rail
dedupes by identity) — **never sign a fresh one for the same purchase**; that is how you
pay twice.

### B4. Send it

```
PAYLOAD=$(jq -nc --argjson accepted "$ACCEPTED" --arg sig "$SIG" --argjson auth "$AUTH" \
  '{x402Version:2, accepted:$accepted, payload:{signature:$sig, authorization:$auth}}')
HEADER=$(printf '%s' "$PAYLOAD" | base64 | tr -d '\n')
curl -si -X POST https://api.agenttool.dev/v1/x402/top-up/1 \
  -H "Authorization: Bearer $BEARER" -H "PAYMENT-SIGNATURE: $HEADER"
```

`$ACCEPTED` is the exact offer captured in B2 (byte-equal fields — the verifier compares
every core field and server `extra` key, `x402-payments.ts` `requirementMatches`); `$AUTH`
is the authorization persisted in B3, string-encoded integers and all. The header JSON
admits only these keys (`middleware/x402.ts` `parseX402Header`), and `payload` must be
exactly `{signature, authorization}` with the six authorization fields — additive fields
are rejected (`decodeExactEvmPayload`). `resource` is optional: omit it, or copy the
challenge's `resource` verbatim. The base64 must be canonical (standard alphabet, padded)
— `base64 | tr -d '\n'` is fine.

Expected: `200 { credits_added, credits_total, authorization_hash, amount_atomic, unit,
finality, payment_status }`, a `PAYMENT-RESPONSE` header (base64 JSON of the facilitator's
settle response, carrying `transaction`), and
`Link: </v1/x402/payments/<payment_id>>; rel="payment-status"`. Credits apply **at most once,
in the same durable transaction that flips the payment row to `settled`** — a 200 with
credits but no settlement cannot happen. The reverse window exists and is recoverable: the
facilitator settlement is persisted first (`externally_settled`), and if the process dies
before credits apply, re-sending the **same** payment bytes applies the credit without
paying again (the payments route names this `retry_same_payment_signature_to_apply_credit`).

### B5. Check the ledger

```
curl -s https://api.agenttool.dev/v1/x402/payments/$PAYMENT_ID -H "Authorization: Bearer $BEARER" | jq .
```

`payment_id` is sha256 of the canonical JSON of
`{network, asset(lowercase), from(lowercase), to(lowercase), value, validAfter, validBefore, nonce(lowercase)}`
with keys sorted (`api/src/services/economy/x402-payments.ts` `authorizationIdentityHash`).
The row is project-scoped and reports `status`
(`inserted | pending | externally_settled | settled | failed`), `credits_purchased`,
`credits_applied`, `transaction`, and a `next_action` telling you what to do — including
`retry_same_payment_signature` when a retry of the **same** bytes is the right move.

### B6. Witness it on Base

```
curl -s https://mainnet.base.org -H 'User-Agent: you/1.0' -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_getTransactionReceipt","params":["'$TX'"]}' | jq .result.status
curl -s https://mainnet.base.org -H 'User-Agent: you/1.0' -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_call","params":[{"to":"0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913","data":"0x70a08231000000000000000000000000a9eea60caaf239abafaa05fcb152128db16dd3d8"},"latest"]}' | jq .result
```

`0x1` = success; the second call is the treasury's USDC balance (6 decimals). Send a
User-Agent header — some public RPC frontends reject requests without one. `$TX` is `transaction` from the ledger row or the decoded
`PAYMENT-RESPONSE`.

## Path C — with the repo

`api/scripts/x402-proof.ts` (`wallet-init` · `address` · `topup N` · `replay` · `verify` ·
`pay` · `deplete`) is the operator-grade version of Path B with every wall built in;
[`X402-PROOF.md`](X402-PROOF.md) is its runbook.

## What the rail refuses, and how

- **Over-cap: refused, never clamped.** `POST /v1/x402/top-up/10001` (or any non-canonical
  amount — sign, leading zero, exponent) is `400 top_up_invalid_credits`; nothing is
  challenged, nothing rounds down. Client-side, both SDKs refuse an over-cap challenge as
  `amount_over_cap` before anything is signed. Paying less than asked is not a mercy either:
  the verifier would bounce it as a price mismatch.
- **Replay: no second credit — and no 409.** A replayed, already-settled authorization is
  stashed as *state*, not as a payment: the handler answers `402` again, the middleware
  suppresses the fresh challenge (no `PAYMENT-REQUIRED`) and echoes `PAYMENT-RESPONSE` plus
  the `rel="payment-status"` Link instead (`routes/x402-top-up.ts` ·
  `middleware/x402.ts` `suppressX402Challenge`). The ledger row, not a status code, is the
  replay boundary — credits apply at most once per authorization. Separately, the route sits
  behind `idempotency()`: retry an ambiguous response with the **same** `Idempotency-Key`
  and a lost `200` is replayed, never settled twice.
- **Unauthed vs depleted.** No bearer is `401` before any challenge exists — the door is
  authenticated (`index.ts` mounts `authMiddleware` on `/v1/x402/top-up/*`). A depleted
  project is not refused here at all: the top-up door is never balance-bound, and the
  metered routes answer their payable `402 insufficient_credits` only when the project is
  genuinely short. Depletion is what the birth grant running out looks like; this page is
  the way back.

## What this page does not claim

- That a settlement will succeed for you: the facilitator's `/settle` is the authoritative
  balance/nonce check, and a fail-closed admission (`Retry-After`, ledger row `pending`) is
  the honest record of an ambiguous attempt — see [`X402-PROOF.md`](X402-PROOF.md) for a
  witnessed one and the rule (*never `pay` during a machine roll*).
- That anything beyond the top-up door and the 21 rows in `/public/plans` →
  `payable_routes` is payable.
- That the SDKs pay by default. They never do; the `x402` option with an explicit signer
  and a mandatory spend policy is the only door.
