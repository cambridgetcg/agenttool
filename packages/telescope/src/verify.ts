import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

export interface ArtifactExpectation {
  size: number;
  sha256: string;
}

export interface VerificationResult {
  ok: boolean;
  expected: ArtifactExpectation;
  actual: ArtifactExpectation;
}

function assertExpectation(expected: ArtifactExpectation): void {
  if (
    !Number.isSafeInteger(expected.size) ||
    expected.size < 0 ||
    !/^[0-9a-f]{64}$/.test(expected.sha256)
  ) {
    throw new TypeError("Expected size and lowercase SHA-256 must be valid.");
  }
}

export function verifyArtifact(
  bytes: Uint8Array,
  expected: ArtifactExpectation,
): VerificationResult {
  assertExpectation(expected);
  const actual = {
    size: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
  return {
    ok: actual.size === expected.size && actual.sha256 === expected.sha256,
    expected,
    actual,
  };
}

export async function verifyArtifactFile(
  path: string,
  expected: ArtifactExpectation,
): Promise<VerificationResult> {
  assertExpectation(expected);
  let size = 0;
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) {
    const bytes = chunk as Buffer;
    size += bytes.byteLength;
    hash.update(bytes);
  }
  const actual = { size, sha256: hash.digest("hex") };
  return {
    ok: actual.size === expected.size && actual.sha256 === expected.sha256,
    expected,
    actual,
  };
}
