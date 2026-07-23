import { createHash } from "node:crypto";
import type { Stats } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";

import { isExactSemver, isNpmPackageName, isRecord } from "./parsers/common.js";
import type { ArtifactExpectation } from "./verify.js";

const TAR_BLOCK_BYTES = 512;
const MAX_ARCHIVE_ENTRIES = 10_000;
const MAX_UNCOMPRESSED_BYTES = 512 * 1024 * 1024;
const MAX_PACKAGE_JSON_BYTES = 1024 * 1024;
const MAX_ARCHIVE_PATH_BYTES = 4_096;
const MAX_ARCHIVE_PATH_DEPTH = 32;
const MAX_ARCHIVE_PATH_COMPONENTS = 100_000;
const MAX_COMPRESSED_BYTES = 512 * 1024 * 1024;
const MAX_ARCHIVE_ENTRY_BYTES = 256 * 1024 * 1024;

export interface NpmTarballExpectation extends ArtifactExpectation {
  name: string;
  version: string;
}

export interface NpmTarballInspectionResult {
  ok: boolean;
  code:
    | "verified_npm_tarball"
    | "integrity_mismatch"
    | "invalid_or_unsupported_npm_tarball"
    | "embedded_package_identity_mismatch";
  expected: NpmTarballExpectation;
  actual: {
    size: number | null;
    sha256: string | null;
  };
  archive: {
    entries: number | null;
    package_name: string | null;
    package_version: string | null;
    install_lifecycle_scripts_present: boolean | null;
  };
}

class ArchiveFormatError extends Error {}
class ArchiveIntegrityError extends Error {}
class ArchiveReadError extends Error {}

function readTarString(field: Uint8Array): string {
  const nul = field.indexOf(0);
  const bytes = nul === -1 ? field : field.subarray(0, nul);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ArchiveFormatError("invalid tar text");
  }
}

function readTarOctal(field: Uint8Array): number {
  if ((field[0] ?? 0) >= 0x80) {
    throw new ArchiveFormatError("base-256 tar numbers are unsupported");
  }
  const value = readTarString(field).trim();
  if (!/^[0-7]+$/.test(value))
    throw new ArchiveFormatError("invalid tar number");
  const parsed = Number.parseInt(value, 8);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new ArchiveFormatError("unsafe tar number");
  }
  return parsed;
}

function allZero(bytes: Uint8Array): boolean {
  return bytes.every((value) => value === 0);
}

function verifyTarChecksum(header: Uint8Array): void {
  const expected = readTarOctal(header.subarray(148, 156));
  let actual = 0;
  for (let index = 0; index < TAR_BLOCK_BYTES; index += 1) {
    actual += index >= 148 && index < 156 ? 0x20 : (header[index] ?? 0);
  }
  if (actual !== expected)
    throw new ArchiveFormatError("tar checksum mismatch");
}

function safeArchivePath(path: string): string {
  const normalized = path;
  if (
    normalized.length === 0 ||
    new TextEncoder().encode(normalized).byteLength > MAX_ARCHIVE_PATH_BYTES ||
    normalized.startsWith("/") ||
    normalized.endsWith("/") ||
    normalized.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    throw new ArchiveFormatError("unsafe archive path");
  }
  const segments = normalized.split("/");
  if (
    segments.length > MAX_ARCHIVE_PATH_DEPTH ||
    segments.some(
      (segment) => segment.length === 0 || segment === "." || segment === "..",
    ) ||
    segments[0] !== "package"
  ) {
    throw new ArchiveFormatError("archive left package root");
  }
  for (const segment of segments.slice(1)) {
    const windowsStem = segment.replace(/[. ]+$/g, "").split(".", 1)[0] ?? "";
    if (
      segment.includes(":") ||
      /[. ]$/.test(segment) ||
      /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(windowsStem)
    ) {
      throw new ArchiveFormatError("Windows-unsafe archive path");
    }
  }
  return normalized;
}

interface ParsedHeader {
  path: string;
  size: number;
  directory: boolean;
  capturePackageJson: boolean;
}

function parseHeader(header: Uint8Array): ParsedHeader {
  verifyTarChecksum(header);
  const magic = readTarString(header.subarray(257, 263));
  if (magic !== "ustar")
    throw new ArchiveFormatError("unsupported tar profile");
  const typeByte = header[156] ?? 0;
  const type = typeByte === 0 ? "0" : String.fromCharCode(typeByte);
  if (type !== "0" && type !== "5") {
    throw new ArchiveFormatError(
      "links and special archive entries are rejected",
    );
  }
  const name = readTarString(header.subarray(0, 100));
  const prefix = readTarString(header.subarray(345, 500));
  const path = safeArchivePath(prefix ? `${prefix}/${name}` : name);
  const size = readTarOctal(header.subarray(124, 136));
  const mode = readTarOctal(header.subarray(100, 108));
  if ((mode & 0o6000) !== 0 || size > MAX_ARCHIVE_ENTRY_BYTES) {
    throw new ArchiveFormatError("unsafe mode or oversized archive entry");
  }
  if (path === "package" && type !== "5") {
    throw new ArchiveFormatError("package root must be a directory");
  }
  if (type === "5" && size !== 0) {
    throw new ArchiveFormatError("directory entry has data");
  }
  return {
    path,
    size,
    directory: type === "5",
    capturePackageJson: type === "0" && path === "package/package.json",
  };
}

async function inspectArchive(gunzip: AsyncIterable<unknown>): Promise<{
  entries: number;
  packageJson: Record<string, unknown>;
}> {
  let pending: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  let state: "header" | "data" | "padding" | "ended" = "header";
  let remaining = 0;
  let padding = 0;
  let capture = false;
  let captureLength = 0;
  let captureChunks: Buffer[] = [];
  let packageJsonBytes: Buffer | null = null;
  let entries = 0;
  let zeroBlocks = 0;
  let uncompressedBytes = 0;
  let pathComponents = 0;
  const paths = new Set<string>();
  const requiredDirectories = new Set<string>();

  const finishEntry = () => {
    if (capture) {
      if (packageJsonBytes)
        throw new ArchiveFormatError("duplicate package.json");
      packageJsonBytes = Buffer.concat(captureChunks, captureLength);
    }
    capture = false;
    captureLength = 0;
    captureChunks = [];
  };

  for await (const incoming of gunzip) {
    const chunk = incoming as Buffer;
    uncompressedBytes += chunk.byteLength;
    if (uncompressedBytes > MAX_UNCOMPRESSED_BYTES) {
      throw new ArchiveFormatError("archive expands beyond limit");
    }
    pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);

    while (pending.length > 0) {
      if (state === "ended") {
        if (!allZero(pending))
          throw new ArchiveFormatError("data after tar end");
        pending = Buffer.alloc(0);
        continue;
      }

      if (state === "header") {
        if (pending.length < TAR_BLOCK_BYTES) break;
        const header = pending.subarray(0, TAR_BLOCK_BYTES);
        pending = pending.subarray(TAR_BLOCK_BYTES);
        if (allZero(header)) {
          zeroBlocks += 1;
          if (zeroBlocks === 2) state = "ended";
          continue;
        }
        if (zeroBlocks !== 0) {
          throw new ArchiveFormatError("incomplete tar end marker");
        }
        const parsed = parseHeader(header);
        entries += 1;
        const portablePathKey = parsed.path.normalize("NFC").toLowerCase();
        const pathSegments = portablePathKey.split("/");
        pathComponents += pathSegments.length;
        if (pathComponents > MAX_ARCHIVE_PATH_COMPONENTS) {
          throw new ArchiveFormatError("archive path-component limit exceeded");
        }
        const ancestors: string[] = [];
        let ancestor = "";
        for (const segment of pathSegments.slice(0, -1)) {
          ancestor = ancestor ? `${ancestor}/${segment}` : segment;
          ancestors.push(ancestor);
        }
        if (
          entries > MAX_ARCHIVE_ENTRIES ||
          paths.has(portablePathKey) ||
          ancestors.some(
            (ancestor) =>
              paths.has(ancestor) && !requiredDirectories.has(ancestor),
          ) ||
          (!parsed.directory && requiredDirectories.has(portablePathKey))
        ) {
          throw new ArchiveFormatError("archive entry limit or duplicate path");
        }
        paths.add(portablePathKey);
        if (parsed.directory) requiredDirectories.add(portablePathKey);
        for (const ancestor of ancestors) requiredDirectories.add(ancestor);
        remaining = parsed.size;
        padding =
          (TAR_BLOCK_BYTES - (parsed.size % TAR_BLOCK_BYTES)) % TAR_BLOCK_BYTES;
        capture = parsed.capturePackageJson;
        if (capture && parsed.size > MAX_PACKAGE_JSON_BYTES) {
          throw new ArchiveFormatError("package.json exceeds limit");
        }
        state = remaining === 0 ? "padding" : "data";
        if (remaining === 0) finishEntry();
        continue;
      }

      if (state === "data") {
        const take = Math.min(remaining, pending.length);
        if (capture && take > 0) {
          const bytes = Buffer.from(pending.subarray(0, take));
          captureChunks.push(bytes);
          captureLength += bytes.byteLength;
        }
        pending = pending.subarray(take);
        remaining -= take;
        if (remaining === 0) {
          finishEntry();
          state = "padding";
        }
        continue;
      }

      const take = Math.min(padding, pending.length);
      if (!allZero(pending.subarray(0, take))) {
        throw new ArchiveFormatError("non-zero tar padding");
      }
      pending = pending.subarray(take);
      padding -= take;
      if (padding === 0) state = "header";
    }
  }

  if (state !== "ended" || !packageJsonBytes || entries === 0) {
    throw new ArchiveFormatError("incomplete npm tarball");
  }
  let packageJson: unknown;
  try {
    packageJson = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(packageJsonBytes),
    ) as unknown;
  } catch {
    throw new ArchiveFormatError("invalid package.json");
  }
  if (!isRecord(packageJson))
    throw new ArchiveFormatError("package.json is not an object");
  return { entries, packageJson };
}

async function hashOpenedFile(
  handle: FileHandle,
  size: number,
): Promise<{ size: number; sha256: string | null }> {
  const hash = createHash("sha256");
  let observed = 0;
  const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, Math.max(1, size)));
  while (observed < size) {
    let bytesRead: number;
    try {
      ({ bytesRead } = await handle.read(
        buffer,
        0,
        Math.min(buffer.byteLength, size - observed),
        observed,
      ));
    } catch {
      throw new ArchiveReadError("local artifact read failed");
    }
    if (bytesRead === 0) break;
    hash.update(buffer.subarray(0, bytesRead));
    observed += bytesRead;
  }
  if (observed === size) {
    const probe = Buffer.allocUnsafe(1);
    let bytesRead: number;
    try {
      ({ bytesRead } = await handle.read(probe, 0, 1, observed));
    } catch {
      throw new ArchiveReadError("local artifact read failed");
    }
    if (bytesRead !== 0) observed += 1;
  }
  return {
    size: observed,
    sha256: observed > size ? null : hash.digest("hex"),
  };
}

async function* openedFileChunks(
  handle: FileHandle,
  size: number,
  readState: { operational_failure: boolean },
): AsyncGenerator<Buffer> {
  let position = 0;
  const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, Math.max(1, size)));
  while (position < size) {
    let bytesRead: number;
    try {
      ({ bytesRead } = await handle.read(
        buffer,
        0,
        Math.min(buffer.byteLength, size - position),
        position,
      ));
    } catch {
      readState.operational_failure = true;
      throw new ArchiveReadError("local artifact read failed");
    }
    if (bytesRead === 0) {
      throw new ArchiveIntegrityError("compressed artifact ended early");
    }
    position += bytesRead;
    yield Buffer.from(buffer.subarray(0, bytesRead));
  }
  const probe = Buffer.allocUnsafe(1);
  let bytesRead: number;
  try {
    ({ bytesRead } = await handle.read(probe, 0, 1, position));
  } catch {
    readState.operational_failure = true;
    throw new ArchiveReadError("local artifact read failed");
  }
  if (bytesRead !== 0) {
    throw new ArchiveIntegrityError(
      "compressed artifact grew during verification",
    );
  }
}

function sameStableMetadata(before: Stats, after: Stats): boolean {
  return (
    after.isFile() &&
    before.dev === after.dev &&
    before.ino === after.ino &&
    before.mode === after.mode &&
    before.size === after.size &&
    before.mtimeMs === after.mtimeMs &&
    before.ctimeMs === after.ctimeMs
  );
}

function emptyArchiveResult() {
  return {
    entries: null,
    package_name: null,
    package_version: null,
    install_lifecycle_scripts_present: null,
  } as const;
}

export async function verifyNpmTarballFile(
  path: string,
  expected: NpmTarballExpectation,
): Promise<NpmTarballInspectionResult> {
  if (!isNpmPackageName(expected.name) || !isExactSemver(expected.version)) {
    throw new TypeError(
      "Expected package name and exact SemVer must be valid.",
    );
  }
  if (
    !Number.isSafeInteger(expected.size) ||
    expected.size <= 0 ||
    expected.size > MAX_COMPRESSED_BYTES ||
    !/^[0-9a-f]{64}$/.test(expected.sha256)
  ) {
    throw new TypeError(
      "Expected npm tarball size and lowercase SHA-256 must fit Telescope's verifier limits.",
    );
  }

  const handle = await open(path, "r");
  let firstActual: NpmTarballInspectionResult["actual"] = {
    size: null,
    sha256: null,
  };
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size !== expected.size) {
      return {
        expected,
        actual: {
          size: metadata.isFile() ? metadata.size : null,
          sha256: null,
        },
        ok: false,
        code: "integrity_mismatch",
        archive: emptyArchiveResult(),
      };
    }

    firstActual = await hashOpenedFile(handle, metadata.size);
    if (
      firstActual.size !== expected.size ||
      firstActual.sha256 !== expected.sha256
    ) {
      return {
        expected,
        actual: firstActual,
        ok: false,
        code: "integrity_mismatch",
        archive: emptyArchiveResult(),
      };
    }

    const gunzip = createGunzip();
    const readState = { operational_failure: false };
    const secondHash = createHash("sha256");
    let secondSize = 0;
    const tap = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        secondSize += chunk.byteLength;
        if (secondSize > expected.size) {
          callback(new ArchiveFormatError("compressed artifact changed size"));
          return;
        }
        secondHash.update(chunk);
        callback(null, chunk);
      },
    });
    const pipe = pipeline(
      openedFileChunks(handle, expected.size, readState),
      tap,
      gunzip,
    );
    let inspected: Awaited<ReturnType<typeof inspectArchive>>;
    try {
      inspected = await inspectArchive(gunzip);
      await pipe;
    } catch (error) {
      tap.destroy();
      gunzip.destroy();
      await pipe.catch(() => undefined);
      if (!(error instanceof Error)) throw error;
      if (readState.operational_failure || error instanceof ArchiveReadError) {
        throw new ArchiveReadError("local artifact read failed");
      }
      return {
        expected,
        actual: { size: null, sha256: null },
        ok: false,
        code:
          error instanceof ArchiveIntegrityError
            ? "integrity_mismatch"
            : "invalid_or_unsupported_npm_tarball",
        archive: emptyArchiveResult(),
      };
    }

    const secondActual = {
      size: secondSize,
      sha256: secondHash.digest("hex"),
    };
    if (
      secondActual.size !== expected.size ||
      secondActual.sha256 !== expected.sha256
    ) {
      return {
        expected,
        actual: secondActual,
        ok: false,
        code: "integrity_mismatch",
        archive: emptyArchiveResult(),
      };
    }

    const finalMetadata = await handle.stat();
    if (!sameStableMetadata(metadata, finalMetadata)) {
      return {
        expected,
        actual: {
          size: finalMetadata.isFile() ? finalMetadata.size : null,
          sha256: null,
        },
        ok: false,
        code: "integrity_mismatch",
        archive: emptyArchiveResult(),
      };
    }

    const packageName =
      typeof inspected.packageJson.name === "string"
        ? inspected.packageJson.name
        : null;
    const packageVersion =
      typeof inspected.packageJson.version === "string"
        ? inspected.packageJson.version
        : null;
    const scripts = isRecord(inspected.packageJson.scripts)
      ? inspected.packageJson.scripts
      : {};
    const installLifecycleScriptsPresent = [
      "preinstall",
      "install",
      "postinstall",
      "prepublish",
      "preprepare",
      "prepare",
      "postprepare",
    ].some((name) => typeof scripts[name] === "string");
    const archive = {
      entries: inspected.entries,
      package_name: packageName,
      package_version: packageVersion,
      install_lifecycle_scripts_present: installLifecycleScriptsPresent,
    };
    if (packageName !== expected.name || packageVersion !== expected.version) {
      return {
        expected,
        actual: secondActual,
        ok: false,
        code: "embedded_package_identity_mismatch",
        archive,
      };
    }
    return {
      expected,
      actual: secondActual,
      ok: true,
      code: "verified_npm_tarball",
      archive,
    };
  } finally {
    await handle.close();
  }
}
