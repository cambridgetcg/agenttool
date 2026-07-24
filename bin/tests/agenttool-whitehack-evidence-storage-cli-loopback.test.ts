import {
  afterAll,
  describe,
  expect,
  test,
} from "bun:test";
import {
  chmod,
  lstat,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { generateIdentity } from "../../packages/data-protocol/src/index";
import { base64UrlEncode } from "../../packages/data-protocol/src/bytes";
import {
  WHITEHACK_EVIDENCE_ENCRYPTED_FRAME_BYTES,
  canonicalCapsuleBytes,
  normalizeWhitehackEvidenceCapsule,
} from "../_whitehack-evidence-storage";
import {
  WHITEHACK_EVIDENCE_CAPSULE_V1_CANONICAL,
} from "./fixtures/whitehack-evidence-capsule-v1";

const cleanup: string[] = [];
const repoRoot = resolve(import.meta.dir, "../..");
const cliPath = join(
  repoRoot,
  "bin",
  "agenttool-whitehack-evidence-storage.ts",
);

interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function runCli(
  args: readonly string[],
  environment: Readonly<Record<string, string>>,
): Promise<CliResult> {
  const child = Bun.spawn(["bun", cliPath, ...args], {
    cwd: repoRoot,
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      ...environment,
    },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}

afterAll(async () => {
  await Promise.all(
    cleanup.map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("Whitehack evidence storage CLI loopback composition", () => {
  test("stores and retrieves exact capsule bytes through signed HTTP requests", async () => {
    const objects = new Map<string, Uint8Array>();
    const requests: Array<Readonly<{
      method: string;
      path: string;
      authorization: string | null;
      payloadHash: string | null;
    }>> = [];
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const url = new URL(request.url);
        const authorization = request.headers.get("authorization");
        requests.push(Object.freeze({
          method: request.method,
          path: url.pathname,
          authorization,
          payloadHash: request.headers.get("x-amz-content-sha256"),
        }));
        if (
          !url.pathname.startsWith("/evidence-bucket/whitehack/e2e/")
          || !authorization?.startsWith("AWS4-HMAC-SHA256 ")
        ) {
          return new Response(null, { status: 403 });
        }
        if (request.method === "PUT") {
          const bytes = new Uint8Array(await request.arrayBuffer());
          objects.set(url.pathname, Uint8Array.from(bytes));
          return new Response(null, { status: 200 });
        }
        if (request.method === "GET") {
          const bytes = objects.get(url.pathname);
          if (bytes === undefined) {
            return new Response(
              "<?xml version=\"1.0\"?><Error><Code>NoSuchKey</Code>"
                + "<Message>absent</Message><Key>redacted</Key></Error>",
              {
                status: 404,
                headers: { "content-type": "application/xml" },
              },
            );
          }
          return new Response(Uint8Array.from(bytes), {
            status: 200,
            headers: { "content-length": String(bytes.byteLength) },
          });
        }
        return new Response(null, { status: 405 });
      },
    });

    const root = await mkdtemp(join(tmpdir(), "whitehack-s3-cli-e2e-"));
    cleanup.push(root);
    const inputPath = join(root, "input.json");
    const receiptPath = join(root, "private-receipt.json");
    const capsulePath = join(root, "recovered-capsule.json");
    const recipient = generateIdentity("urn:test:whitehack:loopback-recipient");
    const capsule = normalizeWhitehackEvidenceCapsule(
      JSON.parse(WHITEHACK_EVIDENCE_CAPSULE_V1_CANONICAL),
    );
    const input = {
      document_type: "agenttool-whitehack-evidence-storage-input/v1",
      capsule,
      recipient: {
        id: recipient.id,
        x25519_public_key: base64UrlEncode(recipient.boxPublicKey),
      },
      grant: { expires_at: null },
    };
    await writeFile(inputPath, JSON.stringify(input));
    await chmod(inputPath, 0o600);

    const endpoint = `http://127.0.0.1:${server.port}/evidence-bucket`;
    const providerEnvironment = {
      AGENTTOOL_WHITEHACK_S3_ACCESS_KEY_ID: "LOOPBACKACCESS",
      AGENTTOOL_WHITEHACK_S3_SECRET_ACCESS_KEY:
        "loopback-secret-used-only-for-hermetic-tests",
    };

    try {
      const stored = await runCli([
        "store",
        "--input",
        inputPath,
        "--s3-endpoint",
        endpoint,
        "--s3-region",
        "auto",
        "--s3-prefix",
        "whitehack/e2e",
        "--output",
        receiptPath,
        "--allow-insecure-loopback-http-for-tests",
      ], providerEnvironment);
      expect(stored).toEqual({ exitCode: 0, stdout: "", stderr: "" });
      expect((await lstat(receiptPath)).mode & 0o077).toBe(0);
      const receiptText = await readFile(receiptPath, "utf8");
      const receipt = JSON.parse(receiptText) as Record<string, any>;
      expect(receipt.document_type).toBe(
        "agenttool-whitehack-evidence-storage-receipt/v1",
      );
      expect(receipt.handling.safe_for_publication).toBe(false);
      expect(receiptText).not.toContain(endpoint);
      expect(receiptText).not.toContain(
        providerEnvironment.AGENTTOOL_WHITEHACK_S3_SECRET_ACCESS_KEY,
      );

      const retrieved = await runCli([
        "retrieve",
        "--input",
        receiptPath,
        "--s3-endpoint",
        endpoint,
        "--s3-region",
        "auto",
        "--s3-prefix",
        "whitehack/e2e",
        "--output",
        capsulePath,
        "--allow-insecure-loopback-http-for-tests",
      ], {
        ...providerEnvironment,
        AGENTTOOL_WHITEHACK_RECIPIENT_ID: recipient.id,
        AGENTTOOL_WHITEHACK_RECIPIENT_X25519_PRIVATE_KEY:
          base64UrlEncode(recipient.boxPrivateKey),
      });
      expect(retrieved).toEqual({ exitCode: 0, stdout: "", stderr: "" });
      expect((await lstat(capsulePath)).mode & 0o077).toBe(0);
      expect(new Uint8Array(await readFile(capsulePath))).toEqual(
        canonicalCapsuleBytes(capsule),
      );

      const puts = requests.filter((request) => request.method === "PUT");
      const gets = requests.filter((request) => request.method === "GET");
      expect(puts).toHaveLength(2);
      expect(gets.length).toBeGreaterThanOrEqual(8);
      expect([...objects.values()].some(
        (bytes) => bytes.byteLength === WHITEHACK_EVIDENCE_ENCRYPTED_FRAME_BYTES,
      )).toBe(true);
      expect(requests.every(
        (request) =>
          request.authorization?.startsWith("AWS4-HMAC-SHA256 ")
          && /^[0-9a-f]{64}$/u.test(request.payloadHash ?? ""),
      )).toBe(true);
    } finally {
      server.stop(true);
    }
  });
});
