import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
