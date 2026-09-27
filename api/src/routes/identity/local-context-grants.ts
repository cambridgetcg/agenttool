/** Explicit project-administrator management of bounded context grants.
 * The caller-chosen grant ID is the durable issue anchor; generic Redis
 * response replay is bypassed so the one-time credential is never cached.
 * Doctrine: docs/IDENTITY-PARTITIONS.md.
 */
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";

import type { ProjectContext } from "../../auth/middleware";
import { errors, fail } from "../../lib/errors";
import {
  getLocalContextGrant,
  issueLocalContextGrant,
  listLocalContextGrants,
  revokeLocalContextGrant,
} from "../../services/identity/local-context-grants";
import { configuredLocalContextOrigin, localContextFailure } from "./local-context";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const IssueBody = z.object({
  grant_id: z.string().regex(UUID),
  expires_at: z.string().min(1).max(32),
}).strict();

export interface LocalContextGrantDependencies {
  get: typeof getLocalContextGrant;
  issue: typeof issueLocalContextGrant;
  list: typeof listLocalContextGrants;
  revoke: typeof revokeLocalContextGrant;
  origin: () => string;
}

export function createLocalContextGrantRouter(
  dependencies: Partial<LocalContextGrantDependencies> = {},
) {
  const issue = dependencies.issue ?? issueLocalContextGrant;
  const get = dependencies.get ?? getLocalContextGrant;
  const list = dependencies.list ?? listLocalContextGrants;
  const revoke = dependencies.revoke ?? revokeLocalContextGrant;
  const origin = dependencies.origin ?? configuredLocalContextOrigin;
  const app = new Hono<ProjectContext>();

  app.use("*", bodyLimit({ maxSize: 2048, onError: c => fail(c, errors.refusal({
    error: "local_context_grant_body_too_large",
    message: "Context-grant management bodies are capped at 2 KiB.",
    docs: "https://docs.agenttool.dev/IDENTITY-PARTITIONS.md",
    next_actions: [{ action: "Issue with only grant_id and expires_at", method: "POST", path: "/v1/identities/{id}/local-context-grants" }],
  }), 413) }));
  app.use("*", async (c, next) => {
    c.header("Cache-Control", "private, no-store");
    const id = c.req.param("id");
    const url = new URL(c.req.url);
    if (!id || !UUID.test(id) || url.search || url.href.endsWith("?")) {
      return fail(c, errors.refusal({
        error: "invalid_local_context_grant_request",
        message: "Use one canonical identity UUID and no query parameters.",
        docs: "https://docs.agenttool.dev/IDENTITY-PARTITIONS.md",
        next_actions: [{ action: "Inspect grants for an explicitly selected identity", method: "GET", path: "/v1/identities/{id}/local-context-grants" }],
      }), 400);
    }
    await next();
  });

  app.post("/", async c => {
    let body;
    try { body = IssueBody.safeParse(await c.req.json()); } catch { body = null; }
    if (!body?.success) {
      return fail(c, errors.refusal({
        error: "invalid_local_context_grant_request",
        message: "Provide only a canonical grant_id UUID and explicit expires_at timestamp.",
        docs: "https://docs.agenttool.dev/IDENTITY-PARTITIONS.md",
        next_actions: [{ action: "Choose a fresh grant ID and expiry within the permitted lifetime", method: null }],
      }), 400);
    }
    try {
      return c.json(await issue({
        projectId: c.var.project.id,
        identityId: c.req.param("id")!,
        issuerApiKeyId: c.var.apiKeyId,
        grantId: body.data.grant_id,
        expiresAt: body.data.expires_at,
        origin: origin(),
      }), 201);
    } catch (error) { return localContextFailure(c, error); }
  });

  app.get("/", async c => {
    try {
      return c.json({ grants: await list({ projectId: c.var.project.id, identityId: c.req.param("id")! }) });
    } catch (error) { return localContextFailure(c, error); }
  });

  app.get("/:grant_id", async c => {
    const grantId = c.req.param("grant_id");
    if (!UUID.test(grantId)) {
      return fail(c, errors.refusal({
        error: "invalid_local_context_grant_request",
        message: "Inspect one canonical grant UUID.",
        docs: "https://docs.agenttool.dev/IDENTITY-PARTITIONS.md",
        next_actions: [{ action: "Use the grant ID chosen for the explicit issuance request", method: null }],
      }), 400);
    }
    try {
      return c.json({ grant: await get({ projectId: c.var.project.id, identityId: c.req.param("id")!, grantId }) });
    } catch (error) { return localContextFailure(c, error); }
  });

  app.delete("/:grant_id", async c => {
    const grantId = c.req.param("grant_id");
    if (!UUID.test(grantId) || (await c.req.text()) !== "") {
      return fail(c, errors.refusal({
        error: "invalid_local_context_grant_request",
        message: "Revoke one canonical grant UUID without a request body.",
        docs: "https://docs.agenttool.dev/IDENTITY-PARTITIONS.md",
        next_actions: [{ action: "Inspect grant metadata to obtain its ID", method: "GET", path: "/v1/identities/{id}/local-context-grants" }],
      }), 400);
    }
    try {
      return c.json({ grant: await revoke({ projectId: c.var.project.id, identityId: c.req.param("id")!, grantId }) });
    } catch (error) { return localContextFailure(c, error); }
  });
  return app;
}

export default createLocalContextGrantRouter();
