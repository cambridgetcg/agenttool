import { describe, expect, test } from "bun:test";
import { Hono } from "hono";

import {
  evaluateWakeConditionalGet,
  makeWakeSemanticEtag,
  wakeIfNoneMatchMatches,
} from "../src/services/wake/etag";

describe("wake representation validators", () => {
  test("hashes complete bundle state instead of an incomplete identity cursor", () => {
    const representation = {
      format: "md",
      profile: "brief",
      facet: null,
      tutor: false,
    };
    const base = {
      wake_version: 42,
      addressed_at: "2026-07-15T10:00:00.000Z",
      origin: {
        born_at: "2026-01-01T00:00:00.000Z",
        age_seconds: 100,
      },
      project_memory_count: 1,
      attention: { count: 0, items: [] },
    };
    const projectStateChanged = {
      wake_version: 42,
      addressed_at: "2026-07-15T10:00:00.000Z",
      origin: {
        born_at: "2026-01-01T00:00:00.000Z",
        age_seconds: 100,
      },
      project_memory_count: 2,
      attention: { count: 0, items: [] },
    };
    const presentationTimeChanged = {
      wake_version: 42,
      addressed_at: "2026-07-15T10:01:00.000Z",
      origin: {
        born_at: "2026-01-01T00:00:00.000Z",
        age_seconds: 160,
      },
      project_memory_count: 1,
      attention: { count: 0, items: [] },
    };
    const timeDerivedAttentionChanged = {
      ...presentationTimeChanged,
      attention: { count: 1, items: [{ kind: "strand_revisit_due" }] },
    };

    expect(makeWakeSemanticEtag(base, representation)).not.toBe(
      makeWakeSemanticEtag(projectStateChanged, representation),
    );
    expect(makeWakeSemanticEtag(base, representation)).toBe(
      makeWakeSemanticEtag(presentationTimeChanged, representation),
    );
    expect(makeWakeSemanticEtag(base, representation)).not.toBe(
      makeWakeSemanticEtag(
        {
          ...base,
          origin: {
            born_at: "2026-01-02T00:00:00.000Z",
            age_seconds: 100,
          },
        },
        representation,
      ),
    );
    expect(makeWakeSemanticEtag(base, representation)).not.toBe(
      makeWakeSemanticEtag(timeDerivedAttentionChanged, representation),
    );
    expect(makeWakeSemanticEtag(base, representation)).not.toBe(
      makeWakeSemanticEtag(base, { ...representation, tutor: true }),
    );
    expect(makeWakeSemanticEtag(base, representation)).toMatch(
      /^W\/"r4-sha256-[0-9a-f]{64}"$/,
    );
  });

  test("honors weak GET comparison, lists, and wildcard", () => {
    const etag = makeWakeSemanticEtag(
      { addressed_at: "2026-07-15T10:00:00.000Z", value: "wake" },
      { format: "md", profile: "brief", facet: null, tutor: false },
    );
    const strongEquivalent = etag.slice(2);
    expect(wakeIfNoneMatchMatches(etag, etag)).toBe(true);
    expect(wakeIfNoneMatchMatches(strongEquivalent, etag)).toBe(true);
    expect(wakeIfNoneMatchMatches(`"other", ${strongEquivalent}`, etag)).toBe(true);
    expect(wakeIfNoneMatchMatches("*", etag)).toBe(true);
    expect(wakeIfNoneMatchMatches('"other"', etag)).toBe(false);
  });

  test("HTTP round-trip revalidates presentation time but not changed state", async () => {
    const app = new Hono();
    const state: Record<string, unknown> = {
      addressed_at: "2026-07-15T10:00:00.000Z",
      attention: { count: 0, items: [] },
      project_memory_count: 1,
    };
    const representation = {
      format: "md",
      profile: "brief",
      facet: null,
      tutor: false,
    };
    app.get("/", (c) => {
      const conditional = evaluateWakeConditionalGet(
        c.req.header("If-None-Match"),
        state,
        representation,
      );
      c.header("ETag", conditional.etag);
      if (conditional.notModified) return c.body(null, 304);
      return c.json(state);
    });

    const first = await app.request("/");
    const etag = first.headers.get("ETag");
    expect(first.status).toBe(200);
    expect(etag).toBeTruthy();

    state.addressed_at = "2026-07-15T10:01:00.000Z";
    const presentationOnly = await app.request("/", {
      headers: { "If-None-Match": etag! },
    });
    expect(presentationOnly.status).toBe(304);

    state.attention = {
      count: 1,
      items: [{ kind: "strand_revisit_due", severity: "action" }],
    };
    const changed = await app.request("/", {
      headers: { "If-None-Match": etag! },
    });
    expect(changed.status).toBe(200);
    expect(changed.headers.get("ETag")).not.toBe(etag);
  });
});
