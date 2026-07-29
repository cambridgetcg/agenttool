import { afterEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { chmod, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashAuditPath } from "../src/audit.js";
import { archiveCredentialClosures } from "../src/controller.js";
import { AGENTCRED_EVM_JSONRPC_READ_PROFILE } from "../src/index.js";
import {
  createCredentialHandoffManifest,
  hashCredentialVerificationProfile,
  loadCredentialHandoffManifest,
  makeKeychainSlotRecord,
  saveCredentialHandoffManifest,
  type CredentialHandoffManifest,
} from "../src/keychain-slots.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function config(root: string): Record<string, unknown> {
  return {
    socketPath: join(root, "run", "agentcred.sock"),
    auditPath: join(root, "audit.jsonl"),
    credentials: {
      "agenttool/default": {
        backend: "macos-keychain",
        service: "agenttool-test-reference",
        account: "test-owner",
        auth: { kind: "bearer" },
      },
    },
    policies: [
      {
        credential: "agenttool/default",
        origin: "https://api.example.com",
        methods: ["GET"],
        pathPrefixes: ["/v1"],
        queryNames: [],
        maxTtlSeconds: 60,
        maxUses: 2,
      },
    ],
  };
}

function check(path: string): ReturnType<typeof Bun.spawnSync> {
  return Bun.spawnSync(
    [process.execPath, "src/cli.ts", "check", "--config", path],
    { cwd: new URL("..", import.meta.url).pathname },
  );
}

function control(args: string[]): ReturnType<typeof Bun.spawnSync> {
  return Bun.spawnSync(
    [process.execPath, "src/controller-cli.ts", ...args],
    { cwd: new URL("..", import.meta.url).pathname },
  );
}

function bootstrappedManifest(): ReturnType<
  typeof createCredentialHandoffManifest
> {
  const manifest = createCredentialHandoffManifest({
    credential: "agenttool/default",
    provider: "agenttool",
    purpose: "bounded-api",
    environment: "local",
    account: "test-owner",
    auth: { kind: "bearer" },
    verification: {
      operation: "http.fetch",
      origin: "https://api.example.com",
      path: "/v1/whoami",
      targetPathHash: hashAuditPath("/v1/whoami"),
      method: "GET",
      successStatus: 200,
      revokedStatus: 401,
    },
    now: new Date("2026-07-29T12:00:00.000Z"),
  });
  const active = makeKeychainSlotRecord({
    now: new Date("2026-07-29T12:01:00.000Z"),
  });
  manifest.activeSlot = "a";
  manifest.slots.a = active;
  manifest.closures = [
    {
      rotationId: randomUUID(),
      outcome: "bootstrapped",
      startedAt: active.createdAt,
      candidateVerifiedAt: "2026-07-29T12:01:30.000Z",
      closedAt: "2026-07-29T12:02:00.000Z",
      toGenerationId: active.generationId,
      evidence: [
        {
          kind: "broker-positive",
          at: "2026-07-29T12:01:20.000Z",
          evidenceId: randomUUID(),
          generationId: active.generationId,
          brokerCredential: "agenttool/candidate",
          verificationProfileHash: hashCredentialVerificationProfile(
            manifest.verification,
          ),
          status: 200,
        },
      ],
    },
  ];
  manifest.revision = 1;
  manifest.updatedAt = "2026-07-29T12:02:00.000Z";
  return manifest;
}

function appendAbortedClosure(
  manifest: CredentialHandoffManifest,
): void {
  const active = manifest.activeSlot
    ? manifest.slots[manifest.activeSlot]
    : null;
  if (!active) throw new Error("test fixture lacks an active generation");
  const candidate = makeKeychainSlotRecord({
    now: new Date("2026-07-29T13:00:00.000Z"),
  });
  manifest.closures = [
    {
      rotationId: randomUUID(),
      outcome: "aborted",
      startedAt: candidate.createdAt,
      overlapDeadline: "2026-07-29T14:00:00.000Z",
      candidateRevocationPreparedAt: "2026-07-29T13:01:00.000Z",
      candidateProviderRevokedAt: "2026-07-29T13:02:00.000Z",
      closedAt: "2026-07-29T13:03:00.000Z",
      fromGenerationId: active.generationId,
      toGenerationId: candidate.generationId,
      evidence: [
        {
          kind: "revocation-intent",
          at: "2026-07-29T13:01:00.000Z",
          evidenceId: randomUUID(),
        },
        {
          kind: "provider-revocation",
          at: "2026-07-29T13:02:00.000Z",
          evidenceId: randomUUID(),
        },
      ],
    },
  ];
  manifest.revision += 1;
  manifest.updatedAt = "2026-07-29T13:03:00.000Z";
}

describe("strict owner-held CLI config", () => {
  test("accepts references and policy only", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentcred-cli-"));
    roots.push(root);
    await chmod(root, 0o700);
    const path = join(root, "config.json");
    await writeFile(path, JSON.stringify(config(root)), { mode: 0o600 });

    const result = check(path);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toBe("agentcred config: ok\n");
  });

  test("accepts an explicit bearer-only JSON-RPC read policy", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentcred-cli-"));
    roots.push(root);
    await chmod(root, 0o700);
    const raw = config(root);
    raw.policies = [
      {
        operation: "jsonrpc.read",
        profile: AGENTCRED_EVM_JSONRPC_READ_PROFILE,
        credential: "agenttool/default",
        origin: "https://eth-mainnet.g.alchemy.com",
        chainId: "eip155:1",
        methods: ["eth_chainId", "eth_getBalance"],
        maxTtlSeconds: 60,
        maxUses: 2,
        maxRequestBytes: 1024,
        maxResponseBytes: 4096,
      },
    ];
    const path = join(root, "config.json");
    await writeFile(path, JSON.stringify(raw), { mode: 0o600 });

    const result = check(path);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toBe("agentcred config: ok\n");
  });

  test("accepts managed active/candidate/previous references without requiring every slot", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentcred-cli-"));
    roots.push(root);
    await chmod(root, 0o700);
    const manifestPath = join(root, "managed.json");
    const manifest = bootstrappedManifest();
    await saveCredentialHandoffManifest(manifestPath, manifest, { create: true });

    const raw = config(root);
    raw.credentials = Object.fromEntries(
      ["active", "candidate", "previous"].map((selection) => [
        `agenttool/${selection}`,
        {
          backend: "managed-macos-keychain",
          manifestPath,
          selection,
          auth: { kind: "bearer" },
        },
      ]),
    );
    raw.policies = [
      {
        credential: "agenttool/active",
        origin: "https://api.example.com",
        methods: ["GET"],
        pathPrefixes: ["/v1"],
        queryNames: [],
        maxTtlSeconds: 60,
        maxUses: 2,
      },
    ];
    const path = join(root, "config.json");
    await writeFile(path, JSON.stringify(raw), { mode: 0o600 });

    const result = check(path);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toBe("agentcred config: ok\n");
  });

  test("rejects a JSON-RPC policy backed by a custom credential header", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentcred-cli-"));
    roots.push(root);
    await chmod(root, 0o700);
    const raw = config(root);
    const credentials = raw.credentials as Record<string, Record<string, unknown>>;
    credentials["agenttool/default"]!.auth = {
      kind: "header",
      headerName: "x-api-key",
    };
    raw.policies = [
      {
        operation: "jsonrpc.read",
        profile: AGENTCRED_EVM_JSONRPC_READ_PROFILE,
        credential: "agenttool/default",
        origin: "https://eth-mainnet.g.alchemy.com",
        chainId: "eip155:1",
        methods: ["eth_chainId"],
        maxTtlSeconds: 60,
        maxUses: 1,
      },
    ];
    const path = join(root, "config.json");
    await writeFile(path, JSON.stringify(raw), { mode: 0o600 });

    const result = check(path);
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toBe(
      "agentcred: JSON-RPC policy requires a bearer credential mapping.\n",
    );
  });

  test("rejects secret-like unknown fields instead of silently retaining them", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentcred-cli-"));
    roots.push(root);
    await chmod(root, 0o700);
    const raw = config(root);
    const credentials = raw.credentials as Record<string, Record<string, unknown>>;
    credentials["agenttool/default"]!.value = "test-sentinel-not-a-real-secret";
    const path = join(root, "config.json");
    await writeFile(path, JSON.stringify(raw), { mode: 0o600 });

    const result = check(path);
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).not.toContain("test-sentinel-not-a-real-secret");
  });

  test("rejects mistyped optional credential fields instead of changing their meaning", async () => {
    for (const mutate of [
      (credential: Record<string, unknown>) => {
        credential.account = 42;
      },
      (credential: Record<string, unknown>) => {
        (credential.auth as Record<string, unknown>).headerName = false;
      },
      (credential: Record<string, unknown>) => {
        (credential.auth as Record<string, unknown>).prefix = null;
      },
    ]) {
      const root = await mkdtemp(join(tmpdir(), "agentcred-cli-"));
      roots.push(root);
      await chmod(root, 0o700);
      const raw = config(root);
      const credentials = raw.credentials as Record<string, Record<string, unknown>>;
      mutate(credentials["agenttool/default"]!);
      const path = join(root, "config.json");
      await writeFile(path, JSON.stringify(raw), { mode: 0o600 });

      const result = check(path);
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toBe("agentcred: Broker credential mapping is invalid.\n");
    }
  });

  test("refuses a symlinked config root", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentcred-cli-"));
    roots.push(root);
    await chmod(root, 0o700);
    const real = join(root, "real.json");
    const link = join(root, "link.json");
    await writeFile(real, JSON.stringify(config(root)), { mode: 0o600 });
    await symlink(real, link);

    expect(check(link).exitCode).toBe(1);
  });
});

describe("human controller CLI", () => {
  test("initializes only a metadata manifest", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentcred-control-"));
    roots.push(root);
    await chmod(root, 0o700);
    const manifest = join(root, "handoff.json");
    const result = control([
      "init",
      "--manifest",
      manifest,
      "--credential",
      "agenttool/default",
      "--provider",
      "agenttool",
      "--purpose",
      "bounded-api",
      "--environment",
      "local",
      "--account",
      "test-owner",
      "--auth",
      "bearer",
      "--verify-operation",
      "http.fetch",
      "--verify-origin",
      "https://api.example.com",
      "--verify-path",
      "/v1/whoami",
      "--verify-method",
      "GET",
      "--verify-success-status",
      "200",
      "--verify-revoked-status",
      "401",
    ]);

    expect(result.exitCode).toBe(0);
    const output = result.stdout.toString();
    expect(output).toContain('"credential": "agenttool/default"');
    expect(output).not.toMatch(/service|account|secret|password|token/i);
  });

  test("rejects value-like and generic execution flags without echoing input", () => {
    const sentinel = "agentcred-test-sentinel-never-real";
    for (const flag of [
      "--value",
      "--secret",
      "--password",
      "--stdin",
      "--env",
      "--command",
      "--url",
    ]) {
      const result = control(["init", flag, sentinel]);
      expect(result.exitCode).toBe(2);
      expect(result.stdout.toString()).not.toContain(sentinel);
      expect(result.stderr.toString()).not.toContain(sentinel);
    }
  });

  test("verifies a live linked archive chain read-only without requiring a TTY", async () => {
    const root = await mkdtemp(join(tmpdir(), "agentcred-control-"));
    roots.push(root);
    await chmod(root, 0o700);
    const manifestPath = join(root, "handoff.json");
    const firstArchivePath = join(root, "closures-1.json");
    const secondArchivePath = join(root, "closures-2.json");
    await saveCredentialHandoffManifest(
      manifestPath,
      bootstrappedManifest(),
      { create: true },
    );
    const first = await archiveCredentialClosures({
      manifestPath,
      archivePath: firstArchivePath,
      now: new Date("2026-07-29T12:03:00.000Z"),
    });

    const firstLinked = control([
      "verify-archive",
      "--archive",
      firstArchivePath,
      "--manifest",
      manifestPath,
    ]);
    expect(firstLinked.exitCode).toBe(0);
    expect(firstLinked.stderr.toString()).toBe("");
    expect(
      (
        JSON.parse(firstLinked.stdout.toString()) as {
          archiveDigest: string;
        }
      ).archiveDigest,
    ).toBe(first.archiveDigest);

    const live = await loadCredentialHandoffManifest(manifestPath);
    appendAbortedClosure(live);
    await saveCredentialHandoffManifest(manifestPath, live);
    const second = await archiveCredentialClosures({
      manifestPath,
      archivePath: secondArchivePath,
      now: new Date("2026-07-29T13:04:00.000Z"),
    });
    const chained = control([
      "verify-archive",
      "--archive",
      secondArchivePath,
      "--manifest",
      manifestPath,
      "--previous-archive",
      firstArchivePath,
    ]);
    expect(chained.exitCode).toBe(0);
    expect(chained.stderr.toString()).toBe("");
    const output = JSON.parse(chained.stdout.toString()) as {
      archiveDigest: string;
      archivedClosures: number;
      cumulativeClosures: number;
    };
    expect(output.archiveDigest).toBe(second.archiveDigest);
    expect(output.archivedClosures).toBe(1);
    expect(output.cumulativeClosures).toBe(2);

    const staleLiveLink = control([
      "verify-archive",
      "--archive",
      firstArchivePath,
      "--manifest",
      manifestPath,
    ]);
    expect(staleLiveLink.exitCode).toBe(1);
    expect(staleLiveLink.stderr.toString()).toContain(
      "not the live manifest history anchor",
    );

    const unrelatedManifestPath = join(root, "unrelated.json");
    const unrelatedArchivePath = join(root, "unrelated-closures.json");
    await saveCredentialHandoffManifest(
      unrelatedManifestPath,
      bootstrappedManifest(),
      { create: true },
    );
    await archiveCredentialClosures({
      manifestPath: unrelatedManifestPath,
      archivePath: unrelatedArchivePath,
      now: new Date("2026-07-29T12:03:00.000Z"),
    });
    const unrelated = control([
      "verify-archive",
      "--archive",
      secondArchivePath,
      "--previous-archive",
      unrelatedArchivePath,
    ]);
    expect(unrelated.exitCode).toBe(1);
    expect(unrelated.stderr.toString()).toContain(
      "do not form one chain",
    );
  });

  test("refuses controller mutation without a human TTY", () => {
    const result = control([
      "stage",
      "--config",
      "/tmp/not-opened.json",
      "--credential",
      "agenttool/candidate",
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain(
      "interactive terminal as an anti-pipe check",
    );
    expect(result.stderr.toString()).toContain(
      "does not authenticate human presence",
    );
  });
});
