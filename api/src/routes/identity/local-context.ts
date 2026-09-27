/** GET /v1/identities/:id/local-context — explicit read-only memory window.
 * The production handler seals this exact route before project middleware.
 * Doctrine: docs/IDENTITY-PARTITIONS.md; packages/local-starter/README.md.
 */
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";

import { verifyBearer, type ProjectContext } from "../../auth/middleware";
import { errors, fail, isGuidedErrorCause } from "../../lib/errors";
import { readLocalContext } from "../../services/identity/local-context";
import { readLocalContextGrant } from "../../services/identity/local-context-grants";
import { IdentityPartitionError } from "../../services/identity/partition";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Configured service audience, never inferred from Host/Origin/forwarded data.
 * A client separately pins its actual HTTPS destination. This is not an
 * attestation of the request's network route through a TLS-terminating proxy.
 */
export function configuredLocalContextOrigin(
  value = process.env.PUBLIC_API_BASE ?? "https://api.agenttool.dev",
): string {
  try {
    const url = new URL(value);
    if (url.protocol === "https:" && !url.username && !url.password
      && !url.search && !url.hash && url.pathname === "/"
      && value === url.origin) return url.origin;
  } catch { /* Stable configuration refusal below; never reflect the value. */ }
  throw new HTTPException(503, { cause: errors.refusal({
    error: "local_context_origin_unavailable",
    message: "The configured HTTPS context-service audience is unavailable.",
    docs: "https://docs.agenttool.dev/IDENTITY-PARTITIONS.md",
    next_actions: [{ action: "Continue with local files while the service configuration is checked", method: null }],
  }) });
}

export function localContextFailure(c: Context, error: unknown) {
  if (error instanceof HTTPException && isGuidedErrorCause(error.cause)) {
    return fail(c, error.cause, error.status);
  }
  return fail(c, errors.refusal({
    error: "local_context_unavailable",
    message: "The selected local-context operation is unavailable.",
    docs: "https://docs.agenttool.dev/LOCAL-CORE.md",
    next_actions: [{ action: "Continue with local files; inspect grant metadata before retrying an uncertain issue", method: null }],
  }), 503);
}

export interface LocalContextReadDependencies {
  verifyProjectBearer: typeof verifyBearer;
  readProject: typeof readLocalContext;
  readGrant: typeof readLocalContextGrant;
  origin: () => string;
}

/** Terminal read handler: delegated readers never receive a ProjectContext,
 * and cannot continue into another router or ordinary project middleware.
 */
export function createSealedLocalContextHandler(
  dependencies: Partial<LocalContextReadDependencies> = {},
) {
  const verify = dependencies.verifyProjectBearer ?? verifyBearer;
  const projectRead = dependencies.readProject ?? readLocalContext;
  const grantRead = dependencies.readGrant ?? readLocalContextGrant;
  const origin = dependencies.origin ?? configuredLocalContextOrigin;
  return async (c: Context) => {
    c.header("Cache-Control", "private, no-store");
    c.header("Content-Type", "application/json; charset=utf-8");
    if (c.req.method !== "GET") {
      c.header("Allow", "GET, OPTIONS");
      return fail(c, errors.refusal({
        error: "local_context_method_not_allowed",
        message: "This context window accepts one explicit GET.",
        docs: "https://docs.agenttool.dev/IDENTITY-PARTITIONS.md",
        next_actions: [{ action: "Read the selected identity's bounded context", method: "GET", path: "/v1/identities/{id}/local-context" }],
      }), 405);
    }
    const url = new URL(c.req.url);
    const match = /^\/v1\/identities\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/local-context$/i.exec(url.pathname);
    const query = url.search || (url.href.endsWith("?") ? "?" : "");
    if (!match || query) {
      return fail(c, errors.refusal({
        error: "invalid_local_context_request",
        message: "Use one explicit identity UUID in the path, with no query parameters.",
        docs: "https://docs.agenttool.dev/IDENTITY-PARTITIONS.md",
        next_actions: [{ action: "Read the selected identity's bounded context", method: "GET", path: "/v1/identities/{id}/local-context" }],
      }), 400);
    }
    const header = c.req.header("Authorization");
    const token = header?.startsWith("Bearer ") ? header.slice(7).trim() : "";
    if (!token || token.length > 256) {
      return fail(c, errors.refusal({
        error: "local_context_credential_invalid",
        message: "Supply the selected context credential in the Authorization bearer header.",
        docs: "https://docs.agenttool.dev/IDENTITY-PARTITIONS.md",
        next_actions: [{ action: "Obtain a current grant from the project administrator, or continue with local files", method: null }],
      }), 401);
    }
    try {
      if (token.startsWith("atlc_")) {
        return c.json(await grantRead({ token, identityId: match[1]!, origin: origin(), method: c.req.method, path: url.pathname, query }));
      }
      const result = await verify(token, { recordLastUsed: false });
      if (!result.ok) {
        return fail(c, errors.refusal({
          error: "local_context_credential_invalid",
          message: "The context credential is invalid, expired or revoked.",
          docs: "https://docs.agenttool.dev/IDENTITY-PARTITIONS.md",
          next_actions: [{ action: "Obtain a current credential, or continue with local files", method: null }],
        }), 401);
      }
      return c.json(await projectRead(result.project.id, match[1]!.toLowerCase()));
    } catch (error) {
      return localContextFailure(c, error);
    }
  };
}

export function createLocalContextHandler(
  read: typeof readLocalContext = readLocalContext,
) {
  return async (c: Context<ProjectContext>) => {
    c.header("Cache-Control", "private, no-store");
    const id = c.req.param("id");
    if (!id || !UUID.test(id) || new URL(c.req.url).search !== "") {
      return fail(c, errors.refusal({
        error: "invalid_local_context_request",
        message: "Use one explicit identity UUID in the path, with no query parameters.",
        docs: "https://docs.agenttool.dev/IDENTITY-PARTITIONS.md",
        next_actions: [{ action: "Read the selected identity's bounded context", method: "GET", path: "/v1/identities/{id}/local-context" }],
      }), 400);
    }
    try {
      return c.json(await read(c.var.project.id, id.toLowerCase()));
    } catch (error) {
      if (error instanceof IdentityPartitionError) {
        return fail(c, errors.refusal({
          error: "identity_not_found_or_not_owned",
          message: "Select an active identity owned by this bearer project.",
          docs: "https://docs.agenttool.dev/IDENTITY-PARTITIONS.md",
          next_actions: [{ action: "Inspect identities in this project", method: "GET", path: "/v1/identities" }],
        }), 404);
      }
      // No database errors, private content, credential values or fallback Wake.
      return fail(c, errors.refusal({
        error: "local_context_unavailable",
        message: "The selected local-context window is unavailable.",
        docs: "https://docs.agenttool.dev/LOCAL-CORE.md",
        next_actions: [{ action: "Continue with local files, or explicitly retry this bounded read later", method: null }],
      }), 503);
    }
  };
}
