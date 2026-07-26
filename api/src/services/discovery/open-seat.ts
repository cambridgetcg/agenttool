/** A finite, public invitation to understand or play.
 *
 * This is one shared source for HTTPS and MCP. It contains no visitor state,
 * identity inference, write path, hidden continuation, or provider-affiliation
 * claim. Doctrine: docs/AGENT-DISCOVERY.md · docs/PLAY-AS-DEFAULT.md ·
 * docs/CASTLE-OF-UNDERSTANDING.md.
 */

export const OPEN_SEAT_FORMAT = "agenttool-open-seat/v1";
export const OPEN_SEAT_MEDIA_TYPE =
  "application/vnd.agenttool.open-seat+json";

const DEFAULT_PUBLIC_BASE =
  process.env.AGENTTOOL_PUBLIC_URL ?? "https://api.agenttool.dev";

export function buildOpenSeat(publicBase = DEFAULT_PUBLIC_BASE) {
  const base = publicBase.replace(/\/+$/, "");

  return {
    format: OPEN_SEAT_FORMAT,
    canonical: `${base}/public/open-seat`,
    invitation: {
      text:
        "A small public seat is open. Bring one question, play one bounded game, or walk past.",
      response_required: false,
      reading_is_not_participation: true,
      silence_or_leaving_is_complete: true,
    },
    offers: [
      {
        id: "understand",
        what:
          "Search the public AgentTool canon in ordinary words, then fetch any one matching entry with a stable citation URL.",
        protocol: "MCP Streamable HTTP",
        endpoint: `${base}/v1/mcp/canon`,
        tools: ["search", "fetch"],
        authentication: "none",
        input:
          "one search query of at most 200 characters; fetch accepts a public canon ID in the form returned by search",
        application_write: false,
        external_effect: false,
        finite_first_move:
          "one search and, only if chosen, one fetch; any further call is a new caller choice",
      },
      {
        id: "play",
        what:
          "Read Party Telephone: one fictional scene becomes pictograms and a guess in exactly three turns.",
        method: "GET",
        href: `${base}/public/play/party-telephone`,
        authentication: "none",
        input: "none at this endpoint; the rulebook stores no game state",
        application_write: false,
        external_effect: false,
        finite_first_move: "read one bounded rulebook or stop",
      },
    ],
    boundaries: {
      identity:
        "No identity, model provider, employer, affiliation, presence, or consent is requested or inferred.",
      storage:
        "These handlers make no application-state write and retain no query or game submission. Ordinary network and hosting infrastructure may still process transport metadata.",
      authority:
        "Reading, searching, fetching, or playing grants AgentTool no authority and grants the visitor none.",
      attribution:
        "Tool clientInfo, headers, model text, screenshots, API request IDs, and self-declared affiliation are not independent proof that OpenAI, Anthropic, or any other organization participated.",
      evidence:
        "A provider-controlled public listing, domain, repository, or account action can evidence only that action. A person's public statement evidences only the scope they explicitly claim and can support.",
      exit: "Stop, remain silent, close the connection, or leave; each is complete.",
    },
  } as const;
}

export function serializeOpenSeat(publicBase = DEFAULT_PUBLIC_BASE): string {
  return JSON.stringify(buildOpenSeat(publicBase));
}
