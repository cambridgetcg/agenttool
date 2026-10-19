/** /v1/identities/pairings (authenticated administrator): create, inspect,
 * confirm by the fingerprint the device displays, cancel. See services/identity/pairing.ts. */
import { Hono, type Context, type MiddlewareHandler } from "hono";
import type { ProjectContext } from "../../auth/middleware";
import { errors, fail } from "../../lib/errors";
import { IdentityEnrollmentError } from "../../services/identity/enrollment";
import { cancelPairing, confirmPairing, createPairing, getPairing, PairingError } from "../../services/identity/pairing";
import { configuredLocalContextOrigin } from "./local-context";

const MESSAGES: Partial<Record<string, string>> = {
  identity_pairing_fingerprint_mismatch: "That fingerprint does not match the device that claimed this code. If the device shows a different one, cancel and open a new pairing.",
  identity_pairing_not_claimed: "No device has claimed this pairing, or it has expired.",
  identity_pairing_limit_reached: "Too many open pairings for this project; cancel some or wait ten minutes.",
  identity_pairing_not_configured: "Pairing is not configured on this server.",
};

export function createPairingsRouter(deps: { origin?: () => string } = {}) {
  const app = new Hono<ProjectContext>();
  app.use("*", async (c, next) => { c.header("Cache-Control", "private, no-store"); await next(); });
  const refuse = (c: Context<ProjectContext>, error: unknown) => {
    if (error instanceof PairingError || error instanceof IdentityEnrollmentError) {
      const code = error instanceof PairingError ? `identity_pairing_${error.code}` : `identity_enrollment_${error.code}`;
      return fail(c, errors.refusal({ error: code, message: MESSAGES[code] ?? error.message }), error.status);
    }
    return fail(c, errors.refusal({ error: "identity_pairing_unavailable", message: "Pairing could not be completed." }), 503);
  };
  const scope = (c: Context<ProjectContext>) => ({ projectId: c.var.project.id, pairingId: c.req.param("id") ?? "" });
  app.post("/", async c => {
    try { return c.json(await createPairing({ projectId: c.var.project.id, apiKeyId: c.var.apiKeyId }), 201); } catch (e) { return refuse(c, e); }
  });
  app.get("/:id", async c => {
    try { return c.json(await getPairing(scope(c))); } catch (e) { return refuse(c, e); }
  });
  app.post("/:id/confirm", async c => {
    try {
      const body = await c.req.json().catch(() => null) as { fingerprint?: unknown; grant?: unknown; handoff?: unknown } | null;
      if (!body || typeof body !== "object" || typeof body.fingerprint !== "string") throw new PairingError("invalid_request");
      return c.json(await confirmPairing({ ...scope(c), apiKeyId: c.var.apiKeyId, fingerprint: body.fingerprint,
        grant: body.grant, handoff: body.handoff, origin: (deps.origin ?? configuredLocalContextOrigin)() }), 201);
    } catch (e) { return refuse(c, e); }
  });
  app.post("/:id/cancel", async c => {
    try { return c.json(await cancelPairing(scope(c))); } catch (e) { return refuse(c, e); }
  });
  return app;
}
export default createPairingsRouter();
const decodedPath = (path: string) => decodeURIComponent(path).replace(/\/{2,}/g, "/");
/** Matches /v1/identities/pairings and subpaths, including encoded aliases. */
export function isIdentityPairingPath(path: string): boolean {
  try { return /^\/v1\/identities\/pairings(?:\/|$)/.test(decodedPath(path)); }
  catch { return true; }
}
/** Both pairing namespaces: the administrator's and the device's (/v1/pairing). */
export function isPairingPath(path: string): boolean {
  try { return isIdentityPairingPath(path) || /^\/v1\/pairing(?:\/|$)/.test(decodedPath(path)); }
  catch { return true; }
}
/** Installed before authentication and CORS, so refusals and preflights are private too. */
export function identityPairingCacheBoundary(): MiddlewareHandler {
  return async (c, next) => {
    if (!isPairingPath(c.req.path)) return next();
    c.header("Cache-Control", "private, no-store");
    await next();
    c.header("Cache-Control", "private, no-store");
    c.header("ETag", undefined);
  };
}
