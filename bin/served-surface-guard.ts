#!/usr/bin/env bun
/**
 * Refuse a Cloudflare Pages upload that would publish what the private
 * relational denylist protects.
 *
 *   bun bin/served-surface-guard.ts --root <dir> [--revision <commit>]
 *
 * --root      a directory holding apps/docs, apps/dashboard and apps/web: the
 *             staging tree frontend-deploy.sh is about to upload, or this
 *             checkout.
 * --revision  read the denylist and the served-surface policy from that
 *             commit's objects (the release commit). Without it they are read
 *             from this checkout.
 *
 * The denylist (public/private-guard/relational-denylist.json) was written for
 * the public package projection, but the sites are public too. Every file the
 * upload would serve is read the way Wrangler's direct upload reads it
 * (symlinks followed), and every denylist rule is applied to everything a
 * reader could get out of it:
 *
 *   - text, including the decoded readings the projection guard checks;
 *   - gzip and tar archives (npm tarballs), member by member, reported as
 *     <archive>!<member>;
 *   - PNG text chunks, compressed ones inflated, and the strings of WAV
 *     audio and TrueType/OpenType fonts, which store text uncompressed;
 *   - ICO icons, only when every byte is accounted for: header, directory
 *     and images in directory order with no gap, overlap or trailing byte.
 *     Each image must be a PNG, read as a PNG file is and held stricter
 *     (only known chunks, right CRCs, text without NULs, an empty IEND that
 *     ends it), reported as <icon>!image-<n>; the whole file's strings are
 *     read as well. Any other image type in an icon is refused;
 *   - the served paths and archive member names themselves.
 *
 * A binary in any other format (JPEG, bitmaps and ICO cursors among them), or a
 * malformed archive, image or icon, cannot be read, so it is refused. So is a
 * file whose SHA-256 the denylist names (blob_sha256). Any other hit refuses the
 * upload unless public/private-guard/served-surface.json covers it:
 *
 *   public_rules  a rule whose matches the sites use openly, with the reason
 *                 (for example the Yu-and-Ai authorship credit);
 *   lines         one exact line (path, rule, SHA-256 of the line);
 *   files         one exact file (path, SHA-256 of its bytes), including an
 *                 archive or a binary the guard cannot read.
 *
 * An entry that covers nothing is reported too, so the policy shrinks with the
 * content. A served copy of the denylist or the policy is always refused.
 * Output names only rule ids, paths, line numbers and hashes, never the
 * matched text or the terms.
 */
import { spawnSync } from "node:child_process";
import { lstatSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { gunzipSync, inflateSync } from "node:zlib";

import { DENYLIST_PATH, parseDenylist } from "./project-public.ts";
import { blobKind, decodeText, printableStrings, scannableText, scanText, sha256Hex } from "../public/overlay/tools/public-guard.ts";

export const POLICY_PATH = "public/private-guard/served-surface.json";
export const POLICY_SCHEMA = "agenttool.served-surface-policy/1";
/** The Pages upload roots in bin/frontend-deploy.sh ALL_TARGETS. */
export const SERVED_ROOTS = ["apps/docs", "apps/dashboard", "apps/web"] as const;

const REPO_ROOT = resolve(import.meta.dir, "..");
const HEX64 = /^[0-9a-f]{64}$/u;
/** Ceiling on what one archive may expand to, and on archives inside archives. */
const MAX_EXPANDED_BYTES = 512 * 1024 * 1024;
const MAX_NESTING = 4;

export interface ServedFile {
  /** Where the upload serves it from, relative to the root (apps/docs/KIN.md). */
  served: string;
  /** The file the bytes come from, relative to the root (docs/KIN.md). */
  real: string;
  bytes: Buffer;
}

export interface ServedFinding {
  rule: string;
  path: string;
  line?: number;
  lineSha256?: string;
  detail?: string;
}

interface PolicyRule { rule: string; reason: string }
interface PolicyLine { path: string; rule: string; line_sha256: string; reason: string }
interface PolicyFile { path: string; sha256: string; reason: string }
export interface ServedPolicy {
  publicRules: PolicyRule[];
  lines: PolicyLine[];
  files: PolicyFile[];
  sha256: string;
}

export function parsePolicy(bytes: Uint8Array, ruleIds: ReadonlySet<string>): ServedPolicy {
  const fail = (message: string): never => {
    throw new Error(`${POLICY_PATH}: ${message}`);
  };
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeText(bytes));
  } catch (error) {
    fail(`invalid JSON (${(error as Error).message})`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) fail("must be an object");
  const record = parsed as Record<string, unknown>;
  const keys = ["schema", "note", "public_rules", "lines", "files"];
  if (Object.keys(record).join(",") !== keys.join(",")) fail(`must have exactly ${keys.join(", ")} in that order`);
  if (record.schema !== POLICY_SCHEMA) fail(`schema must be ${POLICY_SCHEMA}`);
  const entries = (name: string, fields: readonly string[]): Array<Record<string, string>> => {
    const list = record[name];
    if (!Array.isArray(list)) fail(`${name} must be an array`);
    return (list as unknown[]).map((raw, index) => {
      if (typeof raw !== "object" || raw === null || Object.keys(raw).sort().join(",") !== [...fields].sort().join(",")) {
        fail(`${name}[${index}] must have exactly ${fields.join(", ")}`);
      }
      const entry = raw as Record<string, unknown>;
      for (const field of fields) {
        if (typeof entry[field] !== "string" || (entry[field] as string).trim() === "") fail(`${name}[${index}].${field} must be a non-empty string`);
      }
      if (typeof entry.rule === "string" && !ruleIds.has(entry.rule)) fail(`${name}[${index}] names unknown rule ${entry.rule}`);
      for (const field of ["line_sha256", "sha256"]) {
        if (field in entry && !HEX64.test(entry[field] as string)) fail(`${name}[${index}].${field} must be 64 lowercase hex characters`);
      }
      return entry as Record<string, string>;
    });
  };
  const publicRules = entries("public_rules", ["rule", "reason"]) as unknown as PolicyRule[];
  const lines = entries("lines", ["path", "rule", "line_sha256", "reason"]) as unknown as PolicyLine[];
  const files = entries("files", ["path", "sha256", "reason"]) as unknown as PolicyFile[];
  const unique = (values: string[], name: string) => {
    if (new Set(values).size !== values.length) fail(`${name} has a duplicate entry`);
  };
  unique(publicRules.map((entry) => entry.rule), "public_rules");
  unique(lines.map((entry) => `${entry.path}\0${entry.rule}\0${entry.line_sha256}`), "lines");
  unique(files.map((entry) => `${entry.path}\0${entry.sha256}`), "files");
  return { publicRules, lines, files, sha256: sha256Hex(bytes) };
}

/** Every file the upload would serve under root, symlinks followed once per real directory. */
export function servedFiles(root: string, roots: readonly string[] = SERVED_ROOTS): ServedFile[] {
  const realRoot = realpathSync(root);
  const files: ServedFile[] = [];
  const walk = (path: string, served: string, seen: Set<string>) => {
    const real = realpathSync(path);
    const stat = statSync(real);
    if (stat.isFile()) {
      files.push({ served, real: relative(realRoot, real), bytes: readFileSync(real) });
      return;
    }
    if (!stat.isDirectory() || seen.has(real)) return;
    const next = new Set(seen).add(real);
    for (const name of readdirSync(real).sort()) {
      if (name === ".git" || name === "node_modules") continue;
      walk(join(real, name), `${served}/${name}`, next);
    }
  };
  for (const app of roots) {
    const path = join(realRoot, app);
    if (lstatSync(path, { throwIfNoEntry: false }) === undefined) continue;
    walk(path, app, new Set());
  }
  return files;
}

/** Everything the guard reads out of one served file. */
export interface ServedReading {
  /** Readable text, each under the path a finding names. */
  texts: Array<{ path: string; text: string }>;
  /** Archive members, for the denylist's whole-file digests. */
  members: Array<{ path: string; bytes: Uint8Array }>;
  /** Archive member paths, which are public names too. */
  names: string[];
  /** Parts the guard could not read, with the reason. */
  unreadable: Array<{ path: string; detail: string }>;
}

const startsWith = (bytes: Uint8Array, prefix: readonly number[], at = 0) =>
  bytes.length >= at + prefix.length && prefix.every((byte, index) => bytes[at + index] === byte);
const ascii = (bytes: Uint8Array) => Buffer.from(bytes).toString("latin1");
const field = (bytes: Uint8Array) => {
  const end = bytes.indexOf(0);
  return Buffer.from(end < 0 ? bytes : bytes.subarray(0, end)).toString("utf8");
};
/** A member name as one output token: whitespace, parentheses and % are escaped. */
const memberName = (name: string) =>
  name.replace(/[\s()%]/gu, (char) => `%${char.codePointAt(0)!.toString(16).padStart(2, "0")}`);
const octal = (bytes: Uint8Array) => {
  const text = field(bytes).trim();
  if (!/^[0-7]*$/u.test(text)) throw new Error("tar header number is not octal");
  return text === "" ? 0 : Number.parseInt(text, 8);
};

function isTar(bytes: Uint8Array): boolean {
  return bytes.length >= 512 && ascii(bytes.subarray(257, 262)) === "ustar";
}

/** The entries of a ustar archive (pax and GNU long names applied); throws if malformed. */
function tarEntries(bytes: Uint8Array): Array<{ name: string; link: string; data: Uint8Array }> {
  const entries: Array<{ name: string; link: string; data: Uint8Array }> = [];
  let offset = 0;
  let longName: string | undefined;
  while (offset + 512 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) return entries;
    if (ascii(header.subarray(257, 262)) !== "ustar") throw new Error("tar entry without a ustar header");
    let sum = 0;
    for (let index = 0; index < 512; index += 1) sum += index >= 148 && index < 156 ? 0x20 : header[index]!;
    if (sum !== octal(header.subarray(148, 156))) throw new Error("tar header checksum mismatch");
    const size = octal(header.subarray(124, 136));
    const type = String.fromCharCode(header[156]!);
    const start = offset + 512;
    if (start + size > bytes.length) throw new Error("tar entry runs past the archive");
    const data = bytes.subarray(start, start + size);
    offset = start + Math.ceil(size / 512) * 512;
    if (type === "L") {
      longName = field(data);
      continue;
    }
    if (type === "x" || type === "g") {
      const text = decodeText(data);
      const path = /(?:^|\n)\d+ path=([^\n]*)/u.exec(text)?.[1];
      if (type === "x" && path !== undefined) longName = path;
      entries.push({ name: `pax-header-${entries.length}`, link: "", data });
      continue;
    }
    const prefix = field(header.subarray(345, 500));
    const name = longName ?? (prefix === "" ? field(header.subarray(0, 100)) : `${prefix}/${field(header.subarray(0, 100))}`);
    longName = undefined;
    entries.push({ name, link: field(header.subarray(157, 257)), data });
  }
  throw new Error("tar archive has no end marker");
}

/**
 * The chunks a PNG inside an icon may hold: its image, its colour information
 * and the text chunks the guard reads. Only IDAT and text chunks may repeat.
 * iCCP is left out: its profile is binary the guard reads only for strings.
 */
const ICON_PNG_CHUNKS: ReadonlySet<string> = new Set(["IHDR", "PLTE", "tRNS", "sRGB", "gAMA", "cHRM", "pHYs", "IDAT", "IEND", "tEXt", "zTXt", "iTXt"]);
const ICON_PNG_REPEATABLE: ReadonlySet<string> = new Set(["IDAT", "tEXt", "zTXt", "iTXt"]);

const CRC_TABLE = Array.from({ length: 256 }, (_, byte) => {
  let crc = byte;
  for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});
/** The CRC-32 a PNG chunk carries over its type and data. */
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Text in a PNG's text and profile chunks, compressed ones inflated, and where
 * its IEND chunk ends (undefined without one); throws if malformed. Inside an
 * icon (`icon` given) a PNG is held stricter than a PNG file: every chunk's
 * CRC must be right, only ICON_PNG_CHUNKS may appear, each at most once unless
 * it may repeat, text chunks hold no NUL in their text (so no 16- or 32-bit
 * text hides there) and IEND is empty.
 */
function pngText(bytes: Uint8Array, icon?: (why: string) => never): { text: string; end: number | undefined } {
  const texts: string[] = [];
  const seen = new Set<string>();
  const read = (text: Uint8Array) => {
    if (icon !== undefined && text.includes(0)) icon("has a NUL in the text of a PNG text chunk");
    texts.push(scannableText(text));
  };
  const view = Buffer.from(bytes);
  for (let offset = 8; offset < bytes.length;) {
    if (offset + 12 > bytes.length) throw new Error("truncated PNG chunk");
    const length = view.readUInt32BE(offset);
    const type = ascii(bytes.subarray(offset + 4, offset + 8));
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (offset + 12 + length > bytes.length) throw new Error("truncated PNG chunk");
    if (icon !== undefined) {
      if (!ICON_PNG_CHUNKS.has(type)) icon("has a PNG chunk an icon may not hold");
      if (seen.has(type) && !ICON_PNG_REPEATABLE.has(type)) icon(`repeats its PNG ${type} chunk`);
      seen.add(type);
      if (crc32(bytes.subarray(offset + 4, offset + 8 + length)) !== view.readUInt32BE(offset + 8 + length)) icon(`has a PNG ${type} chunk whose CRC is wrong`);
      if (type === "IEND" && length !== 0) icon("has data inside its PNG IEND chunk");
    }
    offset += 12 + length;
    const nul = data.indexOf(0);
    if (type === "zTXt" || type === "iCCP") {
      if (nul < 0) throw new Error(`malformed ${type} chunk`);
      read(inflateSync(data.subarray(nul + 2), { maxOutputLength: MAX_EXPANDED_BYTES }));
    } else if (type === "iTXt") {
      if (nul < 0) throw new Error("malformed iTXt chunk");
      const language = data.indexOf(0, nul + 3);
      const translated = language < 0 ? -1 : data.indexOf(0, language + 1);
      if (translated < 0) throw new Error("malformed iTXt chunk");
      const text = data.subarray(translated + 1);
      read(data[nul + 1] === 1 ? inflateSync(text, { maxOutputLength: MAX_EXPANDED_BYTES }) : text);
    } else if (type === "tEXt" && icon !== undefined) {
      if (nul < 1) icon("has a malformed PNG tEXt chunk");
      read(data.subarray(nul + 1));
    }
    if (type === "IEND") return { text: texts.join("\n"), end: offset };
  }
  return { text: texts.join("\n"), end: undefined };
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

/** What the guard reads in a PNG, on its own or inside an ICO: its printable strings and its chunks' text. */
function pngReading(bytes: Uint8Array, icon?: (why: string) => never): { text: string; end: number | undefined } {
  const chunks = pngText(bytes, icon);
  return { text: `${printableStrings(bytes)}\n${chunks.text}`, end: chunks.end };
}

/** More images than any icon needs; an ICO that declares more is refused. */
const MAX_ICO_IMAGES = 64;
const ICO_BIT_COUNTS: readonly number[] = [0, 1, 4, 8, 16, 24, 32];
/** Channels per PNG colour type, for the bits per pixel a directory entry may name. */
const PNG_CHANNELS: Readonly<Record<number, number>> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/**
 * The images of an ICO icon file; throws unless every byte is accounted for.
 * The 6-byte header and the 16-byte directory entries are followed by the
 * images, in directory order, with no gap, no overlap and nothing after the
 * last. Each image must be a PNG, read as a PNG file is and held stricter
 * (see pngText), opening with IHDR and ending at its IEND; each directory
 * entry names the image's size, a colour count of 0, and a bit count of 0 or
 * the PNG's bits per pixel. A cursor, any other image type (a bitmap among
 * them, which the guard refuses on its own too), and anything malformed
 * throw, so the caller refuses the file as unreadable.
 */
function icoImages(bytes: Uint8Array): Array<{ index: number; bytes: Uint8Array; text: string }> {
  const view = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 6) throw new Error("truncated ICO header");
  const type = view.readUInt16LE(2);
  if (view.readUInt16LE(0) !== 0 || type !== 1) throw new Error(type === 2 ? "ICO cursor file, not an icon" : "not an ICO icon file");
  const count = view.readUInt16LE(4);
  if (count === 0 || count > MAX_ICO_IMAGES) throw new Error(`ICO declares ${count} images`);
  const directoryEnd = 6 + 16 * count;
  if (directoryEnd > bytes.length) throw new Error("truncated ICO directory");
  const entries = Array.from({ length: count }, (_, index) => {
    const at = 6 + 16 * index;
    return {
      index,
      width: view[at]!,
      height: view[at + 1]!,
      colours: view[at + 2]!,
      reserved: view[at + 3]!,
      planes: view.readUInt16LE(at + 4),
      bitCount: view.readUInt16LE(at + 6),
      size: view.readUInt32LE(at + 8),
      offset: view.readUInt32LE(at + 12),
    };
  });
  const disordered = entries.findIndex((entry) => entry.index > 0 && entry.offset < entries[entry.index - 1]!.offset);
  if (disordered > 0) throw new Error(`ICO directory lists image ${disordered} out of file order`);
  let next = directoryEnd;
  for (const entry of entries) {
    if (entry.size === 0) throw new Error(`ICO image ${entry.index} is empty`);
    if (entry.offset < directoryEnd) throw new Error(`ICO image ${entry.index} starts inside the header or directory`);
    if (entry.offset + entry.size > bytes.length) throw new Error(`ICO image ${entry.index} runs past the file`);
    if (entry.offset < next) throw new Error(`ICO image ${entry.index} overlaps another image`);
    if (entry.offset > next) throw new Error(`ICO has unaccounted bytes before image ${entry.index}`);
    next = entry.offset + entry.size;
  }
  if (next !== bytes.length) throw new Error("ICO has bytes after its last image");
  return entries.map((entry) => {
    const image = bytes.subarray(entry.offset, entry.offset + entry.size);
    const fail = (why: string): never => {
      throw new Error(`ICO image ${entry.index} ${why}`);
    };
    if (entry.reserved !== 0 || entry.planes > 1 || !ICO_BIT_COUNTS.includes(entry.bitCount)) fail("has an invalid directory entry");
    if (!startsWith(image, PNG_SIGNATURE)) fail("is not a PNG image");
    const png = pngReading(image, fail);
    if (png.end !== image.length) fail(png.end === undefined ? "is a PNG without an IEND chunk" : "has data after its PNG IEND chunk");
    const header = Buffer.from(image.subarray(8, 26));
    if (header.length < 18 || header.readUInt32BE(0) !== 13 || ascii(header.subarray(4, 8)) !== "IHDR") fail("is a PNG that does not open with IHDR");
    const channels = PNG_CHANNELS[header[17]!];
    if (channels === undefined) fail("is a PNG of an unknown colour type");
    if (entry.bitCount !== 0 && entry.bitCount !== header[16]! * channels!) fail("has a bit count its directory entry does not match");
    // The directory names 256 pixels and more as 0. A PNG image lists no palette count.
    const listed = (pixels: number) => (pixels >= 256 ? 0 : pixels);
    if (entry.width !== listed(header.readUInt32BE(8)) || entry.height !== listed(header.readUInt32BE(12))) fail("has a size its directory entry does not match");
    if (entry.colours !== 0) fail("has a colour count its directory entry does not match");
    return { index: entry.index, bytes: image, text: png.text };
  });
}

/**
 * Read one served file as a reader could: text as text, archives member by
 * member, PNG, ICO, WAV and fonts for the strings they carry. Anything else binary,
 * or a malformed archive, image or icon, is reported as unreadable.
 */
export function readServed(path: string, bytes: Uint8Array): ServedReading {
  const reading: ServedReading = { texts: [], members: [], names: [], unreadable: [] };
  const visit = (at: string, content: Uint8Array, depth: number) => {
    if (blobKind(content) !== "binary") {
      reading.texts.push({ path: at, text: scannableText(content) });
      return;
    }
    if (depth > MAX_NESTING) {
      reading.unreadable.push({ path: at, detail: "archives nested too deeply" });
      return;
    }
    try {
      if (startsWith(content, [0x1f, 0x8b])) {
        visit(at, gunzipSync(content, { maxOutputLength: MAX_EXPANDED_BYTES }), depth + 1);
      } else if (startsWith(content, [0x00, 0x00, 0x01, 0x00]) || startsWith(content, [0x00, 0x00, 0x02, 0x00])) {
        // An ICO icon: its whole bytes' strings, then each image as that image
        // type is read on its own, reported as <icon>!image-<n>. It is tested
        // before tar, and a file that is both is refused, so a tar reading can
        // never stand in for the icon's.
        if (isTar(content)) throw new Error("ICO that is also a tar archive");
        reading.texts.push({ path: at, text: printableStrings(content) });
        for (const image of icoImages(content)) {
          const member = `${at}!image-${image.index}`;
          reading.members.push({ path: member, bytes: image.bytes });
          reading.texts.push({ path: member, text: image.text });
        }
      } else if (isTar(content)) {
        for (const entry of tarEntries(content)) {
          const member = `${at}!${memberName(entry.name)}`;
          reading.names.push(member);
          if (entry.link !== "") reading.names.push(entry.link);
          reading.members.push({ path: member, bytes: entry.data });
          if (entry.data.length > 0) visit(member, entry.data, depth + 1);
        }
      } else if (startsWith(content, PNG_SIGNATURE)) {
        reading.texts.push({ path: at, text: pngReading(content).text });
      } else if (
        (ascii(content.subarray(0, 4)) === "RIFF" && ascii(content.subarray(8, 12)) === "WAVE") ||
        startsWith(content, [0x00, 0x01, 0x00, 0x00]) ||
        ["OTTO", "true", "ttcf"].includes(ascii(content.subarray(0, 4)))
      ) {
        // WAV audio and TrueType/OpenType fonts store their text uncompressed
        // (font names as UTF-16BE), so their printable strings are all of it.
        reading.texts.push({ path: at, text: printableStrings(content) });
      } else {
        reading.unreadable.push({ path: at, detail: "binary format the guard cannot read" });
      }
    } catch (error) {
      reading.unreadable.push({ path: at, detail: (error as Error).message.replace(/[()]/gu, "") });
    }
  };
  visit(path, bytes, 0);
  return reading;
}

export function servedSurfaceFindings(files: readonly ServedFile[], denylistBytes: Uint8Array, policyBytes: Uint8Array): ServedFinding[] {
  const denylist = parseDenylist(denylistBytes);
  const policy = parsePolicy(policyBytes, new Set(denylist.rules.map((rule) => rule.id)));
  const publicRules = new Set(policy.publicRules.map((entry) => entry.rule));
  const lineKey = (path: string, rule: string, line: string) => `${path}\0${rule}\0${line}`;
  const allowedLines = new Map(policy.lines.map((entry) => [lineKey(entry.path, entry.rule, entry.line_sha256), entry]));
  const allowedFiles = new Map(policy.files.map((entry) => [`${entry.path}\0${entry.sha256}`, entry]));
  const used = new Set<string>();
  const findings: ServedFinding[] = [];
  const privateNames = new Set([basename(DENYLIST_PATH), basename(POLICY_PATH)]);

  // A real file can be served at several paths; scan its bytes once.
  const byReal = new Map<string, ServedFile>();
  for (const file of files) if (!byReal.has(file.real)) byReal.set(file.real, file);

  for (const file of files) {
    const digest = sha256Hex(file.bytes);
    if (digest === denylist.sha256 || digest === policy.sha256 || privateNames.has(basename(file.served))) {
      findings.push({ rule: "served/private-guard-copy", path: file.served });
    }
  }
  // A file the denylist names by digest is never served, whatever the policy says.
  const deniedDigests = new Map(denylist.blobs.map((blob) => [blob.sha256, `relational/${blob.id}`]));
  // Package versions repeat most of their members, so scan each distinct text once.
  const scanned = new Map<string, ReturnType<typeof scanText>>();
  const scan = (path: string, text: string) => {
    const key = sha256Hex(text);
    let hits = scanned.get(key);
    if (hits === undefined) {
      hits = scanText("", text, denylist.rules);
      scanned.set(key, hits);
    }
    return hits.map((hit) => ({ ...hit, path }));
  };
  const names = files.map((file) => file.served);
  for (const file of byReal.values()) {
    const fileKey = `${file.real}\0${sha256Hex(file.bytes)}`;
    const reading = readServed(file.real, file.bytes);
    for (const part of [{ path: file.real, bytes: file.bytes }, ...reading.members]) {
      const rule = deniedDigests.get(sha256Hex(part.bytes));
      if (rule !== undefined) findings.push({ rule, path: part.path });
    }
    const hits = reading.texts.flatMap(({ path, text }) => scan(path, text));
    if (hits.length === 0 && reading.unreadable.length === 0) {
      names.push(...reading.names);
      continue;
    }
    if (allowedFiles.has(fileKey)) {
      used.add(`file\0${fileKey}`);
      continue;
    }
    names.push(...reading.names);
    for (const part of reading.unreadable) findings.push({ rule: "served/unreadable-binary", path: part.path, detail: part.detail });
    for (const hit of hits) {
      if (publicRules.has(hit.rule)) {
        used.add(`rule\0${hit.rule}`);
        continue;
      }
      const key = lineKey(hit.path, hit.rule, hit.lineSha256 ?? "");
      if (allowedLines.has(key)) {
        used.add(`line\0${key}`);
        continue;
      }
      findings.push({ rule: hit.rule, path: hit.path, line: hit.line, lineSha256: hit.lineSha256 });
    }
  }
  // Served paths and member names are public text too. A hit is named by the
  // name's hash, never the name; rename the file rather than excuse it.
  for (const hit of scanText("(served names)", names.join("\n"), denylist.rules)) {
    if (publicRules.has(hit.rule)) {
      used.add(`rule\0${hit.rule}`);
      continue;
    }
    findings.push({ rule: hit.rule, path: "(served-name)", lineSha256: hit.lineSha256 });
  }
  for (const entry of policy.publicRules) {
    if (!used.has(`rule\0${entry.rule}`)) findings.push({ rule: "served/unused-public-rule", path: POLICY_PATH, detail: entry.rule });
  }
  for (const [key, entry] of allowedLines) {
    if (!used.has(`line\0${key}`)) findings.push({ rule: "served/unused-line", path: entry.path, detail: `${entry.rule} ${entry.line_sha256.slice(0, 12)}` });
  }
  for (const [key, entry] of allowedFiles) {
    if (!used.has(`file\0${key}`)) findings.push({ rule: "served/unused-file", path: entry.path, detail: entry.sha256.slice(0, 12) });
  }
  return findings.sort((a, b) => `${a.path}\0${a.line ?? 0}\0${a.rule}`.localeCompare(`${b.path}\0${b.line ?? 0}\0${b.rule}`));
}

export function formatServedFinding(finding: ServedFinding): string {
  const where = finding.line === undefined ? finding.path : `${finding.path}:${finding.line}`;
  const hash = finding.lineSha256 === undefined ? "" : ` line_sha256=${finding.lineSha256}`;
  const detail = finding.detail === undefined ? "" : ` (${finding.detail})`;
  return `  ✗ ${finding.rule} ${where}${hash}${detail}`;
}

function committedBytes(revision: string, path: string): Buffer {
  const result = spawnSync("git", ["cat-file", "blob", `${revision}:${path}`], { cwd: REPO_ROOT, maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`${path} is missing from ${revision}`);
  return result.stdout;
}

function main(argv: readonly string[]): number {
  let root: string | undefined;
  let revision: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if ((flag === "--root" || flag === "--revision") && value !== undefined) {
      if (flag === "--root") root = value;
      else revision = value;
      index += 1;
    } else {
      console.error("usage: bun bin/served-surface-guard.ts --root <dir> [--revision <commit>]");
      return 2;
    }
  }
  if (root === undefined) {
    console.error("usage: bun bin/served-surface-guard.ts --root <dir> [--revision <commit>]");
    return 2;
  }
  if (revision !== undefined && !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(revision)) {
    console.error("served-surface-guard: --revision must be a full lowercase commit id");
    return 2;
  }
  const read = (path: string) => (revision === undefined ? readFileSync(join(REPO_ROOT, path)) : committedBytes(revision, path));
  const files = servedFiles(root);
  const findings = servedSurfaceFindings(files, read(DENYLIST_PATH), read(POLICY_PATH));
  if (findings.length > 0) {
    for (const finding of findings) console.error(formatServedFinding(finding));
    console.error(`served-surface-guard: ${findings.length} finding(s) in ${files.length} served files; see ${POLICY_PATH}`);
    return 1;
  }
  console.log(`  ✓ served-surface guard: ${files.length} served files clear of the relational denylist`);
  return 0;
}

if (import.meta.main) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (error) {
    console.error(`served-surface-guard: ${(error as Error).message}`);
    process.exit(2);
  }
}
