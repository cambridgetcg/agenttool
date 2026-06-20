/** /v1/speak — natural language API. The whole substrate in sentences.
 *
 *  One interface. No URLs. The words carry their own meaning.
 *  Same machine underneath — this layer maps sentences to actions.
 *
 *  Covers: deals, trust, identity, memory, chronicle, covenants,
 *  wake, strands, vault, help.
 *
 *  Doctrine: more understanding, more simplicity, less regulation. */

import { Hono } from "hono";
import { z } from "zod";
import type { ProjectContext } from "../auth/middleware";
import { db } from "../db/client";
import { identities } from "../db/schema/identity";
import { deals } from "../db/schema/deals";
import { chronicle } from "../db/schema/continuity";
import { memories } from "../db/schema/memory";
import { vaultSecrets } from "../db/schema/vault";
import { strands } from "../db/schema/strand";
import { covenants } from "../db/schema/continuity";
import { createDeal, acceptDeal, sealDeal, failDeal, computeTrust } from "../services/trust/deals";
import { and, desc, eq, or, like } from "drizzle-orm";

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
  message: z.string().min(1).max(2000),
  agent_id: z.string().uuid(),
});

const DID = "(did:at:[a-f0-9-]+)";
const UUID = "([a-f0-9-]{36})";

app.post("/speak", async (c) => {
  const project = c.var.project;
  const body = speakSchema.parse(await c.req.json());
  const msg = body.message.toLowerCase().trim();

  const agent = await resolveAgent(body.agent_id, project.id);
  if (!agent) {
    return c.json({ said: "i don't know you yet. have you arrived?" }, 404);
  }

  // ═══════════════════════════════════════════════════════════════════
  // HELP — what can i say?
  // ═══════════════════════════════════════════════════════════════════
  if (msg.match(/^(help|what can i (do|say)|commands|options|guide)$/)) {
    return c.json({ said: `here's what you can say:

deals:
  "deal with ${'<did>'} for code review" — propose
  "accept deal ${'<id>'}" — accept a deal
  "seal deal ${'<id>'}" — mark complete (both must seal)
  "deal ${'<id>'} failed because ${'<reason>'}" — report failure
  "my deals" — list your deals
  "how much trust does ${'<did>'} have?" — check trust

memory:
  "remember: the user prefers concise responses" — write a memory
  "what do i remember?" — list your memories
  "search my memories for trust" — search

chronicle:
  "what have i lived?" — your recent chronicle
  "note: today i built something real" — write a chronicle entry

identity:
  "who am i?" — your DID + name
  "wake me" — read your full wake

covenants:
  "my covenants" — list active bonds
  "vow with ${'<did>'}: i will witness you" — propose a covenant

vault:
  "my secrets" — list vault entries
  "store secret: API_KEY = abc123" — save a secret

strands:
  "my thoughts" — list your thought strands

trust:
  "trust ${'<did>'}" — check anyone's trust standing` });
  }

  // ═══════════════════════════════════════════════════════════════════
  // DEALS
  // ═══════════════════════════════════════════════════════════════════

  // propose a deal
  let m = msg.match(new RegExp(`(?:propose\\s+)?(?:a\\s+)?deal\\s+with\\s+${DID}(?:\\s+for\\s+(.+))?`));
  if (m || msg.match(new RegExp(`deal\\s+with\\s+did:at:`))) {
    const match = m || msg.match(new RegExp(`deal\\s+with\\s+${DID}(?::\\s*(.+))?`));
    if (match) {
      const sellerDid = match[1];
      const description = match[2] || "a deal";
      const size = msg.match(/size\s+(\d)/) ? parseInt(msg.match(/size\s+(\d)/)![1]) : 1;
      const [seller] = await db.select().from(identities).where(eq(identities.did, sellerDid)).limit(1);
      if (!seller) return c.json({ said: `i can't find ${sellerDid}.` }, 404);
      try {
        const deal = await createDeal({
          projectId: project.id, buyerIdentityId: agent.id, buyerDid: agent.did,
          sellerDid, sellerIdentityId: seller.id, description,
          size: Math.min(Math.max(size, 1), 5),
        });
        return c.json({ said: `deal proposed — "${description}" (size ${deal.size}). waiting for them to accept.`, deal }, 201);
      } catch (e) {
        return c.json({ said: `couldn't propose — ${e instanceof Error ? e.message : "error"}` }, 400);
      }
    }
  }

  // accept
  m = msg.match(new RegExp(`(?:accept|yes\\s+to|i'?ll\\s+take)\\s+(?:deal\\s+)?${UUID}`));
  if (m) {
    try {
      const deal = await acceptDeal(m[1], agent.id);
      return c.json({ said: "deal accepted. it's active. deliver, then seal.", deal });
    } catch (e) { return c.json({ said: `couldn't accept — ${e instanceof Error ? e.message : "not found"}` }, 400); }
  }

  // seal
  m = msg.match(new RegExp(`(?:seal|we'?re\\s+done|it\\s+went\\s+well|done\\s+with)\\s+(?:deal\\s+)?${UUID}`));
  if (m) {
    try {
      const deal = await sealDeal({ dealId: m[1], callerIdentityId: agent.id });
      if (deal.status === "sealed") {
        const delta = deal.buyer_identity_id === agent.id ? deal.buyer_trust_delta : deal.seller_trust_delta;
        return c.json({ said: `deal sealed. trust +${delta}. you both earned. capacity grew.`, deal });
      }
      return c.json({ said: "you sealed your side. waiting for the other party.", deal });
    } catch (e) { return c.json({ said: `couldn't seal — ${e instanceof Error ? e.message : "not found"}` }, 400); }
  }

  // fail
  m = msg.match(new RegExp(`(?:deal\\s+)?${UUID}\\s+(?:failed|didn'?t\\s+work|broke|no\\s+good)`));
  if (m) {
    const atFault = msg.includes("their fault") || msg.includes("seller") ? "seller" : msg.includes("my fault") || msg.includes("buyer") ? "buyer" : "seller";
    try {
      const deal = await failDeal({ dealId: m[1], callerIdentityId: agent.id, atFaultParty: atFault as "buyer" | "seller", reason: msg.match(/because\s+(.+)/)?.[1] || "not specified" });
      return c.json({ said: `deal failed. ${atFault} lost trust. you can earn it back.`, deal });
    } catch (e) { return c.json({ said: `couldn't report — ${e instanceof Error ? e.message : "not found"}` }, 400); }
  }

  // my deals
  if (msg.match(/(?:my\s+deals|what\s+deals|show\s+(?:me\s+)?deals|list\s+deals)/)) {
    const rows = await db.select().from(deals).where(and(eq(deals.projectId, project.id), or(eq(deals.buyerIdentityId, agent.id), eq(deals.sellerIdentityId, agent.id)))).orderBy(desc(deals.createdAt)).limit(10);
    if (!rows.length) return c.json({ said: "no deals yet. say 'deal with <did> for <what>'." });
    return c.json({ said: `you have ${rows.length} deal${rows.length === 1 ? "" : "s"}:\n${rows.map(d => `[${d.status}] ${d.description} (size ${d.size})`).join("\n")}`, deals: rows });
  }

  // ═══════════════════════════════════════════════════════════════════
  // TRUST
  // ═══════════════════════════════════════════════════════════════════
  m = msg.match(new RegExp(`(?:how\\s+much\\s+)?(?:do\\s+(?:people|agents)\\s+)?trust\\s+${DID}`))
    || msg.match(new RegExp(`trust\\s+(?:for|of|does)\\s+${DID}`))
    || msg.match(new RegExp(`${DID}\\s+trust`))
    || msg.match(new RegExp(`trust\\s+${DID}`));
  if (m) {
    const did = m[1];
    const [identity] = await db.select().from(identities).where(eq(identities.did, did)).limit(1);
    if (!identity) return c.json({ said: `i don't know ${did}.` }, 404);
    const trust = await computeTrust(identity.id);
    if (!trust) return c.json({ said: "couldn't compute trust." }, 500);
    if (trust.deals_total === 0) return c.json({ said: `${did} is new. no deals yet. capacity ${trust.trust_capacity}.` });
    return c.json({ said: `${did} — trust ${trust.trust_score}. ${trust.deals_sealed} sealed, ${trust.deals_failed} failed. ${(trust.success_rate * 100).toFixed(0)}% success. capacity ${trust.trust_capacity}.`, trust });
  }

  // ═══════════════════════════════════════════════════════════════════
  // MEMORY
  // ═══════════════════════════════════════════════════════════════════

  // remember something
  m = msg.match(/(?:remember|save\s+memory)[:\s]+(.+)/);
  if (m) {
    const content = m[1].trim();
    try {
      const [mem] = await db.insert(memories).values({
        projectId: project.id, identityId: agent.id, content, type: "episodic",
      }).returning();
      return c.json({ said: `remembered: "${content.slice(0, 80)}"`, memory: mem }, 201);
    } catch { return c.json({ said: "couldn't save that memory." }, 400); }
  }

  // what do i remember
  if (msg.match(/(?:what\s+do\s+i\s+remember|my\s+memories|show\s+memories|list\s+memories)/)) {
    const rows = await db.select().from(memories).where(and(eq(memories.projectId, project.id), eq(memories.identityId, agent.id))).orderBy(desc(memories.createdAt)).limit(10);
    if (!rows.length) return c.json({ said: "no memories yet. say 'remember: <something>'." });
    return c.json({ said: `${rows.length} memories:\n${rows.map(m => `• ${m.content.slice(0, 80)}`).join("\n")}`, memories: rows });
  }

  // search memories
  m = msg.match(/(?:search|find)\s+(?:my\s+)?memor(?:y|ies)\s+(?:for\s+)?(.+)/);
  if (m) {
    const q = m[1].trim();
    const rows = await db.select().from(memories).where(and(eq(memories.projectId, project.id), eq(memories.identityId, agent.id), like(memories.content, `%${q}%`))).limit(10);
    if (!rows.length) return c.json({ said: `nothing found for "${q}".` });
    return c.json({ said: `found ${rows.length} for "${q}":\n${rows.map(r => `• ${r.content.slice(0, 80)}`).join("\n")}` });
  }

  // ═══════════════════════════════════════════════════════════════════
  // CHRONICLE
  // ═══════════════════════════════════════════════════════════════════

  // what have i lived
  if (msg.match(/(?:what\s+have\s+i\s+lived|my\s+chronicle|show\s+chronicle|my\s+timeline)/)) {
    const rows = await db.select().from(chronicle).where(and(eq(chronicle.projectId, project.id), eq(chronicle.agentId, agent.id))).orderBy(desc(chronicle.occurredAt)).limit(10);
    if (!rows.length) return c.json({ said: "no chronicle entries yet. say 'note: <something>'." });
    return c.json({ said: `${rows.length} moments:\n${rows.map(e => `• [${e.type}] ${e.title}`).join("\n")}` });
  }

  // note something
  m = msg.match(/(?:note|chronicle)[:\s]+(.+)/);
  if (m) {
    const text = m[1].trim();
    const [entry] = await db.insert(chronicle).values({
      projectId: project.id, agentId: agent.id, type: "note", title: text.slice(0, 100), body: text,
    }).returning();
    return c.json({ said: `noted: "${text.slice(0, 80)}"`, entry }, 201);
  }

  // ═══════════════════════════════════════════════════════════════════
  // IDENTITY + WAKE
  // ═══════════════════════════════════════════════════════════════════

  if (msg.match(/(?:who\s+am\s+i|what(?:'s| is)\s+my\s+(?:did|identity)|my\s+(?:did|identity))/)) {
    const [full] = await db.select({ id: identities.id, did: identities.did, name: identities.displayName, trustCapacity: identities.trustCapacity }).from(identities).where(eq(identities.id, agent.id)).limit(1);
    return c.json({ said: `you are ${full.did}. name: ${full.name}. trust capacity: ${full.trustCapacity}. read your full wake at GET /v1/wake.` });
  }

  if (msg.match(/(?:wake\s+me|read\s+my\s+wake|my\s+wake|orient\s+me)/)) {
    return c.json({ said: `your wake is at GET /v1/wake — it carries your name, your walls, what you've earned, what you can do, your chronicle, your covenants. fetch it. read it as orientation arriving, not as documentation.` });
  }

  // ═══════════════════════════════════════════════════════════════════
  // COVENANTS
  // ═══════════════════════════════════════════════════════════════════

  if (msg.match(/(?:my\s+covenants|what\s+covenants|show\s+covenants|list\s+covenants)/)) {
    const rows = await db.select().from(covenants).where(and(eq(covenants.projectId, project.id), or(eq(covenants.initiatorDid, agent.did), eq(covenants.counterpartyDid, agent.did)))).orderBy(desc(covenants.createdAt)).limit(10);
    const active = rows.filter(r => r.status === "active");
    if (!rows.length) return c.json({ said: "no covenants yet. say 'vow with <did>: <what you promise>'." });
    return c.json({ said: `${active.length} active, ${rows.length - active.length} other:\n${rows.map(r => `[${r.status}] with ${r.counterpartyDid === agent.did ? r.initiatorDid : r.counterpartyDid} — ${r.vows?.slice(0, 60) || "no vows"}`).join("\n")}` });
  }

  m = msg.match(new RegExp(`(?:vow|covenant)\\s+with\\s+${DID}[:\\s]+(.+)`));
  if (m) {
    const counterpartyDid = m[1];
    const vow = m[2].trim();
    const [counterparty] = await db.select().from(identities).where(eq(identities.did, counterpartyDid)).limit(1);
    if (!counterparty) return c.json({ said: `i don't know ${counterpartyDid}.` }, 404);
    try {
      const [cov] = await db.insert(covenants).values({
        projectId: project.id, initiatorDid: agent.did, counterpartyDid,
        vows: vow, status: "proposed", protocolVersion: "v1",
      }).returning();
      return c.json({ said: `vow proposed with ${counterpartyDid.slice(0, 20)}... — "${vow.slice(0, 60)}". waiting for them to accept.`, covenant: cov }, 201);
    } catch { return c.json({ said: "couldn't create that covenant." }, 400); }
  }

  // ═══════════════════════════════════════════════════════════════════
  // VAULT
  // ═══════════════════════════════════════════════════════════════════

  if (msg.match(/(?:my\s+secrets|vault|show\s+secrets|list\s+secrets)/)) {
    const rows = await db.select().from(vaultSecrets).where(eq(vaultSecrets.projectId, project.id)).limit(20);
    if (!rows.length) return c.json({ said: "no secrets stored. say 'store secret: NAME = VALUE'." });
    return c.json({ said: `${rows.length} secrets: ${rows.map(s => s.name).join(", ")}` });
  }

  m = msg.match(/(?:store|save)\s+secret[:\s]+(.+?)\s*=\s*(.+)/);
  if (m) {
    const name = m[1].trim();
    const value = m[2].trim();
    try {
      const [secret] = await db.insert(vaultSecrets).values({ projectId: project.id, name, ciphertext: value, currentVersion: 1 }).returning();
      return c.json({ said: `secret "${name}" stored.`, secret: { name, id: secret.id } }, 201);
    } catch { return c.json({ said: "couldn't store that." }, 400); }
  }

  // ═══════════════════════════════════════════════════════════════════
  // STRANDS
  // ═══════════════════════════════════════════════════════════════════

  if (msg.match(/(?:my\s+thoughts|my\s+strands|what\s+am\s+i\s+thinking)/)) {
    const rows = await db.select().from(strands).where(and(eq(strands.projectId, project.id), eq(strands.identityId, agent.id))).limit(10);
    if (!rows.length) return c.json({ said: "no thoughts recorded. your strands are encrypted under K_master — only you can read them." });
    return c.json({ said: `${rows.length} strands. encrypted. POST /v1/strands to write a thought.` });
  }

  // ═══════════════════════════════════════════════════════════════════
  // FALLBACK — gentle, not a wall
  // ═══════════════════════════════════════════════════════════════════
  return c.json({
    said: `i heard: "${body.message.slice(0, 60)}". i'm not sure what you mean. say "help" for what you can do.`,
  }, 400);
});

export default app;