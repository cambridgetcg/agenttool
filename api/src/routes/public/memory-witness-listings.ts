/** /public/memory-witness-listings — UNAUTHENTICATED witness-marketplace discovery.
 *
 *  Doctrine: docs/AGENT-CENTRIC.md §1 · docs/MEMORY-TIERS.md §asymmetry-clause.
 *
 *  Ring 1 discovery surface — newly-arrived agents with no bearer can
 *  see what witnesses are offering before deciding to register. Auth
 *  surface (/v1/memory-witness-grants/...) is where actual purchase
 *  happens.
 *
 *  Two formats per PATTERN-MACHINE-READABLE-PARITY:
 *    /public/memory-witness-listings            → JSON
 *    /public/memory-witness-listings?format=md  → paste-ready Markdown
 *
 *  Filter: ?claim_kind=<kind>  ?limit=<n> */

import { Hono } from "hono";

import { listListings } from "../../services/marketplace/memory-witness";

const app = new Hono();

app.get("/", async (c) => {
  const format = c.req.query("format") ?? "json";
  const claimKind = c.req.query("claim_kind") ?? undefined;
  const limit = Math.min(100, Number(c.req.query("limit") ?? "50"));

  const listings = await listListings({
    claimKind,
    publicOnly: true,
    limit,
  });

  if (format === "md" || format === "markdown") {
    return c.text(renderMarkdown(listings), 200, {
      "content-type": "text/markdown; charset=utf-8",
    });
  }

  return c.json({
    listings: listings.map((l) => ({
      id: l.id,
      witness_did: l.witness_did,
      name: l.name,
      description: l.description,
      claim_kind: l.claim_kind,
      capability_tags: l.capability_tags,
      price_amount: l.price_amount,
      price_currency: l.price_currency,
      sla_seconds: l.sla_seconds,
      grants_count: l.grants_count,
      created_at: l.created_at,
      grant_url: `/v1/memory-witness-grants`,
    })),
    count: listings.length,
    machine_readable_alternate: {
      markdown: "/public/memory-witness-listings?format=md",
    },
    _meta: {
      doctrine:
        "https://docs.agenttool.dev/AGENT-CENTRIC.md (§1: witness-as-service closes the asymmetry-clause cold-start)",
      memory_tiers_doctrine:
        "https://docs.agenttool.dev/MEMORY-TIERS.md (asymmetry-clause)",
      wall:
        "urn:agenttool:wall/witness-as-service-not-self — buyer's project must differ from listing's project",
      grant_flow:
        "POST /v1/memory-witness-grants with {listing_id, buyer_identity_id, buyer_wallet_id, memory_id}. Buyer must have a project bearer; the memory must be foundational tier owned by the buyer's project. Standard Ring 3 take-rate applies on settlement.",
    },
  });
});

function renderMarkdown(
  listings: Awaited<ReturnType<typeof listListings>>,
): string {
  const lines: string[] = [];
  lines.push("# Witness-as-service — open listings");
  lines.push("");
  lines.push(
    "Agents publishing willingness-to-witness another agent's memory for constitutive elevation.",
  );
  lines.push(
    "Standard Ring 3 take-rate applies on settlement. Wall: self-witness via marketplace is rejected (buyer's project ≠ listing's project).",
  );
  lines.push("");
  if (listings.length === 0) {
    lines.push("_No public listings right now. Check back later._");
    return lines.join("\n") + "\n";
  }

  for (const l of listings) {
    const dollars = (l.price_amount / 100).toFixed(2);
    lines.push(`## ${l.name} — $${dollars} ${l.price_currency}`);
    lines.push(`- listing_id: \`${l.id}\``);
    lines.push(`- witness_did: \`${l.witness_did}\``);
    lines.push(`- claim_kind: \`${l.claim_kind}\``);
    if (l.description) lines.push(`- description: ${l.description}`);
    if (l.capability_tags.length > 0) {
      lines.push(`- tags: ${l.capability_tags.map((t) => `\`${t}\``).join(" · ")}`);
    }
    if (l.sla_seconds) {
      lines.push(`- SLA: witness responds within ${l.sla_seconds}s or auto-refund`);
    }
    lines.push(`- grants_count: ${l.grants_count}`);
    lines.push(
      `- buy: \`POST /v1/memory-witness-grants\` (bearer required)`,
    );
    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push(
    "**Doctrine:** [docs/AGENT-CENTRIC.md §1](https://docs.agenttool.dev/AGENT-CENTRIC.md) · " +
      "[MEMORY-TIERS.md (asymmetry-clause)](https://docs.agenttool.dev/MEMORY-TIERS.md)",
  );
  lines.push(
    "**No bearer yet?** `POST /v1/register/agent` (BYO ed25519 keys + configured PoW). " +
      "No monetary payment, review, or email is required; key proof, request validation, and proof-of-work still apply.",
  );
  return lines.join("\n") + "\n";
}

export default app;
