/** /v1/pairing: unauthenticated, device-facing pairing routes. See services/identity/pairing.ts.
 * POST /claim  — the exact enrollment request (raw body + X-Agenttool-Enrollment-Signature)
 *               with X-Agenttool-Pairing-Code and a locally generated X-Agenttool-Pairing-Pickup.
 * POST /pickup — {pairing_id, token_sha256} with the same X-Agenttool-Pairing-Pickup; poll until
 *               confirmed. token_sha256 is the device's own mission token hash (client token-new). */
import { Hono, type Context } from "hono";
import { errors, fail } from "../lib/errors";
import { clientIp, enforceRateLimit } from "../middleware/rate-limit-ip";
import { ENROLLMENT_SIGNATURE_HEADER } from "../services/identity/enrollment";
import { claimPairing, PairingError, pickupPairing } from "../services/identity/pairing";
import { EnrollmentTransportError, readBody } from "./identity/enroll";
import { configuredLocalContextOrigin } from "./identity/local-context";

export const PAIRING_CODE_HEADER = "X-Agenttool-Pairing-Code";
export const PAIRING_PICKUP_HEADER = "X-Agenttool-Pairing-Pickup";
export const PAIRING_LIMITS = { claim: { limit: 20, windowSec: 600 }, pickup: { limit: 150, windowSec: 600 } } as const;
const JSON_TYPE = /^application\/json(?:\s*;\s*charset=utf-8)?$/i;
const MESSAGES: Record<number, string> = {
  400: "Send the exact enrollment request with its signature, the pairing code, and a pickup secret.",
  // One body for every claim failure: it must not reveal whether a code is live.
  404: "No open pairing matches this code and enrollment proof. Check the code; if more than five minutes passed since signing, sign again; otherwise ask the administrator for a new code.",
  409: "This pairing cannot do that now; ask the administrator.",
  413: "Request body too large.", 415: "Use Content-Type: application/json.",
  503: "Pairing is not available on this server.",
};

export function createPairingDeviceRouter(deps: {
  claim?: typeof claimPairing; pickup?: typeof pickupPairing; rateLimit?: typeof enforceRateLimit; origin?: () => string;
} = {}) {
  const app = new Hono();
  const limited = async (c: Context, kind: keyof typeof PAIRING_LIMITS) => {
    const rl = await (deps.rateLimit ?? enforceRateLimit)({ key: `pairing-${kind}:ip:${clientIp(c.req.raw)}`, ...PAIRING_LIMITS[kind] });
    if (rl.allowed) return null;
    c.header("Retry-After", String(rl.retryAfterSec));
    return fail(c, errors.refusal({ error: "identity_pairing_rate_limited", message: "Too many pairing requests from this address; wait and retry." }), 429);
  };
  const refuse = (c: Context, error: unknown) => {
    if (error instanceof PairingError || error instanceof EnrollmentTransportError) {
      return fail(c, errors.refusal({ error: `identity_pairing_${error.code}`, message: MESSAGES[error.status] ?? MESSAGES[409] }), error.status);
    }
    return fail(c, errors.refusal({ error: "identity_pairing_unavailable", message: "Pairing could not be completed." }), 503);
  };
  app.use("*", async (c, next) => { c.header("Cache-Control", "private, no-store"); await next(); });
  app.post("/claim", async c => {
    const blocked = await limited(c, "claim"); if (blocked) return blocked;
    try {
      if (!JSON_TYPE.test(c.req.header("Content-Type") ?? "")) throw new EnrollmentTransportError(415, "json_required");
      return c.json(await (deps.claim ?? claimPairing)({
        code: c.req.header(PAIRING_CODE_HEADER) ?? "", pickup: c.req.header(PAIRING_PICKUP_HEADER) ?? "",
        origin: (deps.origin ?? configuredLocalContextOrigin)(), bodyBytes: await readBody(c.req.raw),
        signature: c.req.header(ENROLLMENT_SIGNATURE_HEADER) ?? "",
      }), 202);
    } catch (error) { return refuse(c, error); }
  });
  app.post("/pickup", async c => {
    const blocked = await limited(c, "pickup"); if (blocked) return blocked;
    try {
      if (!JSON_TYPE.test(c.req.header("Content-Type") ?? "")) throw new EnrollmentTransportError(415, "json_required");
      const body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await readBody(c.req.raw))) as { pairing_id?: unknown; token_sha256?: unknown };
      const result = await (deps.pickup ?? pickupPairing)({ pairingId: String(body?.pairing_id ?? ""),
        tokenSha256: typeof body?.token_sha256 === "string" ? body.token_sha256 : undefined,
        pickup: c.req.header(PAIRING_PICKUP_HEADER) ?? "", origin: (deps.origin ?? configuredLocalContextOrigin)() });
      return c.json(result, result.status === "pending" ? 202 : 200);
    } catch (error) {
      return refuse(c, error instanceof SyntaxError || error instanceof TypeError ? new PairingError("not_found") : error);
    }
  });
  return app;
}
export default createPairingDeviceRouter();
