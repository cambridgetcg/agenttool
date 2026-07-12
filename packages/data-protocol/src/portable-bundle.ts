import { base64UrlDecode, copyBytes, equalBytes } from "./bytes.js";
import { parseCanonicalJson } from "./canonical.js";
import { assertCidMatches, digestFromCid, type Cid } from "./cid.js";
import { IntegrityError, InvalidInputError, LimitExceededError } from "./errors.js";
import {
  ADDS_BUNDLE_PROTOCOL,
  type PortableBlock,
  type PortableBundle,
  type SignedManifest,
} from "./types.js";
import { validateManifest } from "./validation.js";

export interface PortableBundleValidationLimits {
  maxBytes: number;
  maxManifestBytes: number;
  maxBlocks: number;
  maxBundleBytes: number;
}

export interface ValidatedPortableBundle {
  bundle: PortableBundle;
  manifest: SignedManifest;
  encryptedBytes: number;
  bundleBytes: number;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new InvalidInputError(`${label} must be an object.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new InvalidInputError(`${label} must be a plain object.`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => typeof key !== "string")) {
    throw new InvalidInputError(`${label} must not contain symbol keys.`);
  }
  const allowed = new Set(keys);
  for (const key of ownKeys as string[]) {
    if (!allowed.has(key)) throw new InvalidInputError(`${label} contains unsupported field ${key}.`);
  }
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) throw new InvalidInputError(`${label} is missing ${key}.`);
  }
}

function validateLimit(value: number, label: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || value < minimum || Object.is(value, -0)) {
    throw new InvalidInputError(`${label} must be a safe integer >= ${minimum}.`);
  }
  return value;
}

function assertDensePlainArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new InvalidInputError(`${label} must be an array.`);
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) throw new InvalidInputError(`${label} must be dense.`);
  }
  if (
    Reflect.ownKeys(value).some((key) => key !== "length"
      && !(typeof key === "string" && /^(0|[1-9][0-9]*)$/u.test(key)))
  ) {
    throw new InvalidInputError(`${label} must not have non-index properties.`);
  }
  return value;
}

function addBounded(total: number, addition: number, maximum: number): number {
  if (addition > maximum - total) {
    throw new LimitExceededError(`Portable bundle exceeds maxBundleBytes (${maximum}).`);
  }
  return total + addition;
}

function readBlock(value: unknown, index: number): PortableBlock {
  const label = `bundle.blocks[${index}]`;
  const block = record(value, label);
  exactKeys(block, ["cid", "bytes"], label);
  if (typeof block.cid !== "string") throw new InvalidInputError(`${label}.cid must be a string.`);
  digestFromCid(block.cid);
  if (!(block.bytes instanceof Uint8Array)) {
    throw new InvalidInputError(`${label}.bytes must be a Uint8Array.`);
  }
  return { cid: block.cid, bytes: block.bytes };
}

/** Strictly validate and snapshot an in-memory portable bundle before any store write. */
export function validatePortableBundle(
  value: unknown,
  limits: PortableBundleValidationLimits,
): ValidatedPortableBundle {
  const maxBytes = validateLimit(limits.maxBytes, "bundle.maxBytes");
  const maxManifestBytes = validateLimit(limits.maxManifestBytes, "bundle.maxManifestBytes");
  const maxBlocks = validateLimit(limits.maxBlocks, "bundle.maxBlocks", 1);
  const maxBundleBytes = validateLimit(limits.maxBundleBytes, "bundle.maxBundleBytes");

  const input = record(value, "bundle");
  exactKeys(input, ["protocol", "root", "blocks"], "bundle");
  if (input.protocol !== ADDS_BUNDLE_PROTOCOL) {
    throw new InvalidInputError(`bundle.protocol must be ${ADDS_BUNDLE_PROTOCOL}.`);
  }

  const rootInput = record(input.root, "bundle.root");
  exactKeys(rootInput, ["cid"], "bundle.root");
  if (typeof rootInput.cid !== "string") throw new InvalidInputError("bundle.root.cid must be a string.");
  digestFromCid(rootInput.cid);
  const rootCid = rootInput.cid;

  const blockInputs = assertDensePlainArray(input.blocks, "bundle.blocks");
  if (blockInputs.length === 0) throw new InvalidInputError("bundle.blocks must contain the Manifest Block.");
  if (blockInputs.length - 1 > maxBlocks) {
    throw new LimitExceededError(`Portable bundle exceeds local maxBlocks (${maxBlocks}).`);
  }

  const rootInputBlock = readBlock(blockInputs[0], 0);
  if (rootInputBlock.cid !== rootCid) {
    throw new IntegrityError("Portable bundle's first Block must be its root Manifest.");
  }
  if (rootInputBlock.bytes.byteLength > maxManifestBytes) {
    throw new LimitExceededError(`Manifest exceeds maxManifestBytes (${maxManifestBytes}).`);
  }
  let bundleBytes = addBounded(0, rootInputBlock.bytes.byteLength, maxBundleBytes);
  const rootBlock = { cid: rootInputBlock.cid, bytes: copyBytes(rootInputBlock.bytes) };
  assertCidMatches(rootCid, rootBlock.bytes);
  const manifest = validateManifest(parseCanonicalJson(rootBlock.bytes));
  if (manifest.plaintext.size > maxBytes) {
    throw new LimitExceededError(`Manifest declares ${manifest.plaintext.size} bytes; limit is ${maxBytes}.`);
  }
  if (manifest.chunks.length > maxBlocks) {
    throw new LimitExceededError(`Manifest exceeds local maxBlocks (${maxBlocks}).`);
  }
  if (blockInputs.length !== manifest.chunks.length + 1) {
    throw new IntegrityError("Portable bundle must contain exactly its Manifest and every named ciphertext Block.");
  }

  const blocks: PortableBlock[] = [rootBlock];
  const seen = new Set<Cid>([rootCid]);
  let encryptedBytes = 0;
  for (let index = 0; index < manifest.chunks.length; index += 1) {
    const descriptor = manifest.chunks[index]!;
    const blockInput = readBlock(blockInputs[index + 1], index + 1);
    if (blockInput.cid !== descriptor.cid) {
      throw new IntegrityError(`Portable bundle Block ${index} is not in signed Manifest order.`);
    }
    if (seen.has(blockInput.cid)) {
      throw new IntegrityError(`Portable bundle repeats Block CID ${blockInput.cid}.`);
    }
    seen.add(blockInput.cid);
    const expectedLength = 12 + descriptor.ciphertext_size;
    if (blockInput.bytes.byteLength !== expectedLength) {
      throw new IntegrityError(`Block ${index} length does not match its Manifest descriptor.`);
    }
    bundleBytes = addBounded(bundleBytes, blockInput.bytes.byteLength, maxBundleBytes);
    const block = { cid: blockInput.cid, bytes: copyBytes(blockInput.bytes) };
    assertCidMatches(block.cid, block.bytes);
    const expectedNonce = base64UrlDecode(descriptor.nonce, `manifest.chunks[${index}].nonce`);
    if (!equalBytes(block.bytes.subarray(0, 12), expectedNonce)) {
      throw new IntegrityError(`Block ${index} nonce prefix does not match its Manifest descriptor.`);
    }
    encryptedBytes += block.bytes.byteLength;
    blocks.push(block);
  }

  return {
    bundle: {
      protocol: ADDS_BUNDLE_PROTOCOL,
      root: { cid: rootCid },
      blocks,
    },
    manifest,
    encryptedBytes,
    bundleBytes,
  };
}
