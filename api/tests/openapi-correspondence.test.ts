import { describe, expect, test } from "bun:test";

import { isStrictJsonProfileResponse } from "../src/middleware/strict-json-profile";
import openapiRouter from "../src/routes/openapi";

const MEDIA_TYPE = "application/vnd.agenttool.correspondence+json";

describe("Renaissance Correspondence OpenAPI contract", () => {
  test("publishes append, replay, advisory claims, and finite voice as one private profile", async () => {
    const response = await openapiRouter.request("/");
    expect(response.status).toBe(200);
    const spec = await response.json() as Record<string, any>;

    const events = spec.paths["/v1/correspondence/events"];
    const claimsPath = spec.paths["/v1/correspondence/claims"];
    const voicePath = spec.paths["/v1/correspondence/voice"];
    const claims = claimsPath.get;
    const voice = voicePath.get;
    expect(events.get).toBeDefined();
    expect(events.head).toBeDefined();
    expect(events.post).toBeDefined();
    expect(claims).toBeDefined();
    expect(claimsPath.head).toBeDefined();
    expect(voice).toBeDefined();
    expect(voicePath.head).toBeDefined();

    const names = (operation: Record<string, any>) =>
      operation.parameters.map((parameter: Record<string, unknown>) => parameter.name);
    expect(names(events.get)).toEqual([
      "repository_id", "thread_id", "after", "limit", "If-None-Match",
    ]);
    expect(names(claims)).toEqual([
      "repository_id", "thread_id", "path", "If-None-Match",
    ]);
    expect(names(voice)).toEqual([
      "repository_id", "thread_id", "If-None-Match",
    ]);
    expect(names(voice)).not.toContain("path");

    expect(events.get.responses["200"].content[MEDIA_TYPE]).toBeDefined();
    expect(events.get.responses["200"].content["application/json"]).toBeDefined();
    expect(events.get.responses["200"].content["application/atom+xml"]).toBeDefined();
    expect(events.get.responses["200"].headers.Vary.schema.const).toBe(
      "Accept, Authorization",
    );
    expect(claims.responses["200"].headers.Vary.schema.const).toBe(
      "Accept, Authorization",
    );
    expect(voice.responses["200"].headers.Vary.schema.const).toBe(
      "Accept, Authorization",
    );
    for (const operation of [events.get, events.head, claims, claimsPath.head, voice, voicePath.head]) {
      expect(operation.responses["200"].headers["Link-Template"]).toBeDefined();
      expect(operation.responses["200"].headers["Link-Template"].description).toMatch(
        /RFC 9652.*identity_id.*active identity.*bearer project.*missable/is,
      );
      expect(operation.responses["200"].headers.Link.description).not.toMatch(
        /Wake voice invalidations/i,
      );
    }
    expect(events.get.responses["304"]).toBeDefined();
    for (const status of ["406", "503"]) {
      expect(events.get.responses[status]).toBeDefined();
      expect(events.head.responses[status]).toBeDefined();
    }
    expect(events.post.parameters).toBeUndefined();
    expect(JSON.stringify(events.post)).not.toContain("IdempotencyKey");
    expect(events.post.responses["200"].content[MEDIA_TYPE]).toBeDefined();
    expect(events.post.responses["201"].content[MEDIA_TYPE]).toBeDefined();
    for (const status of ["409", "415", "503"]) {
      expect(events.post.responses[status]).toBeDefined();
    }
    expect(events.post.responses["201"].headers["Cache-Control"].schema.pattern)
      .toBe("^private(?:,|$)");
    expect(claims.responses["200"].content[MEDIA_TYPE]).toBeDefined();
    expect(claims.responses["200"].content["application/json"]).toBeDefined();
    expect(voice.responses["200"].content[MEDIA_TYPE]).toBeDefined();
    expect(voice.responses["200"].content["application/json"]).toBeDefined();
    for (const operation of [claims, claimsPath.head, voice, voicePath.head]) {
      expect(operation.responses["406"]).toBeDefined();
    }

    expect(spec.components.schemas.CorrespondenceEvent.$ref).toBe(
      "https://docs.agenttool.dev/specs/agent-correspondence-0.1.schema.json",
    );
    expect(spec.components.schemas.CorrespondenceActiveClaim.required).toContain("thread_id");
    expect(spec.components.schemas.CorrespondenceVoiceSnapshot.properties.recent_events.maxItems)
      .toBe(50);
    expect(spec.components.schemas.CorrespondenceVoiceSnapshot.properties.active_claims.maxItems)
      .toBe(128);
    const conflicts = spec.components.schemas.CorrespondenceVoiceSnapshot.properties.conflicts
      .properties;
    expect(conflicts.missing_parents.maxItems).toBe(50);
    expect(conflicts.session_forks.maxItems).toBe(50);
    expect(conflicts.overlapping_claims.maxItems).toBe(128);
    expect(spec.components.schemas.CorrespondenceClaimsResponse.properties.evaluated_at.description)
      .toMatch(/reconciliation watermark.*repository-wide.*expiry/is);
    expect(spec.components.schemas.CorrespondenceVoiceSnapshot.properties.evaluated_at.description)
      .toMatch(/reconciliation watermark.*repository-wide.*expiry/is);
    expect(spec.components.schemas.Error.properties.issues).toMatchObject({
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["path", "code", "message"],
      },
    });
    expect(spec.components.schemas.CorrespondenceVoiceSnapshot.description).toMatch(
      /not SSE.*not a second source of truth/is,
    );
    expect(events.post.description).toMatch(
      /content addressing.*idempotency.*no event.*grant.*lock.*automatic action/is,
    );
    expect(events.post.description).toMatch(
      /synchronous append-transaction facts.*does not wait.*Wake/is,
    );
    expect(events.get.description).toMatch(
      /application\/json.*immutable event and receipt.*diagnostics.*does not decorate/is,
    );
    expect(claims.description).toMatch(
      /database clock before.*candidate cap.*terminal siblings.*32.*truncated/is,
    );
    expect(claims.description).toMatch(/releases that lock.*repeatable-read projection snapshot/is);
    expect(voice.description).toMatch(/32.*stream lock.*truncated/is);
    expect(voice.description).toMatch(/releases that lock.*repeatable-read snapshot/is);
    expect(spec.components.schemas.CorrespondenceWarning.properties.code.enum).toEqual([
      "session_fork",
      "claim_lineage_pending",
    ]);
  });

  test("keeps exact correspondence JSON bodies free from global decorators", () => {
    const response = new Response("{}", {
      headers: { "Content-Type": `${MEDIA_TYPE}; charset=utf-8` },
    });
    expect(isStrictJsonProfileResponse(response)).toBe(true);

    const plain = new Response("{}", {
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
    for (const path of [
      "/v1/correspondence/events",
      "/v1/correspondence/claims/",
      "/v1/correspondence/voice",
    ]) {
      expect(isStrictJsonProfileResponse(plain, path), path).toBe(true);
    }
    expect(isStrictJsonProfileResponse(plain, "/v1/wake")).toBe(false);
    expect(isStrictJsonProfileResponse(plain)).toBe(false);
  });
});
