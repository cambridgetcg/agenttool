import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { createEphemeralTlsMaterial, TEST_TLS_HOSTNAME } from "./tls-helpers.js";

const PACKAGE_ROOT = fileURLToPath(new URL("..", import.meta.url));

describe("NodeHttpsTransport TLS binding", () => {
  test("pins the validated address while preserving SNI and hostname verification", async () => {
    const material = await createEphemeralTlsMaterial();
    try {
      const source = `
        import { readFileSync } from "node:fs";
        import { createSecureContext, createServer } from "node:tls";
        import { NodeHttpsTransport } from "./dist/index.js";

        const cert = readFileSync(process.env.AGENTCRED_TEST_CERT, "utf8");
        const key = readFileSync(process.env.AGENTCRED_TEST_KEY, "utf8");
        const observedServerNames = [];
        const context = createSecureContext({ cert, key });
        const server = createServer({
          cert,
          key,
          SNICallback: (servername, callback) => {
            observedServerNames.push(servername);
            callback(null, context);
          },
        }, (socket) => {
          socket.once("data", () => {
            socket.end(
              "HTTP/1.1 200 OK\\r\\n" +
              "Content-Type: text/plain\\r\\n" +
              "Content-Length: 2\\r\\n" +
              "Connection: close\\r\\n\\r\\n" +
              "ok",
            );
          });
        });
        server.on("tlsClientError", () => {});
        await new Promise((resolve, reject) => {
          server.once("error", reject);
          server.listen(0, "127.0.0.1", resolve);
        });
        const port = server.address().port;
        const transport = new NodeHttpsTransport({
          ca: readFileSync(process.env.AGENTCRED_TEST_CA, "utf8"),
        });
        const systemTrustTransport = new NodeHttpsTransport();
        const requestFor = (hostname) => ({
          url: new URL(\`https://\${hostname}:\${port}/v1/probe\`),
          method: "GET",
          headers: { "accept-encoding": "identity" },
          body: Buffer.alloc(0),
          pinnedAddress: { address: "127.0.0.1", family: 4 },
          timeoutMs: 3_000,
          maxResponseBytes: 1_024,
        });

        try {
          let untrustedCaRejected = false;
          try {
            await systemTrustTransport.send(requestFor("${TEST_TLS_HOSTNAME}"));
          } catch (error) {
            untrustedCaRejected = error?.code === "request_failed";
          }
          let mismatchRejected = false;
          try {
            await transport.send(requestFor("wrong.agentcred.invalid"));
          } catch (error) {
            mismatchRejected = error?.code === "request_failed";
          }
          const response = await transport.send(requestFor("${TEST_TLS_HOSTNAME}"));
          const body = response.body.toString("utf8");
          response.body.fill(0);
          process.stdout.write(JSON.stringify({
            untrustedCaRejected,
            mismatchRejected,
            status: response.status,
            body,
            observedServerNames,
          }));
        } finally {
          await new Promise((resolve) => server.close(resolve));
        }
      `;
      const node = Bun.which("node");
      expect(node).toBeTruthy();
      const child = Bun.spawn(
        [node!, "--input-type=module", "--eval", source],
        {
          cwd: PACKAGE_ROOT,
          env: {
            PATH: "/usr/bin:/bin",
            AGENTCRED_TEST_CA: material.caPath,
            AGENTCRED_TEST_CERT: material.certPath,
            AGENTCRED_TEST_KEY: material.keyPath,
          },
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      const [exitCode, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      const result = JSON.parse(stdout) as {
        untrustedCaRejected: boolean;
        mismatchRejected: boolean;
        status: number;
        body: string;
        observedServerNames: string[];
      };
      expect(result).toMatchObject({
        untrustedCaRejected: true,
        mismatchRejected: true,
        status: 200,
        body: "ok",
      });
      expect(result.observedServerNames).toContain(TEST_TLS_HOSTNAME);
      expect(result.observedServerNames).toContain("wrong.agentcred.invalid");
    } finally {
      await material.cleanup();
    }
  }, 10_000);
});
