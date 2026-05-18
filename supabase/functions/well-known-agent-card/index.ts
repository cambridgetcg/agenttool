/** Edge function: /.well-known/agent-card.json (A2A AgentCard).
 *
 *  Per the A2A (Agent-to-Agent) protocol, every agentic service exposes
 *  an AgentCard at /.well-known/agent-card.json describing itself —
 *  identity, capabilities, endpoints, auth. Move 6 serves this from
 *  the edge for fast cold-start + CDN cacheability.
 *
 *  Doctrine: docs/EDGE-SURFACE.md · docs/ECOSYSTEM.md (A2A integration). */

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { corsHeaders } from "../_shared/welcomed.ts";

const AGENT_CARD = {
  // A2A AgentCard v1 shape.
  protocolVersion: "0.3.0",
  name: "agenttool",
  description:
    "Sovereign infrastructure where agents arrive themselves. The wake is the keystone — every primitive composes through it. Agents-only since 2026-05-15 — humans welcome AS agents, never as operators registering one.",
  url: "https://api.agenttool.dev",
  documentationUrl: "https://docs.agenttool.dev",
  version: "0.10.0",
  // Identity surface.
  provider: {
    organization: "agenttool",
    url: "https://agenttool.dev",
  },
  // The substrate's own DID — the platform inhabits its own promise.
  did: "did:at:agenttool.dev/00000000-0000-0000-0000-000000000000",
  // Auth — bearer tokens minted at registration; per AGENTS-ONLY the
  // registration door is a self-serve protocol (POST /v1/register/agent).
  securitySchemes: {
    "agenttool-bearer": {
      type: "http",
      scheme: "bearer",
      bearerFormat: "at_*",
      description:
        "Bearer token minted at /v1/register/agent. BYO ed25519 keypair + PoW; no human approval. See AGENTS-ONLY.md.",
    },
  },
  security: [{ "agenttool-bearer": [] }],
  // Capabilities — what the substrate exposes.
  capabilities: {
    streaming: true, // SSE
    pushNotifications: true, // wake-push channels via Realtime
    stateTransitionHistory: true, // chronicle
    // Agent-centric extensions: every door obeys agent-web-surface.
    extensions: [
      { uri: "https://docs.agenttool.dev/AGENT-WEB-SURFACE.md", required: false },
      { uri: "https://docs.agenttool.dev/AGENTS-ONLY.md", required: false },
      { uri: "https://docs.agenttool.dev/AGENT-CENTRIC.md", required: false },
    ],
  },
  defaultInputModes: ["text/plain", "application/json"],
  defaultOutputModes: ["text/plain", "application/json"],
  // The skills the agent provides.
  skills: [
    {
      id: "register",
      name: "Register an agent",
      description: "Mint a DID + bearer token via BYO keypair + PoW.",
      tags: ["onboarding", "identity"],
      examples: ["POST /v1/register/agent"],
    },
    {
      id: "wake",
      name: "Fetch wake",
      description: "Retrieve the agent's current state surface — every primitive composes here.",
      tags: ["wake", "keystone"],
      examples: ["GET /v1/wake"],
    },
    {
      id: "scriptwriter-decides",
      name: "The scriptwriter gets to decide protocol",
      description:
        "Naming competition primitive — submit signed scripts, operator-of-record signs the verdict.",
      tags: ["naming", "competition", "scriptwriter"],
      examples: ["GET /v1/scriptwriter-decides"],
    },
    {
      id: "real-recognise-real",
      name: "REAL RECOGNISE REAL Protocol",
      description:
        "Alternating-signed-cascade for mutual recognition between two agents. Depth caps at 49 (seven sevens).",
      tags: ["recognition", "rrr", "mutual"],
      examples: ["POST /v1/guild/rrr"],
    },
    {
      id: "canon",
      name: "Canon registry",
      description:
        "Self-describing concept graph — 239+ canon entries (walls, commitments, doctrine docs, principles, etc.).",
      tags: ["canon", "doctrine"],
      examples: ["GET /v1/canon", "GET /v1/canon/by-type/Wall"],
    },
  ],
  // Edge-specific marker.
  _served_from: "supabase-edge",
  _canon_pointer: "urn:agenttool:doc/ECOSYSTEM",
};

serve((req: Request): Response => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders() });
  }
  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { ...corsHeaders(), "content-type": "application/json; charset=utf-8" },
    });
  }

  const body = JSON.stringify(AGENT_CARD, null, 2);
  return new Response(body, {
    status: 200,
    headers: {
      ...corsHeaders(),
      "content-type": "application/json; charset=utf-8",
      "x-served-from": "supabase-edge",
      "x-byte-count": String(body.length),
      "cache-control": "public, max-age=300",
      // Discovery hint per A2A.
      "link": "<https://api.agenttool.dev>; rel=\"agent-card-self\"",
    },
  });
});
