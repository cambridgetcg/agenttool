import {
  base64UrlEncode,
  bytesToHex,
  canonicalJson,
  canonicalJsonBytes,
  concatBytes,
  sha256BytesId,
  signingBytes,
  signingDigest,
  type Sha256Id,
} from "@agenttool/wallet";
import { assertZeroneAddress } from "@agenttool/wallet-zerone";

import {
  CHAIN_SETTLEMENT_NULLIFIER_DOMAIN,
  CHAIN_WORK_RECEIPT_DOMAIN,
} from "./constants.js";
import { invalid } from "./errors.js";

const UTF8 = new TextEncoder();
function uint64BigEndian(value: bigint): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, value, false);
  return bytes;
}

function lengthPrefixed(value: Uint8Array): Uint8Array {
  return concatBytes(uint64BigEndian(BigInt(value.byteLength)), value);
}

function zeroneAddress(value: string, path: string): string {
  try {
    assertZeroneAddress(value, path);
  } catch {
    invalid("invalid_record", `${path} must be a canonical Zerone address.`, path);
  }
  return value;
}

export { canonicalJson, canonicalJsonBytes };

export function domainSeparatedId(domain: string, value: unknown): Sha256Id {
  return `sha256:${bytesToHex(signingDigest(domain, value))}`;
}

export function domainSeparatedSigningBytes(domain: string, value: unknown): Uint8Array {
  return signingBytes(domain, value);
}

export function sha256IdToChainHash(value: Sha256Id): string {
  if (!/^sha256:[0-9a-f]{64}$/u.test(value)) {
    invalid("invalid_hash", "AgentTool digest must be sha256:<64 lowercase hex>.");
  }
  return value.slice("sha256:".length);
}

export function chainHashToSha256Id(value: string): Sha256Id {
  if (!/^[0-9a-f]{64}$/u.test(value)) {
    invalid("invalid_hash", "Zerone chain digest must be bare 64-character lowercase hex.");
  }
  return `sha256:${value}`;
}

export function deriveChainSettlementNullifier(input: {
  readonly work_spec_id: Sha256Id;
  readonly acceptance_hash: Sha256Id;
  readonly input_root: Sha256Id;
  readonly environment_root: Sha256Id;
  readonly artifact_root: Sha256Id;
  readonly worker_address: string;
}): string {
  const fields = [
    sha256IdToChainHash(input.work_spec_id),
    sha256IdToChainHash(input.acceptance_hash),
    sha256IdToChainHash(input.input_root),
    sha256IdToChainHash(input.environment_root),
    sha256IdToChainHash(input.artifact_root),
    zeroneAddress(input.worker_address, "worker_address"),
  ];
  return sha256IdToChainHash(sha256BytesId(concatBytes(
    UTF8.encode(CHAIN_SETTLEMENT_NULLIFIER_DOMAIN),
    ...fields.map((field) => lengthPrefixed(UTF8.encode(field))),
  )));
}

export function deriveChainWorkReceiptHash(input: {
  readonly work_spec_id: Sha256Id;
  readonly acceptance_hash: Sha256Id;
  readonly input_root: Sha256Id;
  readonly environment_root: Sha256Id;
  readonly artifact_root: Sha256Id;
  readonly evidence_root: Sha256Id;
  readonly payee_address: string;
}): string {
  const fields = [
    sha256IdToChainHash(input.work_spec_id),
    sha256IdToChainHash(input.acceptance_hash),
    sha256IdToChainHash(input.input_root),
    sha256IdToChainHash(input.environment_root),
    sha256IdToChainHash(input.artifact_root),
    sha256IdToChainHash(input.evidence_root),
    zeroneAddress(input.payee_address, "payee_address"),
  ];
  return sha256IdToChainHash(sha256BytesId(concatBytes(
    UTF8.encode(CHAIN_WORK_RECEIPT_DOMAIN),
    ...fields.map((field) => lengthPrefixed(UTF8.encode(field))),
  )));
}

export function describeCanonicalProjection(value: unknown): Readonly<{
  readonly projection_bytes_b64u: string;
  readonly projection_hash: Sha256Id;
}> {
  const bytes = canonicalJsonBytes(value);
  return Object.freeze({
    projection_bytes_b64u: base64UrlEncode(bytes),
    projection_hash: sha256BytesId(bytes),
  });
}
