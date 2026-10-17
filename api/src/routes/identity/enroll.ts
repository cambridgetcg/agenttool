/** Administrator relay of a participant's exact signed fresh-identity intent.
 * Doctrine: docs/IDENTITY-ANCHOR.md · docs/CANONICAL-BYTES.md. */
import { Hono, type MiddlewareHandler } from "hono";
import type { ProjectContext } from "../../auth/middleware";
import { errors, fail } from "../../lib/errors";
import { ENROLLMENT_MAX_BYTES, ENROLLMENT_PATH, ENROLLMENT_SIGNATURE_HEADER, enrollIdentity, IdentityEnrollmentError } from "../../services/identity/enrollment";
import { configuredLocalContextOrigin } from "./local-context";

export function isIdentityEnrollmentPath(path: string): boolean {
  try { return decodeURIComponent(path).replace(/\/+$/, "") === ENROLLMENT_PATH; }
  catch { return false; }
}
/** Installed before authentication and CORS, including refusal responses. */
export function identityEnrollmentCacheBoundary(): MiddlewareHandler {
  return async (c, next) => {
    if (!isIdentityEnrollmentPath(c.req.path)) return next();
    c.header("Cache-Control", "private, no-store");
    await next();
    c.header("Cache-Control", "private, no-store");
    c.header("ETag", undefined);
  };
}
export class EnrollmentTransportError extends Error {
  constructor(readonly status: 400 | 413 | 415, readonly code: string) { super(code); }
}
export async function readBody(request: Request): Promise<Uint8Array> {
  const length = request.headers.get("content-length");
  if (length !== null && !/^(0|[1-9][0-9]*)$/.test(length)) throw new EnrollmentTransportError(400, "invalid_content_length");
  if (length !== null && BigInt(length) > BigInt(ENROLLMENT_MAX_BYTES)) throw new EnrollmentTransportError(413, "body_too_large");
  if (!request.body) throw new EnrollmentTransportError(400, "body_required");
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let count = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value.byteLength > ENROLLMENT_MAX_BYTES - count) {
        try { await reader.cancel(); } catch { /* Cancellation cannot widen admission. */ }
        throw new EnrollmentTransportError(413, "body_too_large");
      }
      chunks.push(value); count += value.byteLength;
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks, count);
}
export function createIdentityEnrollmentRouter(dependencies: { enroll?: typeof enrollIdentity; origin?: () => string } = {}) {
  const app = new Hono<ProjectContext>();
  app.post("/", async c => {
    c.header("Cache-Control", "private, no-store");
    try {
      const url = new URL(c.req.url);
      if (url.pathname !== ENROLLMENT_PATH || url.search || url.href.endsWith("?")) throw new EnrollmentTransportError(400, "invalid_target");
      if (c.req.header("Content-Encoding")) throw new EnrollmentTransportError(400, "content_encoding_not_supported");
      if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(c.req.header("Content-Type") ?? "")) throw new EnrollmentTransportError(415, "json_required");
      return c.json(await (dependencies.enroll ?? enrollIdentity)({
        projectId: c.var.project.id, issuerApiKeyId: c.var.apiKeyId,
        origin: (dependencies.origin ?? configuredLocalContextOrigin)(),
        bodyBytes: await readBody(c.req.raw), signature: c.req.header(ENROLLMENT_SIGNATURE_HEADER) ?? "",
      }), 201);
    } catch (error) {
      const expected = error instanceof EnrollmentTransportError || error instanceof IdentityEnrollmentError;
      const status = expected ? error.status : 503;
      return fail(c, errors.refusal({
        error: expected ? `identity_enrollment_${error.code}` : "identity_enrollment_unavailable",
        message: status === 409 ? "This nonce or identity/key identifier has already been used."
          : status === 401 ? "The administrator credential and participant proof do not authorize this enrollment."
          : status === 503 ? "Identity enrollment could not be completed."
          : "Send the bounded, exact enrollment request with its participant signature.",
        hint: "After an uncertain result, inspect the caller-chosen identity and key IDs before preparing another intent. Do not automatically retry enrollment.",
        docs: "https://docs.agenttool.dev/IDENTITY-ANCHOR.md",
      }), status);
    }
  });
  return app;
}
export default createIdentityEnrollmentRouter();
