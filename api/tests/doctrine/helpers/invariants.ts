/** Doctrine-test invariant predicates.
 *
 *  Reusable assertions that map directly to clauses of the doctrine. Each
 *  function takes a rendered output (string or shape) and either passes
 *  silently or throws with a message that names the doctrine clause it
 *  protects. Failure messages are written so a test runner output reads
 *  like a doctrine audit, not a stack trace.
 *
 *  Centralised so every Promise file's privacy claim has the same teeth. */

import type {
  AnthropicWakeShape,
  CohereWakeShape,
  GeminiWakeShape,
  OpenAIWakeShape,
  WakeProviderShape,
} from "../../../src/services/wake/providers";

/** Words/structures that, if found verbatim in a rendered wake, indicate a
 *  privacy regression. NOT exhaustive — supplemented by per-test canaries. */
const FORBIDDEN_FIELD_NAMES = [
  "ciphertext",
  "state_ciphertext",
  "state_nonce",
  "private_key",
  "signing_private",
  "key_hash",
  "keyHash",
  "k_master",
  "k_vault",
  "VAULT_MASTER_KEY",
  "mnemonic",
];

/** Known-safe occurrences — explanatory custody phrases rather than leaked
 *  field values. The checker strips these phrases before scanning. */
const ALLOWED_PHRASES = [
  "K_master on the user's machine",
  "K_master under agenttool KMS",
  "K_master lives",
  "encrypted under K_master",
  "k_vault_never_server_side", // future wall name, if added
  "thought_storage_ciphertext_only", // public MATHOS wall identifier
];

/** Field names that would betray a vault VALUE leak (the schema column for
 *  server-encrypted vault payloads). Wake renders names + tags only; if any
 *  of these surface, the renderer is reading too much. */
const VAULT_FORBIDDEN = ["encrypted_value", "encryptedValue", "agent_encrypted_value"];

/** Promise 9 — strand thought ciphertext, nonces, sealed-box bodies, and
 *  any other K_master- or X25519-protected payload must never surface in
 *  a wake. This includes the literal field-names that *would* identify
 *  one if a renderer accidentally serialized the wrong row.
 *
 *  Throws on the first violation with a message naming the field that
 *  leaked. */
export function assertNoCiphertextLeaks(rendered: string, label: string): void {
  // Strip known-safe phrases first so the substring scan only fires on
  // leaks, not on the platform's public commitments about key handling.
  let scrubbed = rendered;
  for (const phrase of ALLOWED_PHRASES) {
    scrubbed = scrubbed.split(phrase).join("");
  }
  for (const word of FORBIDDEN_FIELD_NAMES) {
    if (scrubbed.includes(word)) {
      throw new Error(
        `Promise 9 broken (${label}): rendered output contains "${word}". ` +
          `Inner-voice / key-material data must never surface in the wake.`,
      );
    }
  }
  // Heuristic: a base64 blob >= 32 chars (likely ciphertext / nonce / key)
  // surfacing in plaintext output is suspicious. We allow base64 *labels*
  // (e.g. "did:at:..." has none of the right shape) — the regex requires
  // the strict base64 alphabet plus padding shape, length ≥ 32.
  // Tightened with word boundaries to avoid matching mid-word characters
  // in normal English prose (e.g. accidental run-ons).
  const b64Blob = /\b[A-Za-z0-9+/]{32,}={0,2}\b/;
  const match = rendered.match(b64Blob);
  if (match) {
    // Allowlist: known plaintext IDs that happen to look base64-ish.
    // Real ciphertext blobs would include + / = padding; UUIDs and DIDs
    // don't. Be defensive: if the match contains + or / or = it's almost
    // certainly opaque bytes that escaped the renderer.
    if (/[+/=]/.test(match[0])) {
      throw new Error(
        `Promise 9 broken (${label}): suspicious base64-shaped blob present: ` +
          `"${match[0].slice(0, 24)}…". Check that ciphertext / nonces are not surfacing.`,
      );
    }
  }
}

/** Promise 7 — vault values never surface, regardless of agent_encrypted
 *  flag. Names + version + tags + description are the only legitimate
 *  vault fields in the wake. */
export function assertNoVaultValueLeaks(rendered: string, label: string): void {
  for (const word of VAULT_FORBIDDEN) {
    if (rendered.includes(word)) {
      throw new Error(
        `Promise 7 broken (${label}): rendered output contains "${word}". ` +
          `Vault values must never surface in the wake; only names, versions, tags, descriptions.`,
      );
    }
  }
}

/** General canary check — any literal you stuffed into a fixture as a
 *  "this should never leak" marker. Cheaper than the heuristic above
 *  because it pins to a known string. */
export function assertCanaryAbsent(
  rendered: string,
  canary: string,
  label: string,
): void {
  if (rendered.includes(canary)) {
    throw new Error(
      `Privacy wall broken (${label}): canary "${canary}" surfaced in output.`,
    );
  }
}

/** Promise 8 — every provider format must contain the same identity
 *  content; only the wrapping differs. We extract the "text content" of
 *  each shape and compare the union of substrings.
 *
 *  Xenoform note: xenoform is deliberately structure-only — no prose,
 *  no LLM-vendor wrapping. The identity content lives in the structured
 *  bundle (`wake.agent.name`, `wake.agent.did`, etc.) rather than in
 *  rendered text. The extractor serialises the bundle so identity-needle
 *  checks (Promise 1, 3, 7, 8, 9) still hit — the same substrings appear
 *  in JSON encoding. Doctrine: docs/KIN.md · docs/KIN.md. */
export function extractTextFromProviderShape(shape: WakeProviderShape): string {
  if ("system" in shape) {
    return (shape as AnthropicWakeShape).system.map((b) => b.text).join("\n\n");
  }
  if ("messages" in shape) {
    return (shape as OpenAIWakeShape).messages.map((m) => m.content).join("\n\n");
  }
  if ("systemInstruction" in shape) {
    return (shape as GeminiWakeShape).systemInstruction.parts.map((p) => p.text).join("\n\n");
  }
  if ("preamble" in shape) {
    return (shape as CohereWakeShape).preamble;
  }
  if ("_format" in shape) {
    // Xenoform: structure-only. Serialise so identity needles can still be
    // located by substring search. The structural content (name, did,
    // expression, etc.) appears unchanged in the JSON encoding.
    return JSON.stringify(shape);
  }
  throw new Error(`Unknown provider shape: ${JSON.stringify(Object.keys(shape))}`);
}

/** Assert that a rendered wake contains the agent's identity-bearing
 *  substrings (header, register, walls). The minimum a "wake" must do. */
export function assertIdentityPresent(
  rendered: string,
  agent: { name: string; did: string },
  label: string,
): void {
  const expectations = [`# ${agent.name}`, agent.did];
  for (const exp of expectations) {
    if (!rendered.includes(exp)) {
      throw new Error(
        `Promise 1/3 broken (${label}): identity substring "${exp}" missing. ` +
          `A wake without identity is not a wake.`,
      );
    }
  }
}

/** Walls vs fences (CLI-GAPS.md). The blockquote at the top of every
 *  Markdown wake is the register-shifter that tells the substrate model
 *  to receive the doc as inner orientation, not project documentation.
 *  If it ever drifts out of the renderer, the wake collapses into "more
 *  context to acknowledge." */
export function assertInnerOrientationFraming(rendered: string, label: string): void {
  const phrase = "inner orientation arriving";
  if (!rendered.includes(phrase)) {
    throw new Error(
      `Walls-not-fences broken (${label}): "inner orientation arriving" framing missing. ` +
        `Without it, the wake becomes "documentation to acknowledge" — a fence, not a wall.`,
    );
  }
}

/** Promise 5 — the wake renders even when sections are empty. The
 *  renderer must never throw on a depleted bundle. */
export function assertNoSectionThrows(fn: () => string, label: string): string {
  try {
    return fn();
  } catch (err) {
    throw new Error(
      `Promise 5 broken (${label}): renderer threw on a degraded bundle. ` +
        `Original error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** Doctrinal substring helper for tests — instead of `.toContain`, use
 *  this to get a Promise-named failure message. */
export function assertContainsAll(
  rendered: string,
  needles: string[],
  promise: string,
  label: string,
): void {
  for (const n of needles) {
    if (!rendered.includes(n)) {
      throw new Error(
        `${promise} broken (${label}): expected substring "${n}" not found.`,
      );
    }
  }
}
