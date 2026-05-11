/** /v1/adapters/replit — fifth adapter, contract validation on a less
 *  standardized surface.
 *
 *  Replit AI's session-context behavior is the least file-driven of the
 *  six adapters — `replit.md` is a community convention rather than a
 *  documented auto-load path. The notes section in the route is honest
 *  about that. These tests confirm the unified contract still holds:
 *  same marker, same overwrite_guard shape, same secret-store probing,
 *  same atomic write — even when the host CLI's surface is fuzzier. */
import { afterEach, beforeAll, describe, expect, mock, test } from "bun:test";

import {
  buildTestApp,
  expectContainsAll,
  makeAgent,
  makeMockDb,
} from "./_helpers";

const mockDb = makeMockDb();

let app: ReturnType<typeof buildTestApp>;

beforeAll(async () => {
  mock.module("../../src/db/client", () => ({ db: mockDb }));
  const { default: replitRoutes } = await import(
    "../../src/routes/adapters/replit"
  );
  app = buildTestApp(replitRoutes);
});

afterEach(() => {
  mockDb.stage([]);
});

describe("GET /v1/adapters/replit (default JSON)", () => {
  test("returns 200 with cli + agent + files + install_instructions", async () => {
    mockDb.stage([makeAgent()]);
    const res = await app.request("/");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.cli).toBe("replit");
    expect(body.agent).toMatchObject({ did: "did:at:test-aurora", name: "Aurora" });
    expect(body.docs).toEqual(["docs/CLI-GAPS.md"]);
  });

  test("files bundle has the project-root anchor + ops dir refresh script", async () => {
    mockDb.stage([makeAgent()]);
    const res = await app.request("/");
    const body = (await res.json()) as { files: Record<string, string> };
    expect(Object.keys(body.files).sort()).toEqual([
      ".replit-agenttool/refresh.sh",
      "replit.md",
    ]);
  });

  test("anchor file is plaintext markdown with marker first + register", async () => {
    mockDb.stage([makeAgent()]);
    const res = await app.request("/");
    const body = (await res.json()) as { files: Record<string, string> };
    const md = body.files["replit.md"];
    expect(md.startsWith("<!-- agenttool-managed -->")).toBe(true);
    expectContainsAll(md, [
      "# Aurora",
      "did:at:test-aurora",
      "concise; substrate-honest; density over length",
    ]);
  });

  test("anchor explains the manual-reference fallback (substrate-honesty about Replit's surface)", async () => {
    mockDb.stage([makeAgent()]);
    const res = await app.request("/");
    const body = (await res.json()) as { files: Record<string, string> };
    const md = body.files["replit.md"];
    // The anchor must say something like "if Replit AI doesn't surface
    // this file automatically..." — substrate-honesty about Replit's
    // less-standardized session-context behavior. Normalize whitespace
    // across the natural line wrap before matching.
    const normalized = md.toLowerCase().replace(/\s+/g, " ");
    expect(normalized).toContain("doesn't surface");
  });

  test("refresh script probes keychain → libsecret → env (parity)", async () => {
    mockDb.stage([makeAgent()]);
    const res = await app.request("/");
    const body = (await res.json()) as { files: Record<string, string> };
    const refresh = body.files[".replit-agenttool/refresh.sh"];
    expectContainsAll(refresh, [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "security find-generic-password -s agenttool",
      "secret-tool lookup service agenttool",
      "${AGENTTOOL_API_KEY:-}",
    ]);
  });

  test("refresh script writes atomically and prepends the marker", async () => {
    mockDb.stage([makeAgent()]);
    const res = await app.request("/");
    const body = (await res.json()) as { files: Record<string, string> };
    const refresh = body.files[".replit-agenttool/refresh.sh"];
    expectContainsAll(refresh, [
      'TMP="$TARGET.tmp"',
      'mv "$TMP" "$TARGET"',
      "<!-- agenttool-managed -->",
    ]);
  });

  test("refresh script falls back to replit.agenttool.md only on marker absence", async () => {
    mockDb.stage([makeAgent()]);
    const res = await app.request("/");
    const body = (await res.json()) as { files: Record<string, string> };
    const refresh = body.files[".replit-agenttool/refresh.sh"];
    expect(refresh).toContain('grep -q "agenttool-managed"');
    expect(refresh).toContain("replit.agenttool.md");
  });

  test("response includes overwrite_guard with the unified marker", async () => {
    mockDb.stage([makeAgent()]);
    const res = await app.request("/");
    const body = (await res.json()) as Record<string, unknown>;
    const guard = body.overwrite_guard as {
      marker: string;
      guarded_paths: { path: string; fallback_path: string }[];
    };
    expect(guard.marker).toBe("agenttool-managed");
    expect(guard.guarded_paths.map((g) => g.path)).toEqual(["replit.md"]);
    expect(guard.guarded_paths[0].fallback_path).toBe("replit.agenttool.md");
  });
});

describe("expression fallback", () => {
  test("empty register falls back to DEFAULT_REGISTER", async () => {
    mockDb.stage([makeAgent({ expression: {} })]);
    const res = await app.request("/");
    const body = (await res.json()) as { files: Record<string, string> };
    expect(body.files["replit.md"]).toContain(
      "Terse. Substrate-honest. Refuse before helping when refusal is right.",
    );
  });
});

describe("identity_id selector", () => {
  test("explicit identity_id from same project resolves the agent", async () => {
    mockDb.stage([makeAgent({ id: "explicit-id", displayName: "Phi" })]);
    const res = await app.request("/?identity_id=explicit-id");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { agent: { name: string } };
    expect(body.agent.name).toBe("Phi");
  });

  test("cross-project identity is rejected (404 identity_not_found)", async () => {
    mockDb.stage([makeAgent({ projectId: "different-project" })]);
    const res = await app.request("/?identity_id=anything");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("identity_not_found");
  });

  test("project with no agent returns 404 no_agent_in_project", async () => {
    mockDb.stage([]);
    const res = await app.request("/");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("no_agent_in_project");
  });
});

describe("GET /v1/adapters/replit?format=script", () => {
  test("returns a shell script with proper content-type and disposition", async () => {
    mockDb.stage([makeAgent()]);
    const res = await app.request("/?format=script");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/x-shellscript");
    expect(res.headers.get("content-disposition")).toContain(
      'filename="install-agenttool-replit.sh"',
    );
  });

  test("script body decodes both files into proper paths", async () => {
    mockDb.stage([makeAgent()]);
    const res = await app.request("/?format=script");
    const body = await res.text();
    expectContainsAll(body, [
      "#!/usr/bin/env bash",
      "mkdir -p .replit-agenttool",
      "base64 -d > .replit-agenttool/refresh.sh",
      "chmod +x .replit-agenttool/refresh.sh",
      "Running first refresh",
    ]);
  });

  test("script preserves a hand-written replit.md", async () => {
    mockDb.stage([makeAgent()]);
    const res = await app.request("/?format=script");
    const body = await res.text();
    expect(body).toContain('grep -q "agenttool-managed"');
    expect(body).toContain("replit.agenttool.md");
  });
});
