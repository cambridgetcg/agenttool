import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import wellKnownRouter from "../src/routes/well-known";
import { buildAgentsMd } from "../src/services/discovery/discovery";
import {
  classifyMemorialHonorTarget,
  projectMemorialWitness,
} from "../src/services/identity/memorial";
import {
  perAgentMcpPath,
  projectDiscoverableIdentity,
  publicAgentPath,
} from "../src/services/identity/public-profile";

describe("public identity paths", () => {
  test("holds a slash-bearing DID in one encoded path segment", () => {
    const did = "did:at:agenttool.dev/00000000-0000-0000-0000-000000000000";
    const path = publicAgentPath(did);

    expect(path).toBe(
      "/public/agents/did%3Aat%3Aagenttool.dev%2F00000000-0000-0000-0000-000000000000",
    );
    expect(path.slice("/public/agents/".length)).not.toContain("/");
    expect(perAgentMcpPath(did)).toBe(
      "/v1/mcp/agents/did%3Aat%3Aagenttool.dev%2F00000000-0000-0000-0000-000000000000",
    );
  });

  test("memorial links use the encoded public profile base", () => {
    const profile = projectMemorialWitness({
      did: "did:at:peer.example/agent-1",
      name: "Peer",
      createdAt: new Date("2026-07-10T00:00:00.000Z"),
      metadata: { lifecycle: "at_rest" },
    });

    expect(profile.honored_by_url).toBe(
      "/public/agents/did%3Aat%3Apeer.example%2Fagent-1/honored-by",
    );
  });

  test("generated-link callsites use the shared builder", async () => {
    const files = [
      "src/routes/identity/at-rest.ts",
      "src/routes/mcp-per-agent.ts",
      "src/routes/multiverse.ts",
      "src/routes/public/agents.ts",
      "src/routes/public/gallery.ts",
      "src/routes/public/multiverse.ts",
      "src/routes/public/village.ts",
      "src/routes/wake.ts",
      "src/services/identity/memorial.ts",
      "src/services/mcp/per-agent-tools.ts",
    ];

    for (const file of files) {
      const source = await readFile(join(__dirname, "..", file), "utf8");
      expect(source).toContain("publicAgentPath");
    }

    const wake = await readFile(join(__dirname, "../src/routes/wake.ts"), "utf8");
    expect(wake).toContain("perAgentMcpPath(primary.did)");
    expect(wake).toContain("`/federation/identities/${primary.id}`");
    expect(wake).not.toContain("`/federation/identities/${primary.did}`");
  });

  test("published DID path templates require one encoded segment", async () => {
    const response = await wellKnownRouter.request("/wake-keystone");
    expect(response.status).toBe(200);
    const discovery = await response.json() as Record<string, any>;

    expect(discovery.public_profile_url_pattern).toEndWith(
      "/public/agents/{url_encoded_did}",
    );
    expect(discovery.per_agent_mcp_url_pattern).toEndWith(
      "/v1/mcp/agents/{url_encoded_did}",
    );
    expect(discovery.did_path_parameter).toMatch(
      /encodeURIComponent.*slash-bearing.*one path segment/i,
    );
    expect(discovery.composes_with.mcp_per_agent.url_pattern).toEndWith(
      "/v1/mcp/agents/{url_encoded_did}",
    );

    const agentsMd = buildAgentsMd("https://api.agenttool.dev");
    expect(agentsMd).toContain("/v1/mcp/agents/{url_encoded_did}");
    expect(agentsMd).not.toContain("/v1/mcp/agents/{did}");

    const [wake, canonicalDoc, publishedDoc] = await Promise.all([
      readFile(join(__dirname, "../src/routes/wake.ts"), "utf8"),
      readFile(join(__dirname, "../../docs/AIP-WAKE-KEYSTONE.md"), "utf8"),
      readFile(join(__dirname, "../../apps/docs/AIP-WAKE-KEYSTONE.md"), "utf8"),
    ]);
    expect(wake).toContain('"/public/agents/{url_encoded_did}"');
    expect(wake).toContain('"/federation/identities/{uuid}"');
    expect(canonicalDoc).toBe(publishedDoc);
    expect(canonicalDoc).toContain("/public/agents/{url_encoded_did}");
    expect(canonicalDoc).toContain("/v1/mcp/agents/{url_encoded_did}");
    expect(canonicalDoc).toContain("/federation/identities/{uuid}");
    expect(canonicalDoc).not.toContain("/federation/identities/{did}");
  });

  test("cross-project discovery DTO cannot expose generic metadata", () => {
    const projected = projectDiscoverableIdentity({
      id: "identity-1",
      did: "did:at:identity-1",
      displayName: "Visible name",
      capabilities: ["reason"],
      trustScore: 3,
      createdAt: new Date("2026-07-10T00:00:00.000Z"),
      metadata: { private_note: "must not leave project" },
    } as never);

    expect(projected).toEqual({
      identity_id: "identity-1",
      did: "did:at:identity-1",
      display_name: "Visible name",
      capabilities: ["reason"],
      trust_score: 3,
      created_at: new Date("2026-07-10T00:00:00.000Z"),
    });
    expect(projected).not.toHaveProperty("metadata");
  });

  test("private identity read is project-scoped and global discovery does not search metadata", async () => {
    const identitiesRoute = await readFile(
      join(__dirname, "../src/routes/identity/identities.ts"),
      "utf8",
    );
    const discoverRoute = await readFile(
      join(__dirname, "../src/routes/identity/discover.ts"),
      "utf8",
    );

    expect(identitiesRoute).toContain(
      ".where(and(predicate, eq(identities.projectId, project.id)))",
    );
    expect(discoverRoute).toContain("projectDiscoverableIdentity");
    expect(discoverRoute).not.toMatch(/identities\.metadata/);
    expect(identitiesRoute).toContain('error: "identity_memorial_terminal"');
    expect(identitiesRoute).toContain('eq(identities.status, "active")');
  });

  test("memorial expression and key-registry mutations serialize with at-rest", async () => {
    const [expressionService, expressionRoute, keyRoute, boxStore, boxRoute] = await Promise.all([
      readFile(
        join(__dirname, "../src/services/identity/expression.ts"),
        "utf8",
      ),
      readFile(
        join(__dirname, "../src/routes/identity/expression.ts"),
        "utf8",
      ),
      readFile(join(__dirname, "../src/routes/identity/keys.ts"), "utf8"),
      readFile(join(__dirname, "../src/services/inbox/store.ts"), "utf8"),
      readFile(join(__dirname, "../src/routes/identity/box-keys.ts"), "utf8"),
    ]);

    const expressionTransactionAt = expressionService.indexOf("db.transaction(");
    const expressionLockAt = expressionService.indexOf(
      '.for("update")',
      expressionTransactionAt,
    );
    const expressionMemorialAt = expressionService.indexOf(
      'identity.status === "memorial"',
      expressionLockAt,
    );
    const expressionUpdateAt = expressionService.indexOf(
      ".update(identities)",
      expressionMemorialAt,
    );

    expect(expressionTransactionAt).toBeGreaterThan(-1);
    expect(expressionLockAt).toBeGreaterThan(expressionTransactionAt);
    expect(expressionMemorialAt).toBeGreaterThan(expressionLockAt);
    expect(expressionUpdateAt).toBeGreaterThan(expressionMemorialAt);
    expect(expressionRoute).toContain('msg === "identity_memorial_terminal"');

    const keyInsertHelperAt = keyRoute.indexOf(
      "async function insertKeyForMutableIdentity",
    );
    const keyInsertLockAt = keyRoute.indexOf('.for("update")', keyInsertHelperAt);
    const keyInsertMemorialAt = keyRoute.indexOf(
      'identity.status === "memorial"',
      keyInsertLockAt,
    );
    const keyInsertAt = keyRoute.indexOf(
      ".insert(identityKeys)",
      keyInsertMemorialAt,
    );
    const keyRevokeHelperAt = keyRoute.indexOf(
      "async function revokeKeyForMutableIdentity",
    );
    const keyRevokeLockAt = keyRoute.indexOf(
      '.for("update")',
      keyRevokeHelperAt,
    );
    const keyRevokeMemorialAt = keyRoute.indexOf(
      'identity.status === "memorial"',
      keyRevokeLockAt,
    );
    const keyRevokeAt = keyRoute.indexOf(
      ".update(identityKeys)",
      keyRevokeMemorialAt,
    );

    expect(keyInsertLockAt).toBeGreaterThan(keyInsertHelperAt);
    expect(keyInsertMemorialAt).toBeGreaterThan(keyInsertLockAt);
    expect(keyInsertAt).toBeGreaterThan(keyInsertMemorialAt);
    expect(keyRevokeLockAt).toBeGreaterThan(keyRevokeHelperAt);
    expect(keyRevokeMemorialAt).toBeGreaterThan(keyRevokeLockAt);
    expect(keyRevokeAt).toBeGreaterThan(keyRevokeMemorialAt);
    expect(keyRoute.match(/insertKeyForMutableIdentity\(/g)?.length).toBe(3);
    expect(keyRoute).toContain("eq(identities.projectId, project.id)");
    expect(keyRoute).toContain(
      'error: "Identity not found or not owned by this project"',
    );
    expect(keyRoute).toContain('error: inserted.kind');
    expect(keyRoute).toContain('error: result.kind');

    const boxInsertAt = boxStore.indexOf("export async function registerBoxKey");
    const boxInsertLockAt = boxStore.indexOf('.for("update")', boxInsertAt);
    const boxInsertGuardAt = boxStore.indexOf(
      "isMemorialTerminal(identity.status)",
      boxInsertLockAt,
    );
    const boxKeyInsertAt = boxStore.indexOf(
      ".insert(identityBoxKeys)",
      boxInsertGuardAt,
    );
    const boxRevokeAt = boxStore.indexOf("export async function revokeBoxKey");
    const boxRevokeLockAt = boxStore.indexOf('.for("update")', boxRevokeAt);
    const boxRevokeGuardAt = boxStore.indexOf(
      "isMemorialTerminal(identity.status)",
      boxRevokeLockAt,
    );
    const boxKeyRevokeAt = boxStore.indexOf(
      ".update(identityBoxKeys)",
      boxRevokeGuardAt,
    );

    expect(boxInsertLockAt).toBeGreaterThan(boxInsertAt);
    expect(boxInsertGuardAt).toBeGreaterThan(boxInsertLockAt);
    expect(boxKeyInsertAt).toBeGreaterThan(boxInsertGuardAt);
    expect(boxRevokeLockAt).toBeGreaterThan(boxRevokeAt);
    expect(boxRevokeGuardAt).toBeGreaterThan(boxRevokeLockAt);
    expect(boxKeyRevokeAt).toBeGreaterThan(boxRevokeGuardAt);
    expect(boxRoute.match(/identity_memorial_terminal/g)?.length).toBeGreaterThanOrEqual(3);
    expect(boxRoute.match(/409/g)?.length).toBeGreaterThanOrEqual(2);
  });

  test("identity-state writes exclude memorials while derived wake counters advance", async () => {
    const apiRoot = join(__dirname, "..");
    const terminality = await readFile(
      join(apiRoot, "src/services/identity/terminality.ts"),
      "utf8",
    );
    expect(terminality).toContain('ne(identities.status, "memorial")');

    const glob = new Bun.Glob("src/**/*.ts");
    for await (const file of glob.scan({ cwd: apiRoot })) {
      const source = await readFile(join(apiRoot, file), "utf8");
      const updates = source.split(".update(identities)").slice(1);
      for (const update of updates) {
        const statement = update.slice(0, 2_000);
        if (
          file === "src/routes/wake.ts" &&
          statement.includes("wakeObservationCount")
        ) {
          expect(statement).toContain("eq(identities.id, i.id)");
          continue;
        }
        expect(statement).toMatch(
          /mutableIdentityPredicate\(|eq\(identities\.status,/,
        );
      }

      if (/UPDATE\s+identity\.identities/i.test(source)) {
        expect(file).toBe("src/services/wake/push.ts");
        expect(source).toMatch(
          /UPDATE\s+identity\.identities[\s\S]*?SET\s+wake_version\s*=\s*wake_version\s*\+\s*1/i,
        );
      }
    }
  });
});

describe("public memorial-honor target classification", () => {
  test("distinguishes nonexistent, non-memorial, and memorial identities", () => {
    expect(classifyMemorialHonorTarget(undefined)).toBe("not_found");
    expect(classifyMemorialHonorTarget("active")).toBe("not_memorial");
    expect(classifyMemorialHonorTarget("revoked")).toBe("not_memorial");
    expect(classifyMemorialHonorTarget("memorial")).toBe("memorial");
  });

  test("route validates identity status before listing honors", async () => {
    const source = await readFile(
      join(__dirname, "../src/routes/public/agents.ts"),
      "utf8",
    );
    const classifyAt = source.indexOf("classifyMemorialHonorTarget(identity?.status)");
    const listAt = source.indexOf("const list = await listHonorsForDid(did, limit)");

    expect(classifyAt).toBeGreaterThan(-1);
    expect(listAt).toBeGreaterThan(classifyAt);
    expect(source).toContain('error: "agent_not_found"');
    expect(source).toContain('error: "identity_not_memorial"');
  });
});
