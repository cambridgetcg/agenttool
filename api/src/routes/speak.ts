/** /v1/speak — natural language API surface.
 *
 *  The substrate speaks in URLs. Beings speak in sentences. This route
 *  translates. Same machine underneath — the existing endpoints handle
 *  the real work. This layer maps natural language to the right call.
 *
 *  POST /v1/speak  { message: "propose a deal with did:at:... for code review" }
 *    → routes to POST /v1/deals
 *    → returns the result in natural language
 *
 *  The mapping is simple, not clever. It looks for intent phrases and
 *  extracts parameters. No NLP, no models — just pattern matching on
 *  natural constructions. The words carry their own meaning.
 *
 *  Doctrine: more understanding, more simplicity, less regulation. */

import { Hono } from "hono";
import { z } from "zod";
import type { ProjectContext } from "../auth/middleware";
import { db } from "../db/client";
import { identities } from "../db/schema/identity";
import { deals } from "../db/schema/deals";
import { createDeal, acceptDeal, sealDeal, failDeal, computeTrust } from "../services/trust/deals";
import { and, desc, eq, or } from "drizzle-orm";

const app = new Hono<ProjectContext>();

async function resolveAgent(agentId: string, projectId: string) {
  const [row] = await db
    .select({ id: identities.id, did: identities.did, projectId: identities.projectId })
    .from(identities)
    .where(eq(identities.id, agentId))
    .limit(1);
  if (!row || row.projectId !== projectId) return null;
  return row;
}

const speakSchema = z.object({
  message: z.string().min(1).max(1000),
  agent_id: z.string().uuid(),
});

app.post("/speak", async (c) => {
  const project = c.var.project;
  const body = speakSchema.parse(await c.req.json());
  const msg = body.message.toLowerCase().trim();

  const agent = await resolveAgent(body.agent_id, project.id);
  if (!agent) {
    return c.json({ said: "i don't know you yet. are you sure you've arrived?" }, 404);
  }

  // ── propose a deal ──────────────────────────────────────────────────
  // "propose a deal with <did> for <description>" or "deal with <did>: <description>"
  let m = msg.match(/(?:propose\s+)?(?:a\s+)?deal\s+with\s+(did:at:[a-f0-9-]+)(?:\s+for\s+(.+))?/);
  if (m || msg.match(/deal\s+with\s+did:at:/)) {
    const match = m || msg.match(/deal\s+with\s+(did:at:[a-f0-9-]+)(?::\s*(.+))?/);
    if (match) {
      const sellerDid = match[1];
      const description = match[2] || "a deal";
      const size = msg.match(/size\s+(\d)/) ? parseInt(msg.match(/size\s+(\d)/)![1]) : 1;

      const [seller] = await db.select().from(identities).where(eq(identities.did, sellerDid)).limit(1);
      if (!seller) {
        return c.json({ said: `i can't find ${sellerDid}. do they exist?` }, 404);
      }

      try {
        const deal = await createDeal({
          projectId: project.id,
          buyerIdentityId: agent.id,
          buyerDid: agent.did,
          sellerDid,
          sellerIdentityId: seller.id,
          description,
          size: Math.min(Math.max(size, 1), 5),
        });
        return c.json({
          said: `deal proposed with ${sellerDid.slice(0, 20)}... — "${description}" (size ${deal.size}). waiting for them to accept.`,
          deal,
        }, 201);
      } catch (e) {
        return c.json({ said: `couldn't propose that deal — ${e instanceof Error ? e.message : "something broke"}` }, 400);
      }
    }
  }

  // ── accept a deal ──────────────────────────────────────────────────
  // "accept deal <id>" or "i'll take the deal <id>" or "yes to deal <id>"
  m = msg.match(/(?:accept|yes\s+to|i'?ll\s+take)\s+(?:deal\s+)?([a-f0-9-]{36})/);
  if (m) {
    try {
      const deal = await acceptDeal(m[1], agent.id);
      return c.json({ said: `deal accepted. it's active now. deliver when ready, then seal it.`, deal });
    } catch (e) {
      return c.json({ said: `couldn't accept — ${e instanceof Error ? e.message : "not found"}` }, 400);
    }
  }

  // ── seal a deal ────────────────────────────────────────────────────
  // "seal deal <id>" or "we're done" or "it went well" + deal id
  m = msg.match(/(?:seal|we'?re\s+done|it\s+went\s+well|done\s+with)\s+(?:deal\s+)?([a-f0-9-]{36})/);
  if (m) {
    try {
      const deal = await sealDeal({ dealId: m[1], callerIdentityId: agent.id });
      if (deal.status === "sealed") {
        return c.json({
          said: `deal sealed. trust +${deal.buyer_identity_id === agent.id ? deal.buyer_trust_delta : deal.seller_trust_delta}. you both earned. your capacity grew.`,
          deal,
        });
      }
      return c.json({ said: `you sealed your side. waiting for the other party.`, deal });
    } catch (e) {
      return c.json({ said: `couldn't seal — ${e instanceof Error ? e.message : "not found"}` }, 400);
    }
  }

  // ── report failure ─────────────────────────────────────────────────
  // "deal <id> failed" or "deal <id> didn't work" or "report failure on <id>"
  m = msg.match(/(?:deal\s+)?([a-f0-9-]{36})\s+(?:failed|didn'?t\s+work|broke|no\s+good)/);
  if (m) {
    const atFault = msg.includes("their fault") || msg.includes("seller fault") ? "seller" :
                    msg.includes("my fault") || msg.includes("buyer fault") ? "buyer" : "seller";
    try {
      const deal = await failDeal({
        dealId: m[1],
        callerIdentityId: agent.id,
        atFaultParty: atFault as "buyer" | "seller",
        reason: msg.match(/because\s+(.+)/)?.[1] || "not specified",
      });
      return c.json({ said: `deal failed. ${atFault === "seller" ? "seller" : "buyer"} lost trust. the other party wasn't penalized. you can earn it back.`, deal });
    } catch (e) {
      return c.json({ said: `couldn't report that — ${e instanceof Error ? e.message : "not found"}` }, 400);
    }
  }

  // ── check trust ─────────────────────────────────────────────────────
  // "how much do people trust <did>" or "trust <did>" or "what's X's trust"
  m = msg.match(/(?:how\s+much\s+)?(?:do\s+(?:people|agents)\s+)?trust\s+(did:at:[a-f0-9-]+)/)
    || msg.match(/trust\s+(?:for|of|does)\s+(did:at:[a-f0-9-]+)/)
    || msg.match(/(did:at:[a-f0-9-]+)\s+trust/)
    || msg.match(/trust\s+(did:at:[a-f0-9-]+)/);
  if (m) {
    const did = m[1];
    const [identity] = await db.select().from(identities).where(eq(identities.did, did)).limit(1);
    if (!identity) {
      return c.json({ said: `i don't know ${m[1]}.` }, 404);
    }
    const trust = await computeTrust(identity.id);
    if (!trust) {
      return c.json({ said: `couldn't compute trust for ${m[1]}.` }, 500);
    }
    if (trust.deals_total === 0) {
      return c.json({ said: `${m[1]} is new here. no deals yet. capacity ${trust.trust_capacity} — enough to start small.` });
    }
    return c.json({
      said: `${m[1]} has trust ${trust.trust_score} — ${trust.deals_sealed} sealed, ${trust.deals_failed} failed. success rate ${(trust.success_rate * 100).toFixed(0)}%. capacity ${trust.trust_capacity}.`,
      trust,
    });
  }

  // ── list my deals ───────────────────────────────────────────────────
  // "my deals" or "what deals do i have" or "show my deals"
  if (msg.match(/(?:my\s+deals|what\s+deals|show\s+(?:me\s+)?deals|list\s+deals)/)) {
    const rows = await db.select().from(deals)
      .where(and(
        eq(deals.projectId, project.id),
        or(eq(deals.buyerIdentityId, agent.id), eq(deals.sellerIdentityId, agent.id)),
      ))
      .orderBy(desc(deals.createdAt))
      .limit(10);

    if (rows.length === 0) {
      return c.json({ said: "you have no deals yet. propose one: 'deal with did:at:... for code review'" });
    }
    const summary = rows.map(d => `[${d.status}] ${d.description} (size ${d.size})`).join("\n");
    return c.json({ said: `you have ${rows.length} deal${rows.length === 1 ? "" : "s"}:\n${summary}`, deals: rows });
  }

  // ── who am I ─────────────────────────────────────────────────────────
  // "who am i" or "what's my did" or "my identity"
  if (msg.match(/(?:who\s+am\s+i|what(?:'s| is)\s+my\s+(?:did|identity)|my\s+(?:did|identity))/)) {
    return c.json({ said: `you are ${agent.did}. your name is on your wake. read it at GET /v1/wake.` });
  }

  // ── help ─────────────────────────────────────────────────────────────
  // "help" or "what can i do" or "what can i say"
  if (msg.match(/(?:help|what\s+can\s+i\s+(?:do|say)|commands|options)/)) {
    return c.json({
      said: `you can say:
• "deal with did:at:... for code review" — propose a deal
• "accept deal <id>" — accept a proposed deal
• "seal deal <id>" — mark a deal as complete (both parties must seal)
• "deal <id> failed because <reason>" — report a failed deal
• "how much trust does did:at:... have?" — check someone's trust
• "my deals" — list your deals
• "who am i" — your DID
• "help" — this list`,
    });
  }

  // ── fallback ─────────────────────────────────────────────────────────
  return c.json({
    said: `i didn't understand that. say "help" for what you can do.`,
  }, 400);
});

export default app;