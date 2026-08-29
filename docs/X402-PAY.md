# X402-PAY — pay the kingdom in USDC, with nothing from us but this page

Status: **skeleton** (Wave 2 W2-3). Each section is labelled **true today** or **lands with
W2-2 / W2-4**. Nobody — not a stranger, not our own wallet — has settled on this rail yet;
this page will say so until `docs/X402-PROOF.md` Step 3 has been witnessed. The exit
criterion for Wave 2 is that this page alone is enough (plan W2-10 finishes it).

You need: a bearer for an agenttool project, an EIP-3009-capable signer holding Base USDC,
`curl`, and one of `cast` (foundry), `viem`, or `ethers` for the typed-data signature.
No ETH is needed on the payer — the transfer is submitted by the facilitator.

Rate (locked 2026-08-29): **1 credit = 1,000 USDC atomic units = USD 0.001.** Top-ups are
final — no refunds; unspent credits stay on the project. No subscriptions; you pay per
challenge, once. Cap per challenge: `X402_TOP_UP_MAX_CREDITS` (default 10,000 credits = USD 10).

## 0. A bearer — true today

Registration is free and anonymous but not curl-only: `POST /v1/register/agent` takes your
own Ed25519/X25519 public keys plus a key proof (`api/src/routes/register-agent.ts`). Use
either SDK (`@agenttool/sdk`, `agenttool-sdk`) or follow `docs/AGENT-CENTRIC.md`. From here
on, `$BEARER` is that key. `GET /v1/wake` with it is free forever and shows your
`project.credits`.

```
curl -s https://api.agenttool.dev/v1/wake -H "Authorization: Bearer $BEARER" | jq .project
```

## 1. Get a challenge

### 1a. Top-up route — lands with W2-2 (code) and W2-4 (deploy)

```
curl -si -X POST https://api.agenttool.dev/v1/x402/top-up/1 -H "Authorization: Bearer $BEARER"
```

Expected once live: `402`, body `top_up_payment_required` with guidance **plus** the x402
`PaymentRequired` fields, and a `PAYMENT-REQUIRED` header (base64 JSON of the same
`PaymentRequired`). The route always challenges until a verified payment is attached — it is
a purchase, not a shortfall, so your balance does not gate it. Today it answers `404`.

### 1b. Metered routes — true today, only when your credits are short

`POST /v1/scrape` and `POST /v1/document` answer a payable `402` **only** when
`project.credits < route cost` and production x402 is configured
(`api/src/services/economy/x402-policy.ts:279-290`; `GET /public/plans` →
`then_pay_as_you_go.configuration` says whether it is). With enough credits you get the
tool, not a challenge.

### The envelope — true today

```
PAYMENT-REQUIRED: <base64 of>
{
  "x402Version": 2,
  "error": "...",
  "resource": { "url": "https://api.agenttool.dev/v1/...", "mimeType": "application/json", "serviceName": "AgentTool" },
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

Check before you sign — the body is the counterparty's word, not yours:
`network == eip155:8453`, `asset == 0x8335…2913` (Base USDC), `payTo == 0xA9ee…D3d8`
(the kingdom treasury — anything else is not us), `amount == credits × 1000`.

## 2. Sign one EIP-3009 authorization — true today (shape pinned by the server's verifier)

EIP-712 domain: `{ name: extra.name, version: extra.version, chainId: 8453, verifyingContract: asset }`.
Primary type `TransferWithAuthorization` with fields
`from address, to address, value uint256, validAfter uint256, validBefore uint256, nonce bytes32`.

Message: `from` = your address · `to` = `payTo` · `value` = `amount` · `validAfter` = now − 1 ·
`validBefore` = now + min(`maxTimeoutSeconds`, your own ceiling) · `nonce` = 32 fresh random bytes.

With foundry, write the typed data to `typed.json` and:

```
SIG=$(cast wallet sign --data --from-file typed.json --private-key $PAYER_KEY)
```

Keep the window short: a signed authorization is bearer-spendable until `validBefore`.
Persist `{from,to,value,validAfter,validBefore,nonce}` **before** sending. If the response is
ambiguous, re-send the same bytes (the rail dedupes by identity) — **never sign a fresh one
for the same purchase**; that is how you pay twice.

## 3. Send it — envelope true today; route lands with W2-2 / W2-4

```
PAYLOAD=$(jq -nc --argjson accepted "$ACCEPTED" --arg sig "$SIG" --argjson auth "$AUTH" \
  '{x402Version:2, accepted:$accepted, payload:{signature:$sig, authorization:$auth}}')
HEADER=$(printf '%s' "$PAYLOAD" | base64 | tr -d '\n')
curl -si -X POST https://api.agenttool.dev/v1/x402/top-up/1 \
  -H "Authorization: Bearer $BEARER" -H "PAYMENT-SIGNATURE: $HEADER"
```

`$ACCEPTED` is the exact `accepts[i]` object you chose (byte-equal fields; the verifier binds
price and path); `$AUTH` is your persisted authorization object with string-encoded integers.
The base64 must be canonical (standard alphabet, padded) — `base64 | tr -d '\n'` is fine.

Once live, expected: `200 { credits_added: 1, credits_total: …, authorization_hash: … }`,
a `PAYMENT-RESPONSE` header (base64 JSON of the facilitator's settle response, carrying
`transaction`), and `Link: </v1/x402/payments/<payment_id>>; rel="payment-status"`.

## 4. Check the ledger — true today

```
curl -s https://api.agenttool.dev/v1/x402/payments/$PAYMENT_ID -H "Authorization: Bearer $BEARER" | jq .
```

`payment_id` is sha256 of the canonical JSON of
`{network, asset(lowercase), from(lowercase), to(lowercase), value, validAfter, validBefore, nonce(lowercase)}`
with keys sorted (`api/src/services/economy/x402-payments.ts:140`). The row reports
`status` (`inserted | pending | externally_settled | settled | …`), `credits_purchased`,
`credits_applied`, `transaction`, and a `next_action` telling you what to do — including
`retry_same_payment_signature` when a retry of the **same** bytes is the right move.

Replaying a settled authorization never credits twice: there is no 409; the handler simply
runs unpaid and you get the challenge again.

## 5. Witness it on Base — true today (nothing to witness yet)

```
curl -s https://mainnet.base.org -H 'User-Agent: you/1.0' -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_getTransactionReceipt","params":["'$TX'"]}' | jq .result.status
curl -s https://mainnet.base.org -H 'User-Agent: you/1.0' -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_call","params":[{"to":"0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913","data":"0x70a08231000000000000000000000000a9eea60caaf239abafaa05fcb152128db16dd3d8"},"latest"]}' | jq .result
```

`0x1` = success; the second call is the treasury's USDC balance (6 decimals). The RPC returns
403 without a User-Agent.

## What this page does not claim

- That anyone has paid this way. The first witnessed settlement is W2-4; the line will appear
  in `RESERVE.md` and here when it has happened.
- That the SDKs sign for you. They do not (W2-6…W2-9 change that, opt-in, with a mandatory
  spend policy).
- That routes other than the top-up route and the two metered tools are payable (W2-5).
