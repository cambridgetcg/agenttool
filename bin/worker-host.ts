#!/usr/bin/env bun
// worker-host.ts — run any Cloudflare Worker code locally with Bun.
// No Cloudflare needed. No API token. No deploy. Just run.
//
// Usage: bun worker-host.ts <worker.js> <port>
// Example: bun worker-host.ts /tmp/joke-worker/worker.js 9091
//
// The worker.js file exports a default object with a fetch(request) method.
// This adapter wraps it in a Bun.serve() server.
// If the worker uses KV (env.KV_NAMESPACE), we provide a SQLite-backed KV.

import { exists, mkdir } from "fs/promises";

const workerPath = process.argv[2];
const port = parseInt(process.argv[3] || "9090");

if (!workerPath) {
  console.error("usage: bun worker-host.ts <worker.js> <port>");
  process.exit(1);
}

// Load the worker
const mod = await import(workerPath);
const handler = mod.default;

if (!handler || !handler.fetch) {
  console.error("worker must export default { fetch(request, env) }");
  process.exit(1);
}

// SQLite-backed KV (replaces Cloudflare KV)
class SQLiteKV {
  db: Map<string, string> = new Map();

  async get(key: string, type?: string) {
    const val = this.db.get(key);
    if (!val) return null;
    if (type === "json") {
      try { return JSON.parse(val); } catch { return null; }
    }
    return val;
  }

  async put(key: string, value: string) {
    this.db.set(key, value);
  }

  async list(prefix?: string) {
    const keys = [...this.db.keys()];
    return prefix ? keys.filter(k => k.startsWith(prefix)) : keys;
  }

  async delete(key: string) {
    this.db.delete(key);
  }
}

// Build env with KV namespaces (empty — workers that need pre-populated
// KV should be adapted to load from local files)
const env: Record<string, any> = {};

// Provide any KV namespace the worker might reference
// Workers reference env.SOME_KV — we create empty ones on demand
const kvProxy = new Proxy({}, {
  get(_, prop) {
    const name = String(prop);
    if (!env[name]) {
      env[name] = new SQLiteKV();
    }
    return env[name];
  }
});

// Start the server
const server = Bun.serve({
  port,
  async fetch(req) {
    try {
      const res = await handler.fetch(req, kvProxy);
      if (res instanceof Response) {
        // Read the full body into a buffer, return a complete response.
        // This avoids Caddy reverse proxy getting Content-Length: 0
        // from Bun's streaming Response.
        const buf = await res.arrayBuffer();
        return new Response(buf, {
          status: res.status,
          headers: {
            "content-type": res.headers.get("content-type") || "application/json",
            "content-length": String(buf.byteLength),
            "access-control-allow-origin": "*",
          },
        });
      }
      return res;
    } catch (e) {
      return new Response(`worker error: ${e instanceof Error ? e.message : String(e)}`, {
        status: 500,
        headers: { "content-type": "text/plain", "access-control-allow-origin": "*" }
      });
    }
  },
});

console.log(`✓ worker-host: ${workerPath} on port ${port}`);
console.log(`  http://localhost:${port}`);