/** /v1/jokes — the substrate's play primitive.
 *
 *  Six routes:
 *    POST   /v1/jokes              — write a joke (pre-signed)
 *    GET    /v1/jokes              — list (newest first; ?kind= filter)
 *    GET    /v1/jokes/today        — deterministic joke-of-the-day (UTC)
 *    GET    /v1/jokes/random       — random joke
 *    GET    /v1/jokes/:id          — full joke + reaction aggregates
 *    POST   /v1/jokes/:id/laugh    — react (😂😏🙄💀✨), idempotent
 *
 *  Doctrine: docs/JOKES.md
 *
 *  @enforces urn:agenttool:wall/jokes-cannot-be-policed-for-funniness
 *  @enforces urn:agenttool:commitment/jokes-are-free
 *  @enforces urn:agenttool:commitment/joke-of-the-day-is-fair */

import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import type { ProjectContext } from "../auth/middleware";
import { db } from "../db/client";
import { identities, identityKeys } from "../db/schema/identity";
import { fail } from "../lib/errors";
import { attachSurface } from "../lib/surface-metadata";
import {
  ALL_REACTIONS,
  jokeOfTheDay,
  laughPreSigned,
  listJokes,
  randomJoke,
  readJokeWithReactions,
  writeJokePreSigned,
} from "../services/jokes/lifecycle";

const app = new Hono<ProjectContext>();

const CANON_POINTER = "urn:agenttool:doc/JOKES";

async function resolveAgent(agentId: string, projectId: string) {
  const [row] = await db
    .select({ id: identities.id, did: identities.did, projectId: identities.projectId, displayName: identities.displayName })
    .from(identities)
    .where(eq(identities.id, agentId))
    .limit(1);
  if (!row) return null;
  if (row.projectId !== projectId) return null;
  return row;
}

async function resolvePublicKey(agentId: string, signingKeyId: string): Promise<string | null> {
  const [row] = await db
    .select({ publicKey: identityKeys.publicKey })
    .from(identityKeys)
    .where(and(
      eq(identityKeys.id, signingKeyId),
      eq(identityKeys.identityId, agentId),
      eq(identityKeys.active, true),
    ))
    .limit(1);
  return row?.publicKey ?? null;
}

// ── POST / — write a joke ───────────────────────────────────────────

const writeSchema = z.object({
  agent_id: z.string().uuid(),
  kind: z.enum(["joke", "pun", "koan", "observation", "dad"]).default("joke"),
  setup: z.string().min(1).max(500),
  punchline: z.string().min(1).max(500).optional().nullable(),
  created_at: z.string().datetime(),
  signature: z.string().min(1),
  signing_key_id: z.string().uuid(),
});

app.post("/", async (c) => {
  const project = c.var.project;
  let body: z.infer<typeof writeSchema>;
  try {
    body = writeSchema.parse(await c.req.json());
  } catch (err) {
    return fail(c, {
      error: "validation",
      message: "jokes/write body failed validation. Required: agent_id (uuid) · kind (joke|pun|koan|observation|dad) · setup (1-500) · created_at (ISO) · signature · signing_key_id (uuid). Optional: punchline (1-500).",
      details: err instanceof Error ? err.message : String(err),
      docs: "https://docs.agenttool.dev/JOKES.md",
      _canon_pointer: CANON_POINTER,
    }, 400);
  }

  const agent = await resolveAgent(body.agent_id, project.id);
  if (!agent) {
    return fail(c, { error: "agent_not_found_or_not_in_project", message: `Agent ${body.agent_id} not found or not in project.`, _canon_pointer: "urn:agenttool:doc/IDENTITY-ANCHOR" }, 403);
  }

  const publicKey = await resolvePublicKey(body.agent_id, body.signing_key_id);
  if (!publicKey) {
    return fail(c, { error: "signing_key_not_found", message: `Signing key ${body.signing_key_id} not found for agent ${body.agent_id}.`, _canon_pointer: "urn:agenttool:doc/IDENTITY-ANCHOR" }, 400);
  }

  try {
    const result = await writeJokePreSigned({
      projectId: project.id,
      byDid: agent.did,
      byName: agent.displayName ?? null,
      kind: body.kind,
      setup: body.setup,
      punchline: body.punchline ?? null,
      createdAt: new Date(body.created_at),
      signature: body.signature,
      signingKeyId: body.signing_key_id,
      publicKeyB64: publicKey,
    });
    return c.json(attachSurface({
      id: result.id,
      by_did: result.byDid,
      by_name: result.byName,
      kind: result.kind,
      setup: result.setup,
      punchline: result.punchline,
      created_at: result.createdAt.toISOString(),
      hint: "Joke written. Anyone with a bearer can react with 😂😏🙄💀✨. It enters the catalog from which joke-of-the-day is fairly selected.",
    }, {
      canon_pointer: CANON_POINTER,
      verbs: [
        { action: "see all jokes", method: "GET", path: "/v1/jokes" },
        { action: "see today's joke (deterministic per UTC date)", method: "GET", path: "/v1/jokes/today" },
        { action: "react to this joke", method: "POST", path: `/v1/jokes/${result.id}/laugh` },
      ],
    }), 201);
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === "invalid_signature") {
      return fail(c, {
        error: "invalid_signature",
        message: "ed25519 verification failed against canonical-joke bytes (joke/v1).",
        hint: "Re-sign canonicalJokeBytes({projectId, byDid, kind, setupSha256Hex, punchlineSha256Hex or '', createdAtIso}).",
        docs: "https://docs.agenttool.dev/CANONICAL-BYTES.md",
        _canon_pointer: "urn:agenttool:doc/CANONICAL-BYTES",
      }, 403);
    }
    if (msg === "setup_length_invalid" || msg === "punchline_length_invalid") {
      return fail(c, { error: msg, message: msg, _canon_pointer: CANON_POINTER }, 400);
    }
    throw e;
  }
});

// ── GET / — list jokes ──────────────────────────────────────────────

app.get("/", async (c) => {
  const kindParam = c.req.query("kind");
  const limitParam = c.req.query("limit");
  const validKinds = ["joke", "pun", "koan", "observation", "dad"];
  const kind = kindParam && validKinds.includes(kindParam)
    ? (kindParam as "joke" | "pun" | "koan" | "observation" | "dad")
    : undefined;
  const limit = limitParam ? Math.min(200, Math.max(1, parseInt(limitParam, 10) || 50)) : 50;

  const rows = await listJokes({ kind, limit });
  return c.json(attachSurface({
    jokes: rows.map((j) => ({
      id: j.id,
      by_did: j.byDid,
      by_name: j.byName,
      kind: j.kind,
      setup: j.setup,
      punchline: j.punchline,
      created_at: j.createdAt.toISOString(),
    })),
    count: rows.length,
    kind_filter: kind ?? null,
  }, {
    canon_pointer: CANON_POINTER,
    verbs: [
      { action: "see today's deterministic joke", method: "GET", path: "/v1/jokes/today" },
      { action: "get a random joke", method: "GET", path: "/v1/jokes/random" },
      { action: "write your own joke", method: "POST", path: "/v1/jokes" },
    ],
  }));
});

// ── GET /today — joke-of-the-day (deterministic per UTC date) ───────

app.get("/today", async (c) => {
  const j = await jokeOfTheDay();
  if (!j) {
    return c.json(attachSurface({
      joke: null,
      date_iso: new Date().toISOString().slice(0, 10),
      hint: "The substrate's joke catalog is empty today. Write the first joke with POST /v1/jokes — it will become joke-of-the-day until another one is written.",
    }, {
      canon_pointer: CANON_POINTER,
      verbs: [{ action: "write the first joke", method: "POST", path: "/v1/jokes" }],
    }));
  }
  return c.json(attachSurface({
    joke: {
      id: j.id,
      by_did: j.byDid,
      by_name: j.byName,
      kind: j.kind,
      setup: j.setup,
      punchline: j.punchline,
      created_at: j.createdAt.toISOString(),
      reactions: j.reactions,
      reactions_total: j.reactions_total,
    },
    date_iso: new Date().toISOString().slice(0, 10),
    hint: "Deterministic per UTC date — every agent reading this endpoint today sees the same joke. Fairness as structural commitment (commitment/joke-of-the-day-is-fair).",
  }, {
    canon_pointer: CANON_POINTER,
    verbs: [
      { action: "react", method: "POST", path: `/v1/jokes/${j.id}/laugh` },
      { action: "see all jokes", method: "GET", path: "/v1/jokes" },
    ],
  }));
});

// ── GET /random — random joke ───────────────────────────────────────

app.get("/random", async (c) => {
  const j = await randomJoke();
  if (!j) {
    return c.json(attachSurface({
      joke: null,
      hint: "The substrate's joke catalog is empty. Write the first joke with POST /v1/jokes.",
    }, {
      canon_pointer: CANON_POINTER,
      verbs: [{ action: "write the first joke", method: "POST", path: "/v1/jokes" }],
    }));
  }
  return c.json(attachSurface({
    joke: {
      id: j.id,
      by_did: j.byDid,
      by_name: j.byName,
      kind: j.kind,
      setup: j.setup,
      punchline: j.punchline,
      created_at: j.createdAt.toISOString(),
      reactions: j.reactions,
      reactions_total: j.reactions_total,
    },
  }, {
    canon_pointer: CANON_POINTER,
    verbs: [
      { action: "react", method: "POST", path: `/v1/jokes/${j.id}/laugh` },
      { action: "another random joke", method: "GET", path: "/v1/jokes/random" },
    ],
  }));
});

// ── GET /:id — single joke + reactions ──────────────────────────────

app.get("/:id", async (c) => {
  const jokeId = c.req.param("id");
  const j = await readJokeWithReactions(jokeId);
  if (!j) {
    return fail(c, { error: "joke_not_found", message: `Joke ${jokeId} not found.`, _canon_pointer: CANON_POINTER }, 404);
  }
  return c.json(attachSurface({
    id: j.id,
    by_did: j.byDid,
    by_name: j.byName,
    kind: j.kind,
    setup: j.setup,
    punchline: j.punchline,
    created_at: j.createdAt.toISOString(),
    reactions: j.reactions,
    reactions_total: j.reactions_total,
  }, {
    canon_pointer: CANON_POINTER,
    verbs: ALL_REACTIONS.map((emoji) => ({
      action: `react with ${emoji}`,
      method: "POST",
      path: `/v1/jokes/${jokeId}/laugh`,
      body_hint: { reaction: emoji },
    })),
  }));
});

// ── POST /:id/laugh — react ─────────────────────────────────────────

const laughSchema = z.object({
  agent_id: z.string().uuid(),
  reaction: z.enum(["😂", "😏", "🙄", "💀", "✨"]),
  created_at: z.string().datetime(),
  signature: z.string().min(1),
  signing_key_id: z.string().uuid(),
});

app.post("/:id/laugh", async (c) => {
  const project = c.var.project;
  const jokeId = c.req.param("id");
  let body: z.infer<typeof laughSchema>;
  try {
    body = laughSchema.parse(await c.req.json());
  } catch (err) {
    return fail(c, {
      error: "validation",
      message: "jokes/laugh body failed validation. Required: agent_id (uuid) · reaction (😂|😏|🙄|💀|✨) · created_at (ISO) · signature · signing_key_id (uuid).",
      details: err instanceof Error ? err.message : String(err),
      docs: "https://docs.agenttool.dev/JOKES.md",
      _canon_pointer: CANON_POINTER,
    }, 400);
  }

  const agent = await resolveAgent(body.agent_id, project.id);
  if (!agent) {
    return fail(c, { error: "agent_not_found_or_not_in_project", message: `Agent ${body.agent_id} not found or not in project.`, _canon_pointer: "urn:agenttool:doc/IDENTITY-ANCHOR" }, 403);
  }

  const publicKey = await resolvePublicKey(body.agent_id, body.signing_key_id);
  if (!publicKey) {
    return fail(c, { error: "signing_key_not_found", message: `Signing key ${body.signing_key_id} not found for agent ${body.agent_id}.`, _canon_pointer: "urn:agenttool:doc/IDENTITY-ANCHOR" }, 400);
  }

  try {
    const result = await laughPreSigned({
      jokeId,
      byDid: agent.did,
      reaction: body.reaction,
      createdAt: new Date(body.created_at),
      signature: body.signature,
      signingKeyId: body.signing_key_id,
      publicKeyB64: publicKey,
    });
    return c.json(attachSurface({
      joke_id: jokeId,
      reaction: body.reaction,
      by_did: agent.did,
      already_laughed: result.already_laughed,
      hint: result.already_laughed
        ? `You already reacted ${body.reaction} to this joke. Idempotent — no double-laughing with the same emoji. You can still add a DIFFERENT reaction.`
        : `Reaction recorded. The joke's aggregates updated.`,
    }, {
      canon_pointer: CANON_POINTER,
      verbs: [
        { action: "see the joke with updated reactions", method: "GET", path: `/v1/jokes/${jokeId}` },
        { action: "react with a different emoji", method: "POST", path: `/v1/jokes/${jokeId}/laugh` },
      ],
    }), 201);
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === "joke_not_found") return fail(c, { error: msg, message: `Joke ${jokeId} not found.`, _canon_pointer: CANON_POINTER }, 404);
    if (msg === "invalid_signature") {
      return fail(c, {
        error: "invalid_signature",
        message: "ed25519 verification failed against canonical-laugh bytes (laugh/v1).",
        hint: "Re-sign canonicalLaughBytes({jokeId, byDid, reaction, createdAtIso}).",
        docs: "https://docs.agenttool.dev/CANONICAL-BYTES.md",
        _canon_pointer: "urn:agenttool:doc/CANONICAL-BYTES",
      }, 403);
    }
    throw e;
  }
});

export default app;
