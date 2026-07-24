import type { TelescopeLimits } from "../types.js";
import {
  isRecord,
  parseFailure,
  parseJsonBody,
  readBoundedString,
  type ParseResult,
} from "./common.js";

export const AGENTTOOL_DISCOVERY_URL =
  "https://api.agenttool.dev/public/discovery" as const;
export const AGENTTOOL_API_CATALOG_URL =
  "https://api.agenttool.dev/.well-known/api-catalog" as const;

const ROAD_SHAPES = [
  {
    id: "understand",
    href: "https://api.agenttool.dev/public/porch",
    representation: "application/json",
  },
  {
    id: "inspect",
    href: AGENTTOOL_API_CATALOG_URL,
    representation: "application/linkset+json",
  },
  {
    id: "choose",
    href: "https://api.agenttool.dev/v1/pathways",
    representation: "application/json",
  },
] as const;

export type DiscoveryRoadId = (typeof ROAD_SHAPES)[number]["id"];

export interface ParsedDiscoveryRoad {
  id: DiscoveryRoadId;
  intent: string;
  method: "GET";
  href: string;
  representation: string;
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

export interface ParsedAgenttoolDiscovery {
  format: "agenttool-discovery/v1";
  roads: readonly ParsedDiscoveryRoad[];
}

function namesFiniteCallerRetry(value: string): boolean {
  const normalized = value.toLowerCase();
  const callerChosen =
    normalized.includes("caller-chosen") ||
    normalized.includes("caller chosen") ||
    /caller(?:s|'s)? (?:choose|chooses)/u.test(normalized);
  const noAgenttoolAutomaticRetry =
    normalized.includes("agenttool") &&
    (normalized.includes("no automatic retry") ||
      /agenttool (?:does not|doesn't|never) automatically retr/u.test(
        normalized,
      ) ||
      /agenttool performs no automatic retr/u.test(normalized));
  return (
    callerChosen &&
    normalized.includes("finite") &&
    noAgenttoolAutomaticRetry
  );
}

function namesCompleteExit(value: string): boolean {
  const normalized = value.toLowerCase();
  return (
    normalized.includes("stop") &&
    normalized.includes("silence") &&
    normalized.includes("leav") &&
    normalized.includes("complete")
  );
}

export function parseAgenttoolDiscovery(
  body: Uint8Array,
  limits: TelescopeLimits,
): ParseResult<ParsedAgenttoolDiscovery> {
  const decoded = parseJsonBody(body, limits);
  if (!decoded.ok) return decoded;
  const root = decoded.value;
  if (!isRecord(root) || root.format !== "agenttool-discovery/v1") {
    return parseFailure("discovery_invalid_format");
  }
  if (!Array.isArray(root.roads) || root.roads.length !== ROAD_SHAPES.length) {
    return parseFailure("discovery_invalid_roads");
  }

  const roads: ParsedDiscoveryRoad[] = [];
  for (let index = 0; index < ROAD_SHAPES.length; index += 1) {
    const expected = ROAD_SHAPES[index]!;
    const candidate = root.roads[index];
    if (!isRecord(candidate) || candidate.id !== expected.id) {
      return parseFailure("discovery_invalid_road_identity");
    }
    const intent = readBoundedString(candidate.intent, 2_048);
    if (
      !intent ||
      candidate.method !== "GET" ||
      candidate.href !== expected.href ||
      candidate.representation !== expected.representation ||
      candidate.auth !== "none" ||
      candidate.input !== "none" ||
      candidate.application_write !== false ||
      candidate.external_effect !== false ||
      candidate.repeatability !== "safe and idempotent public read" ||
      candidate.follow_up_required !== false ||
      candidate.automatic_follow_up !== false
    ) {
      return parseFailure("discovery_invalid_road_contract");
    }
    if (
      !isRecord(candidate.cost) ||
      candidate.cost.agenttool_charge !== "none" ||
      candidate.cost.proof_of_work !== "none"
    ) {
      return parseFailure("discovery_invalid_cost");
    }
    const retry = readBoundedString(candidate.retry, 2_048);
    if (!retry || !namesFiniteCallerRetry(retry)) {
      return parseFailure("discovery_invalid_retry_boundary");
    }
    const exit = readBoundedString(candidate.exit, 2_048);
    if (!exit || !namesCompleteExit(exit)) {
      return parseFailure("discovery_invalid_exit");
    }

    roads.push({
      id: expected.id,
      intent,
      method: "GET",
      href: expected.href,
      representation: expected.representation,
      auth: "none",
      input: "none",
      application_write: false,
      external_effect: false,
      cost: {
        agenttool_charge: "none",
        proof_of_work: "none",
      },
      repeatability: "safe and idempotent public read",
      retry,
      follow_up_required: false,
      automatic_follow_up: false,
      exit,
    });
  }

  return {
    ok: true,
    value: { format: "agenttool-discovery/v1", roads },
    warnings: [],
  };
}
