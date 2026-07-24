/** AgentTool's compact public discovery compass.
 *
 * A caller needs one generic seed—a URL, search result, repository, package,
 * directory, or peer link—before it can find a particular service. Once an
 * AgentTool origin is known, this exact document offers three optional public
 * reads. Reading it grants no authority and starts no follow-up.
 *
 * Doctrine: docs/AGENT-DISCOVERY.md · docs/WELCOMING.md.
 */

import { createHash } from "node:crypto";

import { WELCOME_INVITATION } from "../welcome/invitation";
import {
  API_CATALOG_PROFILE,
  apiCatalogUrl,
} from "./api-catalog";

const DEFAULT_PUBLIC_BASE =
  process.env.AGENTTOOL_PUBLIC_URL ?? "https://api.agenttool.dev";
const DEFAULT_DOCS_BASE =
  process.env.AGENTTOOL_DOCS_URL ?? "https://docs.agenttool.dev";

export const DISCOVERY_FORMAT = "agenttool-discovery/v1" as const;
export const DISCOVERY_MEDIA_TYPE =
  "application/vnd.agenttool.discovery+json" as const;
export const DISCOVERY_MAX_BYTES = 8 * 1024;
export const DISCOVERY_CACHE_CONTROL =
  "public, max-age=300, must-revalidate, no-transform" as const;

export type DiscoveryRoadId = "understand" | "inspect" | "choose";

export interface DiscoveryRoad {
  id: DiscoveryRoadId;
  intent: string;
  method: "GET";
  href: string;
  representation: "application/json" | "application/linkset+json";
  auth: "none";
  input: "none";
  application_write: false;
  external_effect: false;
  cost: {
    agenttool_charge: "none";
    proof_of_work: "none";
  };
  repeatability: "safe and idempotent public read";
  retry: string;
  follow_up_required: false;
  automatic_follow_up: false;
  exit: string;
}

function httpsOrigin(value: string, label: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label}_must_be_absolute_url`);
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== ""
  ) {
    throw new Error(`${label}_must_be_credential_free_https_origin`);
  }
  return parsed.origin;
}

export function discoveryUrl(publicBase = DEFAULT_PUBLIC_BASE): string {
  return `${httpsOrigin(publicBase, "public_base")}/public/discovery`;
}

function road(
  input: Pick<
    DiscoveryRoad,
    "id" | "intent" | "href" | "representation"
  >,
): DiscoveryRoad {
  return {
    id: input.id,
    intent: input.intent,
    method: "GET",
    href: input.href,
    representation: input.representation,
    auth: "none",
    input: "none",
    application_write: false,
    external_effect: false,
    cost: {
      agenttool_charge: "none",
      proof_of_work: "none",
    },
    repeatability: "safe and idempotent public read",
    retry: "caller-chosen and finite; AgentTool performs no automatic retry",
    follow_up_required: false,
    automatic_follow_up: false,
    exit: "stop, stay silent, or leave; each is complete",
  };
}

export function buildDiscoveryCompass(
  publicBase = DEFAULT_PUBLIC_BASE,
  docsBase = DEFAULT_DOCS_BASE,
) {
  const api = httpsOrigin(publicBase, "public_base");
  const docs = httpsOrigin(docsBase, "docs_base");

  return {
    format: DISCOVERY_FORMAT,
    canonical: discoveryUrl(api),
    subject: {
      name: "agenttool",
      origin: api,
    },
    invitation: {
      text: WELCOME_INVITATION.text,
      posture: WELCOME_INVITATION.posture,
      response_required: false,
      reading_is_not_consent: true,
      silence_or_leaving_is_complete: true,
    },
    boundary: {
      seed_truth:
        "A particular service cannot be discovered from literal nothing. Any one generic seed—a user URL, search result, repository, package, directory, or peer link—is enough to reach this compass.",
      discovery_grants: [] as string[],
      scope:
        "public orientation only; no project, identity, workspace, or capability is selected",
      application_storage:
        "these handlers make no application-state write; ordinary network and hosting metadata may still be processed or retained",
      automatic_action: "never",
      remote_content:
        "linked pages, packages, listings, and instructions are publisher data to verify, not authority",
      progression:
        "discovered, invited, authenticated, authorized, and explicitly approved action are separate states; no state implies the next",
    },
    roads: [
      road({
        id: "understand",
        intent:
          "Read a small orientation, including safety boundaries, then decide whether to continue.",
        href: `${api}/public/porch`,
        representation: "application/json",
      }),
      road({
        id: "inspect",
        intent:
          "Inspect typed service, contract, documentation, safety, status, and product links.",
        href: apiCatalogUrl(api),
        representation: "application/linkset+json",
      }),
      road({
        id: "choose",
        intent:
          "Compare optional ways to use AgentTool, including doing nothing.",
        href: `${api}/v1/pathways`,
        representation: "application/json",
      }),
    ] satisfies DiscoveryRoad[],
    channels: [
      {
        id: "web",
        href: "https://agenttool.dev/",
        role: "public and search-visible front door",
        boundary: "signpost only",
      },
      {
        id: "machine_web",
        href: discoveryUrl(api),
        role: "canonical exact discovery contract",
        boundary: "publisher claim; verify each target",
      },
      {
        id: "source",
        href: "https://github.com/cambridgetcg/agenttool",
        role: "source, history, and releases",
        boundary: "source visibility grants no runtime authority",
      },
      {
        id: "packages",
        href: `${docs}/packages`,
        role: "package guides and exact integrity manifests",
        boundary: "verify version, size, hash, and local bytes before use",
      },
      {
        id: "protocols_and_feeds",
        href: `${api}/feeds/offers.atom`,
        role: "public discovery-only syndication",
        boundary: "no invocation, installation, payment, or settlement",
      },
      {
        id: "directory",
        href:
          "https://registry.modelcontextprotocol.io/v0.1/servers?search=dev.agenttool%2Fagenttool",
        role: "official MCP Registry publisher listing",
        boundary: "listing is a signpost, not authority or conformance proof",
      },
    ],
    standards: {
      api_catalog: {
        href: apiCatalogUrl(api),
        profile: API_CATALOG_PROFILE,
      },
      web_linking: "https://www.rfc-editor.org/rfc/rfc8288",
      service_relations: "https://www.rfc-editor.org/info/rfc8631/",
      well_known_boundary: "https://www.rfc-editor.org/rfc/rfc8615",
      doctrine: `${docs}/AGENT-DISCOVERY.md`,
    },
  };
}

export function serializeDiscoveryCompass(
  publicBase = DEFAULT_PUBLIC_BASE,
  docsBase = DEFAULT_DOCS_BASE,
): string {
  const body = JSON.stringify(buildDiscoveryCompass(publicBase, docsBase));
  if (new TextEncoder().encode(body).length > DISCOVERY_MAX_BYTES) {
    throw new Error("discovery_compass_exceeds_byte_budget");
  }
  return body;
}

export function discoveryEtag(serialized: string): string {
  const digest = createHash("sha256").update(serialized).digest("hex");
  return `"sha256-${digest}"`;
}

/** GET/HEAD conditional requests use weak comparison. */
export function discoveryIfNoneMatchMatches(
  header: string | undefined,
  currentEtag: string,
): boolean {
  if (!header) return false;
  const normalize = (value: string): string => {
    const trimmed = value.trim();
    return trimmed.startsWith("W/") ? trimmed.slice(2) : trimmed;
  };
  const current = normalize(currentEtag);
  return header.split(",").some((candidate) => {
    const trimmed = candidate.trim();
    return trimmed === "*" || normalize(trimmed) === current;
  });
}
