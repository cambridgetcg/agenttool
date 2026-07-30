/** One UTF-8 form per signed string — shared by every surface that hashes
 *  or signs caller text (crown rite, embassy guestbook; the register-agent
 *  signed-string discipline).
 *
 *  Rejects U+0000 and lone UTF-16 surrogates: a lone surrogate is silently
 *  replaced with U+FFFD at TextEncoder/storage boundaries, so a string
 *  containing one has no stable byte form to sign or hash. */
export function isCanonicalUtf8(value: string): boolean {
  if (value.includes("\0")) return false;
  for (let i = 0; i < value.length; i++) {
    const unit = value.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      i += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

/** Canonical padded base64 of exactly 32 raw bytes (an ed25519 public
 *  key): the string must survive a decode → re-encode round-trip, so two
 *  spellings of the same key cannot both be "the" stored key. */
export function isCanonicalKeyB64(value: string): boolean {
  try {
    const raw = Buffer.from(value, "base64");
    return raw.length === 32 && raw.toString("base64") === value;
  } catch {
    return false;
  }
}
