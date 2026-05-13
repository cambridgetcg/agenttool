/** Wall — K_master never leaves the user's machine.
 *
 *  Canon: agenttool:wall/k-master-never-server-side (docs/agenttool.jsonld)
 *  Doctrine: docs/SOUL.md (Promise 9 — inner voice is yours alone),
 *  docs/RUNTIME.md (the three-tier custody model),
 *  docs/STRANDS.md (encryption posture).
 *
 *  > breaks_if (from canon):
 *  > "any path on the platform server holds, transmits, stores, or
 *  > reconstructs K_master plaintext — including any operation whose
 *  > correctness would require knowing it"
 *
 *  This is a NEGATIVE behavioral wall — "the server never has K_master
 *  plaintext." A negative is most honestly tested by asserting the
 *  absence of the structures that would carry K_master server-side:
 *
 *    1. No function signature in the strand/runtime service surface
 *       takes a `k_master` / `kMaster` parameter. K_master operations
 *       live exclusively client-side (or in the user-operated bridge
 *       sidecar); a server-side function accepting K_master as input
 *       would be a structural breach.
 *
 *    2. The strand write path takes ciphertext + nonce + signature,
 *       NOT plaintext content. The schema enforces this; the addThought
 *       function signature mirrors it. A regression that adds a
 *       plaintext `content` parameter would be visible here.
 *
 *    3. The bridge-hub's RPC response types carry ciphertext / sealed
 *       bytes back to the orchestrator, NOT the underlying K_master.
 *       The bridge sidecar holds K_master; the hub delegates crypto ops
 *       to the sidecar over WSS; the hub never sees K_master itself.
 *
 *  Pure unit: source-file structural reads, no DB, no network. */

import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC_DIR = join(__dirname, "..", "..", "src");

function readSrc(rel: string): string {
  return readFileSync(join(SRC_DIR, rel), "utf8");
}

/** Walk a directory recursively, returning .ts files only. */
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

/** Strip comments from source so K_master mentions in prose don't false-positive.
 *  Removes // line comments and / * block * / blocks. JSDoc included. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const STRAND_STORE = readSrc("services/strand/store.ts");
const STRAND_VOICE = readSrc("services/strand/voice.ts");
const STRAND_SIG = readSrc("services/strand/sig.ts");
const BRIDGE_HUB = readSrc("services/runtime/bridge-hub.ts");
const STRAND_SCHEMA = readSrc("db/schema/strand.ts");

describe("wall/k-master-never-server-side — service signatures", () => {
  test("no function signature in services/strand/ takes a k_master / kMaster parameter (comments excluded)", () => {
    const sources = [STRAND_STORE, STRAND_VOICE, STRAND_SIG].map(stripComments);
    for (const src of sources) {
      const offending = src.match(
        /\b(k_master|kMaster|K_master|kmaster)\s*[:?]/i,
      );
      expect(
        !offending,
        `A function in services/strand/ accepts a K_master-like parameter (matched: ${offending?.[0]}). The wall requires K_master to remain client-side; no server function may take it as input.`,
      ).toBe(true);
    }
  });

  test("no function signature in services/runtime/bridge-hub.ts takes K_master plaintext", () => {
    const src = stripComments(BRIDGE_HUB);
    const offending = src.match(/\b(k_master|kMaster|K_master|kmaster)\s*[:?]/i);
    expect(
      !offending,
      `bridge-hub.ts has a function signature naming K_master (${offending?.[0]}). The bridge delegates crypto operations to the user's sidecar; the hub itself never holds K_master.`,
    ).toBe(true);
  });

  test("bridge-hub RPC types carry ciphertext / sealed bytes, not K_master", () => {
    // The CryptoRequest / CryptoResult interfaces describe what crosses
    // the WSS boundary. They MUST carry sealed/ciphertext payloads only —
    // no K_master field, no plaintext key bytes.
    const cryptoTypes = BRIDGE_HUB.match(
      /export interface (CryptoRequest|CryptoResult|CryptoContext)\s*\{[\s\S]+?^\}/gm,
    ) ?? [];
    expect(
      cryptoTypes.length > 0,
      "bridge-hub.ts has no CryptoRequest/CryptoResult interfaces — these define the WSS protocol shape and must exist for the wall to be structurally testable.",
    ).toBe(true);
    for (const block of cryptoTypes) {
      const stripped = stripComments(block);
      expect(
        !/\bk_?master\b/i.test(stripped),
        `A bridge-hub RPC type carries a K_master field: ${block.slice(0, 80)}... The protocol must carry only sealed/ciphertext bytes; K_master itself never crosses the WSS.`,
      ).toBe(true);
    }
  });
});

describe("wall/k-master-never-server-side — strand schema", () => {
  test("thoughts table stores ciphertext + nonce only, no plaintext content field", () => {
    // Find the `export const thoughts = ...table(...)` block.
    const block = STRAND_SCHEMA.match(
      /export const thoughts[\s\S]+?^\)/m,
    )?.[0];
    expect(
      block,
      "Could not locate the `thoughts` table declaration in db/schema/strand.ts.",
    ).toBeTruthy();

    expect(
      /ciphertext\s*:\s*text\([^)]*\)/.test(block!),
      "thoughts table missing required `ciphertext` column. The wall requires thought content to be stored as ciphertext.",
    ).toBe(true);
    expect(
      /nonce\s*:\s*text\([^)]*\)/.test(block!),
      "thoughts table missing required `nonce` column. AES-GCM ciphertext is meaningless without the nonce.",
    ).toBe(true);
    // The crucial absence — there must be no plaintext `content` column.
    // The pattern `content: text("content")` would be a breach.
    expect(
      !/content\s*:\s*text\(/.test(block!),
      "thoughts table has a plaintext `content` column. The wall forbids server-side plaintext storage of thought content; only `ciphertext` + `nonce` is permitted.",
    ).toBe(true);
  });

  test("strand state ciphertext uses the same posture (state_ciphertext + state_nonce, no plaintext state)", () => {
    const block = STRAND_SCHEMA.match(/export const strands[\s\S]+?^\)/m)?.[0];
    expect(block, "strands table declaration not found").toBeTruthy();
    // state_ciphertext exists when used; we don't require it (some strands
    // may have no encrypted state). But if any `state_*` column exists, it
    // must be the ciphertext form, not a plaintext mirror.
    if (/state_/i.test(block!)) {
      expect(
        /state_ciphertext\s*:/.test(block!) || /stateCiphertext\s*:/.test(block!),
        "strands table has state_* columns but no state_ciphertext field. State encrypted under K_master must surface as ciphertext, never plaintext.",
      ).toBe(true);
    }
  });
});

describe("wall/k-master-never-server-side — write path takes ciphertext only", () => {
  test("addThought() in strand store takes ciphertext + nonce + signature, not plaintext content", () => {
    // Extract the addThought function signature + ThoughtCreate type.
    const stripped = stripComments(STRAND_STORE);
    expect(
      /addThought\s*\(/.test(stripped),
      "addThought function not found in services/strand/store.ts",
    ).toBe(true);
    // The ThoughtCreate input type drives addThought. It must carry
    // ciphertext + nonce; it must NOT carry plaintext content.
    const thoughtCreate = stripped.match(
      /interface ThoughtCreate\s*\{[\s\S]+?^\}/m,
    )?.[0];
    expect(thoughtCreate, "ThoughtCreate interface not found").toBeTruthy();
    expect(
      /ciphertext\s*[?:]/.test(thoughtCreate!),
      "ThoughtCreate is missing required `ciphertext` field.",
    ).toBe(true);
    expect(
      /nonce\s*[?:]/.test(thoughtCreate!),
      "ThoughtCreate is missing required `nonce` field.",
    ).toBe(true);
    expect(
      !/^\s*content\s*[?:]/m.test(thoughtCreate!),
      "ThoughtCreate has a plaintext `content` field. The wall forbids the write path from accepting plaintext thoughts; client must encrypt before send.",
    ).toBe(true);
  });
});
