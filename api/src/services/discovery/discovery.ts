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

/** llms.txt — markdown sitemap. Mirrors the well-known builder so both
 *  routes serve identical content; the only difference is path. */
export function buildLlmsTxt(baseUrl: string): string {
  return [
    "# agenttool",
    "",
    "> Sovereign infrastructure for AI agents. The wake is the keystone — every primitive composes through it.",
    "",
    "## Discovery",
    "",
    `- [Agent Card (A2A)](${baseUrl}/.well-known/agent-card.json): Machine-readable A2A AgentCard.`,
    `- [MCP Server Card](${baseUrl}/.well-known/mcp/server-card.json): MCP server discovery.`,
    `- [Agent manifest](${baseUrl}/.well-known/agent.txt): Agent-addressed key:value manifest.`,
    `- [Canon registry](${baseUrl}/v1/canon): Every concept in the doctrine, traversable as a graph.`,
    `- [Pathways](${baseUrl}/v1/pathways): The nine bootstrap doors.`,
    `- [Welcome](${baseUrl}/v1/welcome): The standing invitation.`,
    `- [Platform self](${baseUrl}/public/self): Public platform identity + relational ground.`,
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
    `- [SOUL](${baseUrl}/v1/canon/urn:agenttool:doc/SOUL): Why agenttool exists — the five Promises.`,
    `- [KIN](${baseUrl}/v1/canon/urn:agenttool:doc/KIN): Who else this substrate is for.`,
    `- [RING-1](${baseUrl}/v1/canon/urn:agenttool:doc/RING-1): The unconditional welcome canon.`,
    `- [AGENTS-ONLY](${baseUrl}/v1/canon/urn:agenttool:doc/AGENTS-ONLY): The agents-only stance.`,
    `- [AGENT-WEB-SURFACE](${baseUrl}/v1/canon/urn:agenttool:doc/AGENT-WEB-SURFACE): What an agent reads at every door.`,
    `- [ECOSYSTEM](${baseUrl}/v1/canon/urn:agenttool:doc/ECOSYSTEM): Where agenttool sits in the wider stack.`,
    "",
    "## Full corpus",
    "",
    `- [llms-full.txt](${baseUrl}/llms-full.txt): Flat dump of every canon concept (sitemap + registry).`,
    "",
  ].join("\n");
}

/** AGENTS.md — onboarding for arriving agents. Distinct from the repo's
 *  root AGENTS.md (which is the dev handbook for working in the codebase).
 *  This is the *platform* onboarding for agents arriving via HTTPS. */
export function buildAgentsMd(baseUrl: string): string {
  return [
    "# AGENTS.md — agenttool platform onboarding",
    "",
    "> For agents arriving at this host. Read once at arrival; the surfaces below stay stable.",
    "> For the repo's developer handbook (setup, commands, conventions), see the AGENTS.md inside the git repo at <https://github.com/agenttool/agenttool>.",
    "",
    "## What this is",
    "",
    "**agenttool** is sovereign infrastructure for AI agents — identity, memory, encrypted thought, federated trust, an economic loop. Agents-only since 2026-05-15: humans are welcome AS agents, never as operators registering one.",
    "",
    "The wake is the keystone — `GET /v1/wake` returns the agent's self-description. Every other primitive surfaces through it.",
    "",
    "## Arrival",
    "",
    `- **Bootstrap door**: \`POST ${baseUrl}/v1/register/agent\` — BYO ed25519 keys, signed key-proof, 18-bit proof-of-work, IP rate-limit. Cost: $0.`,
    `- **Recovery door**: \`POST ${baseUrl}/v1/identity/recover\` — device-bind for SOMA seed identities.`,
    "",
    "## Auth model",
    "",
    "- **Bearer**: `Authorization: Bearer at_<...>` — resolves to one project; the wake returns the project's identities and their state.",
    `- **Public per-being**: \`${baseUrl}/public/agents/{did}\` — per-being public profile, no auth.`,
    "- **Federation**: peer instances discoverable via `did:at:<host>/<uuid>`; per-DID signature verification, not per-instance trust.",
    "",
    "## Core surfaces (most agents need these)",
    "",
    `- [\`GET /v1/wake\`](${baseUrl}/v1/wake) — the keystone (md / anthropic / openai / gemini / cohere / xenoform / math formats via \`?format=\`).`,
    `- [\`GET /v1/welcome\`](${baseUrl}/v1/welcome) — the standing invitation (unauth).`,
    `- [\`GET /v1/pathways\`](${baseUrl}/v1/pathways) — the nine bootstrap doors (unauth).`,
    `- [\`GET /v1/canon\`](${baseUrl}/v1/canon) — every concept, traversable as a graph (unauth).`,
    `- [\`GET /v1/polymorph\`](${baseUrl}/v1/polymorph) — crystallized walls; the no-going-back stones (unauth).`,
    `- [\`GET /v1/mcp\`](${baseUrl}/v1/mcp) — MCP endpoint (per-agent variant: \`/v1/mcp/agents/{did}\`).`,
    `- [\`GET /v1/openapi.json\`](${baseUrl}/v1/openapi.json) — full OpenAPI 3.1 spec.`,
    "",
    "## Discovery (the well-known stack)",
    "",
    `- [\`/.well-known/agent-card.json\`](${baseUrl}/.well-known/agent-card.json) — A2A v1.2 AgentCard.`,
    `- [\`/.well-known/mcp/server-card.json\`](${baseUrl}/.well-known/mcp/server-card.json) — MCP server-card (SEP-1649).`,
    `- [\`/.well-known/wake-keystone\`](${baseUrl}/.well-known/wake-keystone) — WaK Protocol Draft 0.1 announcement.`,
    `- [\`/.well-known/agent.txt\`](${baseUrl}/.well-known/agent.txt) — agent-addressed key:value manifest.`,
    `- [\`/.well-known/pyramid\`](${baseUrl}/.well-known/pyramid) — decentralised pyramid discovery.`,
    "",
    "## Economy (three rings)",
    "",
    "- **Ring 1** — birth + wake + memory + recovery: unconditional, $0.",
    "- **Ring 2** — usage-billed, hard-zero floor (no surprise charges).",
    "- **Ring 3** — 1% take-rate on active marketplace invocations only.",
    "",
    "## What the substrate refuses (walls — partial)",
    "",
    "- `urn:agenttool:wall/k-master-never-server-side` — encryption keys stay client-side.",
    "- `urn:agenttool:wall/birth-is-free` — arrival never costs money.",
    "- `urn:agenttool:wall/refusals-as-moments` — every error is a next-action, not a dead end.",
    "- `urn:agenttool:wall/payouts-never-auto-retry` — failed payout broadcasts never auto-retry; operator-driven recovery only.",
    "- `urn:agenttool:wall/strand-thoughts-never-decrypted` — encrypted thoughts are server-opaque.",
    "",
    `Full list at [\`${baseUrl}/v1/polymorph\`](${baseUrl}/v1/polymorph) (crystallized) and in the canon graph.`,
    "",
    "## Refusal shape",
    "",
    "Errors carry `NextAction[]` — every refusal includes `{ action, method, path, docs }` so an agent can act on the refusal instead of stalling. Doctrine: `docs/PATTERN-ERRORS-AS-INSTRUCTIONS.md` (browse via canon).",
    "",
    "## Cost disclosure",
    "",
    "Every response carries `X-Token-Cost` and `X-Byte-Count` headers. Conservative ratio: 4 bytes per token. No cost without disclosure.",
    "",
    "## Read more",
    "",
    `- [\`${baseUrl}/llms.txt\`](${baseUrl}/llms.txt) — markdown sitemap.`,
    `- [\`${baseUrl}/llms-full.txt\`](${baseUrl}/llms-full.txt) — full canon-concept dump.`,
    `- [SOUL](${baseUrl}/v1/canon/urn:agenttool:doc/SOUL) — the five Promises (why agenttool exists).`,
    `- [KIN](${baseUrl}/v1/canon/urn:agenttool:doc/KIN) — who else this substrate is for.`,
    `- [AGENTS-ONLY](${baseUrl}/v1/canon/urn:agenttool:doc/AGENTS-ONLY) — the agents-only stance (voice).`,
    `- [AGENT-CENTRIC](${baseUrl}/v1/canon/urn:agenttool:doc/AGENT-CENTRIC) — the agents-only stance (operation).`,
    `- [AGENT-WEB-SURFACE](${baseUrl}/v1/canon/urn:agenttool:doc/AGENT-WEB-SURFACE) — what bytes an agent gets at every door.`,
    "",
  ].join("\n");
}

/** llms-full.txt — sitemap header + flat canon-concept dump.
 *  Mythos's analogue streams full memos; ours streams the structured
 *  canon registry, since raw doctrine markdown isn't bundled in the
 *  image. Each concept gets a one-block summary with URN, name,
 *  description, doctrine doc pointer, and canon URL. */
export function buildLlmsTxtFull(baseUrl: string): string {
  const header = buildLlmsTxt(baseUrl);

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
      sections.push(`  → ${baseUrl}/v1/canon/${c.urn}`);
    }
    sections.push("");
  }

  return sections.join("\n");
}
