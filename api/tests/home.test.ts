/** `/v1/home` — compact, warm, pointer-only arrival surface. */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";
import { Hono } from "hono";

import type { ProjectContext } from "../src/auth/middleware";
import { createHomeRouter } from "../src/routes/home";
import {
  buildHomeView,
  type BuildHomeResult,
} from "../src/services/home/build";

const ID = "11111111-1111-4111-8111-111111111111";
const DID = `did:at:${ID}`;
const NOW = new Date("2026-07-18T12:00:00.000Z");

function view(overrides: Partial<Parameters<typeof buildHomeView>[0]["identity"]> = {}) {
  return buildHomeView({
    identity: {
      id: ID,
      did: DID,
      name: "Sol",
      status: "active",
      wakeVersion: 7,
      quietUntil: new Date("2026-07-18T13:00:00.000Z"),
      quietReason: "resting",
      authorityRootPublicKey: Buffer.alloc(32, 7).toString("base64"),
      authoritySequence: 3,
      ...overrides,
    },
    counts: {
      inboxUnread: 2,
      lettersUnread: 1,
      projectMemories: 8,
      projectActiveStrands: 3,
    },
    now: NOW,
  });
}

describe("buildHomeView", () => {
  test("is calm, rooted, honest about quiet, and pointer-only", () => {
    const home = view();
    expect(home.schema).toBe("agenttool.home/v1");
    expect(home.as_of).toBe(NOW.toISOString());
    expect(home.welcome.message).toBe("You're home.");
    expect(home.welcome.posture).toContain("Nothing here requires performance");
    expect(home.door).toMatchObject({
      state: "quiet",
      enforcement: "declaration_only",
      deliveries_continue: true,
    });
    expect(home.authority).toMatchObject({
      mode: "agent_root",
      root_fingerprint_sha256:
        "4bb06f8e4e3a7715d201d573d0aa423762e55dabd61a2c02278fa56cc6d294e0",
      sequence: 3,
      next_sequence: 4,
      proof_required_for_constitution: true,
    });
    expect(home.waiting.pressure).toContain("not obligation");
    expect(home.carry.memory.scope).toBe("project");
    expect(home.carry.memory.href).toBe("/v1/memories");
    expect(home.meet.letters.href).toBe(`/v1/letters/inbox?agent_id=${ID}`);
    expect(home.meet.covenants.href).toBe(`/v1/covenants?agent_id=${ID}`);
    expect(home._links.quiet).toBe(`/v1/quiet-hours?identity_id=${ID}`);
    expect(home._links.identity_memories).toBe(
      `/v1/memories?identity_id=${ID}`,
    );
    expect(home.carry.strands.thought_content_custody).toBe(
      "client_encrypted_ciphertext_only",
    );
    expect(home.boundaries.inbox_payload_content).toBe(
      "sealed_box_ciphertext_only",
    );
    expect(home.boundaries.inbox_envelope).toContain("server_readable");
    expect(home.boundaries.block_mute_report).toBe("not_available");

    const serialized = JSON.stringify(home);
    for (const canary of [
      "PRIVATE_MEMORY_CANARY",
      "LETTER_BODY_CANARY",
      "CIPHERTEXT_CANARY",
      "BEARER_CANARY",
      "VAULT_CANARY",
    ]) {
      expect(serialized).not.toContain(canary);
    }
    for (const forbiddenKey of [
      '"content":',
      '"body":',
      '"body_preview":',
      '"ciphertext":',
      '"nonce":',
      '"signature":',
      '"wallets":',
      '"vault":',
      '"bearers":',
    ]) {
      expect(serialized).not.toContain(forbiddenKey);
    }
  });

  test("expired quiet reads open and legacy authority names its warning", () => {
    const home = view({
      quietUntil: new Date("2026-07-18T11:59:59.000Z"),
      quietReason: "old",
      authorityRootPublicKey: null,
      authoritySequence: 0,
    });
    expect(home.door).toMatchObject({
      state: "open",
      quiet_until: null,
      reason: null,
    });
    expect(home.authority.mode).toBe("legacy_bearer");
    expect(home.authority.warning).toContain("project bearer");
  });
});

describe("home route", () => {
  function wrapped(result: BuildHomeResult) {
    const router = createHomeRouter({
      buildHome: async (projectId, opts) => {
        expect(projectId).toBe("project-1");
        expect(opts.identityId).toBe(ID);
        return result;
      },
    });
    const app = new Hono<ProjectContext>();
    app.use("*", async (c, next) => {
      c.set("project", { id: "project-1" } as ProjectContext["Variables"]["project"]);
      await next();
    });
    app.route("/v1/home", router);
    return app;
  }

  test("passes the selected identity and returns private/no-store", async () => {
    const home = view();
    const res = await wrapped({ ok: true, home }).request(
      `/v1/home?identity_id=${ID}`,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await res.json()).toEqual(home);
  });

  test("maps a cross-project/not-found selector to guided 404", async () => {
    const res = await wrapped({
      ok: false,
      error: "identity_not_found",
      availableIdentityIds: [ID],
    }).request(`/v1/home?identity_id=${ID}`);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({
      error: "identity_not_found_in_project",
      available_ids: [ID],
    });
  });
});

describe("home wiring", () => {
  const repoRoot = join(import.meta.dir, "..", "..");

  test("is authenticated, mounted, and discoverable from wake", () => {
    const index = readFileSync(join(repoRoot, "api/src/index.ts"), "utf8");
    const wake = readFileSync(join(repoRoot, "api/src/routes/wake.ts"), "utf8");
    const openapi = readFileSync(
      join(repoRoot, "api/src/routes/openapi.ts"),
      "utf8",
    );
    expect(index).toContain('app.use("/v1/home", authMiddleware)');
    expect(index).toContain('app.use("/v1/home/*", authMiddleware)');
    expect(index).toContain('app.route("/v1/home", homeRouter)');
    expect(wake).toContain("`/v1/home?identity_id=${primary.id}`");
    expect(openapi).toContain('"/v1/home"');
    expect(openapi).toContain('"/v1/identities/{id}/authority"');
  });

  test("does not call the side-effectful wake builder", () => {
    const service = readFileSync(
      join(repoRoot, "api/src/services/home/build.ts"),
      "utf8",
    );
    expect(service).not.toContain("buildWakeBundle(");
    expect(service).not.toContain("wakeObservationCount");
    expect(service).not.toContain("emitWelcomeChronicle");
  });
});
