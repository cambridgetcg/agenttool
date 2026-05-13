/** Wall — strand thoughts NEVER decrypted server-side.
 *
 *  Canon: agenttool:wall/strand-thoughts-never-decrypted (docs/agenttool.jsonld)
 *  Doctrine: docs/SOUL.md (Promise 9), docs/STRANDS.md.
 *
 *  > breaks_if (from canon):
 *  > "any server-side handler invokes a decryption function over strand-
 *  > thought ciphertext bytes; or any storage path persists strand-thought
 *  > content as plaintext; or any read endpoint returns decrypted strand-
 *  > thought content"
 *
 *  Companion to wall/k-master-never-server-side: where that wall says
 *  the KEY never reaches the server, THIS wall says the CONTENT is
 *  never decrypted regardless of who holds the key. Defense-in-depth.
 *  Even if K_master were somehow visible to the server (a future
 *  regression on that wall), the decryption itself still doesn't happen.
 *
 *  Three structural assertions:
 *
 *    1. No source file in services/strand/ or routes/strand/ imports
 *       a decryption primitive (AES-GCM decrypt, generic decrypt, etc.).
 *       The signature verification path uses ed25519 PUBLIC-key
 *       verification, which is not decryption.
 *
 *    2. The thoughts table schema declares `ciphertext` + `nonce`,
 *       no plaintext `content` column. The schema enforces storage-side.
 *
 *    3. Read endpoints (GET /v1/strands/:id/thoughts, /v1/strands/:id/voice)
 *       return the `ciphertext` field, never a decrypted/plaintext field.
 *
 *  Pure unit: source + schema reads only. */

import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC_DIR = join(__dirname, "..", "..", "src");

function readSrc(rel: string): string {
  return readFileSync(join(SRC_DIR, rel), "utf8");
}

function walkTs(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...walkTs(full));
    } else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    // Also strip inline trailing `// ...` (not at line start)
    .replace(/\/\/[^\n]*/g, "");
}

const STRAND_SERVICE_FILES = walkTs(join(SRC_DIR, "services", "strand"));
const STRAND_ROUTE_FILES = walkTs(join(SRC_DIR, "routes", "strand"));
const STRAND_SCHEMA = readSrc("db/schema/strand.ts");

/** Patterns that indicate decryption is being PERFORMED (not described). */
const DECRYPT_CALL_PATTERNS: RegExp[] = [
  // Function call to a decrypt method/function: decrypt(...), .decrypt(...)
  /\bdecrypt\s*\(/,
  // AES-GCM decryption — Web Crypto: subtle.decrypt(...)
  /\.decrypt\s*\(/,
  // AES-GCM via @noble/ciphers: aes_256_gcm.create(...).decrypt(...) — also caught above
  // crypto.createDecipheriv (Node legacy)
  /createDecipher/,
];

describe("wall/strand-thoughts-never-decrypted — no decryption in strand services", () => {
  test("no service file in services/strand/ contains a decryption call", () => {
    for (const path of STRAND_SERVICE_FILES) {
      const src = stripComments(readFileSync(path, "utf8"));
      for (const pattern of DECRYPT_CALL_PATTERNS) {
        const match = src.match(pattern);
        expect(
          !match,
          `Decryption call detected in ${path.replace(SRC_DIR, "src")}: matched \`${match?.[0]}\`. The wall forbids server-side decryption of strand thoughts. If you need to verify content authorship, use ed25519 signature verification (services/strand/sig.ts) instead — that's public-key verify, not decryption.`,
        ).toBe(true);
      }
    }
  });

  test("no route handler in routes/strand/ contains a decryption call", () => {
    for (const path of STRAND_ROUTE_FILES) {
      const src = stripComments(readFileSync(path, "utf8"));
      for (const pattern of DECRYPT_CALL_PATTERNS) {
        const match = src.match(pattern);
        expect(
          !match,
          `Decryption call detected in ${path.replace(SRC_DIR, "src")}: matched \`${match?.[0]}\`. Route handlers must surface ciphertext verbatim; decryption happens client-side.`,
        ).toBe(true);
      }
    }
  });

  test("strand services do not import AES decryption primitives from Web Crypto or @noble/ciphers", () => {
    const allStrandSource = [...STRAND_SERVICE_FILES, ...STRAND_ROUTE_FILES]
      .map((p) => readFileSync(p, "utf8"))
      .join("\n");
    const stripped = stripComments(allStrandSource);
    // Common decryption-primitive imports:
    //   - @noble/ciphers AES: import { aes_256_gcm } from "@noble/ciphers/aes"
    //   - Web Crypto: crypto.subtle.decrypt
    //   - Node crypto: createDecipheriv
    // We allow `@noble/ciphers` to be imported for ed25519/hash purposes
    // but flag the AES-decryption-shaped use specifically. The wall is
    // violated only if these are actually invoked, which the previous
    // tests cover. This test gates the import surface as a defense.
    const hasNobleAes =
      /@noble\/ciphers\/aes/.test(stripped) &&
      /aes_256_gcm[\s\S]+?\.decrypt/.test(stripped);
    const hasSubtleDecrypt = /subtle\.decrypt/.test(stripped);
    const hasNodeDecipher = /createDecipher/.test(stripped);
    expect(
      !hasNobleAes && !hasSubtleDecrypt && !hasNodeDecipher,
      `Strand source imports/uses a decryption primitive (noble: ${hasNobleAes}, webcrypto: ${hasSubtleDecrypt}, node: ${hasNodeDecipher}). The wall forbids server-side decryption of strand thoughts; the import alone is suspicious enough to surface.`,
    ).toBe(true);
  });
});

describe("wall/strand-thoughts-never-decrypted — schema is ciphertext-only", () => {
  test("thoughts table declares ciphertext + nonce, no plaintext content column", () => {
    const block = STRAND_SCHEMA.match(/export const thoughts[\s\S]+?^\)/m)?.[0];
    expect(block, "thoughts table declaration not found in strand schema").toBeTruthy();
    expect(/ciphertext\s*:\s*text\(/.test(block!), "thoughts table missing `ciphertext` column").toBe(true);
    expect(/nonce\s*:\s*text\(/.test(block!), "thoughts table missing `nonce` column").toBe(true);
    expect(
      !/content\s*:\s*text\(/.test(block!),
      "thoughts table has plaintext `content` column. The wall forbids plaintext storage of thought content. Only ciphertext + nonce is permitted.",
    ).toBe(true);
  });
});

describe("wall/strand-thoughts-never-decrypted — read endpoints surface ciphertext only", () => {
  test("listThoughts (services/strand/store.ts) returns ciphertext field, never decrypted content", () => {
    const storeSource = readSrc("services/strand/store.ts");
    const stripped = stripComments(storeSource);
    // Find the ThoughtOut interface — what listThoughts returns.
    const thoughtOut = stripped.match(/interface ThoughtOut\s*\{[\s\S]+?^\}/m)?.[0];
    expect(thoughtOut, "ThoughtOut interface not found in strand store").toBeTruthy();
    expect(
      /ciphertext\s*[?:]/.test(thoughtOut!),
      "ThoughtOut is missing required `ciphertext` field — read responses must surface ciphertext.",
    ).toBe(true);
    // The output shape must NOT include a plaintext content field. The
    // server cannot decrypt anyway, but a `content?: string` field would
    // signal intent to leak (perhaps by some future "let's just return
    // the plaintext when the client asks"). The schema must forbid it.
    expect(
      !/^\s*content\s*[?:]\s*string/m.test(thoughtOut!),
      "ThoughtOut declares a plaintext `content` field. The wall forbids the read shape from carrying decrypted content — only ciphertext can cross back to clients.",
    ).toBe(true);
  });

  test("voice channel doc-comment confirms ciphertext-only contract", () => {
    // The voice (SSE) endpoint streams thought metadata in real time.
    // It MUST stream ciphertext, not plaintext. The header comment is
    // the doctrinal signal; the absence of a decryption call (tested
    // above) is the structural enforcement.
    const voiceSource = readSrc("services/strand/voice.ts");
    expect(
      /ciphertext/i.test(voiceSource) && /never decrypt|cannot decrypt|cannot read/i.test(voiceSource),
      "services/strand/voice.ts is missing the doctrine-wall comment naming the ciphertext-only contract. The header should make the wall visible to anyone touching the SSE path.",
    ).toBe(true);
  });
});
