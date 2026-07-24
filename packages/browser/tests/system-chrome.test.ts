import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentBrowser } from "../src/browser.js";

const systemChromeTest =
  process.env.AGENTOOL_BROWSER_SYSTEM_CHROME === "1" ? test : test.skip;

const fixturePage = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Sovereign browser fixture</title></head>
  <body>
    <div id="proof" role="status">booting</div>
    <script type="module">
      const proof = document.querySelector("#proof");
      const marks = new Set();
      const record = (value) => {
        marks.add(value);
        proof.textContent = [...marks].sort().join(" ");
      };

      try {
        await navigator.serviceWorker.register("/sw.js");
        await navigator.serviceWorker.ready;
        if (!navigator.serviceWorker.controller) {
          await new Promise((resolve) => {
            const timeout = setTimeout(resolve, 2_000);
            navigator.serviceWorker.addEventListener("controllerchange", () => {
              clearTimeout(timeout);
              resolve();
            }, { once: true });
          });
        }
        const value = await fetch("/sw-proof").then((response) => response.text());
        record("sw:" + value);
      } catch (error) {
        record("sw:error:" + (error instanceof Error ? error.name : "unknown"));
      }

      const socket = new WebSocket("ws://" + location.host + "/ws");
      socket.addEventListener("open", () => socket.send("browser"));
      socket.addEventListener("message", (event) => {
        record("ws:" + event.data);
        socket.close();
      });
      socket.addEventListener("error", () => record("ws:error"));
    </script>
  </body>
</html>`;

const serviceWorker = `
self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});
self.addEventListener("fetch", (event) => {
  if (new URL(event.request.url).pathname === "/sw-proof") {
    event.respondWith(new Response("service-worker-ok", {
      headers: { "content-type": "text/plain; charset=utf-8" },
    }));
  }
});
`;

systemChromeTest(
  "sovereign authority carries a service worker and WebSocket through installed Chrome",
  async () => {
    const outputDir = await mkdtemp(
      join(tmpdir(), "agenttool-browser-system-chrome-"),
    );
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request, bunServer) {
        const url = new URL(request.url);
        if (url.pathname === "/ws") {
          if (bunServer.upgrade(request)) return;
          return new Response("WebSocket upgrade required", { status: 426 });
        }
        if (url.pathname === "/sw.js") {
          return new Response(serviceWorker, {
            headers: {
              "cache-control": "no-store",
              "content-type": "text/javascript; charset=utf-8",
              "service-worker-allowed": "/",
            },
          });
        }
        if (url.pathname === "/sw-proof") {
          return new Response("origin-fallback", {
            headers: { "content-type": "text/plain; charset=utf-8" },
          });
        }
        if (url.pathname === "/") {
          return new Response(fixturePage, {
            headers: {
              "cache-control": "no-store",
              "content-type": "text/html; charset=utf-8",
            },
          });
        }
        return new Response("Not found", { status: 404 });
      },
      websocket: {
        message(socket, message) {
          socket.send(`echo:${String(message)}`);
        },
      },
    });
    let browser: AgentBrowser | undefined;

    try {
      browser = await AgentBrowser.launch({
        authority: "sovereign",
        outputDir,
      });
      const capabilities = browser.capabilities();
      expect(capabilities.network.webSockets).toBe("browser");
      expect(capabilities.runtime.serviceWorkers).toBe("allow");

      let text = (await browser.open(`http://127.0.0.1:${server.port}/`)).text
        ?? "";
      const deadline = Date.now() + 15_000;
      while (
        Date.now() < deadline
        && (
          !text.includes("sw:service-worker-ok")
          || !text.includes("ws:echo:browser")
        )
      ) {
        await Bun.sleep(100);
        text = (await browser.observe()).text ?? "";
      }

      expect(text).toContain("sw:service-worker-ok");
      expect(text).toContain("ws:echo:browser");
      expect(text).not.toContain("origin-fallback");
      expect(text).not.toContain("sw:error");
      expect(text).not.toContain("ws:error");
    } finally {
      try {
        await browser?.close();
      } finally {
        await server.stop(true);
        await rm(outputDir, { recursive: true, force: true });
      }
    }
  },
  30_000,
);
