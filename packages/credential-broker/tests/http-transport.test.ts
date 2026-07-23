import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import type { AddressInfo, Socket } from "node:net";
import { createServer } from "node:tls";
import { fileURLToPath } from "node:url";
import { createEphemeralTlsMaterial, TEST_TLS_HOSTNAME } from "./tls-helpers.js";

const PACKAGE_ROOT = fileURLToPath(new URL("..", import.meta.url));

async function listen(server: ReturnType<typeof createServer>): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    const failed = (error: Error): void => reject(error);
    server.once("error", failed);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", failed);
      resolve();
    });
  });
  return (server.address() as AddressInfo).port;
}

async function close(server: ReturnType<typeof createServer>): Promise<void> {
  server.closeAllConnections?.();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

describe("NodeHttpsTransport deadlines", () => {
  test("an absolute deadline stops a response that continuously drips bytes", async () => {
    const material = await createEphemeralTlsMaterial();
    const sockets = new Set<Socket>();
    const intervals = new Set<ReturnType<typeof setInterval>>();
    let dripCount = 0;
    let server: ReturnType<typeof createServer> | undefined;
    try {
      const [cert, key] = await Promise.all([
        readFile(material.certPath, "utf8"),
        readFile(material.keyPath, "utf8"),
      ]);
      server = createServer({ cert, key }, (socket) => {
        sockets.add(socket);
        socket.once("data", () => {
          socket.write(
            "HTTP/1.1 200 OK\r\n" +
              "Content-Type: text/plain\r\n" +
              "Transfer-Encoding: chunked\r\n" +
              "Connection: close\r\n\r\n",
          );
          const drip = (): void => {
            if (socket.destroyed) return;
            dripCount += 1;
            socket.write("1\r\nx\r\n");
          };
          drip();
          const interval = setInterval(drip, 10);
          interval.unref?.();
          intervals.add(interval);
          socket.once("close", () => {
            clearInterval(interval);
            intervals.delete(interval);
            sockets.delete(socket);
          });
        });
      });

      const port = await listen(server);
      const source = `
        import { readFileSync } from "node:fs";
        import { NodeHttpsTransport } from "./dist/index.js";

        const transport = new NodeHttpsTransport({
          ca: readFileSync(process.env.AGENTCRED_TEST_CA, "utf8"),
        });
        const started = Date.now();
        try {
          await transport.send({
            url: new URL(\`https://${TEST_TLS_HOSTNAME}:\${process.env.AGENTCRED_TEST_PORT}/v1/drip\`),
            method: "GET",
            headers: { "accept-encoding": "identity" },
            body: Buffer.alloc(0),
            pinnedAddress: { address: "127.0.0.1", family: 4 },
            timeoutMs: 120,
            maxResponseBytes: 1_000_000,
          });
          process.exitCode = 2;
        } catch (error) {
          process.stdout.write(JSON.stringify({ code: error?.code, elapsedMs: Date.now() - started }));
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
            AGENTCRED_TEST_PORT: String(port),
          },
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      const watchdog = setTimeout(() => child.kill(), 2_000);
      const [exitCode, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      clearTimeout(watchdog);

      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      const result = JSON.parse(stdout) as { code: string; elapsedMs: number };
      expect(result.code).toBe("request_failed");
      expect(result.elapsedMs).toBeGreaterThanOrEqual(80);
      expect(result.elapsedMs).toBeLessThan(1_000);
      expect(dripCount).toBeGreaterThanOrEqual(3);
    } finally {
      for (const interval of intervals) clearInterval(interval);
      for (const socket of sockets) socket.destroy();
      if (server?.listening) await close(server);
      await material.cleanup();
    }
  }, 10_000);
});
