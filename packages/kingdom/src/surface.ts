import {
  defineSurfaceManifest,
  type SurfaceManifest,
} from "@agenttool/xenia/surface-0.1";
import { isRecord } from "./internal.js";
import type { KingdomSurfaceManifestOptions } from "./types.js";

const OPTION_KEYS = new Set([
  "serviceName",
  "canonicalUrl",
  "registryUrl",
  "description",
  "documentationUrl",
]);

export const KINGDOM_SURFACE_NOT_COVERED = Object.freeze([
  "verification of declared dependency reachability",
  "verification that declared rights are practised",
  "KINGDOM card or registry conformance certification",
  "permissions, authority, and covenant adoption",
] as const);

/**
 * Defines a conservative XENIA Surface manifest for a hosted KINGDOM registry.
 *
 * This declares one unauthenticated JSON resource and no behavioral claims.
 * XENIA's producer validates same-origin URLs and the release-pinned wire shape.
 */
export function createKingdomSurfaceManifest(
  options: KingdomSurfaceManifestOptions,
): SurfaceManifest {
  if (!isRecord(options)) {
    throw new TypeError("options must be an object");
  }
  for (const key of Object.keys(options)) {
    if (!OPTION_KEYS.has(key)) {
      throw new TypeError(`options.${key} is not defined`);
    }
  }
  const description =
    options.description ??
    "A derived, read-only KINGDOM project registry of card declarations.";
  return defineSurfaceManifest({
    service: {
      name: options.serviceName,
      canonicalUrl: options.canonicalUrl,
      description,
    },
    resources: [
      {
        id: "kingdom-registry",
        href: options.registryUrl,
        representations: ["application/json"],
        defaultMediaType: "application/json",
        description:
          "Derived project metadata with dependency edges and adoption declarations kept separate.",
      },
    ],
    claims: [],
    notCovered: KINGDOM_SURFACE_NOT_COVERED,
    ...(options.documentationUrl === undefined
      ? {}
      : { documentation: options.documentationUrl }),
  });
}
