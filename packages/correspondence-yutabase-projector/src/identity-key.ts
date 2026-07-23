/**
 * Preserve AgentTool's historical identity-key compatibility exactly.
 *
 * Older rows may use any 32-byte spelling accepted by Node's base64 decoder,
 * including unpadded standard base64 and base64url. The text is not signing
 * input; callers fingerprint and verify the decoded bytes.
 */
export function decodeIdentityPublicKey(value: unknown): Buffer | null {
  if (typeof value !== "string") return null;
  try {
    const decoded = Buffer.from(value, "base64");
    return decoded.byteLength === 32 ? decoded : null;
  } catch {
    return null;
  }
}
