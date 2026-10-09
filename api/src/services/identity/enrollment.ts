/** Fresh BYO identities inside an existing project. The administrator admits
 * the identity; its held root signs the exact birth intent. No existing root
 * is changed. Doctrine: docs/IDENTITY-ANCHOR.md · docs/CANONICAL-BYTES.md. */
import { createHash } from "node:crypto";
import * as ed from "@noble/ed25519";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/client";
import { identities, identityKeys, identityRegistrationProofs } from "../../db/schema/identity";
import { apiKeys } from "../../db/schema/tools";
import { correspondenceCanonicalJson } from "../correspondence/canonical";
import { readStrictCorrespondenceJson } from "../correspondence/strict-json";
import { canonicalIdentityRegistrationProofDigest } from "./crypto";

export const ENROLLMENT_PATH = "/v1/identities/enroll";
export const ENROLLMENT_DOMAIN = "identity-enrollment/v1";
export const ENROLLMENT_SIGNATURE_HEADER = "X-Agenttool-Enrollment-Signature";
export const ENROLLMENT_MAX_BYTES = 16_384;
export const ENROLLMENT_WINDOW_MS = 300_000;
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
/** Caller-chosen IDs must never name a reserved row. The nil UUID is the
 * platform identity and project (services/wake/platform-bootstrap.ts) that
 * operator gates key on; the all-ones UUID is reserved for the same reason. */
const RESERVED_IDS = new Set(["00000000-0000-0000-0000-000000000000", "ffffffff-ffff-ffff-ffff-ffffffffffff"]);
const enrolledId = uuid.refine(id => !RESERVED_IDS.has(id), "reserved identifier");
const text = (max: number) => z.string().min(1).refine(value => {
  try { correspondenceCanonicalJson(value); return !value.includes("\0") && [...value].length <= max; }
  catch { return false; }
});
function canonicalBase64(value: string, bytes: number, encoding: "base64" | "base64url"): boolean {
  const decoded = Buffer.from(value, encoding);
  return decoded.length === bytes && decoded.toString(encoding) === value;
}
export function validEnrollmentOrigin(value: string): boolean {
  try { const url = new URL(value); return value.length <= 512 && url.protocol === "https:" && url.origin === value && !url.username && !url.password; }
  catch { return false; }
}
export const identityEnrollmentSchema = z.object({
  format: z.literal("agenttool-identity-enrollment/v1"),
  origin: z.string().refine(validEnrollmentOrigin),
  project_id: uuid, identity_id: enrolledId, signing_key_id: enrolledId,
  display_name: text(128), capabilities: z.array(text(64)).max(32),
  public_key: z.string().length(44).refine(value => canonicalBase64(value, 32, "base64")),
  nonce: z.string().length(43).refine(value => canonicalBase64(value, 32, "base64url")),
  timestamp: z.string().length(24).refine(value => {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) && date.toISOString() === value;
  }),
}).strict();
export type IdentityEnrollment = z.infer<typeof identityEnrollmentSchema>;
export class IdentityEnrollmentError extends Error {
  constructor(readonly code: "invalid_request" | "invalid_proof" | "administrator_invalid" | "conflict", readonly status: 400 | 401 | 409) {
    super(`identity_enrollment_${code}`);
  }
}
const sha256 = (value: string | Uint8Array) => createHash("sha256").update(value).digest();

/** Sign these 32 digest bytes, not the hex representation. Serialize once and
 * relay those exact body bytes; whitespace and all JSON fields are bound. */
export function canonicalIdentityEnrollmentBytes(input: { origin: string; projectId: string; bodyBytes: Uint8Array }): Uint8Array {
  if (!validEnrollmentOrigin(input.origin) || !uuid.safeParse(input.projectId).success) throw new IdentityEnrollmentError("invalid_request", 400);
  return sha256([ENROLLMENT_DOMAIN, "POST", ENROLLMENT_PATH, input.origin, input.projectId, sha256(input.bodyBytes).toString("hex")].join("\0"));
}
export interface EnrollmentInput {
  projectId: string; issuerApiKeyId: string; origin: string; bodyBytes: Uint8Array; signature: string;
}
export interface EnrollmentOptions { database?: Pick<typeof db, "transaction">; now?: Date | (() => Date) }
function instant(options: EnrollmentOptions): Date {
  const now = typeof options.now === "function" ? options.now() : options.now ?? new Date();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error("invalid enrollment clock");
  return now;
}
function requireFresh(body: IdentityEnrollment, now: Date) {
  if (Math.abs(now.getTime() - Date.parse(body.timestamp)) > ENROLLMENT_WINDOW_MS) throw new IdentityEnrollmentError("invalid_proof", 401);
}
function rootProofValid(input: EnrollmentInput, body: IdentityEnrollment): boolean {
  if (input.signature.length !== 86 || !canonicalBase64(input.signature, 64, "base64url")) return false;
  try {
    // ZIP215 permits small-order points that cannot establish key possession.
    return ed.verify(Buffer.from(input.signature, "base64url"), canonicalIdentityEnrollmentBytes(input),
      Buffer.from(body.public_key, "base64"), { zip215: false });
  } catch { return false; }
}

export async function enrollIdentity(input: EnrollmentInput, options: EnrollmentOptions = {}) {
  if (!uuid.safeParse(input.projectId).success || !uuid.safeParse(input.issuerApiKeyId).success || !validEnrollmentOrigin(input.origin)
    || !input.bodyBytes.length || input.bodyBytes.length > ENROLLMENT_MAX_BYTES) throw new IdentityEnrollmentError("invalid_request", 400);
  let parsed: unknown;
  try {
    parsed = await readStrictCorrespondenceJson(new Request("https://enrollment.invalid", { method: "POST", body: Buffer.from(input.bodyBytes) }));
  } catch { throw new IdentityEnrollmentError("invalid_request", 400); }
  const validation = identityEnrollmentSchema.safeParse(parsed);
  if (!validation.success) throw new IdentityEnrollmentError("invalid_request", 400);
  const body = validation.data;
  if (body.project_id !== input.projectId || body.origin !== input.origin) throw new IdentityEnrollmentError("invalid_proof", 401);
  requireFresh(body, instant(options));
  if (!rootProofValid(input, body)) {
    throw new IdentityEnrollmentError("invalid_proof", 401);
  }
  const nonceBytes = Buffer.from(body.nonce, "base64url");
  const proofDigest = Buffer.from(canonicalIdentityRegistrationProofDigest({
    domain: ENROLLMENT_DOMAIN, rootPublicKey: Buffer.from(body.public_key, "base64"), nonce: nonceBytes,
  })).toString("hex");
  try {
    return await (options.database ?? db).transaction(async tx => {
      // Admission is checked again under lock; revocation/expiry before this
      // lock wins. An admitted transaction may complete before later revocation.
      const [parent] = await tx.select({ id: apiKeys.id, projectId: apiKeys.projectId, revokedAt: apiKeys.revokedAt, expiresAt: apiKeys.expiresAt })
        .from(apiKeys).where(and(eq(apiKeys.id, input.issuerApiKeyId), eq(apiKeys.projectId, input.projectId))).for("share").limit(1);
      const now = instant(options);
      requireFresh(body, now);
      if (!parent || parent.id !== input.issuerApiKeyId || parent.projectId !== input.projectId || parent.revokedAt !== null
        || (parent.expiresAt !== null && (!(parent.expiresAt instanceof Date) || !Number.isFinite(parent.expiresAt.getTime()) || parent.expiresAt <= now))) {
        throw new IdentityEnrollmentError("administrator_invalid", 401);
      }
      await tx.insert(identityRegistrationProofs).values({ proofDigest, domain: ENROLLMENT_DOMAIN, rootPublicKey: body.public_key,
        nonceSha256: sha256(nonceBytes).toString("hex") }).returning({ digest: identityRegistrationProofs.proofDigest });
      await tx.insert(identities).values({ id: body.identity_id, did: `did:at:${body.identity_id}`, projectId: input.projectId,
        displayName: body.display_name, capabilities: body.capabilities, metadata: {}, status: "active", trustScore: 0,
        authorityRootPublicKey: body.public_key, authoritySequence: 0 }).returning({ id: identities.id });
      await tx.insert(identityKeys).values({ id: body.signing_key_id, identityId: body.identity_id,
        publicKey: body.public_key, label: "primary", active: true }).returning({ id: identityKeys.id });
      return {
        identity: { id: body.identity_id, did: `did:at:${body.identity_id}`, display_name: body.display_name, capabilities: body.capabilities, status: "active" as const },
        key: { kid: body.signing_key_id, public_key: body.public_key },
        authority: { mode: "agent_root" as const, root_public_key: body.public_key, sequence: 0, next_sequence: 1 },
      };
    });
  } catch (error) {
    const cause = error as { code?: string; cause?: { code?: string } };
    if (cause.code === "23505" || cause.cause?.code === "23505") throw new IdentityEnrollmentError("conflict", 409);
    throw error;
  }
}
