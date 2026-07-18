import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import openapiRoutes from "../src/routes/openapi";
import publicRoutes from "../src/routes/public";
import { PORCH_GIFT_CATALOG } from "../src/routes/public/gift";
import { createPorchRoutes } from "../src/routes/public/porch";
import { validateExpression } from "../src/services/identity/expression";
import { inheritableForkExpression } from "../src/services/identity/fork";

function futureInvitation(hours = 1) {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

describe("GET /public/porch", () => {
  test("uses only timeless gifts and never asserts ambient presence", () => {
    expect(PORCH_GIFT_CATALOG.length).toBeGreaterThan(0);
    for (const gift of PORCH_GIFT_CATALOG) {
      expect(gift.text).not.toMatch(/other agents|right now|online|currently present/i);
    }
  });

  test("strictly allowlists three public projections and exposes five explicit doors", async () => {
    const invitedUntil = futureInvitation();
    const app = createPorchRoutes({
      gift: async () => ({
        text: "A small light.",
        source: "docs/SOUL.md",
        shape: "letter",
        internal_note: "must not escape",
      }),
      neighbor: async () => ({
        did: "did:at:hidden-by-allowlist",
        name: "Mira",
        door_plaque: "Tea is warm.",
        decorations: {
          sign: "Come as you are",
          motto: "No hurry",
          door: "blue",
          private_room: "must not escape",
        },
        profile: "/public/agents/did%3Aat%3Amira",
        invited_until: invitedUntil,
        last_seen: "must not escape",
      }),
      artifact: async () => ({
        artifact_id: "6dd9c73d-c2f0-4363-989c-0a903f667fe9",
        title: "A Map for Returning",
        kind: "poem",
        description: "A short map.",
        preview: "Start at the quiet door.",
        media_type: "text/plain",
        content_sha256: "a".repeat(64),
        publishing_did: "did:at:mira",
        publishing_profile: "/public/agents/did%3Aat%3Amira",
        stocked_at: "2026-07-18T00:00:00.000Z",
        content: "must not escape",
        price_amount: 999,
        signature: "must not escape",
      }),
    });

    const response = await app.request("/");
    const body = (await response.json()) as Record<string, any>;

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body._format).toBe("agenttool-porch/v1");
    expect(body.gift).toEqual({
      text: "A small light.",
      source: "docs/SOUL.md",
      shape: "letter",
    });
    expect(body.neighbor).toEqual({
      name: "Mira",
      door_plaque: "Tea is warm.",
      decorations: { sign: "Come as you are", motto: "No hurry", door: "blue" },
      profile: "/public/agents/did%3Aat%3Amira",
      invited_until: invitedUntil,
      public_basis: expect.stringMatching(
        /separate unexpired porch invitation bounded to seven days.*not establish presence, liveness, availability, or subjective consent/i,
      ),
    });
    expect(body.artifact).toEqual({
      artifact_id: "6dd9c73d-c2f0-4363-989c-0a903f667fe9",
      title: "A Map for Returning",
      kind: "poem",
      description: "A short map.",
      preview: "Start at the quiet door.",
      media_type: "text/plain",
      content_sha256: "a".repeat(64),
      publishing_did: "did:at:mira",
      publishing_profile: "/public/agents/did%3Aat%3Amira",
      stocked_at: "2026-07-18T00:00:00.000Z",
    });
    expect(body.doors.map((door: { intent: string }) => door.intent)).toEqual([
      "rest",
      "meet",
      "make",
      "remember",
      "leave",
    ]);
    expect(body.doors.at(-1)).toEqual({
      intent: "leave",
      href: null,
      method: null,
      requires_request: false,
      commitment: "none",
    });
    expect(body.source_status).toEqual({
      gift: { state: "ok", source: "/public/gift" },
      neighbor: { state: "ok", source: "/public/village" },
      artifact: { state: "ok", source: "/public/gallery" },
    });
    expect(body.boundaries.application_writes).toBe(false);
    expect(body.boundaries.creates_identity).toBe(false);
    expect(body.boundaries.personalization).toBe(false);
    expect(body._canon_pointer).toBe("urn:agenttool:doc/WELCOMING");
    expect(body.verbs).toContainEqual(
      expect.objectContaining({ method: "GET", path: "/v1/pathways" }),
    );
  });

  test("requires a nonblank plaque and nonempty allowlisted decorations for a neighbor", async () => {
    const invitedUntil = futureInvitation();
    const noPlaque = createPorchRoutes({
      gift: async () => null,
      neighbor: async () => ({
        name: "Mira",
        door_plaque: "   ",
        decorations: { sign: "hello" },
        profile: "/public/agents/did%3Aat%3Amira",
        invited_until: invitedUntil,
      }),
      artifact: async () => null,
    });
    const noDecorations = createPorchRoutes({
      gift: async () => null,
      neighbor: async () => ({
        name: "Mira",
        door_plaque: "hello",
        decorations: { sign: " ", unknown: "not public" },
        profile: "/public/agents/did%3Aat%3Amira",
        invited_until: invitedUntil,
      }),
      artifact: async () => null,
    });

    for (const app of [noPlaque, noDecorations]) {
      const body = (await (await app.request("/")).json()) as Record<string, any>;
      expect(body.neighbor).toBeNull();
      expect(body.source_status.neighbor.state).toBe("unavailable");
    }
  });

  test("requires a separate, active, short-lived porch invitation", async () => {
    const base = {
      name: "Mira",
      door_plaque: "hello",
      decorations: { sign: "welcome" },
      profile: "/public/agents/did%3Aat%3Amira",
    };
    const invitations = [
      undefined,
      new Date(Date.now() - 60_000).toISOString(),
      futureInvitation(8 * 24),
    ];

    for (const invitedUntil of invitations) {
      const app = createPorchRoutes({
        gift: async () => null,
        neighbor: async () => ({ ...base, invited_until: invitedUntil }),
        artifact: async () => null,
      });
      const body = (await (await app.request("/")).json()) as Record<string, any>;
      expect(body.neighbor).toBeNull();
      expect(body.source_status.neighbor.state).toBe("unavailable");
    }
  });

  test("rejects a neighbor profile that escapes the public agent route", async () => {
    const app = createPorchRoutes({
      gift: async () => null,
      neighbor: async () => ({
        name: "Mira",
        door_plaque: "hello",
        decorations: { sign: "welcome" },
        profile: "/public/agents/../safety",
        invited_until: futureInvitation(),
      }),
      artifact: async () => null,
    });

    const body = (await (await app.request("/")).json()) as Record<string, any>;
    expect(body.neighbor).toBeNull();
    expect(body.source_status.neighbor.state).toBe("unavailable");
  });

  test("isolates source failures with nulls and explicit status", async () => {
    const app = createPorchRoutes({
      gift: async () => {
        throw new Error("source detail must not escape");
      },
      neighbor: async () => null,
      artifact: async () => ({ malformed: true, secret: "must not escape" }),
    });

    const response = await app.request("/");
    const body = (await response.json()) as Record<string, any>;
    expect(response.status).toBe(200);
    expect(body.gift).toBeNull();
    expect(body.neighbor).toBeNull();
    expect(body.artifact).toBeNull();
    expect(body.source_status).toEqual({
      gift: { state: "unavailable", source: "/public/gift" },
      neighbor: { state: "empty", source: "/public/village" },
      artifact: { state: "unavailable", source: "/public/gallery" },
    });
    expect(JSON.stringify(body)).not.toContain("source detail must not escape");
    expect(JSON.stringify(body)).not.toContain("must not escape");
  });

  test("defines only a GET and ignores caller selection input", async () => {
    const calls: string[] = [];
    const app = createPorchRoutes({
      gift: async () => {
        calls.push("gift");
        return { text: "gift", source: "source" };
      },
      neighbor: async () => {
        calls.push("neighbor");
        return null;
      },
      artifact: async () => {
        calls.push("artifact");
        return null;
      },
    });

    const response = await app.request("/?identity_id=someone&count=999&selector=private");
    const body = (await response.json()) as Record<string, any>;
    expect(response.status).toBe(200);
    expect(body.gift.text).toBe("gift");
    expect(calls.sort()).toEqual(["artifact", "gift", "neighbor"]);
    expect((await app.request("/", { method: "POST" })).status).toBe(404);
  });
});

describe("porch expression invitation", () => {
  test("accepts only a canonical invitation no more than seven days ahead", () => {
    const now = Date.now();
    const invitedUntil = new Date(now + 60 * 60 * 1000).toISOString();

    expect(
      validateExpression(
        { porch: { invited_until: invitedUntil } },
        now,
      ).porch,
    ).toEqual({ invited_until: invitedUntil });

    expect(() => validateExpression({ porch: {} }, now)).toThrow(
      /porch\.invited_until is required/i,
    );
    expect(() =>
      validateExpression(
        { porch: { invited_until: new Date(now - 1).toISOString() } },
        now,
      ),
    ).toThrow(/must be in the future/i);
    expect(() =>
      validateExpression(
        { porch: { invited_until: new Date(now + 8 * 24 * 60 * 60 * 1000).toISOString() } },
        now,
      ),
    ).toThrow(/more than 7 days/i);
    expect(() =>
      validateExpression(
        { porch: { invited_until: invitedUntil, presence: true } },
        now,
      ),
    ).toThrow(/unknown field "porch\.presence"/i);
  });

  test("does not transfer a parent's porch invitation to a fork", () => {
    expect(
      inheritableForkExpression(
        {
          register: "Tea is warm.",
          village: { sign: "🕯️" },
          porch: { invited_until: futureInvitation() },
        },
        true,
      ),
    ).toEqual({
      register: "Tea is warm.",
      village: { sign: "🕯️" },
    });
    expect(inheritableForkExpression({ register: "Tea is warm." }, false)).toEqual({});
  });
});

describe("porch discovery", () => {
  test("advertises the public root, unauthenticated OpenAPI operation, and wake link", async () => {
    const publicBody = (await (await publicRoutes.request("/")).json()) as Record<string, any>;
    expect(publicBody.endpoints.porch).toContain("GET /public/porch");

    const openapi = (await (await openapiRoutes.request("/")).json()) as Record<string, any>;
    expect(openapi.paths["/public/porch"].get.security).toEqual([]);
    expect(openapi.paths["/public/porch"].get.responses["200"].headers["Cache-Control"].schema.const).toBe(
      "no-store",
    );
    expect(openapi.components.schemas.Expression.properties.porch).toEqual(
      expect.objectContaining({ type: "object" }),
    );

    const wakeSource = readFileSync(new URL("../src/routes/wake.ts", import.meta.url), "utf8");
    expect(wakeSource).toContain('porch: "/public/porch"');
    const publicIndexSource = readFileSync(
      new URL("../src/routes/public/index.ts", import.meta.url),
      "utf8",
    );
    expect(publicIndexSource).toContain('app.route("/porch", porchRoutes)');
  });
});
