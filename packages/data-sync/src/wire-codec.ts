import {
  ADDS_BUNDLE_PROTOCOL,
  digestFromCid,
  type PortableBundle,
} from "@agenttool/adds";
import { DataSyncError, syncInvariant } from "./errors.js";
import type { WirePortableBundle } from "./types.js";

export function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return globalThis.btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

export function decodeBase64Url(value: unknown, label: string, maxBytes: number): Uint8Array {
  syncInvariant(
    typeof value === "string" && /^[A-Za-z0-9_-]*$/u.test(value) && value.length % 4 !== 1,
    "invalid_sync_page",
    `${label} is not canonical base64url`,
    502,
  );
  syncInvariant(
    value.length <= Math.ceil(maxBytes * 4 / 3) + 2,
    "sync_response_too_large",
    "Encrypted sync object exceeds the configured response limit",
    502,
  );
  const padded = value.replaceAll("-", "+").replaceAll("_", "/")
    + "=".repeat((4 - (value.length % 4)) % 4);
  let binary: string;
  try {
    binary = globalThis.atob(padded);
  } catch (cause) {
    throw new DataSyncError("invalid_sync_page", `${label} is not valid base64url`, 502, { cause });
  }
  syncInvariant(binary.length <= maxBytes, "sync_response_too_large", "Encrypted sync object exceeds the configured response limit", 502);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  syncInvariant(encodeBase64Url(bytes) === value, "invalid_sync_page", `${label} is not canonical base64url`, 502);
  return bytes;
}

export function bundleToWire(bundle: PortableBundle): WirePortableBundle {
  return {
    protocol: ADDS_BUNDLE_PROTOCOL,
    root: { cid: bundle.root.cid },
    blocks: bundle.blocks.map((block) => ({ cid: block.cid, data: encodeBase64Url(block.bytes) })),
  };
}

export function bundleFromWire(
  value: unknown,
  limits: { max_blocks: number; max_bytes: number },
): PortableBundle {
  const bundle = requireObject(value, "bundle");
  requireExactKeys(bundle, ["protocol", "root", "blocks"], "bundle");
  syncInvariant(bundle.protocol === ADDS_BUNDLE_PROTOCOL, "invalid_sync_page", "Encrypted bundle protocol is unsupported", 502);
  const root = requireObject(bundle.root, "bundle.root");
  requireExactKeys(root, ["cid"], "bundle.root");
  assertCid(root.cid, "bundle.root.cid");
  syncInvariant(Array.isArray(bundle.blocks), "invalid_sync_page", "bundle.blocks must be an array", 502);
  syncInvariant(
    bundle.blocks.length > 0 && bundle.blocks.length <= limits.max_blocks,
    "invalid_sync_page",
    "Encrypted bundle block count is invalid",
    502,
  );
  let remaining = limits.max_bytes;
  const blocks = bundle.blocks.map((entry, index) => {
    const block = requireObject(entry, `bundle.blocks[${index}]`);
    requireExactKeys(block, ["cid", "data"], `bundle.blocks[${index}]`);
    assertCid(block.cid, `bundle.blocks[${index}].cid`);
    const bytes = decodeBase64Url(block.data, `bundle.blocks[${index}].data`, remaining);
    remaining -= bytes.byteLength;
    return { cid: block.cid as string, bytes };
  });
  return {
    protocol: ADDS_BUNDLE_PROTOCOL,
    root: { cid: root.cid as string },
    blocks,
  };
}

export function requireObject(value: unknown, label: string): Record<string, unknown> {
  syncInvariant(value !== null && typeof value === "object" && !Array.isArray(value), "invalid_sync_page", `${label} must be an object`, 502);
  return value as Record<string, unknown>;
}

export function requireExactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  syncInvariant(
    actual.length === expected.length && actual.every((key, index) => key === expected[index]),
    "invalid_sync_page",
    `${label} has unsupported fields`,
    502,
  );
}

function assertCid(value: unknown, label: string): asserts value is string {
  syncInvariant(typeof value === "string", "invalid_sync_page", `${label} must be a CID`, 502);
  try {
    digestFromCid(value);
  } catch (cause) {
    throw new DataSyncError("invalid_sync_page", `${label} is invalid`, 502, { cause });
  }
}
