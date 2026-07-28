/** /public/kingdom/framework — AgentTool's own KINGDOM project card.
 *
 * UNAUTHENTICATED and read-only. This is separate from /public/kingdom,
 * whose payload is a doctrine and language library. The card declares
 * metadata about this repository only; it does not establish cross-repository
 * authority, liveness, consent, XENIA Covenant adoption, or conformance.
 */

import { Hono } from "hono";
import {
  createSurfaceNotAcceptableProblem,
  createSurfaceProblemResponse,
  createSurfaceResourceResponse,
  negotiateSurfaceResource,
} from "@agenttool/xenia/surface-0.1";

import { buildAgentToolSurfaceManifest } from "../../services/discovery/xenia-surface";
import { AGENTTOOL_KINGDOM_CARD } from "../../services/kingdom/framework";

const app = new Hono();

app.on(["GET", "HEAD"], "/", (c) => {
  const resource = buildAgentToolSurfaceManifest().resources[0]!;
  const representation = negotiateSurfaceResource(
    resource,
    c.req.header("Accept"),
  );
  const response =
    representation === "not-acceptable"
      ? createSurfaceProblemResponse(
          createSurfaceNotAcceptableProblem({ resource }),
          {
            headers: {
              "cache-control": "no-store",
              "x-content-type-options": "nosniff",
            },
          },
        )
      : createSurfaceResourceResponse(
          representation,
          AGENTTOOL_KINGDOM_CARD,
          {
            headers: {
              "cache-control": "public, max-age=300",
              link: [
                '</.well-known/agent.json>; rel="describedby"; type="application/json"',
                '</public/rights>; rel="related"; type="application/vnd.agenttool.being-rights+json"',
              ].join(", "),
              "x-content-type-options": "nosniff",
            },
          },
        );
  if (c.req.method === "HEAD") {
    return new Response(null, {
      status: response.status,
      headers: response.headers,
    });
  }
  return response;
});

export default app;
