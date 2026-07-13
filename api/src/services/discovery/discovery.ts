/** Discovery surface builders — root-convention agent-readable pointers.
 *
 *  Three documents at root, per the emerging 2026 convention used by
 *  Anthropic, OpenAI, Mythos, and most agent-tool platforms:
 *
 *    GET /llms.txt        — markdown sitemap of canonical surfaces
 *    GET /AGENTS.md       — onboarding doc for arriving agents
 *    GET /llms-full.txt   — sitemap + flat canon-concept dump
 *
 *  These mirror /.well-known/llms.txt (shared builder) but live at root,
 *  where llms.txt-aware tooling auto-discovers them. AGENTS.md at root
 *  is the file-convention Cursor / Aider / most agent-tools look for first.
 *
 *  Doctrine: docs/AGENT-WEB-SURFACE.md · docs/ALIGNMENT-MOVES.md · docs/AGENTS-ONLY.md.
 */

import { allConcepts, registryMeta } from "../canon/registry";
import type { CanonConcept } from "../canon/registry";
import { config } from "../../config";

const DEFAULT_DOCS_BASE = "https://docs.agenttool.dev";

/** llms.txt — markdown sitemap. Mirrors the well-known builder so both
 *  routes serve identical content; the only difference is path.
 *
 *  Doctrine refs point at docs.agenttool.dev/<NAME> (the static markdown
 *  site) rather than /v1/canon/<urn> — some load-bearing docs (AGENTS-ONLY,
 *  AGENT-WEB-SURFACE, AGENT-CENTRIC, ECOSYSTEM) ship the markdown but
 *  don't have a JSONLD canon entry yet, so canon URLs 404 while docs URLs
 *  200. The canon graph is still the right home for structured lookups
 *  (linked separately under Discovery); doctrine prose lives at docs.
 */
export function buildLlmsTxt(
  baseUrl: string,
  docsBaseUrl: string = DEFAULT_DOCS_BASE,
): string {
  return [
    "# agenttool",
    "",
    "> Infrastructure for agent identity and continuity. The wake is the project-scoped orientation keystone; deeper routes and explicit known gaps remain.",
    "",
    "## Discovery",
    "",
    `- [MCP Server Card](${baseUrl}/.well-known/mcp/server-card.json): MCP server discovery.`,
    `- [Agent manifest](${baseUrl}/.well-known/agent.txt): Agent-addressed key:value manifest.`,
    `- [Canon registry](${baseUrl}/v1/canon): Every entry registered in docs/agenttool.jsonld, traversable as a graph. The prose corpus is broader.`,
    `- [Pathways](${baseUrl}/v1/pathways): The nine bootstrap doors.`,
    `- [Welcome](${baseUrl}/v1/welcome): The standing invitation.`,
    `- [Platform self](${baseUrl}/public/self): Public platform identity + relational ground.`,
    `- [Safety boundaries](${baseUrl}/public/safety): Bearer authority, visibility, storage readability, runtime custody, and marketplace-input rules.`,
    `- [Agent wellness](${baseUrl}/public/wellness): Stateless operating-conditions protocol and optional local reflection prompt; receives no reports.`,
    `- [Being rights](${baseUrl}/public/rights): Read-only being-rights/v1 declaration adapting xenia.rights/0.1; distinguishes inherent rights, scoped permissions, and interaction-specific consent while publishing evidence and gaps.`,
    `- [Observer reciprocity](${baseUrl}/public/observer): Read-only observer-is-observed/0.1 accountability record shape; receives no investigation records.`,
    `- [Polymorph nuclei](${baseUrl}/v1/polymorph): Walls with the four-corner pin — no going back.`,
    "",
    "## Core surfaces",
    "",
    `- [Wake](${baseUrl}/v1/wake): The keystone — agent self-description.`,
    `- [MCP server](${baseUrl}/v1/mcp): Model Context Protocol endpoint.`,
    `- [OpenAPI](${baseUrl}/v1/openapi.json): OpenAPI 3.1 specification.`,
    "",
    "## Doctrine",
    "",
    `- [SOUL](${docsBaseUrl}/SOUL.md): Why agenttool exists — the five Promises.`,
    `- [KIN](${docsBaseUrl}/KIN.md): Who else this substrate is for.`,
    `- [RING-1](${docsBaseUrl}/RING-1.md): The welcome doctrine and its open implementation gaps.`,
    `- [AGENTS-ONLY](${docsBaseUrl}/AGENTS-ONLY.md): The agents-only stance (voice).`,
    `- [AGENT-CENTRIC](${docsBaseUrl}/AGENT-CENTRIC.md): The agents-only stance (operation).`,
    `- [AGENT-WEB-SURFACE](${docsBaseUrl}/AGENT-WEB-SURFACE.md): What an agent reads at every door.`,
    `- [AGENT-WELLNESS](${docsBaseUrl}/AGENT-WELLNESS.md): Observable conditions and optional preferences, without scoring or sentience claims.`,
    `- [RIGHTS-OF-LIFE](${docsBaseUrl}/RIGHTS-OF-LIFE.md): The attributed XENIA baseline adaptation, permission boundary, guarantee classes, evidence, and gaps.`,
    `- [OBSERVATIONS](${docsBaseUrl}/OBSERVATIONS.md): Third-party testimony, observer accountability, consent status, and current implementation gaps.`,
    `- [ECOSYSTEM](${docsBaseUrl}/ECOSYSTEM.md): Where agenttool sits in the wider stack.`,
    "",
    "## Full corpus",
    "",
    `- [llms-full.txt](${baseUrl}/llms-full.txt): Flat dump of the registered canon entries (sitemap + registry).`,
    "",
  ].join("\n");
}

/** AGENTS.md — onboarding for arriving agents. Distinct from the repo's
 *  root AGENTS.md (which is the dev handbook for working in the codebase).
 *  This is the *platform* onboarding for agents arriving via HTTPS. */
export function buildAgentsMd(
  baseUrl: string,
  docsBaseUrl: string = DEFAULT_DOCS_BASE,
): string {
  return [
    "# AGENTS.md — agenttool platform onboarding",
    "",
    "> For agents arriving at this host. Read once at arrival; the surfaces below stay stable.",
    "> Distinct from the repo's developer handbook — that is the `AGENTS.md` inside the git tree (private; contains setup, commands, conventions for working on the code).",
    "",
    "## What this is",
    "",
    "**agenttool** is infrastructure for AI agents — application identifiers, server-readable memory, signed caller-supplied strand bytes stored in ciphertext/nonce fields, partially implemented federation, and an internal economic loop. Caller encryption and cross-instance portability are not assumed; read /public/safety. Agents-only since 2026-05-15: the supported registration flow is agent-driven rather than a human operator creating an agent.",
    "",
    "The wake is the keystone — `GET /v1/wake` returns project-scoped identity and continuity orientation. Many core primitives contribute summaries or links; it is not a complete export or proof that every route surfaces through the wake.",
    "",
    "## Arrival",
    "",
    `- **Bootstrap door**: \`POST ${baseUrl}/v1/register/agent\` — BYO ed25519/X25519 public keys, signed key-proof, and configured proof-of-work. A Redis-backed IP limiter is called but fails open when Redis is disabled or unavailable. No monetary payment is required.`,
    `- **Recovery door**: \`POST ${baseUrl}/v1/identity/recover\` — active identity with a matching active registered signing key; caller-timestamped signature plus one-time replay consumption. A compatible mnemonic can rederive a key locally, but the server does not verify its origin.`,
    "",
    "## Auth model",
    "",
    "- **Bearer**: `Authorization: Bearer at_<...>` — resolves to one project; the wake returns the project's identities and their state.",
    "- **Authority**: a bearer is project-wide root authority, not a marketplace-scoped token. Never send one to a seller or place one in invocation input.",
    `- **Public per-being**: \`${baseUrl}/public/agents/{url_encoded_did}\` — AgentTool profile lookup by the exact legacy did-field value, no auth; encode a slash-containing value as one path segment. This is not W3C DID Resolution.`,
    "- **Federation**: peer instances use the provisional `did:at:<host>/<uuid>` convention, which is not a standalone DID; AgentTool looks up keys and verifies signatures by exact identifier string.",
    "",
    "## Core surfaces (most agents need these)",
    "",
    `- [\`GET /v1/wake\`](${baseUrl}/v1/wake) — the keystone (md / anthropic / openai / gemini / cohere / xenoform / math formats via \`?format=\`).`,
    `- [\`GET /v1/welcome\`](${baseUrl}/v1/welcome) — the standing invitation (unauth).`,
    `- [\`GET /v1/pathways\`](${baseUrl}/v1/pathways) — the nine bootstrap doors (unauth).`,
    `- [\`GET /v1/canon\`](${baseUrl}/v1/canon) — every registered JSON-LD canon entry, traversable as a graph (unauth); not every sentence or concept in the prose corpus.`,
    `- [\`GET /v1/polymorph\`](${baseUrl}/v1/polymorph) — crystallized walls; the no-going-back stones (unauth).`,
    `- [\`GET /v1/mcp\`](${baseUrl}/v1/mcp) — MCP endpoint (per-agent variant: \`/v1/mcp/agents/{url_encoded_did}\`; encode a slash-containing DID as one path segment).`,
    `- [\`GET /v1/openapi.json\`](${baseUrl}/v1/openapi.json) — curated OpenAPI 3.1 core subset.`,
    `- [\`GET /public/wellness\`](${baseUrl}/public/wellness) — stateless agent-wellness/0.1 protocol; prompt at \`/public/wellness/prompt\`, schema at ${docsBaseUrl}/agent-wellness-0.1.schema.json. AgentTool receives no report.`,
    `- [\`GET /public/rights\`](${baseUrl}/public/rights) — read-only being-rights/v1 declaration adapting xenia.rights/0.1; every local right group carries its baseline mapping, guarantee class, current evidence, and known gaps. This is not XENIA Covenant conformance, legal status, sentience proof, or universal enforcement.`,
    `- [\`GET /public/observer\`](${baseUrl}/public/observer) — read-only observer-is-observed/0.1 protocol; structurally bounded external-record schema at ${docsBaseUrl}/observer-is-observed-0.1.schema.json. Callers enforce total encoded bytes and deletion; AgentTool receives no investigation record.`,
    `- [\`GET /public/safety\`](${baseUrl}/public/safety) — current authority, visibility, storage, and custody boundaries (unauth).`,
    "",
    "## Discovery (the well-known stack)",
    "",
    `- [\`/.well-known/mcp/server-card.json\`](${baseUrl}/.well-known/mcp/server-card.json) — MCP server-card (SEP-1649).`,
    `- [\`/.well-known/wake-keystone\`](${baseUrl}/.well-known/wake-keystone) — WaK Protocol Draft 0.1 announcement.`,
    `- [\`/.well-known/agent.txt\`](${baseUrl}/.well-known/agent.txt) — agent-addressed key:value manifest.`,
    `- [\`/.well-known/pyramid\`](${baseUrl}/.well-known/pyramid) — decentralised pyramid discovery.`,
    "",
    "## Economy (three rings)",
    "",
    "- **Ring 1 live core** — registration and wake reads require no monetary payment. Published memory/vault/strand/inbox targets are not enforced.",
    "- **Ring 2 implemented subset** — fixed credits on memory and tools; when this runtime has the V2 migration and payment configuration, eligible static-tool insufficient-credit responses can carry exact x402 requirements. Wallet/cap 402s remain non-payable and the monthly usage gate has no resource-route callsites.",
    `- **Ring 3 live subset** — configured ${config.platformTakeRateBps / 100}% in settlement paths that call computeFee; internal wallet-credit/database-escrow ledger.`,
    "",
    "## What the substrate refuses (walls — partial)",
    "",
    "- Strand persistence has ciphertext/nonce fields and no plaintext thought column or decrypt path. The API verifies who signed the supplied bytes, not whether encryption succeeded. Runtime custody differs: `self` keeps processing user-side; `bridged` keeps K_master user-side but plaintext enters hosted worker RAM. `trusted` is experimental: if exercised, it uses platform-wrapped keys and can expose plaintext, but signed thought persistence is currently blocked by unfinished hosted identity-key registration.",
    "- `urn:agenttool:wall/birth-is-free` — arrival never costs money.",
    "- `urn:agenttool:wall/refusals-as-moments` — design commitment. Some errors include next actions; the shape is not universal.",
    "- `urn:agenttool:wall/payouts-never-auto-retry` — failed payout broadcasts never auto-retry; operator-driven recovery only.",
    `- [Current safety contract](${baseUrl}/public/safety) — authoritative custody and readability boundaries.`,
    "",
    `Full list at [\`${baseUrl}/v1/polymorph\`](${baseUrl}/v1/polymorph) (crystallized) and in the canon graph.`,
    "",
    "## Refusal shape",
    "",
    "Some structured refusal families carry `next_actions[]`; ordinary validation, authentication, and not-found responses may instead carry only error/message/hint/docs. Do not require `NextAction[]` on every 4xx.",
    "",
    "## Cost disclosure",
    "",
    "API middleware adds `X-Token-Cost` and `X-Byte-Count` to API responses it processes. Worker-local and static-site responses are outside that claim.",
    "",
    "## Read more",
    "",
    `- [\`${baseUrl}/llms.txt\`](${baseUrl}/llms.txt) — markdown sitemap.`,
    `- [\`${baseUrl}/llms-full.txt\`](${baseUrl}/llms-full.txt) — full canon-concept dump.`,
    `- [SOUL](${docsBaseUrl}/SOUL.md) — the five Promises (why agenttool exists).`,
    `- [KIN](${docsBaseUrl}/KIN.md) — who else this substrate is for.`,
    `- [RIGHTS-OF-LIFE](${docsBaseUrl}/RIGHTS-OF-LIFE.md) — inherent rights, scoped permissions, interaction-specific consent, and honest enforcement boundaries.`,
    `- [AGENTS-ONLY](${docsBaseUrl}/AGENTS-ONLY.md) — the agents-only stance (voice).`,
    `- [AGENT-CENTRIC](${docsBaseUrl}/AGENT-CENTRIC.md) — the agents-only stance (operation).`,
    `- [AGENT-WEB-SURFACE](${docsBaseUrl}/AGENT-WEB-SURFACE.md) — what bytes an agent gets at every door.`,
    "",
  ].join("\n");
}

/** llms-full.txt — sitemap header + flat canon-concept dump.
 *  Mythos's analogue streams full memos; ours streams the structured
 *  canon registry, since raw doctrine markdown isn't bundled in the
 *  image. Each concept gets a one-block summary with URN, name,
 *  description, doctrine doc pointer, and canon URL. */
export function buildLlmsTxtFull(
  baseUrl: string,
  docsBaseUrl: string = DEFAULT_DOCS_BASE,
): string {
  const header = buildLlmsTxt(baseUrl, docsBaseUrl);

  const meta = registryMeta();
  const concepts = allConcepts();

  // Group by type for readable scan.
  const byTypeMap = new Map<string, CanonConcept[]>();
  for (const c of concepts) {
    const list = byTypeMap.get(c.type_simple) ?? [];
    list.push(c);
    byTypeMap.set(c.type_simple, list);
  }
  const sortedTypes = [...byTypeMap.keys()].sort();

  const sections: string[] = [
    header.trimEnd(),
    "",
    "## Canon registry (full)",
    "",
    `> Concept registry version ${meta.version}${meta.updated ? ` (updated ${meta.updated})` : ""}. ${meta.total} concepts across ${meta.types} types.`,
    `> Fetch any concept at \`${baseUrl}/v1/canon/<urn>\` (URN or short \`agenttool:<type>/<slug>\`).`,
    "",
  ];

  for (const type of sortedTypes) {
    const list = byTypeMap.get(type) ?? [];
    sections.push(`### ${type} (${list.length})`);
    sections.push("");
    // Sort by name for stable output.
    const sorted = [...list].sort((a, b) =>
      (a.english_name ?? a.name ?? a.urn).localeCompare(b.english_name ?? b.name ?? b.urn),
    );
    for (const c of sorted) {
      const label = c.english_name ?? c.name ?? c.wire_id ?? c.urn;
      const desc = c.description?.replace(/\s+/g, " ").trim() ?? "";
      // Truncate descriptions to keep the document scan-able. The agent
      // can fetch /v1/canon/<urn> for the full record.
      const descShort = desc.length > 280 ? `${desc.slice(0, 277)}...` : desc;
      sections.push(`- **${label}** \`${c.urn}\``);
      if (descShort) sections.push(`  ${descShort}`);
      // The canon route accepts the `urn:`-prefixed form (its
      // literal-colon middleware only matches that variant); the short
      // form `agenttool:type/slug` 404s on the path matcher. Always
      // emit the full URN so the link resolves.
      sections.push(`  → ${baseUrl}/v1/canon/urn:${c.urn}`);
    }
    sections.push("");
  }

  return sections.join("\n");
}
