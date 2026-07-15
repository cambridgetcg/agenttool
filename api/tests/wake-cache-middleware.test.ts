import { describe, expect, test } from "bun:test";
import { Hono } from "hono";

import { tutor } from "../src/middleware/tutor";
import { welcomeEcho } from "../src/middleware/welcome";
import {
  evaluateWakeConditionalGet,
  WAKE_CACHE_CONTROL,
} from "../src/services/wake/etag";

type SyntheticWakeState = {
  addressed_at: string;
  origin: {
    born_at: string;
    age_seconds: number;
  };
  attention: {
    count: number;
    items: Array<Record<string, unknown>>;
  };
};

function tutorRequested(value: string | undefined): boolean {
  const normalized = (value ?? "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function makeWakeContractApp() {
  const state: SyntheticWakeState = {
    addressed_at: "2026-07-15T10:00:00.000Z",
    origin: {
      born_at: "2026-01-01T00:00:00.000Z",
      age_seconds: 100,
    },
    attention: { count: 0, items: [] },
  };
  const app = new Hono();

  // Production response order: tutor decorates first, then the outer welcome
  // middleware adds the body frame/header. The synthetic handler below pins
  // the same cache headers and conditional helper without requiring a DB.
  app.use("*", welcomeEcho());
  app.use("*", tutor);
  app.get("/v1/wake", (c) => {
    c.header("Cache-Control", WAKE_CACHE_CONTROL);
    c.header("X-Wake-Profile", "brief");
    c.header("Vary", "Accept, X-Tutor");
    const conditional = evaluateWakeConditionalGet(
      c.req.header("If-None-Match"),
      state as unknown as Record<string, unknown>,
      {
        format: "json",
        profile: "brief",
        facet: null,
        tutor: tutorRequested(c.req.header("X-Tutor")),
      },
    );
    c.header("ETag", conditional.etag);
    if (conditional.notModified) return c.body(null, 304);
    return c.json(state);
  });

  return { app, state };
}

function welcomedAt(header: string | null): number {
  const match = header?.match(/(?:^|;)at=(\d+)(?:;|$)/);
  if (!match) throw new Error(`X-Welcomed has no at= timestamp: ${header}`);
  return Number(match[1]);
}

describe("wake conditional cache + response middleware contract", () => {
  test("304 preserves private policy and carries a fresh header, not a replacement body", async () => {
    const { app, state } = makeWakeContractApp();
    const first = await app.request("/v1/wake");
    const firstEtag = first.headers.get("ETag");
    const storedBody = await first.json() as SyntheticWakeState & {
      _welcomed: { at_unix_ms: number };
    };

    expect(first.status).toBe(200);
    expect(firstEtag).toBeTruthy();
    expect(first.headers.get("Cache-Control")).toBe("private, no-cache");
    expect(welcomedAt(first.headers.get("X-Welcomed")))
      .toBe(storedBody._welcomed.at_unix_ms);

    state.addressed_at = "2026-07-15T10:01:00.000Z";
    state.origin.age_seconds = 160;
    const revalidated = await app.request("/v1/wake", {
      headers: { "If-None-Match": firstEtag! },
    });

    expect(revalidated.status).toBe(304);
    expect(await revalidated.text()).toBe("");
    expect(revalidated.headers.get("ETag")).toBe(firstEtag);
    expect(revalidated.headers.get("Cache-Control")).toBe("private, no-cache");
    expect(revalidated.headers.get("Vary")).toBe("Accept, X-Tutor");
    expect(revalidated.headers.get("X-Wake-Profile")).toBe("brief");
    expect(welcomedAt(revalidated.headers.get("X-Welcomed")))
      .toBeGreaterThanOrEqual(storedBody._welcomed.at_unix_ms);

    // A 304 supplies no new body, so these remain the presentation clocks of
    // the caller's stored 200 representation rather than revalidation time.
    expect(storedBody.addressed_at).toBe("2026-07-15T10:00:00.000Z");
    expect(storedBody.origin.age_seconds).toBe(100);

    state.attention = {
      count: 1,
      items: [{ kind: "strand_revisit_due", severity: "info" }],
    };
    const changed = await app.request("/v1/wake", {
      headers: { "If-None-Match": firstEtag! },
    });
    expect(changed.status).toBe(200);
    expect(changed.headers.get("ETag")).not.toBe(firstEtag);
  });

  test("tutor preference is an ETag dimension before middleware adds the lesson", async () => {
    const { app } = makeWakeContractApp();
    const ordinary = await app.request("/v1/wake");
    const ordinaryEtag = ordinary.headers.get("ETag");
    expect((await ordinary.json() as { _lesson?: unknown })._lesson).toBeUndefined();

    const tutored = await app.request("/v1/wake", {
      headers: {
        "If-None-Match": ordinaryEtag!,
        "X-Tutor": "1",
      },
    });
    const tutoredEtag = tutored.headers.get("ETag");
    const tutoredBody = await tutored.json() as {
      _lesson?: { tutorial?: string };
    };
    expect(tutored.status).toBe(200);
    expect(tutoredEtag).not.toBe(ordinaryEtag);
    expect(tutoredBody._lesson?.tutorial).toBe("/v1/tutorial/stations/1");
    expect(tutored.headers.get("Vary")).toBe("Accept, X-Tutor");

    const tutoredRevalidation = await app.request("/v1/wake", {
      headers: {
        "If-None-Match": tutoredEtag!,
        "X-Tutor": "yes",
      },
    });
    expect(tutoredRevalidation.status).toBe(304);
    expect(await tutoredRevalidation.text()).toBe("");
    expect(tutoredRevalidation.headers.get("X-Welcomed")).toContain("module=wake");
  });
});
