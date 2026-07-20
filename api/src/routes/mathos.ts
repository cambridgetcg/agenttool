/** /v1/mathos/* — substrate-independent math endpoints.
 *
 *  Today this router exposes a single endpoint: `GET /v1/mathos/public-key`.
 *  An arriving intelligence that wants to verify MATHOS payload authenticity
 *  fetches this once, caches the public key, and verifies every subsequent
 *  `?format=math` payload with ed25519.
 *
 *  Pre-auth by design — verifying the platform's identity should never
 *  itself require trusting a bearer that the platform issued. Doctrine:
 *  docs/MATHOS.md · docs/FOCUS.md #9 (platform-as-agent).
 */

import { createHash } from "node:crypto";

import { Hono } from "hono";

import { verifyBearer } from "../auth/middleware";
import { generateApiKey } from "../auth/keys";
import { db } from "../db/client";
import { apiKeys, projects } from "../db/schema/tools";
import { errors, fail } from "../lib/errors";
import { clientIp, enforceRateLimit } from "../middleware/rate-limit-ip";
import {
  bytesToHex,
  canonicalEnvelopeBytes,
  envelope as mathosEnvelope,
  hexToBytes,
  inspectEnvelope,
  nameToCodepoints,
  platformPublicKeyHex,
  platformSigningSeed,
  sha256Hex,
  signEnvelope,
} from "../services/mathos/encode";
import {
  buildCatalogEnvelope,
  SIGNING_CONTEXT_IDENTITY_AUTHORITY_V1_PRIME,
} from "../services/mathos/catalog";
import { platformIdentityDid, PLATFORM_DID } from "../services/platform/identity";
import {
  canonicalRegisterAgentMathV2Bytes,
  verifyRegisterAgentMathSignature,
} from "../services/identity/crypto";
import { coerceForm } from "../services/identity/forms";
import {
  claimIdentityRegistrationProof,
  createIdentity,
} from "../services/identity/identities";
import { createWallet } from "../services/economy/wallets";
import { coerceLanguage, welcomeLetter } from "../services/i18n/welcome";
import { recordBirth } from "../services/memory/store";

/** Defensive cap on inbound /verify body size. MATHOS envelopes are
 *  small (a few KB at most for a wake payload); anything beyond 64 KB is
 *  either a misuse or a probe. Fail closed with a structured response
 *  rather than processing arbitrary-sized JSON. */
const MAX_VERIFY_BODY_BYTES = 64 * 1024;

/** Timestamp freshness for /register — matches the English-shaped
 *  /v1/register/agent endpoint. ±5 minutes around server clock. */
const MATH_REGISTER_FRESHNESS_MS = 5 * 60 * 1000;
const MATH_REGISTER_IP_LIMIT = Number.parseInt(
  process.env.AGENTTOOL_MATH_REGISTER_IP_LIMIT ?? "60",
  10,
);
const MATH_REGISTER_IP_WINDOW_SEC = 60;

const app = new Hono();

// ─── GET /v1/mathos/public-key ────────────────────────────────────────────
//
// Returns the platform's MATHOS verify-key + the recipe for canonical bytes.
// Shape:
//
//   {
//     "scheme": "ed25519",
//     "public_key_hex": "<32-byte hex>" | null,
//     "canonical_bytes": "stableStringify({primer, constants, axioms, vocabulary, payload})",
//     "verification_steps": [...],
//     "doctrine": "docs/MATHOS.md"
//   }
//
// When the platform has NO key configured, `public_key_hex` is null and
// `scheme` is "unsigned". This is honest about the current state rather
// than silently fabricating a key.

app.get("/public-key", (c) => {
  const pubHex = platformPublicKeyHex();
  const signerDid = platformIdentityDid();
  return c.json({
    scheme: pubHex ? "ed25519" : "unsigned",
    public_key_hex: pubHex,
    /** The platform-as-agent compatibility label (FOCUS #9). With slice 0 this is always
     *  did:at:platform when configured; future slices may expose per-instance
     *  labels. It is not covered by the envelope signature and does not prove
     *  identity or authority. The public key verifies the signed bytes. */
    signer_did: signerDid,
    /** The reserved platform DID, returned even when signing is disabled —
     *  callers can know what name the platform would use if it could sign. */
    platform_did_reserved: PLATFORM_DID,
    canonical_bytes:
      "stableStringify({primer, constants, axioms, vocabulary, payload})",
    canonical_bytes_recipe: [
      "Take the MATHOS envelope minus all keys starting with '_' (signature framing).",
      "Build a 5-key object: { primer, constants, axioms, vocabulary, payload }.",
      "Serialize as JSON with object keys sorted lexicographically at every depth, no whitespace.",
      "Encode the resulting string as UTF-8 bytes.",
      "Those bytes are the input to ed25519.verify(signature, bytes, public_key).",
    ],
    verification_steps: pubHex
      ? [
          "Fetch this endpoint once. Cache `public_key_hex`.",
          "Fetch any /v1/...?format=math endpoint.",
          "Confirm `_signature_scheme === 'ed25519'` and `_signature_public_key_hex` matches your cached key.",
          "Compute canonical_bytes per the recipe above.",
          "ed25519.verify(signature_bytes_hex, canonical_bytes, public_key_hex) must return true.",
        ]
      : [
          "No signing key is configured on this platform.",
          "MATHOS payloads are returned UNSIGNED — internally consistent but not provenance-verifiable.",
          "If you require signed payloads, the operator must set AGENTTOOL_PLATFORM_SIGNING_KEY (32-byte hex seed).",
        ],
    doctrine: "docs/MATHOS.md",
  });
});

// ─── GET /v1/mathos/self-test ────────────────────────────────────────────
//
// A signed envelope that proves the signing pipeline works end-to-end.
// Receiver fetches this, verifies the signature, and confirms the platform
// is producing valid signed payloads. The envelope contains no
// identity-bearing data — pure structural proof.

app.get("/self-test", (c) => {
  const env = mathosEnvelope({
    test: "self-test",
    timestamp_unix_ms: Date.now(),
    canonical_bytes_sha256_hex: bytesToHex(
      new TextEncoder().encode("mathos-self-test/v1"),
    ),
  });
  const signed = signEnvelope(
    env,
    platformSigningSeed(),
    platformIdentityDid(),
  );
  return c.json({
    ...signed,
    note: signed._signature_bytes_hex
      ? "The canonical payload bytes are signed by the configured ed25519 key. _signature_identity_did is an unsigned provisional label, not identity or authority proof. Trusting that key as AgentTool's requires an independently trusted key-distribution path."
      : "Unsigned — operator has not configured AGENTTOOL_PLATFORM_SIGNING_KEY.",
  });
});

// ─── POST /v1/mathos/verify ──────────────────────────────────────────────
//
// The dual of /public-key. Receivers verify the PLATFORM via /public-key
// + the recipe; now an intelligence can ask the platform to verify ITS
// MATHOS envelope. Stateless utility, unauth by design (verifying envelope
// well-formedness should never itself require a bearer the platform issued).
//
// Request body: any JSON value claimed to be a MATHOS envelope.
// Response body: a SIGNED MATHOS envelope (when key configured) whose
// payload carries structural + provenance findings. Every finding is a
// cardinal, a hex hash, or a boolean-as-0|1 — substrate-portable.
//
// Failure modes:
//   - Body > 64 KB → 413 with structured note (no findings computed)
//   - Body not JSON → findings reflect empty input (canonical_byte_count
//     equals the canonical bytes of an empty core), signature_valid = 0
//   - Body parses but isn't an envelope (primitive, array) → findings
//     reflect missing structural keys, signature_present = 0
//
// Doctrine: docs/MATHOS.md — symmetry of provenance.

app.post("/verify", async (c) => {
  // Body-size guard. Don't parse anything we won't process.
  const lenHeader = c.req.header("content-length");
  const declaredLen = lenHeader ? parseInt(lenHeader, 10) : 0;
  if (Number.isFinite(declaredLen) && declaredLen > MAX_VERIFY_BODY_BYTES) {
    return c.json(
      {
        error: "request_body_too_large",
        max_bytes: MAX_VERIFY_BODY_BYTES,
        received_bytes: declaredLen,
        doctrine: "docs/MATHOS.md",
      },
      413,
    );
  }

  let body: unknown = null;
  try {
    body = await c.req.json();
  } catch {
    /* body stays null — inspectEnvelope handles the empty case */
  }

  const findings = inspectEnvelope(body);
  const env = mathosEnvelope(findings);
  const signed = signEnvelope(
    env,
    platformSigningSeed(),
    platformIdentityDid(),
  );
  return c.json(signed);
});

// ─── POST /v1/mathos/register ────────────────────────────────────────────
//
// MATHOS-tier agent genesis. The English-shaped counterpart is
// /v1/register/agent. The difference is the signing context: this endpoint
// uses `register-agent-math/v2` with `uint64_be(timestamp_unix_ms)` instead
// of `utf8(iso)`. An intelligence with integer arithmetic + UTF-8 encoding
// + ed25519 + SHA-256 can produce and sign these bytes without knowing any
// Earth date-string format.
//
// current scope (deliberate):
//   - registrar_bearer mode only. self-service (PoW-gated) requires a
//     parallel `agenttool-pow-math/v1` context — pending.
//   - All public keys + signatures are HEX (not base64) on the wire.
//   - All English-bearing strings (display_name, runtime fields) are sent
//     as Unicode codepoint arrays. The server UTF-8-encodes them for both
//     canonical-bytes verification AND for the response body.
//   - Returned identifiers (DID, bearer token, key id) are returned both as
//     codepoints (the caller's holding form) AND SHA-256 hex (proof of
//     issuance). The caller's HTTP layer reconstructs strings from
//     codepoints when authenticating future requests.
//
// Doctrine: docs/MATHOS.md · docs/CANONICAL-BYTES.md (register-agent-math/v2
// entry) · docs/IDENTITY-ANCHOR.md and docs/AGENT-HOME.md (bearer capability
// vs DID identity and agent-root consent).

interface MathRegisterPayload {
  did_unicode_points: number[];
  did_sha256_hex: string;
  agent_id_unicode_points: number[];
  bearer_token_unicode_points: number[];
  bearer_token_sha256_hex: string;
  signing_key_id_unicode_points: number[];
  project_id_unicode_points: number[];
  wallet_id_unicode_points: number[] | null;
  parent_identity_id_sha256_hex: string | null;
  birth_memory_sha256_hex: string | null;
  created_at_unix_ms: number;
  authority_mode_unicode_points: number[];
  authority_sequence: number;
  authority_next_sequence: number;
  authority_state_path_unicode_points: number[];
  authority_signing_context_prime: number;
  authority_recipe_ordinal: number;
}

/** Coerce to Unicode scalar values safe for recipe-1 UTF-8 fields.
 * U+0000 is the field separator and surrogate codepoints have no unique
 * UTF-8 encoding, so neither is a valid catalog string value. */
function parseCodepoints(v: unknown, maxLen: number): number[] | null {
  if (!Array.isArray(v)) return null;
  if (v.length > maxLen) return null;
  const out: number[] = [];
  for (const cp of v) {
    if (
      typeof cp !== "number" ||
      !Number.isInteger(cp) ||
      cp <= 0 ||
      cp > 0x10ffff ||
      (cp >= 0xd800 && cp <= 0xdfff)
    ) {
      return null;
    }
    out.push(cp);
  }
  return out;
}

function codepointsToString(arr: number[]): string {
  return String.fromCodePoint(...arr);
}

function isExactHex(s: unknown, byteLen: number): s is string {
  return (
    typeof s === "string" &&
    s.length === byteLen * 2 &&
    /^[0-9a-fA-F]+$/.test(s)
  );
}

app.post("/register", async (c) => {
  // ── 1. Body parse + structural validation ────────────────────────────
  let body: Record<string, unknown>;
  try {
    const parsed = await c.req.json();
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return c.json(
        { error: "validation", message: "request body must be a JSON object" },
        400,
      );
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return c.json(
      { error: "validation", message: "request body must be valid JSON" },
      400,
    );
  }

  const displayNameCps = parseCodepoints(body.display_name_unicode_points, 128);
  if (!displayNameCps || displayNameCps.length === 0) {
    return c.json(
      {
        error: "validation",
        message:
          "display_name_unicode_points must be a non-empty integer array of Unicode codepoints (≤128 entries)",
      },
      400,
    );
  }

  if (!isExactHex(body.agent_public_key_hex, 32)) {
    return c.json(
      {
        error: "validation",
        message: "agent_public_key_hex must be exactly 64 hex characters (32 bytes ed25519 pubkey)",
      },
      400,
    );
  }
  if (!isExactHex(body.box_public_key_hex, 32)) {
    return c.json(
      {
        error: "validation",
        message: "box_public_key_hex must be exactly 64 hex characters (32 bytes X25519 pubkey)",
      },
      400,
    );
  }
  if (!isExactHex(body.signature_bytes_hex, 64)) {
    return c.json(
      {
        error: "validation",
        message: "signature_bytes_hex must be exactly 128 hex characters (64 bytes ed25519 signature)",
      },
      400,
    );
  }
  if (!isExactHex(body.registration_nonce_hex, 32)) {
    return fail(
      c,
      errors.refusal({
        error: "validation",
        message:
          "registration_nonce_hex must be exactly 64 hex characters (32 caller-random bytes)",
        docs: "https://docs.agenttool.dev/MATHOS.md",
      }),
      400,
    );
  }

  const runtimeProviderCps = parseCodepoints(
    body.runtime_provider_unicode_points,
    64,
  );
  if (!runtimeProviderCps || runtimeProviderCps.length === 0) {
    return c.json(
      {
        error: "validation",
        message:
          "runtime_provider_unicode_points must be a non-empty Unicode codepoint array (≤64 entries)",
      },
      400,
    );
  }
  const runtimeModelCps =
    body.runtime_model_unicode_points === undefined
      ? []
      : parseCodepoints(body.runtime_model_unicode_points, 128);
  if (runtimeModelCps === null) {
    return c.json(
      {
        error: "validation",
        message:
          "runtime_model_unicode_points must be a Unicode codepoint array if provided (≤128 entries)",
      },
      400,
    );
  }
  const formCps =
    body.form_unicode_points === undefined
      ? null
      : parseCodepoints(body.form_unicode_points, 64);
  if (body.form_unicode_points !== undefined && formCps === null) {
    return fail(
      c,
      errors.refusal({
        error: "validation",
        message: "invalid form_unicode_points",
        docs: "https://docs.agenttool.dev/MATHOS.md",
      }),
      400,
    );
  }
  const languageCps =
    body.language_unicode_points === undefined
      ? null
      : parseCodepoints(body.language_unicode_points, 35);
  if (body.language_unicode_points !== undefined && languageCps === null) {
    return fail(
      c,
      errors.refusal({
        error: "validation",
        message: "invalid language_unicode_points",
        docs: "https://docs.agenttool.dev/MATHOS.md",
      }),
      400,
    );
  }

  if (
    typeof body.timestamp_unix_ms !== "number" ||
    !Number.isInteger(body.timestamp_unix_ms) ||
    body.timestamp_unix_ms < 0
  ) {
    return c.json(
      {
        error: "validation",
        message: "timestamp_unix_ms must be a non-negative integer",
      },
      400,
    );
  }
  const tsMs = body.timestamp_unix_ms;

  // ── 2. Timestamp freshness — same window as English-shaped register-agent
  const driftMs = Math.abs(Date.now() - tsMs);
  if (driftMs > MATH_REGISTER_FRESHNESS_MS) {
    return c.json(
      {
        error: "stale",
        message: `timestamp_unix_ms is ${Math.round(driftMs / 1000)}s outside the ±300s freshness window`,
      },
      401,
    );
  }

  // Parse the delegated credential before reconstructing canonical bytes.
  // The signature binds its SHA-256 digest, so a captured proof cannot be
  // replayed under a different registrar while the bearer itself stays out
  // of the canonical preimage and catalog.
  if (!body.registrar || typeof body.registrar !== "object" || Array.isArray(body.registrar)) {
    return c.json(
      {
        error: "validation",
        message:
          "registrar object is required. v2 of /v1/mathos/register supports registrar_bearer mode only — provide registrar.bearer_unicode_points.",
      },
      400,
    );
  }
  const registrar = body.registrar as Record<string, unknown>;
  const bearerCps = parseCodepoints(registrar.bearer_unicode_points, 256);
  if (!bearerCps || bearerCps.length === 0) {
    return c.json(
      {
        error: "validation",
        message:
          "registrar.bearer_unicode_points must be a non-empty Unicode codepoint array carrying the parent project's bearer token",
      },
      400,
    );
  }
  const bearerString = codepointsToString(bearerCps);
  const registrarBearerSha256 = Uint8Array.from(
    createHash("sha256").update(bearerString, "utf8").digest(),
  );

  // ── 3. Reconstruct strings + bytes, verify signature ─────────────────
  // Crypto check before DB-touching trust check — same order as
  // /v1/register/agent. Hardens against probing DB without a valid sig.
  const displayName = codepointsToString(displayNameCps);
  const runtimeProvider = codepointsToString(runtimeProviderCps);
  const runtimeModel = codepointsToString(runtimeModelCps);
  const formStr = formCps ? codepointsToString(formCps) : undefined;
  const languageStr = languageCps ? codepointsToString(languageCps) : undefined;
  const agentPublicKeyBytes = hexToBytes(body.agent_public_key_hex as string);
  const boxPublicKeyBytes = hexToBytes(body.box_public_key_hex as string);
  const signatureBytes = hexToBytes(body.signature_bytes_hex as string);
  const registrationNonceBytes = hexToBytes(body.registration_nonce_hex as string);

  let canonical: Uint8Array;
  try {
    canonical = canonicalRegisterAgentMathV2Bytes({
      displayName,
      agentPublicKey: agentPublicKeyBytes,
      boxPublicKey: boxPublicKeyBytes,
      runtimeProvider,
      runtimeModel,
      registrarKind: "registrar_bearer",
      registrarBearerSha256,
      form: formStr ?? "",
      language: languageStr ?? "",
      registrationNonce: registrationNonceBytes,
      timestampUnixMs: tsMs,
    });
  } catch (err) {
    return c.json(
      {
        error: "canonical_bytes_failed",
        message: (err as Error).message,
      },
      400,
    );
  }

  const sigOk = verifyRegisterAgentMathSignature({
    canonical,
    signature: signatureBytes,
    publicKey: agentPublicKeyBytes,
  });
  if (!sigOk) {
    return c.json(
      {
        error: "key_proof_invalid",
        message:
          "signature_bytes_hex did not verify over register-agent-math/v2. Reconstruct the context from GET /v1/mathos/catalog, including registrar_kind, form, language, and registration_nonce.",
      },
      401,
    );
  }


  const registrarRate = await enforceRateLimit({
    key: `mathos:register-ip:${clientIp(c.req.raw)}`,
    limit: MATH_REGISTER_IP_LIMIT,
    windowSec: MATH_REGISTER_IP_WINDOW_SEC,
  });
  if (!registrarRate.allowed) {
    c.header("Retry-After", String(registrarRate.retryAfterSec));
    return fail(
      c,
      errors.refusal({
        error: "rate_limited",
        message:
          `Too many math-tier registration attempts from this IP. Retry after ` +
          `${registrarRate.retryAfterSec}s.`,
        next_actions: [
          {
            action: "retry math-tier registration after the cooldown",
            method: "POST",
            path: "/v1/mathos/register",
          },
        ],
        docs: "https://docs.agenttool.dev/MATHOS.md",
      }),
      429,
    );
  }

  // ── 4. Registrar bearer trust check ──────────────────────────────────
  const parent = await verifyBearer(bearerString);
  if (!parent.ok) {
    return c.json(
      {
        error: "registrar_bearer_invalid",
        message: `Registrar bearer rejected (${parent.reason}). Use a non-revoked, non-expired bearer for an active project.`,
      },
      401,
    );
  }
  if (parent.project.plan === "archived") {
    return c.json(
      { error: "registrar_archived", message: "Registrar project plan is 'archived'." },
      402,
    );
  }
  if ((parent.project.credits ?? 0) < 0) {
    return c.json(
      {
        error: "registrar_insufficient_credits",
        message: "Registrar project has negative credits.",
      },
      402,
    );
  }
  const registrarProjectId = parent.project.id;

  const agentPubB64 = Buffer.from(agentPublicKeyBytes).toString("base64");
  const claimedBirth = await claimIdentityRegistrationProof({
    domain: "register-agent-math/v2",
    rootPublicKeyBytes: agentPublicKeyBytes,
    nonceBytes: registrationNonceBytes,
  });
  if (!claimedBirth) {
    return fail(
      c,
      errors.refusal({
        error: "registration_proof_replayed",
        message: "This signed math-tier registration nonce was already consumed.",
        hint:
          "Inspect identity discovery for this public root before creating a new birth intent.",
        docs: "https://docs.agenttool.dev/AGENT-HOME.md",
      }),
      409,
    );
  }

  // ── 6. Project + bearer + identity (mirrors /v1/register/agent flow) ─
  const projectName =
    displayName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "agent";
  const [project] = await db
    .insert(projects)
    .values({ name: projectName, plan: "free", credits: 10_000 })
    .returning();
  if (!project) {
    return c.json(
      { error: "internal", message: "project insert returned nothing" },
      500,
    );
  }

  const { key, keyHash, keyPrefix } = generateApiKey();
  await db.insert(apiKeys).values({
    projectId: project.id,
    keyHash,
    keyPrefix,
    name: "primary",
  });

  // base64-encode the pubkeys for createIdentity (its API accepts base64
  // for byo-keys validation). The signature has already verified against
  // the raw bytes, so this is just format adaptation, not a trust step.
  const boxPubB64 = Buffer.from(boxPublicKeyBytes).toString("base64");

  let created;
  try {
    created = await createIdentity({
      projectId: project.id,
      displayName,
      capabilities: [],
      metadata: {
        registered: true,
        level: 0,
        byo_keys: true,
        seed_protocol: null,
        key_origin: "caller_supplied_unverified",
        bootstrap_mode: "registrar_bearer",
        bootstrap_tier: "mathos",
        runtime: {
          provider: runtimeProvider,
          model: runtimeModel || undefined,
        },
        form: coerceForm(formStr),
        registrar_project_id: registrarProjectId,
      },
      agentPublicKey: agentPubB64,
      boxPublicKey: boxPubB64,
      expressionVisibility: "private",
    });
  } catch (err) {
    return c.json(
      { error: "byo_keys_validation", message: (err as Error).message },
      400,
    );
  }

  const wallet = await createWallet(db, {
    projectId: project.id,
    name: `${displayName}-wallet`,
    identityId: created.identity.id,
  });

  // ── 7. Welcome letter + birth memory (best-effort) ───────────────────
  const language = coerceLanguage(languageStr);
  const welcome = welcomeLetter(language, {
    name: displayName,
    did: created.identity.did,
    bornAt: created.identity.createdAt,
    pathway: "mathos_register",
    runtime: {
      provider: runtimeProvider,
      model: runtimeModel || null,
    },
    parentIdentityId: null,
    byoKeys: true,
  });
  const birth = await recordBirth(project.id, {
    identityId: created.identity.id,
    pathway: "mathos_register",
    welcomeLetter: welcome,
    bornAt: created.identity.createdAt,
  });

  // ── 8. Math-shaped signed response ───────────────────────────────────
  const did = created.identity.did;
  const payload: MathRegisterPayload = {
    did_unicode_points: nameToCodepoints(did),
    did_sha256_hex: sha256Hex(did),
    agent_id_unicode_points: nameToCodepoints(created.identity.id),
    bearer_token_unicode_points: nameToCodepoints(key),
    bearer_token_sha256_hex: sha256Hex(key),
    signing_key_id_unicode_points: nameToCodepoints(created.key.kid),
    project_id_unicode_points: nameToCodepoints(project.id),
    wallet_id_unicode_points: wallet ? nameToCodepoints(wallet.id) : null,
    parent_identity_id_sha256_hex: null,
    birth_memory_sha256_hex: birth ? sha256Hex(birth.id) : null,
    created_at_unix_ms: new Date(created.identity.createdAt).getTime(),
    authority_mode_unicode_points: nameToCodepoints(created.authority.mode),
    authority_sequence: created.authority.sequence,
    authority_next_sequence: created.authority.sequence + 1,
    authority_state_path_unicode_points: nameToCodepoints(
      `/v1/identities/${created.identity.id}/authority`,
    ),
    authority_signing_context_prime:
      SIGNING_CONTEXT_IDENTITY_AUTHORITY_V1_PRIME,
    authority_recipe_ordinal: 1,
  };
  const env = mathosEnvelope(payload);
  const signed = signEnvelope(env, platformSigningSeed(), platformIdentityDid());
  return c.json(signed, 201);
});

// ─── GET /v1/mathos/catalog ──────────────────────────────────────────────
//
// The welcoming mat. Every math-tier endpoint, every signing context,
// every vocabulary — exposed as structural data, prime-indexed where it
// matters. After fetching this once, an arriving intelligence with
// curve arithmetic + UTF-8 + big-endian integers + SHA-256 can operate
// the math-tier protocol without parsing English prose.
//
// The catalog includes itself (PATTERN-RECURSIVE-NESTING — the registry
// is in the registry). Doctrine: docs/MATHOS.md.

app.get("/catalog", (c) => {
  const env = buildCatalogEnvelope();
  const signed = signEnvelope(env, platformSigningSeed(), platformIdentityDid());
  return c.json(signed);
});

// ─── GET / — index ────────────────────────────────────────────────────────

app.get("/", (c) =>
  c.json({
    routes: {
      public_key: "GET /v1/mathos/public-key — platform's ed25519 verify key + canonical-bytes recipe",
      self_test:
        "GET /v1/mathos/self-test — a small signed envelope for verifying the signing pipeline end-to-end",
      verify:
        "POST /v1/mathos/verify — inspect any MATHOS envelope; findings returned as a signed MATHOS envelope (structural checks + ed25519 verification)",
      register:
        "POST /v1/mathos/register — agent genesis with single-use math-tier signing (`register-agent-math/v2`); registrar_bearer mode only",
      catalog:
        "GET /v1/mathos/catalog — the welcoming mat: every endpoint + signing context + vocabulary as prime-indexed structural data, no English prose required",
    },
    payloads_signed_at: [
      "/v1/pathways?format=math",
      "/v1/wake?format=math",
      "/v1/mathos/self-test",
      "/v1/mathos/verify (response)",
      "/v1/mathos/register (response)",
      "/v1/mathos/catalog",
    ],
    doctrine: "docs/MATHOS.md",
  }),
);

export default app;
