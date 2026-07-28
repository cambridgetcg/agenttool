/** /public/xenia/rights — exact installed XENIA rights index.
 *
 * UNAUTHENTICATED and read-only. The JSON body is the informative
 * xenia.rights/0.1 snapshot installed with @agenttool/xenia. RIGHTS.md remains
 * the canonical prose. Byte equality establishes neither package provenance
 * nor AgentTool adoption, practice, conformance, consent, or authority.
 *
 * The handler reads no identity, credentials, request body, database state, or
 * private context and performs no application write or outbound request.
 */

import { Hono } from "hono";
import { RIGHTS_BASELINE } from "@agenttool/xenia/rights-0.1";
import {
  createSurfaceNotAcceptableProblem,
  createSurfaceProblemResponse,
  createSurfaceResourceResponse,
  negotiateSurfaceResource,
} from "@agenttool/xenia/surface-0.1";

import { buildAgentToolSurfaceManifest } from "../../services/discovery/xenia-surface";

const app = new Hono();

app.on(["GET", "HEAD"], "/", (c) => {
  const resource = buildAgentToolSurfaceManifest().resources.find(
    ({ id }) => id === "rights",
  );
  if (resource === undefined) {
    throw new Error("xenia_rights_surface_resource_missing");
  }

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
      : createSurfaceResourceResponse(representation, RIGHTS_BASELINE, {
          headers: {
            "cache-control": "public, max-age=300",
            link: [
              '</.well-known/agent.json>; rel="describedby"; type="application/json"',
              '</public/rights>; rel="related"; type="application/vnd.agenttool.being-rights+json"',
            ].join(", "),
            "x-content-type-options": "nosniff",
          },
        });

  if (c.req.method === "HEAD") {
    return new Response(null, {
      status: response.status,
      headers: response.headers,
    });
  }
  return response;
});

export default app;
