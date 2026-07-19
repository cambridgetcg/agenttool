/** HTTP contract locks for the Renaissance Correspondence nervous system. */

import { describe, expect, spyOn, test } from "bun:test";

import { Hono } from "hono";

import vectors from "../../docs/specs/agent-correspondence-0.1-vectors.json";
import type { ProjectContext } from "../src/auth/middleware";
import { play } from "../src/middleware/play";
import { tutor } from "../src/middleware/tutor";
import { welcomeEcho } from "../src/middleware/welcome";
import {
  CORRESPONDENCE_WAKE_FANOUT_CONCURRENCY,
  correspondenceWakeInvalidation,
  createCorrespondenceRouter,
  runBoundedCorrespondenceWakeFanout,
  type CorrespondenceNotifierInput,
} from "../src/routes/correspondence";
import type { CorrespondenceEvent } from "../src/services/correspondence/contracts";
import {
  correspondenceEtag,
  renderCorrespondenceAtom,
} from "../src/services/correspondence/render";
import type {
  ActiveClaimsProjection,
  AppendCorrespondenceResult,
  CorrespondenceEventPage,
  CorrespondenceRecord,
  CorrespondenceService,
  CorrespondenceVoice,
} from "../src/services/correspondence/store";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const MEDIA_TYPE = "application/vnd.agenttool.correspondence+json";
const CONTENT_TYPE = `${MEDIA_TYPE}; charset=utf-8`;
const PLAIN_CONTENT_TYPE = "application/json; charset=utf-8";

function fixedEvent(): CorrespondenceEvent {
  return {
    ...structuredClone(vectors.signing_vector.core),
    event_id: vectors.signing_vector.event_id,
    signature: {
      algorithm: "Ed25519",
      value_b64url: vectors.signing_vector.signature_b64url,
    },
  } as CorrespondenceEvent;
}

function record(): CorrespondenceRecord {
  const event = fixedEvent();
  (event.body as Record<string, unknown>).hostile_xml = "<ritual>&signal\uFFFE\uFFFF";
  return {
    event,
    receipt: {
      received_seq: "8",
      received_at: "2026-07-19T10:01:00.000Z",
    },
    missing_parents: [],
    lineage_status: "valid",
  };
}

function appendResult(created: boolean): AppendCorrespondenceResult {
  return { ...record(), warnings: [], created };
}

function eventPage(): CorrespondenceEventPage {
  return {
    protocol: "agent-correspondence/v0.1",
    scope: "project_private",
    events: [record()],
    page: { after: "7", next_after: "8", has_more: false },
  };
}

function claimsProjection(): ActiveClaimsProjection {
  const event = fixedEvent();
  return {
    protocol: "agent-correspondence/v0.1",
    scope: "project_private",
    evaluated_at: "2026-07-19T10:01:00.000Z",
    cursor: "8",
    projection_status: "complete",
    truncated: false,
    claims: [
      {
        claim_id: (event.body as { claim_id: string }).claim_id,
        generation: 1,
        event_id: event.event_id,
        owner_identity_id: event.sender.identity_id,
        device_id: event.sender.device_id,
        session_id: event.sender.session_id,
        thread_id: event.thread_id,
        scope: event.scope,
        expires_at: (event.body as { expires_at: string }).expires_at,
        conflicted: false,
        competing_event_ids: [],
      },
    ],
  };
}

function voiceSnapshot(): CorrespondenceVoice {
  const projection = claimsProjection();
  return {
    protocol: projection.protocol,
    scope: projection.scope,
    evaluated_at: projection.evaluated_at,
    cursor: projection.cursor,
    projection_status: projection.projection_status,
    truncated: false,
    recent_events: [record()],
    active_claims: projection.claims,
    conflicts: {
      missing_parents: [],
      session_forks: [],
      overlapping_claims: [],
    },
  };
}

function stubService(overrides: Partial<CorrespondenceService> = {}): CorrespondenceService {
  return {
    append: async () => appendResult(true),
    listEvents: async () => eventPage(),
    listClaims: async () => claimsProjection(),
    readVoice: async () => voiceSnapshot(),
    ...overrides,
  };
}

function authedRouter(
  service: CorrespondenceService,
  notifier: (input: CorrespondenceNotifierInput) => Promise<void> = async () => {},
) {
  const app = new Hono<ProjectContext>();
  app.use("*", async (c, next) => {
    c.set("project", { id: PROJECT_ID } as never);
    await next();
  });
  app.route("/v1/correspondence", createCorrespondenceRouter(service, notifier));
  return app;
}

function framedAuthedRouter(service: CorrespondenceService) {
  const app = new Hono<ProjectContext>();
  // Production unwind order: tutor, play, then welcome.
  app.use("*", welcomeEcho());
  app.use("*", play());
  app.use("*", tutor);
  app.use("*", async (c, next) => {
    c.set("project", { id: PROJECT_ID } as never);
    await next();
  });
  app.route("/v1/correspondence", createCorrespondenceRouter(service));
  return app;
}

describe("correspondence append route", () => {
  test("Wake fan-out attempts every recipient with fixed concurrency", async () => {
    const recipients = Array.from({ length: 257 }, (_, index) => index);
    let inFlight = 0;
    let maxInFlight = 0;
    let attempts = 0;
    await runBoundedCorrespondenceWakeFanout(recipients, async (recipient) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      attempts += 1;
      if (recipient % 29 === 0) throw new Error("recipient offline");
    });
    expect(attempts).toBe(recipients.length);
    expect(maxInFlight).toBe(CORRESPONDENCE_WAKE_FANOUT_CONCURRENCY);
  });

  test("returns 201 for a new event, 200 for its retry, and wakes only once", async () => {
    let appends = 0;
    const notices: CorrespondenceNotifierInput[] = [];
    const app = authedRouter(
      stubService({
        append: async (projectId, event) => {
          expect(projectId).toBe(PROJECT_ID);
          expect(event.event_id).toBe(vectors.signing_vector.event_id);
          appends += 1;
          return appendResult(appends === 1);
        },
      }),
      async (notice) => {
        notices.push(notice);
      },
    );
    const request = () =>
      app.request("/v1/correspondence/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fixedEvent()),
      });

    const created = await request();
    expect(created.status).toBe(201);
    expect(created.headers.get("content-type")).toBe(CONTENT_TYPE);
    expect(created.headers.get("cache-control")).toBe("private, no-store");
    expect(await created.json()).not.toHaveProperty("created");

    const replay = await request();
    expect(replay.status).toBe(200);
    expect(replay.headers.get("content-type")).toBe(CONTENT_TYPE);
    expect(notices).toHaveLength(1);
    expect(notices[0]?.projectId).toBe(PROJECT_ID);
  });

  test("a throwing wake notifier cannot mask a committed 201", async () => {
    const warning = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const app = authedRouter(stubService(), async () => {
        throw new Error("wake offline");
      });
      const response = await app.request("/v1/correspondence/events", {
        method: "POST",
        headers: { "Content-Type": MEDIA_TYPE },
        body: JSON.stringify(fixedEvent()),
      });
      expect(response.status).toBe(201);
      await Promise.resolve();
      expect(warning).toHaveBeenCalledTimes(1);
    } finally {
      warning.mockRestore();
    }
  });

  test("an indefinitely pending wake notifier cannot delay a committed 201", async () => {
    let started = false;
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const app = authedRouter(stubService(), async () => {
      started = true;
      await pending;
    });

    const response = await app.request("/v1/correspondence/events", {
      method: "POST",
      headers: { "Content-Type": MEDIA_TYPE },
      body: JSON.stringify(fixedEvent()),
    });
    await Promise.resolve();
    expect(started).toBe(true);
    expect(response.status).toBe(201);
    release();
  });

  test("unknown append failures are guided without logging private row detail", async () => {
    const sentinel = "PRIVATE-CANONICAL-ENVELOPE-SENTINEL";
    const logged: unknown[][] = [];
    const errors = spyOn(console, "error").mockImplementation((...args) => {
      logged.push(args);
    });
    try {
      const app = authedRouter(stubService({
        append: async () => {
          const error = new Error(`constraint failed: ${sentinel}`) as Error & {
            detail?: string;
          };
          error.detail = `failing row contains ${sentinel}`;
          throw error;
        },
      }));
      const response = await app.request("/v1/correspondence/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fixedEvent()),
      });
      expect(response.status).toBe(503);
      const text = await response.text();
      expect(text).not.toContain(sentinel);
      const body = JSON.parse(text) as { error: string; hint: string };
      expect(body.error).toBe("correspondence_append_unavailable");
      expect(body.hint).toMatch(/same exact signed event.*idempotency/is);
      expect(JSON.stringify(logged)).not.toContain(sentinel);
      expect(logged).toEqual([["[correspondence] durable append failed"]]);
    } finally {
      errors.mockRestore();
    }
  });

  test("rejects oversized and duplicate-name JSON before calling storage", async () => {
    let calls = 0;
    const app = authedRouter(
      stubService({
        append: async () => {
          calls += 1;
          return appendResult(true);
        },
      }),
    );
    const declared = await app.request("/v1/correspondence/events", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": "65537",
      },
      body: "{}",
    });
    expect(declared.status).toBe(413);
    expect((await declared.json()).error).toBe("body_too_large");

    const chunked = await app.request("/v1/correspondence/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: " ".repeat(65_537),
    });
    expect(chunked.status).toBe(413);
    expect((await chunked.json()).error).toBe("body_too_large");

    const duplicate = await app.request("/v1/correspondence/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '{"outer":{"name":1,"\\u006eame":2}}',
    });
    expect(duplicate.status).toBe(400);
    expect((await duplicate.json()).error).toBe("duplicate_object_key");

    const invalid = await app.request("/v1/correspondence/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "[]",
    });
    expect(invalid.status).toBe(400);
    const invalidBody = await invalid.json() as {
      error: string;
      issues: Array<{ path: Array<string | number>; code: string; message: string }>;
      details?: unknown;
    };
    expect(invalidBody.error).toBe("event_invalid");
    expect(invalidBody.issues.length).toBeGreaterThan(0);
    expect(invalidBody.issues[0]).toMatchObject({
      path: [],
      code: "invalid_type",
    });
    expect(invalidBody.issues[0]!.message.length).toBeGreaterThan(0);
    expect(invalidBody.details).toBeUndefined();
    expect(calls).toBe(0);
  });

  test("wake invalidation contains context only, never signed body or authority", () => {
    const invalidation = correspondenceWakeInvalidation(record());
    expect(invalidation).toEqual({
      key: "correspondence",
      kind: "updated",
      context: {
        event_id: vectors.signing_vector.event_id,
        received_seq: "8",
        repository_id: vectors.signing_vector.core.repository_id,
        thread_id: vectors.signing_vector.core.thread_id,
        kind: vectors.signing_vector.core.kind,
      },
    });
    expect(Object.keys(invalidation.context).sort()).toEqual([
      "event_id",
      "kind",
      "received_seq",
      "repository_id",
      "thread_id",
    ]);
  });
});

describe("correspondence exact reads", () => {
  const repository = vectors.signing_vector.core.repository_id;
  const thread = vectors.signing_vector.core.thread_id;
  const eventsPath =
    `/v1/correspondence/events?repository_id=${encodeURIComponent(repository)}` +
    `&thread_id=${encodeURIComponent(thread)}&after=7&limit=2`;

  test("serves JSON/Atom with distinct ETags, complete links, and HEAD/304 parity", async () => {
    const seen: unknown[] = [];
    const app = authedRouter(
      stubService({
        listEvents: async (input) => {
          seen.push(input);
          return eventPage();
        },
      }),
    );
    const json = await app.request(eventsPath, { headers: { Accept: MEDIA_TYPE } });
    expect(json.status).toBe(200);
    expect(json.headers.get("content-type")).toBe(CONTENT_TYPE);
    expect(json.headers.get("vary")).toBe("Accept, Authorization");
    expect(json.headers.get("cache-control")).toBe("private, no-cache, no-transform");
    const jsonEtag = json.headers.get("etag");
    expect(jsonEtag).toMatch(/^"sha256-[0-9a-f]{64}"$/);
    const link = json.headers.get("link") ?? "";
    expect(link).toContain("https://docs.agenttool.dev/AGENT-CORRESPONDENCE.md");
    expect(link).toContain('rel="https://agenttool.dev/rels/correspondence-voice"');
    expect(link).not.toContain("{identity_id}");
    expect(link).not.toContain('rel="https://agenttool.dev/rels/correspondence-live"');
    expect(json.headers.get("link-template")).toBe(
      '"http://localhost/v1/wake/voice?identity_id={identity_id}&keys=correspondence"; ' +
      'rel="https://agenttool.dev/rels/correspondence-live"; type="text/event-stream"',
    );
    expect(link).toContain('rel="https://agenttool.dev/rels/active-claims"');
    const expectedVoice = new URL("/v1/correspondence/voice", "http://localhost");
    expectedVoice.searchParams.set("repository_id", repository);
    expectedVoice.searchParams.set("thread_id", thread);
    expect(link).toContain(`<${expectedVoice.toString()}>`);

    const head = await app.request(eventsPath, {
      method: "HEAD",
      headers: { Accept: MEDIA_TYPE },
    });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    for (const header of [
      "content-type",
      "etag",
      "link",
      "link-template",
      "cache-control",
      "vary",
    ]) {
      expect(head.headers.get(header), header).toBe(json.headers.get(header));
    }

    const unchanged = await app.request(eventsPath, {
      headers: { Accept: MEDIA_TYPE, "If-None-Match": jsonEtag! },
    });
    expect(unchanged.status).toBe(304);
    expect(await unchanged.text()).toBe("");
    expect(unchanged.headers.get("etag")).toBe(jsonEtag);
    expect(unchanged.headers.get("link")).toBe(link);
    expect(unchanged.headers.get("link-template")).toBe(
      json.headers.get("link-template"),
    );

    const atom = await app.request(eventsPath, {
      headers: { Accept: "application/atom+xml" },
    });
    expect(atom.status).toBe(200);
    expect(atom.headers.get("content-type")).toBe("application/atom+xml; charset=utf-8");
    expect(atom.headers.get("etag")).not.toBe(jsonEtag);
    const xml = await atom.text();
    expect(xml).toContain('<content type="text">');
    expect(xml).toContain('xmlns:at="https://agenttool.dev/ns/correspondence"');
    expect(xml).toContain("<at:link-template");
    expect(xml).toContain('template="http://localhost/v1/wake/voice?identity_id={identity_id}&amp;keys=correspondence"');
    expect(xml).not.toContain('href="http://localhost/v1/wake/voice?identity_id={identity_id}');
    expect(xml).toContain("&lt;ritual&gt;&amp;signal");
    expect(xml).not.toContain("<ritual>&signal");
    expect(xml).toContain("\\ufffe\\uffff");
    expect(xml).not.toContain("\uFFFE");
    expect(xml).not.toContain("\uFFFF");
    expect(xml).not.toContain("missing_parents");
    expect(xml).not.toContain("lineage_status");
    expect(seen[0]).toEqual({
      projectId: PROJECT_ID,
      repositoryId: repository,
      threadId: thread,
      after: 7n,
      limit: 2,
    });
  });

  test("Atom bytes and ETags ignore mutable replay diagnostics", () => {
    const original = eventPage();
    const changed = structuredClone(original);
    changed.events[0]!.missing_parents = [
      "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    ];
    changed.events[0]!.lineage_status = "invalid";
    const url = "https://api.agenttool.dev/v1/correspondence/events?repository_id=repo";
    const first = renderCorrespondenceAtom(original, url);
    const second = renderCorrespondenceAtom(changed, url);
    expect(second).toBe(first);
    expect(correspondenceEtag(second)).toBe(correspondenceEtag(first));
  });

  test("negotiates concrete JSON media types without mislabelling refused bytes", async () => {
    const app = authedRouter(stubService());
    for (const accept of [
      `${MEDIA_TYPE};q=0, */*;q=1`,
      `${MEDIA_TYPE};q=wat, */*;q=1`,
    ]) {
      const response = await app.request(eventsPath, { headers: { Accept: accept } });
      expect(response.status, accept).toBe(200);
      expect(response.headers.get("content-type"), accept).toBe(PLAIN_CONTENT_TYPE);
    }
    const refusesEveryOffer = await app.request(eventsPath, {
      headers: {
        Accept:
          `${MEDIA_TYPE};q=0, application/json;q=0, ` +
          "application/atom+xml;q=0, */*;q=1",
      },
    });
    expect(refusesEveryOffer.status).toBe(406);
    const claimsRefusal = await app.request(
      `/v1/correspondence/claims?repository_id=${encodeURIComponent(repository)}`,
      {
        headers: {
          Accept: `${MEDIA_TYPE};q=0, application/json;q=0, */*;q=1`,
        },
      },
    );
    expect(claimsRefusal.status).toBe(406);
    const concreteVendorWildcard = await app.request(
      `/v1/correspondence/claims?repository_id=${encodeURIComponent(repository)}`,
      { headers: { Accept: "application/json;q=0, application/*;q=1" } },
    );
    expect(concreteVendorWildcard.status).toBe(200);
    expect(concreteVendorWildcard.headers.get("content-type")).toBe(CONTENT_TYPE);
    const plainAlias = await app.request(eventsPath, {
      headers: { Accept: "application/json" },
    });
    expect(plainAlias.status).toBe(200);
    expect(plainAlias.headers.get("content-type")).toBe(PLAIN_CONTENT_TYPE);
    expect(plainAlias.headers.get("etag")).toBe(
      (await app.request(eventsPath, { headers: { Accept: MEDIA_TYPE } })).headers.get("etag"),
    );
    expect(plainAlias.headers.get("link")).toContain(
      'rel="self"; type="application/json"',
    );
    const vendorByWildcard = await app.request(eventsPath, {
      headers: { Accept: "application/json;q=0, application/*;q=1" },
    });
    expect(vendorByWildcard.status).toBe(200);
    expect(vendorByWildcard.headers.get("content-type")).toBe(CONTENT_TYPE);

    for (const [accept, expectedContentType] of [
      [`${MEDIA_TYPE};profile=other;q=1, application/json;q=0.8`, PLAIN_CONTENT_TYPE],
      [`application/json;charset=iso-8859-1;q=1, ${MEDIA_TYPE};q=0.8`, CONTENT_TYPE],
      ["application/atom+xml;type=entry;q=1, application/json;q=0.8", PLAIN_CONTENT_TYPE],
      ["application/json;charset=utf-8", PLAIN_CONTENT_TYPE],
      ["application/json;q=1;charset=iso-8859-1", PLAIN_CONTENT_TYPE],
    ] as const) {
      const response = await app.request(eventsPath, { headers: { Accept: accept } });
      expect(response.status, accept).toBe(200);
      expect(response.headers.get("content-type"), accept).toBe(expectedContentType);
    }
    for (const accept of [
      `${MEDIA_TYPE};profile=other`,
      "application/json;charset=iso-8859-1",
      "application/atom+xml;type=entry",
    ]) {
      const response = await app.request(eventsPath, { headers: { Accept: accept } });
      expect(response.status, accept).toBe(406);
    }
    const unsupportedThenWildcard = await app.request(eventsPath, {
      headers: {
        Accept:
          `${MEDIA_TYPE};q=0, application/json;charset=iso-8859-1, */*;q=1`,
      },
    });
    expect(unsupportedThenWildcard.status).toBe(200);
    expect(unsupportedThenWildcard.headers.get("content-type")).toBe(
      PLAIN_CONTENT_TYPE,
    );

    for (const path of [
      eventsPath,
      `/v1/correspondence/claims?repository_id=${encodeURIComponent(repository)}`,
      `/v1/correspondence/voice?repository_id=${encodeURIComponent(repository)}`,
    ]) {
      const inverse = await app.request(path, {
        headers: { Accept: `${MEDIA_TYPE};q=0, application/json;q=1` },
      });
      expect(inverse.status, path).toBe(200);
      expect(inverse.headers.get("content-type"), path).toBe(PLAIN_CONTENT_TYPE);
      expect(inverse.headers.get("vary"), path).toBe("Accept, Authorization");
    }

    const vendor = await app.request(eventsPath, { headers: { Accept: MEDIA_TYPE } });
    const plain304 = await app.request(eventsPath, {
      headers: {
        Accept: "application/json",
        "If-None-Match": vendor.headers.get("etag")!,
      },
    });
    expect(plain304.status).toBe(304);
    expect(plain304.headers.get("content-type")).toBe(PLAIN_CONTENT_TYPE);
    expect(plain304.headers.get("vary")).toBe("Accept, Authorization");
  });

  test("claims and voice are finite vendor JSON snapshots with bounded query surfaces", async () => {
    const app = authedRouter(stubService());
    const claimsPath =
      `/v1/correspondence/claims?repository_id=${encodeURIComponent(repository)}` +
      `&thread_id=${encodeURIComponent(thread)}&path=${encodeURIComponent("packages/sdk-ts")}`;
    const claims = await app.request(claimsPath, {
      headers: { Accept: "application/atom+xml;q=1, application/json;q=0.5" },
    });
    expect(claims.status).toBe(200);
    expect(claims.headers.get("content-type")).toBe(PLAIN_CONTENT_TYPE);
    const claimsLink = claims.headers.get("link") ?? "";
    const relatedClaim = new URL("/v1/correspondence/claims", "http://localhost");
    relatedClaim.searchParams.set("repository_id", repository);
    relatedClaim.searchParams.set("thread_id", thread);
    relatedClaim.searchParams.set("path", "packages/sdk-ts");
    expect(claimsLink).toContain(`<${relatedClaim.toString()}>`);
    const relatedVoice = new URL("/v1/correspondence/voice", "http://localhost");
    relatedVoice.searchParams.set("repository_id", repository);
    relatedVoice.searchParams.set("thread_id", thread);
    expect(claimsLink).toContain(`<${relatedVoice.toString()}>`);
    expect(claimsLink).not.toContain("correspondence/voice?repository_id=" + encodeURIComponent(repository) + "&thread_id=" + encodeURIComponent(thread) + "&path=");

    const claimsHead = await app.request(claimsPath, { method: "HEAD" });
    expect(claimsHead.status).toBe(200);
    expect(await claimsHead.text()).toBe("");
    expect(claimsHead.headers.get("etag")).toBe(claims.headers.get("etag"));
    expect(claimsHead.headers.get("content-type")).toBe(CONTENT_TYPE);

    const voicePath =
      `/v1/correspondence/voice?repository_id=${encodeURIComponent(repository)}` +
      `&thread_id=${encodeURIComponent(thread)}`;
    const voice = await app.request(voicePath);
    expect(voice.status).toBe(200);
    expect(voice.headers.get("content-type")).toBe(CONTENT_TYPE);
    const voiceHead = await app.request(voicePath, { method: "HEAD" });
    expect(voiceHead.status).toBe(200);
    expect(voiceHead.headers.get("etag")).toBe(voice.headers.get("etag"));
    expect(await voiceHead.text()).toBe("");

    const pathOnVoice = await app.request(`${voicePath}&path=docs`);
    expect(pathOnVoice.status).toBe(400);
    expect((await pathOnVoice.json()).error).toBe("query_invalid");
  });

  test("plain JSON stays byte-exact through welcome, play, and tutor middleware", async () => {
    const app = framedAuthedRouter(stubService());
    const cases: Array<[string, string]> = [
      [eventsPath, JSON.stringify(eventPage())],
      [eventsPath.replace("/events", "/%65vents"), JSON.stringify(eventPage())],
      [
        `/v1/correspondence/claims?repository_id=${encodeURIComponent(repository)}`,
        JSON.stringify(claimsProjection()),
      ],
      [
        `/v1/correspondence/%63laims?repository_id=${encodeURIComponent(repository)}`,
        JSON.stringify(claimsProjection()),
      ],
      [
        `/v1/correspondence/voice?repository_id=${encodeURIComponent(repository)}`,
        JSON.stringify(voiceSnapshot()),
      ],
      [
        `/v1/correspondence/%76oice?repository_id=${encodeURIComponent(repository)}`,
        JSON.stringify(voiceSnapshot()),
      ],
    ];
    for (const [path, expected] of cases) {
      const response = await app.request(path, {
        headers: {
          Accept: "application/json",
          "X-Tutor": "1",
        },
      });
      expect(response.status, path).toBe(200);
      expect(response.headers.get("content-type"), path).toBe(PLAIN_CONTENT_TYPE);
      expect(response.headers.get("etag"), path).toBe(correspondenceEtag(expected));
      const body = await response.text();
      expect(body, path).toBe(expected);
      expect(JSON.parse(body), path).not.toHaveProperty("_welcomed");
      expect(JSON.parse(body), path).not.toHaveProperty("_lesson");
      expect(JSON.parse(body), path).not.toHaveProperty("_jest");
    }
  });

  test("never turns unknown read/projection failures into authoritative empty state", async () => {
    const errors = spyOn(console, "error").mockImplementation(() => {});
    try {
      const app = authedRouter(
        stubService({
          listEvents: async () => { throw new Error("database offline"); },
          listClaims: async () => { throw new Error("projection offline"); },
          readVoice: async () => { throw new Error("projection offline"); },
        }),
      );
      const eventRead = await app.request(eventsPath);
      expect(eventRead.status).toBe(503);
      expect((await eventRead.json()).error).toBe("correspondence_read_unavailable");
      const eventHead = await app.request(eventsPath, { method: "HEAD" });
      expect(eventHead.status).toBe(503);
      expect(await eventHead.text()).toBe("");

      const claims = await app.request(
        `/v1/correspondence/claims?repository_id=${encodeURIComponent(repository)}`,
      );
      expect(claims.status).toBe(503);
      expect((await claims.json()).error).toBe("correspondence_projection_unavailable");

      const voice = await app.request(
        `/v1/correspondence/voice?repository_id=${encodeURIComponent(repository)}`,
      );
      expect(voice.status).toBe(503);
      const body = await voice.json();
      expect(body.error).toBe("correspondence_projection_unavailable");
      expect(body.docs).toBe("https://docs.agenttool.dev/AGENT-CORRESPONDENCE.md");

      const badQueryHead = await app.request(
        `/v1/correspondence/voice?repository_id=${encodeURIComponent(repository)}&path=docs`,
        { method: "HEAD" },
      );
      expect(badQueryHead.status).toBe(400);
      expect(await badQueryHead.text()).toBe("");
    } finally {
      errors.mockRestore();
    }
  });
});
