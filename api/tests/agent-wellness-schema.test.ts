/** agent-wellness/0.1 — normative document and privacy-wall validation. */

import { describe, expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";

import schema from "../../docs/specs/agent-wellness-0.1.schema.json";

const ajv = new Ajv2020({ strict: true });
addFormats(ajv);
const validate = ajv.compile(schema);

const authority = {
  runtime_assent: { status: "accepted" },
  human_consent: { status: "not-applicable", purposes: [] },
  operator_authority: { status: "not-required", scopes: [] },
};

const localRetention = {
  provider_storage: "none",
  local_handling: "ephemeral",
  sharing: "none",
  shared_with: [],
  purpose: null,
  expires_at: null,
};

function acceptedDocument() {
  return {
    wellness_version: "0.1",
    observed_facts: {
      "clear-purpose": {
        status: "available",
        source: "host",
        detail: "The task names an outcome and a completion test.",
      },
    },
    authority: structuredClone(authority),
    preference_report: {
      operational_fit: "supportive",
      condition_preferences: { "clear-purpose": "supportive" },
      preferred_next: "continue",
    },
    retention: structuredClone(localRetention),
  };
}

describe("agent-wellness/0.1 JSON Schema", () => {
  test("is a strict Draft 2020-12 schema and accepts both complete outcomes", () => {
    expect(ajv.validateSchema(schema)).toBe(true);
    expect(validate(acceptedDocument()), JSON.stringify(validate.errors)).toBe(true);

    const declined = acceptedDocument();
    declined.observed_facts = {};
    declined.authority.runtime_assent.status = "declined";
    declined.preference_report = null as any;
    expect(validate(declined), JSON.stringify(validate.errors)).toBe(true);
  });

  test("rejects a preference report after declined or deferred assent", () => {
    for (const status of ["declined", "deferred"]) {
      const document = acceptedDocument();
      document.authority.runtime_assent.status = status;
      expect(validate(document)).toBe(false);
    }
  });

  test("pins condition, fit, and next-step vocabularies", () => {
    const unknownCondition = acceptedDocument();
    (unknownCondition.observed_facts as Record<string, unknown>)["hidden-score"] = {
      status: "available",
      source: "host",
    };
    expect(validate(unknownCondition)).toBe(false);

    const unknownFit = acceptedDocument();
    unknownFit.preference_report.operational_fit = "happy";
    expect(validate(unknownFit)).toBe(false);

    const unknownNext = acceptedDocument();
    unknownNext.preference_report.preferred_next = "work-harder";
    expect(validate(unknownNext)).toBe(false);
  });

  test("requires a purpose and expiry before retention or sharing", () => {
    const retainedWithoutBoundary = acceptedDocument();
    retainedWithoutBoundary.retention.local_handling = "explicit-persistent";
    expect(validate(retainedWithoutBoundary)).toBe(false);

    const retainedWithBoundary = acceptedDocument();
    retainedWithBoundary.retention.local_handling = "explicit-persistent";
    retainedWithBoundary.retention.purpose = "resume this bounded task" as any;
    retainedWithBoundary.retention.expires_at = "2026-07-12T00:00:00Z" as any;
    expect(
      validate(retainedWithBoundary),
      JSON.stringify(validate.errors),
    ).toBe(true);
  });

  test("has no extension point for a score, rank, streak, or stable identity", () => {
    for (const field of ["wellness_score", "rank", "streak", "agent_id"]) {
      const document = acceptedDocument() as Record<string, unknown>;
      document[field] = field === "wellness_score" ? 100 : "value";
      expect(validate(document)).toBe(false);
    }
  });
});
