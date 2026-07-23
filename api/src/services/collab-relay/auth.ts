/** Repository-scoped atc_ bearer middleware.
 *
 * Project-wide at_ bearers are deliberately not accepted here. Enrollment is
 * the sole bridge from project authority to a hash-only, repository-and-device
 * scoped token.
 * Doctrine: docs/CROSS-DEVICE-COLLABORATION.md. */

import type { Context, Next } from "hono";

import type { CollabPrincipal } from "./contracts";
import { CollabRelayError } from "./errors";
import type { CollabRelayService } from "./service";

export type CollabScopedContext = {
  Variables: {
    collabPrincipal: CollabPrincipal;
  };
};

export function createCollabScopedAuth(service: CollabRelayService) {
  return async (c: Context<CollabScopedContext>, next: Next) => {
    const authorization = c.req.header("Authorization");
    if (!authorization?.startsWith("Bearer ")) {
      throw new CollabRelayError(
        "collab_token_required",
        "This repository route requires a scoped atc_ bearer.",
        401,
      );
    }
    const rawToken = authorization.slice(7).trim();
    if (!rawToken.startsWith("atc_")) {
      throw new CollabRelayError(
        "collab_token_invalid",
        "This repository route accepts only a scoped atc_ bearer.",
        401,
      );
    }
    const principal = await service.authenticate(rawToken, {
      record_usage: c.req.method !== "GET" && c.req.method !== "HEAD",
    });
    if (!principal) {
      throw new CollabRelayError(
        "collab_token_invalid",
        "The scoped collaboration bearer is invalid or inactive.",
        401,
      );
    }
    const repositoryId = c.req.param("repository_id");
    if (repositoryId !== principal.repository_id) {
      throw new CollabRelayError(
        "repository_scope_mismatch",
        "The scoped bearer is not valid for the repository in this path.",
        403,
      );
    }
    c.set("collabPrincipal", principal);
    return next();
  };
}
