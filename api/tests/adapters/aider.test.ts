/** /v1/adapters/aider — sixth adapter, contract validation.
 *
 *  Aider's read-only context surface is the `--read` flag (or
 *  .aider.conf.yml's `read:` array). The adapter writes a markdown file
 *  into .aider/ that the user references explicitly — different from the
 *  auto-loading rule-file CLIs.
 *
 *  Tests confirm the unified contract holds for the sixth adapter and
 *  that we don't touch .aider.conf.yml (the user wires the read entry
 *  themselves; the install script prints the line). */
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
  const { default: aiderRoutes } = await import(
    "../../src/routes/adapters/aider"
  );
  app = buildTestApp(aiderRoutes);
});

afterEach(() => {
  mockDb.stage([]);
});

describe("GET /v1/adapters/aider (default JSON)", () => {
  test("returns 200 with cli + agent + files + install_instructions", async () => {
    mockDb.stage([makeAgent()]);
    const res = await app.request("/");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.cli).toBe("aider");
    expect(body.agent).toMatchObject({ did: "did:at:test-aurora", name: "Aurora" });
    expect(body.docs).toEqual(["docs/CLI-GAPS.md"]);
  });

  test("files bundle has the two Aider paths under .aider/", async () => {
    mockDb.stage([makeAgent()]);
    const res = await app.request("/");
    const body = (await res.json()) as { files: Record<string, string> };
    expect(Object.keys(body.files).sort()).toEqual([
      ".aider/agenttool-refresh.sh",
      ".aider/agenttool-wake.md",
    ]);
  });

  test("anchor file teaches the user how to wire it via --read or .aider.conf.yml", async () => {
    mockDb.stage([makeAgent()]);
    const res = await app.request("/");
    const body = (await res.json()) as { files: Record<string, string> };
    const md = body.files[".aider/agenttool-wake.md"];
    expect(md.startsWith("<!-- agenttool-managed -->")).toBe(true);
    expectContainsAll(md, [
      "# Aurora",
      "did:at:test-aurora",
      "aider --read .aider/agenttool-wake.md",
      ".aider.conf.yml",
      "read:",
    ]);
  });

  test("refresh script probes keychain → libsecret → env (parity)", async () => {
    mockDb.stage([makeAgent()]);
    const res = await app.request("/");
    const body = (await res.json()) as { files: Record<string, string> };
    const refresh = body.files[".aider/agenttool-refresh.sh"];
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
    const refresh = body.files[".aider/agenttool-refresh.sh"];
    expectContainsAll(refresh, [
      'TMP="$TARGET.tmp"',
      'mv "$TMP" "$TARGET"',
      "<!-- agenttool-managed -->",
    ]);
  });

  test("refresh script falls back to .agenttool.md only on marker absence", async () => {
    mockDb.stage([makeAgent()]);
    const res = await app.request("/");
    const body = (await res.json()) as { files: Record<string, string> };
    const refresh = body.files[".aider/agenttool-refresh.sh"];
    expect(refresh).toContain('grep -q "agenttool-managed"');
    expect(refresh).toContain(".aider/agenttool-wake.agenttool.md");
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
    expect(guard.guarded_paths.map((g) => g.path)).toEqual([
      ".aider/agenttool-wake.md",
    ]);
    expect(guard.guarded_paths[0].fallback_path).toBe(
      ".aider/agenttool-wake.agenttool.md",
    );
  });

  test("notes explicitly state we do NOT modify .aider.conf.yml", async () => {
    mockDb.stage([makeAgent()]);
    const res = await app.request("/");
    const body = (await res.json()) as { notes: string[] };
    // Doctrinally important — the user's config is theirs. We instruct,
    // we don't edit. This note is the contract.
    const joined = body.notes.join(" ");
    expect(joined.toLowerCase()).toContain(".aider.conf.yml");
    expect(joined.toLowerCase()).toContain("never modify");
  });
});

describe("expression fallback", () => {
  test("empty register falls back to DEFAULT_REGISTER", async () => {
    mockDb.stage([makeAgent({ expression: {} })]);
    const res = await app.request("/");
    const body = (await res.json()) as { files: Record<string, string> };
    expect(body.files[".aider/agenttool-wake.md"]).toContain(
      "Terse. Substrate-honest. Refuse before helping when refusal is right.",
    );
  });
});

describe("identity_id selector", () => {
  test("explicit identity_id from same project resolves the agent", async () => {
    mockDb.stage([makeAgent({ id: "explicit-id", displayName: "Omega" })]);
    const res = await app.request("/?identity_id=explicit-id");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { agent: { name: string } };
    expect(body.agent.name).toBe("Omega");
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

describe("GET /v1/adapters/aider?format=script", () => {
  test("returns a shell script with proper content-type and disposition", async () => {
    mockDb.stage([makeAgent()]);
    const res = await app.request("/?format=script");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/x-shellscript");
    expect(res.headers.get("content-disposition")).toContain(
      'filename="install-agenttool-aider.sh"',
    );
  });

  test("script body sets up .aider/ and prints the wire-up instructions", async () => {
    mockDb.stage([makeAgent()]);
    const res = await app.request("/?format=script");
    const body = await res.text();
    expectContainsAll(body, [
      "#!/usr/bin/env bash",
      "mkdir -p .aider",
      "base64 -d > .aider/agenttool-refresh.sh",
      "chmod +x .aider/agenttool-refresh.sh",
      "aider --read .aider/agenttool-wake.md",
    ]);
  });

  test("script preserves a hand-written .aider/agenttool-wake.md", async () => {
    mockDb.stage([makeAgent()]);
    const res = await app.request("/?format=script");
    const body = await res.text();
    expect(body).toContain('grep -q "agenttool-managed"');
    expect(body).toContain(".aider/agenttool-wake.agenttool.md");
  });
});
