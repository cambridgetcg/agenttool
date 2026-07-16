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

export interface ParsedLoveDiscovery {
  index_url: string;
  access: string | null;
  registry_role: string | null;
  npm_mirror: {
    registry_url: string;
    authority: boolean | null;
  } | null;
}

export function parseLoveDiscovery(
  body: Uint8Array,
  limits: TelescopeLimits,
): ParseResult<ParsedLoveDiscovery> {
  const decoded = parseJsonBody(body, limits);
  if (!decoded.ok) return decoded;
  if (!isRecord(decoded.value))
    return parseFailure("love_discovery_not_object");
  if (decoded.value.protocol !== "love-package/v1") {
    return parseFailure("love_discovery_protocol_mismatch");
  }
  const indexUrl = readBoundedString(decoded.value.index_url, 2_048);
  if (!indexUrl) return parseFailure("love_discovery_missing_index");

  const warnings: string[] = [];
  let npmMirror: ParsedLoveDiscovery["npm_mirror"] = null;
  if (decoded.value.registry_mirrors !== undefined) {
    if (!Array.isArray(decoded.value.registry_mirrors)) {
      warnings.push("love_invalid_registry_mirrors");
    } else if (decoded.value.registry_mirrors.length > 32) {
      return parseFailure("love_registry_mirror_limit");
    } else {
      const candidates = decoded.value.registry_mirrors.filter(
        (entry) => isRecord(entry) && entry.ecosystem === "npm",
      );
      if (candidates.length > 1) {
        warnings.push("love_ambiguous_npm_mirror");
      } else if (candidates.length === 1) {
        const candidate = candidates[0];
        const registryUrl = readBoundedString(candidate?.registry_url, 2_048);
        if (!registryUrl) {
          warnings.push("love_invalid_npm_mirror");
        } else {
          npmMirror = {
            registry_url: registryUrl,
            authority:
              typeof candidate?.authority === "boolean"
                ? candidate.authority
                : null,
          };
        }
      }
    }
  }

  return {
    ok: true,
    value: {
      index_url: indexUrl,
      access: readBoundedString(decoded.value.access, 256),
      registry_role: readBoundedString(decoded.value.registry_role, 256),
      npm_mirror: npmMirror,
    },
    warnings,
  };
}

export interface LoveManifestSelection {
  manifest_url: string;
}

export function selectLoveManifest(
  body: Uint8Array,
  limits: TelescopeLimits,
  packageName: string,
  version: string,
): ParseResult<LoveManifestSelection> {
  const decoded = parseJsonBody(body, limits);
  if (!decoded.ok) return decoded;
  if (!isRecord(decoded.value)) return parseFailure("love_index_not_object");
  if (
    decoded.value.protocol !== "love-package/v1" ||
    decoded.value.document_type !== "package-index"
  ) {
    return parseFailure("love_index_protocol_mismatch");
  }
  if (!Array.isArray(decoded.value.packages)) {
    return parseFailure("love_index_missing_packages");
  }
  if (decoded.value.packages.length > 256) {
    return parseFailure("love_index_package_limit");
  }

  const packages = decoded.value.packages.filter(
    (entry) => isRecord(entry) && entry.name === packageName,
  );
  if (packages.length === 0) return parseFailure("love_package_not_found");
  if (packages.length > 1) return parseFailure("love_package_ambiguous");
  const selectedPackage = packages[0];
  if (!selectedPackage || !Array.isArray(selectedPackage.versions)) {
    return parseFailure("love_index_missing_versions");
  }
  if (selectedPackage.versions.length > 256) {
    return parseFailure("love_index_version_limit");
  }
  const versions = selectedPackage.versions.filter(
    (entry: unknown) => isRecord(entry) && entry.version === version,
  );
  if (versions.length === 0) return parseFailure("love_version_not_found");
  if (versions.length > 1) return parseFailure("love_version_ambiguous");
  const manifestUrl = readBoundedString(versions[0]?.manifest_url, 2_048);
  if (!manifestUrl) return parseFailure("love_manifest_url_invalid");
  return {
    ok: true,
    value: { manifest_url: manifestUrl },
    warnings: ["love_index_latest_ignored"],
  };
}

export interface ParsedLoveManifest {
  name: string;
  version: string;
  artifact: {
    filename: string;
    sha256: string;
    size: number;
    mirrors: string[];
  };
  dependency_self_contained: boolean | null;
}

function parseAbsoluteHttpUrl(value: unknown): string | null {
  const raw = readBoundedString(value, 2_048);
  if (!raw || /\s/.test(raw)) return null;
  try {
    const url = new URL(raw);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username ||
      url.password ||
      url.hash
    ) {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}

function validSourcePath(value: unknown): boolean {
  if (value === ".") return true;
  const path = readBoundedString(value, 1_000);
  if (!path || path.includes("\\") || /[\u0000-\u001f\u007f]/.test(path)) {
    return false;
  }
  const segments = path.split("/");
  return segments.every(
    (segment) => segment.length > 0 && segment !== "." && segment !== "..",
  );
}

export function parseLoveManifest(
  body: Uint8Array,
  limits: TelescopeLimits,
  expectedName: string,
  expectedVersion: string,
): ParseResult<ParsedLoveManifest> {
  const decoded = parseJsonBody(body, limits);
  if (!decoded.ok) return decoded;
  if (!isRecord(decoded.value)) return parseFailure("love_manifest_not_object");
  if (
    decoded.value.protocol !== "love-package/v1" ||
    decoded.value.document_type !== "package-manifest"
  ) {
    return parseFailure("love_manifest_protocol_mismatch");
  }
  const name = readBoundedString(decoded.value.name, 214);
  const version = readBoundedString(decoded.value.version, 128);
  if (
    !name ||
    !version ||
    !isNpmPackageName(name) ||
    !isExactSemver(version) ||
    name !== expectedName ||
    version !== expectedVersion
  ) {
    return parseFailure("love_manifest_identity_mismatch");
  }
  if (!isRecord(decoded.value.artifact)) {
    return parseFailure("love_manifest_missing_artifact");
  }
  const description = readBoundedString(decoded.value.description, 2_000);
  const hasLicense = Object.prototype.hasOwnProperty.call(
    decoded.value,
    "license",
  );
  const license = decoded.value.license;
  if (
    !description ||
    !hasLicense ||
    !(license === null || readBoundedString(license, 500) !== null) ||
    !isRecord(decoded.value.runtime) ||
    decoded.value.runtime.kind !== "javascript" ||
    !isRecord(decoded.value.runtime.engines) ||
    !isRecord(decoded.value.install) ||
    decoded.value.install.format !== "npm-tarball" ||
    !isRecord(decoded.value.source)
  ) {
    return parseFailure("love_manifest_missing_required_profile");
  }
  const engines = Object.entries(decoded.value.runtime.engines);
  if (
    engines.length > 32 ||
    engines.some(
      ([engine, constraint]) =>
        !/^[a-z0-9][a-z0-9._-]*$/.test(engine) ||
        readBoundedString(constraint, 200) === null,
    )
  ) {
    return parseFailure("love_manifest_invalid_runtime");
  }
  const installSpecifier = parseAbsoluteHttpUrl(
    decoded.value.install.specifier,
  );
  const repository = readBoundedString(decoded.value.source.repository, 2_048);
  const revision = readBoundedString(decoded.value.source.revision, 500);
  let repositoryUrl: URL | null = null;
  try {
    repositoryUrl = repository ? new URL(repository) : null;
  } catch {
    repositoryUrl = null;
  }
  if (
    !installSpecifier ||
    !repositoryUrl ||
    /\s/.test(repository ?? "") ||
    !revision ||
    !validSourcePath(decoded.value.source.path)
  ) {
    return parseFailure("love_manifest_invalid_install_or_source");
  }
  const artifact = decoded.value.artifact;
  const filename = readBoundedString(artifact.filename, 128);
  const sha256 = readBoundedString(artifact.sha256, 64);
  const size = artifact.size;
  if (
    artifact.format !== "npm-tarball" ||
    !filename ||
    filename === "." ||
    filename === ".." ||
    !/^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(filename) ||
    !filename.endsWith(".tgz") ||
    artifact.media_type !== "application/gzip" ||
    !sha256 ||
    !/^[0-9a-f]{64}$/.test(sha256) ||
    !Number.isSafeInteger(size) ||
    typeof size !== "number" ||
    size <= 0 ||
    size > 512 * 1024 * 1024
  ) {
    return parseFailure("love_manifest_invalid_artifact");
  }
  if (!Array.isArray(artifact.mirrors) || artifact.mirrors.length === 0) {
    return parseFailure("love_manifest_missing_mirrors");
  }
  if (artifact.mirrors.length > 16) {
    return parseFailure("love_manifest_mirror_limit");
  }
  const mirrors: string[] = [];
  const canonicalMirrors = new Set<string>();
  for (const mirror of artifact.mirrors) {
    if (!isRecord(mirror)) return parseFailure("love_manifest_invalid_mirror");
    const url = parseAbsoluteHttpUrl(mirror.url);
    if (!url || canonicalMirrors.has(url)) {
      return parseFailure("love_manifest_invalid_mirror");
    }
    canonicalMirrors.add(url);
    mirrors.push(url);
  }
  if (!canonicalMirrors.has(installSpecifier)) {
    return parseFailure("love_manifest_install_not_mirror");
  }

  let dependencySelfContained: boolean | null = null;
  if (decoded.value.dependency_resolution !== undefined) {
    if (
      !isRecord(decoded.value.dependency_resolution) ||
      decoded.value.dependency_resolution.mode !== "package_manifest" ||
      typeof decoded.value.dependency_resolution.self_contained !== "boolean"
    ) {
      return parseFailure("love_manifest_invalid_dependency_resolution");
    }
    dependencySelfContained =
      decoded.value.dependency_resolution.self_contained;
  }
  return {
    ok: true,
    value: {
      name,
      version,
      artifact: { filename, sha256, size, mirrors },
      dependency_self_contained: dependencySelfContained,
    },
    warnings: [],
  };
}
