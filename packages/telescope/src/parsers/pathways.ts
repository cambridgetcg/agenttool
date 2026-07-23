import type { TelescopeLimits } from "../types.js";
import {
  isExactSemver,
  isNpmPackageName,
  isRecord,
  parseFailure,
  parseJsonBody,
  readBoundedString,
  type ParseResult,
} from "./common.js";

export interface ParsedPathways {
  sdk_version: string;
  npm: {
    package: string;
    authority: boolean | null;
    dist_tags: string | null;
    verification_boundary_present: boolean;
  } | null;
}

export function parsePathways(
  body: Uint8Array,
  limits: TelescopeLimits,
): ParseResult<ParsedPathways> {
  const decoded = parseJsonBody(body, limits);
  if (!decoded.ok) return decoded;
  const root = decoded.value;
  if (!isRecord(root) || !isRecord(root.first_success)) {
    return parseFailure("pathways_missing_first_success");
  }
  const firstSuccess = root.first_success;
  if (!isRecord(firstSuccess.tutorial)) {
    return parseFailure("pathways_missing_tutorial");
  }
  const sdkVersion = readBoundedString(firstSuccess.tutorial.sdk_version, 128);
  if (!sdkVersion || !isExactSemver(sdkVersion)) {
    return parseFailure("pathways_invalid_sdk_version");
  }

  const warnings: string[] = [];
  let npm: ParsedPathways["npm"] = null;
  if (isRecord(firstSuccess.package_discovery)) {
    const candidate = firstSuccess.package_discovery.optional_npm;
    if (candidate !== undefined) {
      if (!isRecord(candidate)) {
        warnings.push("pathways_invalid_optional_npm");
      } else {
        const packageName = readBoundedString(candidate.package, 214);
        if (!packageName || !isNpmPackageName(packageName)) {
          warnings.push("pathways_invalid_npm_package");
        } else {
          npm = {
            package: packageName,
            authority:
              typeof candidate.authority === "boolean"
                ? candidate.authority
                : null,
            dist_tags: readBoundedString(candidate.dist_tags, 256),
            verification_boundary_present:
              readBoundedString(candidate.verification_boundary, 4_096) !==
              null,
          };
        }
      }
    }
  }

  return { ok: true, value: { sdk_version: sdkVersion, npm }, warnings };
}
