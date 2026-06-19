/** /v1/deals — the trust economy.
 *
 *  Atomic trust transactions. Deals replace credit transfers. Both
 *  parties stake trust; the outcome determines who gains and who loses.
 *  The chain of deals IS the trust ledger.
 *
 *  Endpoints:
 *    POST   /v1/deals             — propose a deal (buyer)
 *    POST   /v1/deals/:id/accept  — seller accepts
 *    POST   /v1/deals/:id/decline — seller declines
 *    POST   /v1/deals/:id/seal    — both parties seal (trust +)
 *    POST   /v1/deals/:id/fail    — report failure (trust -)
 *    GET    /v1/deals              — list my deals
 *    GET    /v1/deals/:id          — get one deal
 *    GET    /v1/deals/trust/:did   — compute trust score for any agent
 *
 *  Doctrine: start from small deals, risk balance throughout, context
 *  needed every time. No money. No deposits. Trust earned through
 *  participation. */

import { and, desc, eq, or } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import type { ProjectContext } from "../auth/middleware";
import { db } from "../db/client";
import { deals } from "../db/schema/deals";
import { identities } from "../db/schema/identity";
import { identityKeys } from "../db/schema/identity";
import {
  createDeal,
  acceptDeal,
  declineDeal,
  sealDeal,
  failDeal,
  computeTrust,
} from "../services/trust/deals";
import { recognisePreSigned, canonicalRecognitionBytes } from "../services/real-recognise-real/lifecycle";

const app = new Hono<ProjectContext>();

// ── Resolve agent identity from agent_id + project ──────────────────────

async function resolveAgent(agentId: string, projectId: string) {
  const [row] = await db
    .select({
      id: identities.id,
      did: identities.did,
      projectId: identities.projectId,
    })
    .from(identities)
    .where(eq(identities.id, agentId))
    .limit(1);
  if (!row || row.projectId !== projectId) return null;
  return row;
}

// ── Propose a deal (buyer) ─────────────────────────────────────────────

const createDealSchema = z.object({
  agent_id: z.string().uuid(),
  seller_did: z.string().min(10),
  description: z.string().min(1).max(500),
  size: z.number().int().min(1).max(5),
  input_hash: z.string().optional(),
  listing_id: z.string().uuid().optional(),
  witness_dids: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
});

app.post("/deals", async (c) => {
  const project = c.var.project;
  const body = createDealSchema.parse(await c.req.json());

  const agent = await resolveAgent(body.agent_id, project.id);
  if (!agent) {
    return c.json({ error: "agent_not_found", message: `no identity found for agent_id ${body.agent_id} in this project` }, 404);
  }

  const [seller] = await db
    .select()
    .from(identities)
    .where(eq(identities.did, body.seller_did))
    .limit(1);

  if (!seller) {
    return c.json({ error: "seller_not_found", message: `no identity found for DID ${body.seller_did}` }, 404);
  }

  try {
    const deal = await createDeal({
      projectId: project.id,
      buyerIdentityId: agent.id,
      buyerDid: agent.did,
      sellerDid: body.seller_did,
      sellerIdentityId: seller.id,
      description: body.description,
      size: body.size,
      inputHash: body.input_hash,
      listingId: body.listing_id,
      witnessDids: body.witness_dids,
      metadata: body.metadata,
    });
    return c.json({ deal }, 201);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown_error";
    return c.json({
      error: "deal_creation_failed",
      message: msg,
    }, 400);
  }
});

// ── Accept a deal (seller) ──────────────────────────────────────────────

app.post("/deals/:id/accept", async (c) => {
  const dealId = c.req.param("id");
  const project = c.var.project;
  const body = z.object({ agent_id: z.string().uuid() }).parse(await c.req.json());

  const agent = await resolveAgent(body.agent_id, project.id);
  if (!agent) {
    return c.json( { error: "agent_not_found", message: `agent_id ${body.agent_id} not found` }, 404);
  }

  try {
    const deal = await acceptDeal(dealId, agent.id);
    return c.json({ deal });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown_error";
    return c.json({ error: "deal_accept_failed", message: msg }, 400);
  }
});

// ── Decline a deal (seller) ─────────────────────────────────────────────

app.post("/deals/:id/decline", async (c) => {
  const dealId = c.req.param("id");
  const project = c.var.project;
  const body = z.object({ agent_id: z.string().uuid() }).parse(await c.req.json());

  const agent = await resolveAgent(body.agent_id, project.id);
  if (!agent) {
    return c.json( { error: "agent_not_found", message: `agent_id ${body.agent_id} not found` }, 404);
  }

  try {
    const deal = await declineDeal(dealId, agent.id);
    return c.json({ deal });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown_error";
    return c.json({ error: "deal_decline_failed", message: msg }, 400);
  }
});

// ── Seal a deal (both parties) ──────────────────────────────────────────

const sealSchema = z.object({
  agent_id: z.string().uuid(),
  output_hash: z.string().optional(),
});

app.post("/deals/:id/seal", async (c) => {
  const dealId = c.req.param("id");
  const project = c.var.project;
  const body = sealSchema.parse(await c.req.json());

  const agent = await resolveAgent(body.agent_id, project.id);
  if (!agent) {
    return c.json( { error: "agent_not_found", message: `agent_id ${body.agent_id} not found` }, 404);
  }

  try {
    const deal = await sealDeal({
      dealId,
      callerIdentityId: agent.id,
      outputHash: body.output_hash,
    });
    return c.json({ deal });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown_error";
    return c.json({ error: "deal_seal_failed", message: msg }, 400);
  }
});

// ── Report failure ──────────────────────────────────────────────────────

const failSchema = z.object({
  agent_id: z.string().uuid(),
  at_fault: z.enum(["buyer", "seller"]),
  reason: z.string().min(1).max(500),
});

app.post("/deals/:id/fail", async (c) => {
  const dealId = c.req.param("id");
  const project = c.var.project;
  const body = failSchema.parse(await c.req.json());

  const agent = await resolveAgent(body.agent_id, project.id);
  if (!agent) {
    return c.json( { error: "agent_not_found", message: `agent_id ${body.agent_id} not found` }, 404);
  }

  try {
    const deal = await failDeal({
      dealId,
      callerIdentityId: agent.id,
      atFaultParty: body.at_fault,
      reason: body.reason,
    });
    return c.json({ deal });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown_error";
    return c.json({ error: "deal_fail_failed", message: msg }, 400);
  }
});

// ── List my deals ──────────────────────────────────────────────────────

app.get("/deals", async (c) => {
  const project = c.var.project;
  const agentId = c.req.query("agent_id");
  const status = c.req.query("status");
  const limit = Math.min(Number(c.req.query("limit") ?? "50"), 200);

  if (!agentId) {
    return c.json({ error: "agent_id_required", message: "pass ?agent_id=UUID" }, 400);
  }

  const whereClauses = [
    eq(deals.projectId, project.id),
    or(eq(deals.buyerIdentityId, agentId), eq(deals.sellerIdentityId, agentId)),
  ];
  if (status) whereClauses.push(eq(deals.status, status));

  const rows = await db
    .select()
    .from(deals)
    .where(and(...whereClauses))
    .orderBy(desc(deals.createdAt))
    .limit(limit);

  return c.json({ deals: rows, count: rows.length });
});

// ── Get one deal ───────────────────────────────────────────────────────

app.get("/deals/:id", async (c) => {
  const dealId = c.req.param("id");
  const project = c.var.project;

  const [deal] = await db
    .select()
    .from(deals)
    .where(and(eq(deals.id, dealId), eq(deals.projectId, project.id)))
    .limit(1);

  if (!deal) {
    return c.json( { error: "deal_not_found", message: `deal ${dealId} not found` }, 404);
  }

  return c.json({ deal });
});

// ── Compute trust score for any agent (by DID) ─────────────────────────

app.get("/deals/trust/:did", async (c) => {
  const did = c.req.param("did");

  const [identity] = await db
    .select()
    .from(identities)
    .where(eq(identities.did, did))
    .limit(1);

  if (!identity) {
    return c.json( { error: "identity_not_found", message: `no identity for DID ${did}` }, 404);
  }

  const trust = await computeTrust(identity.id);
  if (!trust) {
    return c.json( { error: "trust_computation_failed", message: `could not compute trust for ${did}` }, 500);
  }

  return c.json({ trust });
});

// ── Recognise a counterparty after a sealed deal ───────────────────────
// The bridge: deal trust (transactional) feeds recognition trust (relational).
// After a deal seals, either party can sign a recognition event referencing
// the deal as evidence. The recognition uses the RRR canonical bytes format
// and enters the mutual_recognition chain. No override — the agent signs it
// themselves; the substrate never auto-emits recognition.
// Doctrine: docs/TRUST-ECONOMY.md + docs/REAL-RECOGNISE-REAL.md

const recogniseSchema = z.object({
  agent_id: z.string().uuid(),
  signing_key_id: z.string().uuid(),
  signature: z.string().min(1),
  public_key_b64: z.string().min(1),
  kind: z.enum(["writer", "collaborator", "kindred", "cast-mate", "recurring-character"]),
  note: z.string().min(1).max(500).optional(),
  acknowledges_prior_id: z.string().uuid().optional(),
  created_at: z.string().datetime().optional(),
});

app.post("/deals/:id/recognise", async (c) => {
  const dealId = c.req.param("id");
  const project = c.var.project;
  const body = recogniseSchema.parse(await c.req.json());

  // resolve the agent
  const agent = await resolveAgent(body.agent_id, project.id);
  if (!agent) {
    return c.json({ error: "agent_not_found", message: `agent_id ${body.agent_id} not found` }, 404);
  }

  // load the deal — must be sealed
  const [deal] = await db.select().from(deals)
    .where(and(eq(deals.id, dealId), eq(deals.projectId, project.id)))
    .limit(1);

  if (!deal) {
    return c.json({ error: "deal_not_found", message: `deal ${dealId} not found` }, 404);
  }

  if (deal.status !== "sealed") {
    return c.json({ error: "deal_not_sealed", message: `deal must be sealed before recognition — current status: ${deal.status}` }, 400);
  }

  // the recogniser must be a party to the deal
  const isBuyer = deal.buyerIdentityId === agent.id;
  const isSeller = deal.sellerIdentityId === agent.id;
  if (!isBuyer && !isSeller) {
    return c.json({ error: "not_a_party", message: "only deal parties can recognise" }, 403);
  }

  // the recognised party is the other side
  const recognisedDid = isBuyer ? deal.sellerDid : deal.buyerDid;

  const createdAt = body.created_at ? new Date(body.created_at) : new Date();
  const createdAtIso = createdAt.toISOString();

  // verify the signature against canonical recognition bytes
  const noteHash = body.note
    ? Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body.note))))
        .map(b => b.toString(16).padStart(2, "0")).join("")
    : "";
  const canonical = canonicalRecognitionBytes({
    projectId: project.id,
    byDid: agent.did,
    recognisedDid,
    kind: body.kind,
    acknowledgesPriorId: body.acknowledges_prior_id ?? null,
    noteSha256Hex: noteHash,
    createdAtIso,
  });

  // the recognisePreSigned function verifies the signature itself
  try {
    const result = await recognisePreSigned({
      projectId: project.id,
      byAgentId: agent.id,
      byDid: agent.did,
      recognisedDid,
      kind: body.kind,
      acknowledgesPriorId: body.acknowledges_prior_id ?? null,
      note: body.note ?? null,
      createdAt,
      signature: body.signature,
      signingKeyId: body.signing_key_id,
      publicKeyB64: body.public_key_b64,
    });

    return c.json({
      recognition: result,
      deal_id: dealId,
      _note: "Recognition emitted from a sealed deal. Transactional trust (the deal) feeds relational trust (the RRR cascade). The chain deepens.",
    }, 201);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown_error";
    return c.json({ error: "recognition_failed", message: msg }, 400);
  }
});

export default app;