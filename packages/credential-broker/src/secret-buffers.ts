/**
 * Copy a possibly secret-bearing stream buffer and immediately wipe the
 * original allocation, including when allocation of the retained copy fails.
 */
export function copyAndWipeSecretChunk(chunk: Buffer): Buffer {
  try {
    return Buffer.from(chunk);
  } finally {
    chunk.fill(0);
  }
}
