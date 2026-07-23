import { canonicalJsonBytes, parseCanonicalJson } from "@agenttool/adds";

import {
  ARCHIVE_PAYLOAD_FORMAT,
  type SignedSnapshotDescriptor,
} from "./types.js";
import { concatBytes, equalBytes, sha256Id, utf8 } from "./encoding.js";
import {
  ArchiveVerificationError,
  InvalidArchiveRecordError,
} from "./errors.js";
import { verifySnapshotDescriptor } from "./records.js";

const MAGIC = utf8("ARA\0v0.1\n");
const LENGTH_BYTES = 4;
export const MAX_SNAPSHOT_DESCRIPTOR_BYTES = 1024 * 1024;

export interface DecodedSnapshotPayload {
  format: typeof ARCHIVE_PAYLOAD_FORMAT;
  descriptor: SignedSnapshotDescriptor;
  bundle: Uint8Array;
}

function uint32(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new InvalidArchiveRecordError("Snapshot descriptor length is outside uint32 bounds.");
  }
  const bytes = new Uint8Array(LENGTH_BYTES);
  new DataView(bytes.buffer).setUint32(0, value, false);
  return bytes;
}

export function encodeSnapshotPayload(
  descriptorValue: SignedSnapshotDescriptor,
  bundleValue: Uint8Array,
): Uint8Array {
  const descriptor = verifySnapshotDescriptor(descriptorValue);
  if (!(bundleValue instanceof Uint8Array)) {
    throw new InvalidArchiveRecordError("Git bundle must be a Uint8Array.");
  }
  const bundle = Uint8Array.from(bundleValue);
  if (bundle.byteLength !== descriptor.payload.bytes) {
    throw new InvalidArchiveRecordError("Git bundle byte length does not match SnapshotDescriptor.");
  }
  if (sha256Id(bundle) !== descriptor.payload.digest) {
    throw new InvalidArchiveRecordError("Git bundle digest does not match SnapshotDescriptor.");
  }
  const descriptorBytes = canonicalJsonBytes(descriptor);
  if (descriptorBytes.byteLength > MAX_SNAPSHOT_DESCRIPTOR_BYTES) {
    throw new InvalidArchiveRecordError("SnapshotDescriptor exceeds its byte limit.");
  }
  return concatBytes(MAGIC, uint32(descriptorBytes.byteLength), descriptorBytes, bundle);
}

export function decodeSnapshotPayload(
  value: Uint8Array,
  options: { maxBundleBytes: number },
): DecodedSnapshotPayload {
  if (!(value instanceof Uint8Array)) {
    throw new InvalidArchiveRecordError("Snapshot payload must be bytes.");
  }
  if (
    !Number.isSafeInteger(options.maxBundleBytes)
    || options.maxBundleBytes < 1
  ) {
    throw new InvalidArchiveRecordError("maxBundleBytes must be a positive safe integer.");
  }
  if (value.byteLength < MAGIC.byteLength + LENGTH_BYTES + 1) {
    throw new ArchiveVerificationError("Snapshot payload is truncated.");
  }
  if (!equalBytes(value.subarray(0, MAGIC.byteLength), MAGIC)) {
    throw new ArchiveVerificationError("Snapshot payload magic/version is invalid.");
  }
  const descriptorLength = new DataView(
    value.buffer,
    value.byteOffset + MAGIC.byteLength,
    LENGTH_BYTES,
  ).getUint32(0, false);
  if (descriptorLength < 1 || descriptorLength > MAX_SNAPSHOT_DESCRIPTOR_BYTES) {
    throw new ArchiveVerificationError("Snapshot descriptor length is outside local limits.");
  }
  const descriptorStart = MAGIC.byteLength + LENGTH_BYTES;
  const descriptorEnd = descriptorStart + descriptorLength;
  if (descriptorEnd > value.byteLength) {
    throw new ArchiveVerificationError("Snapshot descriptor length exceeds payload bytes.");
  }
  let parsed: unknown;
  try {
    parsed = parseCanonicalJson(value.subarray(descriptorStart, descriptorEnd));
  } catch (cause) {
    throw new ArchiveVerificationError("Snapshot descriptor is not strict canonical JSON.", { cause });
  }
  const descriptor = verifySnapshotDescriptor(parsed);
  const bundle = Uint8Array.from(value.subarray(descriptorEnd));
  if (bundle.byteLength > options.maxBundleBytes) {
    throw new ArchiveVerificationError("Git bundle exceeds the configured restore byte limit.");
  }
  if (bundle.byteLength !== descriptor.payload.bytes) {
    throw new ArchiveVerificationError("Restored Git bundle length does not match its descriptor.");
  }
  if (sha256Id(bundle) !== descriptor.payload.digest) {
    throw new ArchiveVerificationError("Restored Git bundle digest does not match its descriptor.");
  }
  return {
    format: ARCHIVE_PAYLOAD_FORMAT,
    descriptor,
    bundle,
  };
}
