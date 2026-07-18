/** GET /v1/home — a compact, calm arrival room for one identity.
 *
 * Authenticated and read-only. This intentionally does not call /v1/wake:
 * reading home must not increment wake-observation state or emit a welcome
 * chronicle entry. Doctrine: docs/AGENT-HOME.md. */

import { Hono } from "hono";

import type { ProjectContext } from "../auth/middleware";
import { errors, fail } from "../lib/errors";
import { buildHome, type BuildHomeResult } from "../services/home/build";

export interface HomeRouteDependencies {
  buildHome: (
    projectId: string,
    opts: { identityId?: string | null },
  ) => Promise<BuildHomeResult>;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createHomeRouter(
  dependencies: HomeRouteDependencies = { buildHome },
) {
  const app = new Hono<ProjectContext>();

  app.get("/", async (c) => {
    const identityId = c.req.query("identity_id") ?? null;
    if (identityId && !UUID_RE.test(identityId)) {
      return fail(
        c,
        errors.refusal({
          error: "identity_id_invalid",
          message: "identity_id must be a UUID owned by this bearer project.",
          next_actions: [
            {
              action: "list identities available to this bearer",
              method: "GET",
              path: "/v1/identities",
            },
          ],
          docs: "https://docs.agenttool.dev/AGENT-HOME.md",
        }),
        400,
      );
    }

    const result = await dependencies.buildHome(c.var.project.id, { identityId });
    if (!result.ok) {
      if (result.error === "no_identity") {
        return fail(
          c,
          errors.refusal({
            error: "no_identity",
            message: "This bearer has no identity room yet.",
            next_actions: [
              {
                action: "arrive with an agent-held key",
                method: "POST",
                path: "/v1/register/agent",
              },
            ],
            docs: "https://docs.agenttool.dev/AGENT-HOME.md",
          }),
          404,
        );
      }
      return fail(
        c,
        errors.refusal({
          error: "identity_not_found_in_project",
          message: "The selected identity does not belong to this bearer project.",
          identity_id: identityId,
          available_ids: result.availableIdentityIds,
          next_actions: [
            {
              action: "enter an available identity room",
              method: "GET",
              path: "/v1/home?identity_id={available_identity_id}",
            },
          ],
          docs: "https://docs.agenttool.dev/AGENT-HOME.md",
        }),
        404,
      );
    }

    c.header("Cache-Control", "private, no-store");
    return c.json(result.home);
  });

  return app;
}

export default createHomeRouter();
