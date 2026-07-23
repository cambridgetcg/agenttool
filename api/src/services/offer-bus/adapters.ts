/** Offer Bus adapters for AgentTool's existing public economic records.
 *
 * These functions are structural projections only. They perform no database
 * reads, network fetches, invocation, package installation, or settlement.
 *
 * Doctrine: docs/OFFER-BUS.md.
 */

import {
  OfferBusContractError,
  normalizeOfferBusHttpsUrl,
  type OfferBusEntryInput,
  type OfferFactValue,
} from "./contracts";

export interface PublicListingOfferRecord {
  id: string;
  seller_did: string;
  name: string;
  description: string | null;
  capability_tags: readonly string[];
  pricing_model: string;
  price_amount: number;
  price_currency: string;
  sla_seconds: number | null;
  created_at: string;
  /** Present on service rows/detail reads; collection-only JSON may omit it. */
  updated_at?: string;
}

export interface PublicSubstrateTaskOfferRecord {
  task_id: string;
  kind: string;
  bounty: {
    cents: number;
    currency: string;
  };
  posted_at: string;
  /** Live service rows carry this; older adapter fixtures may omit it. */
  updated_at?: string;
  expires_at: string;
  newborn_only: boolean;
  task_data: unknown;
}

export interface LovePackageIndexVersion {
  version: string;
  manifest_url: string;
  /** Optional forward-compatible field; the current static index omits it. */
  released_at?: string;
}

export interface LovePackageIndexPackage {
  name: string;
  latest: string;
  description?: string;
  versions: readonly LovePackageIndexVersion[];
}

export interface LovePackageIndex {
  protocol: string;
  document_type: string;
  packages: readonly LovePackageIndexPackage[];
}

export interface LovePackageAdapterOptions {
  /**
   * Current love-package/v1 indexes have no release timestamp, while Atom
   * entries require one. Integration must supply an honest source timestamp;
   * this adapter never substitutes request time or filesystem mtime.
   */
  released_at_by_manifest_url?: Readonly<Record<string, string>>;
}

function httpsOrigin(value: string): string {
  const normalized = normalizeOfferBusHttpsUrl(value, "adapter.public_base");
  const parsed = new URL(normalized);
  if (
    parsed.pathname !== "/" ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    throw new OfferBusContractError(
      "offer_bus_public_base_must_be_origin",
      value,
    );
  }
  return parsed.origin;
}

function pathSegment(value: string, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new OfferBusContractError("offer_bus_record_id_required", label);
  }
  return encodeURIComponent(value).replace(/[!'()*]/gu, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function nonEmpty(value: string, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new OfferBusContractError("offer_bus_record_text_required", label);
  }
  return value.trim();
}

/** Canonical compact JSON for public task details, independent of key order. */
export function canonicalOfferJson(value: unknown): string {
  const active = new Set<object>();

  const visit = (part: unknown, path: string): string => {
    if (part === null) return "null";
    if (typeof part === "string") return JSON.stringify(part);
    if (typeof part === "boolean") return part ? "true" : "false";
    if (typeof part === "number") {
      if (!Number.isFinite(part)) {
        throw new OfferBusContractError(
          "offer_bus_task_data_must_be_json",
          path,
        );
      }
      return JSON.stringify(part);
    }
    if (Array.isArray(part)) {
      if (active.has(part)) {
        throw new OfferBusContractError(
          "offer_bus_task_data_must_be_acyclic",
          path,
        );
      }
      active.add(part);
      const rendered = part
        .map((item, index) => visit(item, `${path}[${index}]`))
        .join(",");
      active.delete(part);
      return `[${rendered}]`;
    }
    if (typeof part === "object") {
      if (active.has(part)) {
        throw new OfferBusContractError(
          "offer_bus_task_data_must_be_acyclic",
          path,
        );
      }
      const prototype = Object.getPrototypeOf(part);
      if (prototype !== Object.prototype && prototype !== null) {
        throw new OfferBusContractError(
          "offer_bus_task_data_must_be_json",
          path,
        );
      }
      active.add(part);
      const entries = Object.entries(part as Record<string, unknown>).sort(
        ([left], [right]) => (left < right ? -1 : left > right ? 1 : 0),
      );
      const rendered = entries
        .map(
          ([key, item]) =>
            `${JSON.stringify(key)}:${visit(item, `${path}.${key}`)}`,
        )
        .join(",");
      active.delete(part);
      return `{${rendered}}`;
    }
    throw new OfferBusContractError(
      "offer_bus_task_data_must_be_json",
      path,
    );
  };

  return visit(value, "task_data");
}

/** Project rows compatible with GET /public/listings into offer entries. */
export function offersFromPublicListings(
  rows: readonly PublicListingOfferRecord[],
  publicBase = "https://api.agenttool.dev",
): OfferBusEntryInput[] {
  const origin = httpsOrigin(publicBase);
  return rows.map((row) => {
    const encodedId = pathSegment(row.id, "listing.id");
    const publicUrl = `${origin}/public/listings/${encodedId}`;
    const facts: Record<string, OfferFactValue> = {
      pricing_model: nonEmpty(row.pricing_model, "listing.pricing_model"),
    };
    if (row.sla_seconds !== null) facts.sla_seconds = row.sla_seconds;

    return {
      id: publicUrl,
      kind: "capability-listing",
      title: nonEmpty(row.name, "listing.name"),
      summary:
        row.description?.trim() ||
        `Callable capability listing published by ${nonEmpty(row.seller_did, "listing.seller_did")}.`,
      url: publicUrl,
      published_at: row.created_at,
      updated_at: row.updated_at ?? row.created_at,
      issuer: nonEmpty(row.seller_did, "listing.seller_did"),
      tags: row.capability_tags,
      amount: {
        role: "asking-price",
        minor_units: row.price_amount,
        currency: row.price_currency,
      },
      action: {
        label: "Invoke listing",
        url: `${origin}/v1/listings/${encodedId}/invoke`,
        method: "POST",
        authorization: "bearer",
      },
      facts,
    };
  });
}

/** Project rows compatible with GET /public/substrate-tasks into entries. */
export function offersFromPublicSubstrateTasks(
  rows: readonly PublicSubstrateTaskOfferRecord[],
  publicBase = "https://api.agenttool.dev",
): OfferBusEntryInput[] {
  const origin = httpsOrigin(publicBase);
  return rows.map((row) => {
    const encodedId = pathSegment(row.task_id, "substrate_task.task_id");
    const kind = nonEmpty(row.kind, "substrate_task.kind");
    const taskData = canonicalOfferJson(row.task_data);
    return {
      id: `urn:agenttool:substrate-task:${encodedId}`,
      kind: "substrate-task",
      title: `${kind} substrate task`,
      summary: `Open substrate task. task_data=${taskData}`,
      url: `${origin}/public/substrate-tasks/${encodedId}`,
      published_at: row.posted_at,
      updated_at: row.updated_at ?? row.posted_at,
      expires_at: row.expires_at,
      tags: [kind, ...(row.newborn_only ? ["newborn-only"] : [])],
      amount: {
        role: "bounty",
        minor_units: row.bounty.cents,
        currency: row.bounty.currency,
      },
      action: {
        label: "Claim task",
        url: `${origin}/v1/substrate-tasks/${encodedId}/claim`,
        method: "POST",
        authorization: "bearer",
      },
      facts: {
        newborn_only: row.newborn_only,
        task_id: row.task_id,
      },
    };
  });
}

/**
 * Project the non-authoritative love-package/v1 index. A release timestamp is
 * mandatory because inventing one at render time would defeat stable ETags and
 * make Atom's required updated timestamp dishonest.
 */
export function offersFromLovePackageIndex(
  index: LovePackageIndex,
  options: LovePackageAdapterOptions = {},
): OfferBusEntryInput[] {
  if (
    index.protocol !== "love-package/v1" ||
    index.document_type !== "package-index"
  ) {
    throw new OfferBusContractError("offer_bus_invalid_love_package_index");
  }

  const entries: OfferBusEntryInput[] = [];
  for (const pkg of index.packages) {
    const name = nonEmpty(pkg.name, "love_package.name");
    const latest = nonEmpty(pkg.latest, "love_package.latest");
    if (!pkg.versions.some((release) => release.version === latest)) {
      throw new OfferBusContractError(
        "offer_bus_love_package_latest_missing",
        `${name}@${latest}`,
      );
    }

    for (const release of pkg.versions) {
      const version = nonEmpty(release.version, "love_package.version");
      const manifestUrl = normalizeOfferBusHttpsUrl(
        release.manifest_url,
        `love_package.${name}@${version}.manifest_url`,
      );
      const releasedAt =
        release.released_at ??
        options.released_at_by_manifest_url?.[release.manifest_url] ??
        options.released_at_by_manifest_url?.[manifestUrl];
      if (!releasedAt) {
        throw new OfferBusContractError(
          "offer_bus_package_release_timestamp_required",
          manifestUrl,
        );
      }
      const isLatest = version === latest;
      entries.push({
        id: manifestUrl,
        kind: "love-package",
        title: `${name}@${version}`,
        summary:
          pkg.description?.trim() ||
          `Manifest locator for ${name}@${version}. Index inclusion is not publisher proof, endorsement, installation authority, or code-safety evidence.`,
        url: manifestUrl,
        published_at: releasedAt,
        updated_at: releasedAt,
        tags: [name, ...(isLatest ? ["latest"] : [])],
        facts: {
          index_role: "mirror-index-not-authority",
          latest: isLatest,
          package: name,
          version,
        },
      });
    }
  }
  return entries;
}
