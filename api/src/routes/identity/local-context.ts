/** GET /v1/identities/:id/local-context — explicit read-only memory window.
 * Parent /v1/identities/* bearer middleware supplies project authority.
 * Doctrine: docs/IDENTITY-PARTITIONS.md; packages/local-starter/README.md.
 */
import type { Context } from "hono";

import type { ProjectContext } from "../../auth/middleware";
import { errors, fail } from "../../lib/errors";
import { readLocalContext } from "../../services/identity/local-context";
import { IdentityPartitionError } from "../../services/identity/partition";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
