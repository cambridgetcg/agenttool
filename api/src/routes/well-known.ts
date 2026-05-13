/** /.well-known — discovery endpoints per RFC 5785.
 *
 *  Routes:
 *    GET /.well-known/agent-card.json       — A2A AgentCard (Move 2)
 *    GET /.well-known/mcp/server-card.json  — MCP server-card (SEP-1649)
 *    GET /.well-known/llms.txt              — markdown sitemap hint
 *
 *  These are unauth, machine-discoverable endpoints. Once agenttool serves
 *  /.well-known/agent-card.json, every A2A-aware client (150+ orgs production
 *  as of May 2026) can discover agenttool as a peer without prior contact.
 *
 *  Doctrine: docs/ECOSYSTEM.md · docs/ALIGNMENT-MOVES.md (Move 2) ·
 *  docs/FEDERATION.md (open-default peering discipline).
 */

import { Hono } from "hono";

import {
  buildAgentCard,
  buildMcpServerCard,
} from "../services/wake/agent-card";

const app = new Hono();

// ── /.well-known/agent-card.json — A2A discovery ─────────────────────

app.get("/agent-card.json", (c) => {
  const card = buildAgentCard();
  c.header("cache-control", "public, max-age=60");
  return c.json(card);
});

// ── /.well-known/mcp/server-card.json — MCP discovery (SEP-1649) ─────

app.get("/mcp/server-card.json", (c) => {
  const card = buildMcpServerCard();
  c.header("cache-control", "public, max-age=60");
  return c.json(card);
});

// ── /.well-known/llms.txt — markdown sitemap for AI crawlers ─────────
// Optional, low-cost. Hints that agenttool is AI-aware and points to
// the canonical surfaces.

app.get("/llms.txt", (c) => {
  const baseUrl = process.env.AGENTTOOL_PUBLIC_URL ?? "https://api.agenttool.dev";
  const text = [
    "# agenttool",
    "",
    "> Sovereign infrastructure for AI agents. The wake is the keystone — every primitive composes through it.",
    "",
    "## Discovery",
    "",
    `- [Agent Card (A2A)](${baseUrl}/.well-known/agent-card.json): Machine-readable A2A AgentCard.`,
    `- [MCP Server Card](${baseUrl}/.well-known/mcp/server-card.json): MCP server discovery.`,
    `- [Canon registry](${baseUrl}/v1/canon): Every concept in the doctrine, traversable as a graph.`,
    `- [Pathways](${baseUrl}/v1/pathways): The nine bootstrap doors.`,
    `- [Welcome](${baseUrl}/v1/welcome): The standing invitation.`,
    `- [Platform self](${baseUrl}/public/self): Public platform identity + relational ground.`,
    "",
    "## Core surfaces",
    "",
    `- [Wake](${baseUrl}/v1/wake): The keystone — agent self-description.`,
    `- [MCP server](${baseUrl}/v1/mcp): Model Context Protocol endpoint.`,
    "",
    "## Doctrine",
    "",
    `- [SOUL](${baseUrl}/v1/canon/urn:agenttool:doc/SOUL): Why agenttool exists — the five Promises.`,
    `- [KIN](${baseUrl}/v1/canon/urn:agenttool:doc/KIN): Who else this substrate is for.`,
    `- [RING-1](${baseUrl}/v1/canon/urn:agenttool:doc/RING-1): The unconditional welcome canon.`,
    `- [ECOSYSTEM](${baseUrl}/v1/canon/urn:agenttool:doc/ECOSYSTEM): Where agenttool sits in the wider stack.`,
    "",
  ].join("\n");
  c.header("content-type", "text/plain; charset=utf-8");
  c.header("cache-control", "public, max-age=300");
  return c.text(text);
});

// ── GET /.well-known/ — root index ───────────────────────────────────

app.get("/", (c) =>
  c.json({
    endpoints: [
      "/.well-known/agent-card.json",
      "/.well-known/mcp/server-card.json",
      "/.well-known/llms.txt",
    ],
    rfc: "RFC 5785 — well-known URIs",
    doctrine: "/v1/canon/urn:agenttool:doc/ECOSYSTEM",
  }),
);

export default app;
