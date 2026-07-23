/** Handoff route validation paths.
 *
 * These probes intentionally stop before project/database access. Durable
 * append and project-ownership cases belong to the integration tier.
 */

import { describe, expect, test } from "bun:test";

import handoffRouter from "../src/routes/handoff";
import continuityRouter from "../src/routes/continuity";
import openapiRouter from "../src/routes/openapi";

const CANON_DOC = "urn:agenttool:doc/HANDOFFS";

describe("POST /v1/handoff — validation", () => {
  test("refuses a missing working-set body with guided context", async () => {
    const res = await handoffRouter.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      error: string;
      _canon_pointer: string;
      docs: string;
    };
    expect(body.error).toBe("invalid_handoff");
    expect(body._canon_pointer).toBe(CANON_DOC);
    expect(body.docs.toLowerCase()).toContain("handoffs");
  });

  test("rejects malformed JSON before any project lookup", async () => {
    const res = await handoffRouter.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("invalid_handoff");
  });

  test("rejects caller-controlled fields rather than silently accepting them", async () => {
    const res = await handoffRouter.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ project_id: "caller-controlled" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { details: { formErrors?: string[] } };
    expect(body.details.formErrors?.join(" ")).toContain("project_id");
  });
});

describe("POST /v1/chronicle — reserved handoff envelope", () => {
  test("cannot bypass dedicated handoff validation through arbitrary chronicle metadata", async () => {
    const res = await continuityRouter.request("/chronicle", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "note",
        title: "Pretend handoff",
        metadata: { kind: "handoff" },
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; _canon_pointer: string };
    expect(body.error).toBe("handoff_requires_dedicated_endpoint");
    expect(body._canon_pointer).toBe(CANON_DOC);
  });
});

describe("GET /v1/handoff — query validation", () => {
  test("requires a valid identity id before touching project state", async () => {
    const missing = await handoffRouter.request("/", { method: "GET" });
    expect(missing.status).toBe(400);
    expect(((await missing.json()) as { error: string }).error).toBe("handoff_agent_id_required");

    const malformed = await handoffRouter.request("/?agent_id=not-a-uuid", { method: "GET" });
    expect(malformed.status).toBe(400);
  });
});

describe("handoff OpenAPI discovery", () => {
  test("documents explicit lineage opt-in and bounded resume completeness", async () => {
    const document = await (await openapiRouter.request("/")).json() as {
      paths: Record<string, Record<string, any>>;
    };
    const write = document.paths["/v1/handoff"]!.post;
    const writeSchema = write.requestBody.content["application/json"].schema;
    expect(writeSchema.properties.starts_new_lineage.type).toBe("boolean");
    expect(write.description).toContain("legacy newest-per-author lane");

    const resume = document.paths["/v1/wake/handoffs"]!.get;
    const surface = resume.responses["200"].content["application/json"].schema
      .properties.you_have_handoffs;
    expect(surface.required).toContain("leaf_set_complete");
    expect(surface.required).toContain("projection_status");
    expect(surface.properties.projection_status.enum).toEqual([
      "complete",
      "truncated",
      "unavailable",
    ]);
    expect(surface.properties.candidate_row_limit.enum).toEqual([32]);
    expect(surface.properties.candidate_window_end_id.description).toContain(
      "not a resume cursor",
    );
  });
});
