import { afterEach, describe, expect, test } from "bun:test";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  requestSha256,
  type RelayEnrolmentRequest,
} from "../src/relay-contract.js";
import {
  DEVICE_ID,
  profile,
  PROJECT_BEARER,
  RELAY_TOKEN,
  REPOSITORY_ID,
} from "./relay-fixtures.js";

const packageRoot = resolve(import.meta.dir, "..");
const temporaryDirectories: string[] = [];
const servers: Bun.Server<unknown>[] = [];

afterEach(() => {
  while (servers.length > 0) servers.pop()!.stop(true);
  while (temporaryDirectories.length > 0) {
    rmSync(temporaryDirectories.pop()!, { recursive: true, force: true });
  }
});

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "agenttool-relay-cli-"));
  temporaryDirectories.push(directory);
  return directory;
}

describe("agenttool-collab-enroll CLI", () => {
  test("accepts the one-shot project bearer over stdin and prints only safe metadata", async () => {
    let authorization: string | null = null;
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        authorization = request.headers.get("authorization");
        const input = await request.json() as RelayEnrolmentRequest;
        return Response.json({
          schema: "agenttool.collab-enrolment-result/1",
          replayed: false,
          receipt: {
            idempotency_key: input.idempotency_key,
            request_sha256: requestSha256(input),
            recorded_at: "2026-07-23T12:00:00.000Z",
          },
          repository: {
            id: REPOSITORY_ID,
            ...input.repository,
          },
          device: {
            id: input.device.id,
            label: input.device.label,
            token_prefix: input.token.prefix,
            active: true,
            version: input.expected_device_version + 1,
          },
          observation_policy: input.observation_policy,
          created: true,
        });
      },
    });
    servers.push(server);

    const root = temporaryDirectory();
    const profilePath = join(root, "project.json");
    const credentialPath = join(root, "private", "relay.json");
    writeFileSync(profilePath, `${JSON.stringify(profile)}\n`);
    const child = Bun.spawn([
      process.execPath,
      "bin/agenttool-collab-enroll.ts",
      "--project",
      profilePath,
      "--relay-url",
      `http://127.0.0.1:${server.port}`,
      "--credential-file",
      credentialPath,
      "--device-id",
      DEVICE_ID,
      "--device-label",
      "CLI test device",
      "--project-bearer-stdin",
    ], {
      cwd: packageRoot,
      env: {
        PATH: process.env.PATH ?? "",
        TMPDIR: tmpdir(),
        AGENTOOL_COLLAB_RELAY_TOKEN: RELAY_TOKEN,
      },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    child.stdin.write(`${PROJECT_BEARER}\n`);
    child.stdin.end();
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(authorization as string | null).toBe(`Bearer ${PROJECT_BEARER}`);
    expect(stdout).not.toContain(PROJECT_BEARER);
    expect(stdout).not.toContain(RELAY_TOKEN);
    expect(JSON.parse(stdout)).toMatchObject({
      enrolled: true,
      created: true,
      repository_id: REPOSITORY_ID,
      device_id: DEVICE_ID,
      device_version: 1,
      replayed: false,
      credential_file: credentialPath,
      token_storage: "environment",
    });
    expect(readFileSync(credentialPath, "utf8")).not.toContain(RELAY_TOKEN);
    expect(readFileSync(credentialPath, "utf8")).not.toContain(PROJECT_BEARER);
  });

  test("redacts secret-like unknown argv and states the token-rotation limitation", async () => {
    for (const credential of [
      RELAY_TOKEN,
      `at_${"P".repeat(43)}`,
      `npm_${"N".repeat(36)}`,
      `ghp_${"G".repeat(36)}`,
      `github_pat_${"H".repeat(48)}`,
    ]) {
      const rejected = Bun.spawnSync([
        process.execPath,
        "bin/agenttool-collab-enroll.ts",
        credential,
      ], {
        cwd: packageRoot,
        env: { PATH: process.env.PATH ?? "" },
        stdout: "pipe",
        stderr: "pipe",
      });
      const rejectedText = rejected.stderr.toString();
      expect(rejected.exitCode).toBe(1);
      expect(rejectedText).toContain("[redacted secret-like argument]");
      expect(rejectedText).not.toContain(credential);
    }

    const help = Bun.spawnSync([
      process.execPath,
      "bin/agenttool-collab-enroll.ts",
      "--help",
    ], {
      cwd: packageRoot,
      env: { PATH: process.env.PATH ?? "" },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(help.exitCode).toBe(0);
    expect(help.stdout.toString()).toContain(
      "this command does not rotate tokens",
    );
    expect(help.stdout.toString()).toContain(
      "bearer is accepted on argv or printed",
    );
  });
});
