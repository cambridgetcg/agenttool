#!/usr/bin/env bun
/** Generate the shared x402 EIP-3009 signing vector the SDKs are checked
 *  against — `packages/sdk-ts/tests/fixtures/x402-eip3009-vector.json`.
 *
 *  The SERVER is normative. Every value in the fixture is produced here by
 *  the same code that verifies inbound payments in production:
 *
 *    - `middleware/x402.ts`            buildPaymentRequirements / buildPaymentRequired /
 *                                      encodeCanonicalBase64Json / parseX402Header
 *    - `services/economy/x402-client.ts` authorizationHash (the SDK port must agree)
 *    - `services/economy/x402-payments.ts` decodeExactEvmPayload / classifyExactEvmSignature
 *                                      (offline EOA recovery via viem `recoverTypedDataAddress`)
 *    - viem `hashTypedData` / `privateKeyToAccount().signTypedData`
 *
 *  A fixed, PUBLIC test key is used (Anvil account #1). It holds nothing and
 *  never will; it exists so that three implementations can be compared byte
 *  for byte. The nonce, window, amount and recipient are fixed too, so the
 *  PAYMENT-SIGNATURE header is reproducible. `signExactEvmAuthorization` in
 *  the server (and its SDK ports) mints a fresh random nonce on every call —
 *  that wall is deliberately NOT bypassed here: the payload is assembled by
 *  hand with the same key order, then proven acceptable to the verifier.
 *
 *  Regenerate:
 *    cd api && bun scripts/x402-eip3009-vector.ts > ../packages/sdk-ts/tests/fixtures/x402-eip3009-vector.json
 *
 *  Plan: docs/superpowers/plans/2026-08-29-wave-2-agent-rail.md (W2-6, W2-8). */

import { keccak256, toBytes, hashTypedData, recoverTypedDataAddress, getAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import {
  buildPaymentRequired,
  buildPaymentRequirements,
  encodeCanonicalBase64Json,
  parseX402Header,
  type PaymentPayload,
  type ResourceInfo,
} from "../src/middleware/x402";
import {
  authorizationHash,
  TRANSFER_WITH_AUTHORIZATION_TYPES,
} from "../src/services/economy/x402-client";
import {
  authorizationIdentityHash,
  classifyExactEvmSignature,
  decodeExactEvmPayload,
} from "../src/services/economy/x402-payments";

// Anvil account #1 — a public, unfunded development key. Never a real payer.
const PRIVATE_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
// Anvil account #0 — used only for the address-derivation KAT below.
const ANVIL_0_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;

const KINGDOM_TREASURY = "0xA9eeA60CAaF239AbAfAA05FcB152128dB16dD3d8";
const NOW_SECONDS = 1756512000;
const MAX_TIMEOUT_SECONDS = 60;
const NONCE = "0x4b1e6d0f6b3d5a1c0e9f8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d2e1f0a9b8c7d";

const account = privateKeyToAccount(PRIVATE_KEY);

const resource: ResourceInfo = {
  url: "https://api.agenttool.dev/v1/x402/top-up/1",
  description: "Exact USDC top-up of 1 project credit (final; unspent credits stay).",
  mimeType: "application/json",
  serviceName: "AgentTool",
};

const requirement = buildPaymentRequirements({
  amountAtomic: "1000",
  payTo: KINGDOM_TREASURY,
  network: "eip155:8453",
  maxTimeoutSeconds: MAX_TIMEOUT_SECONDS,
});

const paymentRequired = buildPaymentRequired(resource, [requirement], "top_up_payment_required");

const authorization = {
  from: account.address,
  to: requirement.payTo,
  value: requirement.amount,
  validAfter: String(NOW_SECONDS - 1),
  validBefore: String(NOW_SECONDS + MAX_TIMEOUT_SECONDS),
  nonce: NONCE,
};

const typedData = {
  domain: {
    name: requirement.extra.name,
    version: requirement.extra.version,
    chainId: 8453,
    verifyingContract: requirement.asset as Hex,
  },
  types: TRANSFER_WITH_AUTHORIZATION_TYPES,
  primaryType: "TransferWithAuthorization" as const,
  message: {
    from: authorization.from as Hex,
    to: authorization.to as Hex,
    value: BigInt(authorization.value),
    validAfter: BigInt(authorization.validAfter),
    validBefore: BigInt(authorization.validBefore),
    nonce: authorization.nonce as Hex,
  },
};

const digest = hashTypedData(typedData);
const signature = await account.signTypedData(typedData);
const recovered = await recoverTypedDataAddress({ ...typedData, signature });

// Same key order `signExactEvmAuthorization` emits (x402-client.ts:408-413).
const payload: PaymentPayload = {
  x402Version: 2,
  resource,
  accepted: requirement,
  payload: { signature, authorization },
};
const paymentSignatureHeader = encodeCanonicalBase64Json(payload);

// Prove the server accepts these exact bytes, offline.
const parsedHeader = parseX402Header(paymentSignatureHeader);
if (!parsedHeader) throw new Error("server parseX402Header rejected the header");
const exact = decodeExactEvmPayload(parsedHeader.payload);
if (!exact) throw new Error("server decodeExactEvmPayload rejected the payload");
const signatureClass = await classifyExactEvmSignature(parsedHeader.accepted, exact);
if (signatureClass !== "eoa_verified") {
  throw new Error(`server classified the signature as ${signatureClass}, not eoa_verified`);
}
if (recovered.toLowerCase() !== account.address.toLowerCase()) {
  throw new Error("viem recovered a different address than the signer");
}

const fixture = {
  $schema: "agenttool.x402-eip3009-vector/v1",
  generated_by: "api/scripts/x402-eip3009-vector.ts (server implementation is normative)",
  note:
    "Public Anvil development key #1; holds nothing. Fixed nonce and window so the header is reproducible. " +
    "The SDK signers must reproduce `signature` byte for byte from `typed_data` and recover `payer_address`.",
  payer: {
    private_key: PRIVATE_KEY,
    address: account.address,
  },
  typed_data: {
    domain: typedData.domain,
    primary_type: typedData.primaryType,
    types: TRANSFER_WITH_AUTHORIZATION_TYPES,
    message: authorization,
  },
  eip712_digest: digest,
  signature,
  recovered_address: recovered,
  requirement,
  resource,
  payment_required: paymentRequired,
  payment_required_header: encodeCanonicalBase64Json(paymentRequired),
  payment_payload: payload,
  payment_signature_header: paymentSignatureHeader,
  authorization_hash: authorizationHash(authorization),
  authorization_identity_hash: authorizationIdentityHash(requirement, exact),
  server_signature_class: signatureClass,
  now_seconds: NOW_SECONDS,
  kats: {
    keccak256: {
      "": keccak256(toBytes("")),
      abc: keccak256(toBytes("abc")),
      "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)":
        keccak256(
          toBytes(
            "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)",
          ),
        ),
      "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)": keccak256(
        toBytes("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
      ),
    },
    address_from_private_key: {
      [ANVIL_0_PRIVATE_KEY]: privateKeyToAccount(ANVIL_0_PRIVATE_KEY).address,
      [PRIVATE_KEY]: account.address,
    },
    checksum: {
      "0xa9eea60caaf239abafaa05fcb152128db16dd3d8": getAddress("0xa9eea60caaf239abafaa05fcb152128db16dd3d8"),
      "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": getAddress("0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"),
      "0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed": getAddress("0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed"),
      "0xfb6916095ca1df60bb79ce92ce3ea74c37c5d359": getAddress("0xfb6916095ca1df60bb79ce92ce3ea74c37c5d359"),
    },
  },
};

process.stdout.write(`${JSON.stringify(fixture, null, 2)}\n`);
