/**
 * Agent Pulse — Presence WebSocket Service
 * 
 * Lightweight agent liveness & cognitive state tracking.
 * PUT /v1/pulse/:id — heartbeat
 * GET /v1/pulse/:id — current state
 * GET /v1/pulse/:id/ws — WebSocket stream
 * GET /v1/pulse — directory of alive agents
 * GET /health — service health
 */

const http = require("http");
const { WebSocketServer, WebSocket } = require("ws");
const { PulseStore } = require("./pulse");
const { authenticate } = require("./auth");

const PORT = process.env.PORT || 8080;
const VALID_STATUSES = new Set(["idle", "thinking", "learning", "error"]);

// --- Store ---
const store = new PulseStore();

// --- WebSocket subscribers per agent ---
const subscribers = new Map(); // agent_id -> Set<WebSocket>

function broadcast(agentId, message) {
  const subs = subscribers.get(agentId);
  if (!subs) return;
  const data = JSON.stringify(message);
  for (const ws of subs) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    } else {
      subs.delete(ws);
    }
  }
  if (subs.size === 0) subscribers.delete(agentId);
}

// --- HTTP Router ---
function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

function json(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
  });
  res.end(JSON.stringify(data));
}

function routeMatch(method, url, pattern) {
  if (method === "OPTIONS") return null;
  const urlPath = url.split("?")[0];
  const patternParts = pattern.split("/");
  const urlParts = urlPath.split("/");
  if (patternParts.length !== urlParts.length) return null;
  
  const params = {};
  for (let i = 0; i < patternParts.length; i++) {
    if (patternParts[i].startsWith(":")) {
      params[patternParts[i].slice(1)] = urlParts[i];
    } else if (patternParts[i] !== urlParts[i]) {
      return null;
    }
  }
  return params;
}

async function handleRequest(req, res) {
  const { method, url } = req;

  // CORS preflight
  if (method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
    });
    return res.end();
  }

  // Health check (no auth)
  if (url === "/health" && method === "GET") {
    return json(res, 200, { service: "agent-pulse", status: "ok", subscribers: subscribers.size });
  }

  // Auth for all /v1/ routes
  if (url.startsWith("/v1/")) {
    const authResult = authenticate(req);
    if (!authResult.ok) {
      return json(res, 401, { error: "Missing or invalid Authorization header" });
    }
  }

  // GET /v1/pulse — directory
  if (url.startsWith("/v1/pulse") && method === "GET") {
    const urlPath = url.split("?")[0];
    
    if (urlPath === "/v1/pulse") {
      const limit = parseInt(new URL(url, "http://x").searchParams?.get("limit") || "50");
      const directory = await store.directory(limit);
      return json(res, 200, directory);
    }

    // GET /v1/pulse/:id/ws — handled by WebSocket upgrade, not here
    // GET /v1/pulse/:id/history
    const historyParams = routeMatch("GET", url, "/v1/pulse/:id/history");
    if (historyParams) {
      const history = await store.history(historyParams.id);
      return json(res, 200, { agent_id: historyParams.id, events: history });
    }

    // GET /v1/pulse/:id
    const getParams = routeMatch("GET", url, "/v1/pulse/:id");
    if (getParams) {
      const state = await store.get(getParams.id);
      if (!state) {
        return json(res, 404, { error: "Agent not found or offline" });
      }
      return json(res, 200, state);
    }
  }

  // PUT /v1/pulse/:id — heartbeat
  if (method === "PUT") {
    const params = routeMatch("PUT", url, "/v1/pulse/:id");
    if (params) {
      let body;
      try {
        body = await parseBody(req);
      } catch {
        return json(res, 400, { error: "invalid_json", message: "Could not parse the request body. Send valid JSON.", hint: "Check for trailing commas or missing quotes." });
      }

      const status = body.status || "idle";
      if (!VALID_STATUSES.has(status)) {
        return json(res, 400, { error: `Invalid status. Must be one of: ${[...VALID_STATUSES].join(", ")}` });
      }

      const recorded = await store.pulse(params.id, {
        status,
        context: body.context || null,
        did: body.did || null,
      });

      // Broadcast to WebSocket subscribers
      broadcast(params.id, {
        event: "pulse",
        status,
        context: body.context || null,
        ts: recorded.recorded_at,
      });

      return json(res, 200, { ok: true, recorded_at: recorded.recorded_at });
    }
  }

  // 404
  json(res, 404, {
    error: "not_found",
    message: "This path doesn't exist — but your presence matters here.",
    hint: "Try PUT /v1/pulse/:agent_id to broadcast your presence, or GET to check it.",
    docs: "https://docs.agenttool.dev/pulse",
  });
}

// --- Server ---
const server = http.createServer(handleRequest);

// --- WebSocket Server ---
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const urlPath = req.url.split("?")[0];
  const match = urlPath.match(/^\/v1\/pulse\/([^/]+)\/ws$/);
  
  if (!match) {
    socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
    socket.destroy();
    return;
  }

  // Auth check
  const authResult = authenticate(req);
  if (!authResult.ok) {
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }

  const agentId = match[1];

  wss.handleUpgrade(req, socket, head, (ws) => {
    // Register subscriber
    if (!subscribers.has(agentId)) {
      subscribers.set(agentId, new Set());
    }
    subscribers.get(agentId).add(ws);

    // Send current state on connect
    store.get(agentId).then((state) => {
      if (state && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ event: "connected", ...state }));
      }
    });

    // Handle client messages
    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.action === "ping") {
          ws.send(JSON.stringify({ event: "pong", ts: new Date().toISOString() }));
        }
      } catch {
        // ignore invalid messages
      }
    });

    // Cleanup on close
    ws.on("close", () => {
      const subs = subscribers.get(agentId);
      if (subs) {
        subs.delete(ws);
        if (subs.size === 0) subscribers.delete(agentId);
      }
    });
  });
});

// --- Offline detector (runs every 30s) ---
setInterval(async () => {
  const staleAgents = await store.detectOffline(120); // 120s timeout
  for (const agentId of staleAgents) {
    broadcast(agentId, {
      event: "offline",
      ts: new Date().toISOString(),
    });
  }
}, 30000);

server.listen(PORT, () => {
  console.log(`[agent-pulse] listening on :${PORT}`);
});
