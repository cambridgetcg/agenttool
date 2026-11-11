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
 *   - text, including the decoded readings the projection guard checks
 *     (UTF-8 behind a UTF-16 byte-order mark among them);
 *   - gzip and tar archives (npm tarballs), member by member, reported as
 *     <archive>!<member>; a gzip header's name and comment and every tar
 *     header's fields (user and group names among them) are read as text.
 *     A gzip file must be one member with no extra field and nothing after
 *     it; a tar header's text fields must hold nothing after their NUL, its
 *     numbers only octal, its link name nothing unless it is a link, and a
 *     tar whose member padding, or whose bytes after its end marker, are not
 *     all zero is refused;
 *   - PNG files and ICO icons, only when every byte is accounted for. An
 *     icon's header, directory and images run in directory order with no
 *     gap, overlap or trailing byte; each image must be a PNG of at most 256
 *     pixels a side, reported as <icon>!image-<n>. Every PNG, a file or an
 *     icon's image, is non-interlaced and holds only known chunks, each CRC
 *     right, each colour chunk the length PNG gives it, each chunk's data
 *     (every IDAT chunk's among them) read on its own; every text field
 *     (keyword, language tag, translated keyword, text) free of NULs,
 *     compressed text one zlib stream that ends at its chunk's end; its
 *     IDAT data joined and inflated the same way to exactly the rows its
 *     IHDR implies; an empty IEND that ends it. The icon's bytes, the
 *     chunks' data, their text fields and the inflated pixel rows are read as
 *     Latin-1, UTF-8 and UTF-16 as well as for their strings. Any other image
 *     type in an icon is refused;
 *   - the strings of WAV audio and TrueType/OpenType fonts, which store text
 *     uncompressed, once every byte is accounted for: a WAV holds one plain
 *     PCM or float fmt chunk and one data chunk and nothing else; a font's
 *     tables, each of a kind that holds outlines, metrics, layout or names,
 *     tile the file after its table directory, and its name table is read
 *     as Latin-1, UTF-8 and UTF-16 too. A refusal names the chunk or table
 *     it met;
 *   - the served paths and archive member names themselves.
 *
 * What the guard does not read as text: pixel values, palette entries and
 * colour chunks (PLTE, tRNS, gAMA, cHRM, sRGB, pHYs, bKGD) are image bytes,
 * as audio samples and a font's outlines and tables are sound and glyph
 * bytes. The inflated pixel rows and every chunk's data are read on their
 * own, but the guard does not decode them, so text held as numbers, spread
 * across pixels or palette entries, or hidden by PNG row filtering, is not
 * seen. Within what it reads, the guard catches accidents and plain text; it
 * does not claim to catch someone deliberately hiding data in pixel values.
 *
 * A binary in any other format (JPEG, bitmaps, ICO cursors and font
 * collections among them), or a malformed archive, image, icon, audio file or
 * font, cannot be read, so it is refused. So is a
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
import { gunzipSync, inflateRawSync, inflateSync } from "node:zlib";

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
const zero = (bytes: Uint8Array) => bytes.every((byte) => byte === 0);
const NEWLINE = Buffer.from("\n");
const ascii = (bytes: Uint8Array) => Buffer.from(bytes).toString("latin1");
const field = (bytes: Uint8Array) => {
  const end = bytes.indexOf(0);
  return Buffer.from(end < 0 ? bytes : bytes.subarray(0, end)).toString("utf8");
};
/** A 4-byte chunk or table tag as one output token: a byte outside A-Z, a-z, 0-9 and / is written %XX. */
const tagName = (tag: string) => tag.replace(/[^A-Za-z0-9/]/gu, (char) => `%${char.charCodeAt(0).toString(16).padStart(2, "0")}`);
/** A member name as one output token: whitespace, parentheses and % are escaped. */
const memberName = (name: string) =>
  name.replace(/[\s()%]/gu, (char) => `%${char.codePointAt(0)!.toString(16).padStart(2, "0")}`);
const octal = (bytes: Uint8Array) => {
  const text = field(bytes).trim();
  if (!/^[0-7]*$/u.test(text)) throw new Error("tar header number is not octal");
  return text === "" ? 0 : Number.parseInt(text, 8);
};

/** Where each field of a ustar header block starts and ends, name to prefix and the padding after it. */
const TAR_FIELDS = [[0, 100], [100, 108], [108, 116], [116, 124], [124, 136], [136, 148], [148, 156], [156, 157], [157, 257], [257, 263], [263, 265], [265, 297], [297, 329], [329, 337], [337, 345], [345, 500], [500, 512]] as const;
/** The text fields of a ustar header before its prefix: name, link name, user and group names. */
const TAR_TEXT_FIELDS = [[0, 100], [157, 257], [265, 297], [297, 329]] as const;
/** The number fields of a ustar header: mode, ids, size, time, checksum and device numbers. */
const TAR_NUMBER_FIELDS = [[100, 108], [108, 116], [116, 124], [124, 136], [136, 148], [148, 156], [329, 337], [337, 345]] as const;
/** A text field that ends at its first NUL with only zero bytes after it, or fills the field. */
const endsAtNul = (value: Uint8Array) => {
  const nul = value.indexOf(0);
  return nul < 0 || zero(value.subarray(nul));
};
/** A number field: octal digits, spaces and NULs, or (user and group ids only, as GNU tar and node-tar write large ids) base-256. */
const tarNumber = (value: Uint8Array, from: number) => /^[0-7 \0]*$/u.test(ascii(value)) || ((from === 108 || from === 116) && value[0] === 0x80);

function isTar(bytes: Uint8Array): boolean {
  return bytes.length >= 512 && ascii(bytes.subarray(257, 262)) === "ustar";
}

/**
 * The entries of a ustar archive (pax and GNU long names applied) and the
 * fields of its headers with any GNU long-name data, which the caller reads as
 * text, each field on its own (user and group names among them); throws if
 * malformed, or if a byte of a member's padding or after the end marker is not
 * zero. A header must hold nothing a reader skips: each text field ends at its
 * first NUL with only zero bytes after it, each number field holds only octal
 * digits, spaces and NULs (or a base-256 user or group id), the link name is
 * empty unless the entry is a link, and the 12 bytes after the prefix are
 * zero. A prefix of at most 130 bytes may keep an access and a change time,
 * octal, in its last 24 bytes, as star and node-tar (older npm) write them.
 */
function tarEntries(bytes: Uint8Array): { entries: Array<{ name: string; link: string; data: Uint8Array }>; fields: Uint8Array[] } {
  const entries: Array<{ name: string; link: string; data: Uint8Array }> = [];
  const fields: Uint8Array[] = [];
  let offset = 0;
  let longName: string | undefined;
  while (offset + 512 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512);
    if (zero(header)) {
      if (!zero(bytes.subarray(offset))) throw new Error("tar archive has bytes after its end marker");
      return { entries, fields };
    }
    if (ascii(header.subarray(257, 262)) !== "ustar") throw new Error("tar entry without a ustar header");
    let sum = 0;
    for (let index = 0; index < 512; index += 1) sum += index >= 148 && index < 156 ? 0x20 : header[index]!;
    if (sum !== octal(header.subarray(148, 156))) throw new Error("tar header checksum mismatch");
    for (const [from, to] of TAR_TEXT_FIELDS) {
      if (!endsAtNul(header.subarray(from, to))) throw new Error(`tar header field at byte ${from} has bytes after its NUL`);
    }
    const shortPrefix = header.subarray(345, 476);
    const times = (from: number) => /^[0-7 \0]*$/u.test(ascii(header.subarray(from, from + 12)));
    if (!endsAtNul(header.subarray(345, 500)) && !(shortPrefix.includes(0) && endsAtNul(shortPrefix) && times(476) && times(488))) {
      throw new Error("tar header field at byte 345 has bytes after its NUL");
    }
    for (const [from, to] of TAR_NUMBER_FIELDS) {
      if (!tarNumber(header.subarray(from, to), from)) throw new Error(`tar header number at byte ${from} is not octal`);
    }
    if (!zero(header.subarray(500, 512))) throw new Error("tar header has bytes after its prefix");
    for (const [from, to] of TAR_FIELDS) fields.push(header.subarray(from, to));
    const size = octal(header.subarray(124, 136));
    const type = String.fromCharCode(header[156]!);
    if (header[157] !== 0 && type !== "1" && type !== "2") throw new Error("tar entry that is not a link has a link name");
    const start = offset + 512;
    if (start + size > bytes.length) throw new Error("tar entry runs past the archive");
    const data = bytes.subarray(start, start + size);
    offset = start + Math.ceil(size / 512) * 512;
    if (!zero(bytes.subarray(start + size, offset))) throw new Error("tar entry has bytes in its padding");
    if (type === "L") {
      fields.push(data);
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
 * The original file name and comment of a gzip header, which gunzip skips; the
 * caller reads them as text. Throws unless the file is one gzip member and
 * nothing else: no extra field (binary the guard does not read) or reserved
 * flag, and a deflate stream that ends 8 bytes (the CRC and size gunzip
 * checks) before the end of the file, so no second member, whose header
 * gunzip would also skip, and no other bytes follow it.
 */
function gzipHeaderFields(bytes: Uint8Array): Uint8Array {
  const flags = bytes[3] ?? 0;
  if (flags & 0x04) throw new Error("gzip header with an extra field, which the guard does not read");
  if (flags & 0xe0) throw new Error("gzip header with a reserved flag set");
  let end = 10;
  for (const flag of [0x08, 0x10]) {
    if (!(flags & flag)) continue;
    const nul = bytes.indexOf(0, end);
    if (nul < 0) throw new Error("truncated gzip header");
    end = nul + 1;
  }
  const fields = bytes.subarray(10, end);
  if (flags & 0x02) end += 2;
  if (end + 8 > bytes.length) throw new Error("truncated gzip file");
  const fail = (why: string): never => {
    throw new Error(`gzip file ${why}`);
  };
  inflateWhole(bytes.subarray(end, bytes.length - 8), MAX_EXPANDED_BYTES, fail, "first member's compressed data", inflateRawSync);
  return fields;
}

/**
 * Check that a WAV file is accounted for byte by byte: a RIFF size that is the
 * file's, then a plain PCM or float `fmt ` chunk and a `data` chunk of whole
 * sample frames, each padded to an even length with a zero byte, and nothing
 * else. A WAV with any other chunk (LIST metadata among them) throws.
 */
function checkWav(bytes: Uint8Array): void {
  const view = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.readUInt32LE(4) !== bytes.length - 8) throw new Error("WAV whose RIFF size is not its length");
  const order = ["fmt ", "data"];
  let frame = 0;
  let chunks = 0;
  for (let offset = 12; offset < bytes.length; chunks += 1) {
    if (offset + 8 > bytes.length) throw new Error("truncated WAV chunk");
    const id = ascii(bytes.subarray(offset, offset + 4));
    const size = view.readUInt32LE(offset + 4);
    const end = offset + 8 + size + (size % 2);
    if (id !== order[chunks]) throw new Error(`WAV holds a ${tagName(id)} chunk where the guard reads only one fmt chunk, then one data chunk`);
    if (end > bytes.length) throw new Error("WAV chunk runs past the file");
    if (size % 2 === 1 && bytes[end - 1] !== 0) throw new Error("WAV chunk padding that is not zero");
    if (id === "fmt ") {
      const [format, channels, align, bits] = [0, 2, 12, 14].map((at) => (size >= 16 ? view.readUInt16LE(offset + 8 + at) : 0));
      const extension = size === 18 ? view.readUInt16LE(offset + 24) : 0;
      if ((size !== 16 && size !== 18) || extension !== 0 || (format !== 1 && format !== 3) || channels === 0 || bits === 0 || align !== channels! * Math.ceil(bits! / 8)) {
        throw new Error("WAV whose format is not plain PCM or float");
      }
      frame = align!;
    } else if (size % frame !== 0) {
      throw new Error("WAV data that is not whole sample frames");
    }
    offset = end;
  }
  if (chunks !== order.length) throw new Error("WAV without its fmt and data chunks");
}

/**
 * The tables a font may hold: outlines, metrics, layout, variations, colour
 * and names. Tables that embed images or documents (SVG, sbix, CBDT, EBDT and
 * their kin), signatures (DSIG) and any tag not listed are refused.
 */
const FONT_TABLES: ReadonlySet<string> = new Set([
  "cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post", "cvt ", "fpgm", "glyf", "loca", "prep", "gasp",
  "CFF ", "CFF2", "VORG", "BASE", "GDEF", "GPOS", "GSUB", "JSTF", "MATH", "kern", "hdmx", "LTSH", "VDMX", "vhea",
  "vmtx", "PCLT", "avar", "fvar", "gvar", "cvar", "HVAR", "MVAR", "VVAR", "STAT", "COLR", "CPAL",
]);

/**
 * Check that a TrueType or OpenType font (not a collection) is accounted for
 * byte by byte: its table directory, then its tables, each a FONT_TABLES tag
 * named once, at a 4-byte boundary, tiling the rest of the file in offset
 * order with at most 3 zero bytes of padding after each. Throws otherwise.
 * Returns the name table's bytes (empty without one), where a font keeps its
 * text, names outside ASCII stored as UTF-16BE among it.
 */
function checkFont(bytes: Uint8Array): Uint8Array {
  if (ascii(bytes.subarray(0, 4)) === "ttcf") throw new Error("font collection, which the guard does not read");
  const view = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = bytes.length >= 12 ? view.readUInt16BE(4) : 0;
  const directoryEnd = 12 + 16 * count;
  if (count === 0 || directoryEnd > bytes.length) throw new Error("font with a truncated or empty table directory");
  const tables = Array.from({ length: count }, (_, index) => {
    const at = 12 + 16 * index;
    return { tag: ascii(bytes.subarray(at, at + 4)), offset: view.readUInt32BE(at + 8), length: view.readUInt32BE(at + 12) };
  });
  if (new Set(tables.map((table) => table.tag)).size !== count) throw new Error("font names a table twice");
  let next = directoryEnd;
  for (const table of tables.sort((a, b) => a.offset - b.offset)) {
    if (!FONT_TABLES.has(table.tag)) throw new Error(`font holds a ${tagName(table.tag)} table, which the guard does not read`);
    if (table.offset % 4 !== 0 || table.offset < next || table.offset - next > 3 || !zero(bytes.subarray(next, table.offset))) {
      throw new Error("font table that overlaps another or leaves bytes unaccounted for");
    }
    if (table.offset + table.length > bytes.length) throw new Error("font table runs past the file");
    next = table.offset + table.length;
  }
  if (bytes.length - next > 3 || !zero(bytes.subarray(next))) throw new Error("font has bytes after its last table");
  const name = tables.find((table) => table.tag === "name");
  return name === undefined ? new Uint8Array() : bytes.subarray(name.offset, name.offset + name.length);
}

/**
 * The chunks a PNG may hold, in a file or inside an icon: its image, its
 * colour information and the text chunks the guard reads. Only IDAT and text
 * chunks may repeat. iCCP is left out: its profile is binary the guard reads
 * only for strings.
 */
const PNG_CHUNKS: ReadonlySet<string> = new Set(["IHDR", "PLTE", "tRNS", "sRGB", "gAMA", "cHRM", "pHYs", "bKGD", "IDAT", "IEND", "tEXt", "zTXt", "iTXt"]);
const PNG_REPEATABLE: ReadonlySet<string> = new Set(["IDAT", "tEXt", "zTXt", "iTXt"]);
/**
 * The data lengths the PNG specification gives its colour chunks, by IHDR
 * colour type, so none can carry bytes beyond its values: no PLTE in a
 * greyscale image, and no tRNS in one with an alpha channel.
 */
const PNG_LENGTHS: Readonly<Record<string, (length: number, colour: number) => boolean>> = {
  gAMA: (length) => length === 4,
  cHRM: (length) => length === 32,
  sRGB: (length) => length === 1,
  pHYs: (length) => length === 9,
  bKGD: (length, colour) => length === (colour === 3 ? 1 : colour === 0 || colour === 4 ? 2 : 6),
  PLTE: (length, colour) => colour !== 0 && colour !== 4 && length > 0 && length <= 768 && length % 3 === 0,
  tRNS: (length, colour) => (colour === 3 ? length <= 256 : length === (colour === 0 ? 2 : colour === 2 ? 6 : -1)),
};
/** The bit depths PNG allows for each colour type. */
const PNG_DEPTHS: Readonly<Record<number, readonly number[]>> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };

/**
 * Every reading the guard scans of a PNG's text fields, chunk data and pixel
 * rows, of an icon's bytes, and of archive header fields: what the shared
 * reader takes from them, their printable strings, and the whole of them as
 * Latin-1, UTF-8, and UTF-16 in either byte order at either alignment. The
 * full UTF-16 readings keep the text outside ASCII that printable strings
 * leave out, and the UTF-8 reading is kept when a byte-order mark makes the
 * shared reader take the bytes as UTF-16.
 */
function textReadings(bytes: Uint8Array): string {
  const readings = new Set([scannableText(bytes), printableStrings(bytes), ascii(bytes), decodeText(bytes)]);
  for (const encoding of ["utf-16le", "utf-16be"]) {
    for (const start of [0, 1]) readings.add(new TextDecoder(encoding).decode(bytes.subarray(start)));
  }
  return [...readings].join("\n");
}

/**
 * Inflate one zlib stream (or, with inflateRawSync, one raw deflate stream)
 * that must end at the input's last byte, to at most `limit` bytes. zlib stops
 * at a stream's end and ignores what follows, so the input is inflated again
 * without its last byte: a stream that ends there no longer inflates, and one
 * that ended sooner, with bytes after it, still does.
 */
function inflateWhole(input: Uint8Array, limit: number, fail: (why: string) => never, what: string, inflate = inflateSync): Buffer {
  let output: Buffer;
  try {
    output = inflate(input, { maxOutputLength: limit });
  } catch {
    return fail(`has ${what} that does not inflate, or inflates past ${limit} bytes`);
  }
  let ended = false;
  try {
    inflate(input.subarray(0, input.length - 1), { maxOutputLength: limit });
  } catch {
    ended = true;
  }
  if (!ended) fail(`has bytes after the end of its ${what}`);
  return output;
}

/**
 * What a PNG must be: its IHDR's row count and bytes per row (a filter byte
 * and the packed pixels), and how its inflated rows are read as text.
 */
interface StrictPng {
  fail: (why: string) => never;
  colour: number;
  rows: number;
  rowBytes: number;
  readRows: (rows: Uint8Array) => string;
}

/**
 * The pixel rows of a PNG, read as text with png.readRows: all its IDAT data
 * joined, inflated as one zlib stream that ends at the last byte, to exactly
 * the rows its IHDR implies, each opening with a filter type of 0 to 4.
 */
function pixelRows(idat: readonly Uint8Array[], png: StrictPng): string {
  if (idat.length === 0) png.fail("has no PNG IDAT chunk");
  const size = png.rows * png.rowBytes;
  const rows = inflateWhole(Buffer.concat(idat), size, png.fail, "PNG pixel data");
  if (rows.length !== size) png.fail("has PNG pixel data that is not the size its IHDR implies");
  for (let at = 0; at < size; at += png.rowBytes) {
    if (rows[at]! > 4) png.fail("has a PNG row with an unknown filter type");
  }
  return png.readRows(rows);
}

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
 * Text in a PNG's text chunks, and where its IEND chunk ends (undefined
 * without one); throws if malformed. Every field of a text chunk (keyword,
 * iTXt language tag and translated keyword, text, compressed text inflated)
 * is read on its own, with textReadings. Every chunk's CRC must be right,
 * only PNG_CHUNKS may appear, each at most once unless it may repeat, and
 * each chunk's data is read on its own; a keyword is 1 to 79 bytes, no field
 * holds a NUL (so no 16- or 32-bit text hides there), compressed text is one
 * zlib stream (method 0) that ends at the chunk's end, and an iTXt
 * compression flag is 0 or 1; each colour chunk is the length PNG_LENGTHS
 * gives it; the IDAT data is inflated and read (pixelRows); and IEND is empty.
 */
function pngText(bytes: Uint8Array, png: StrictPng): { text: string; end: number | undefined } {
  const texts: string[] = [];
  const seen = new Set<string>();
  const idat: Uint8Array[] = [];
  const fail = png.fail;
  const read = (field: Uint8Array) => {
    if (field.includes(0)) fail("has a NUL in the text of a PNG text chunk");
    texts.push(textReadings(field));
  };
  const keyword = (data: Uint8Array, nul: number) => {
    if (nul < 1 || nul > 79) fail("has a PNG text chunk whose keyword is empty or longer than 79 bytes");
    read(data.subarray(0, nul));
  };
  const inflate = (input: Uint8Array, method: number | undefined) => {
    if (method !== 0) fail("has a PNG text chunk with an unknown compression method");
    return inflateWhole(input, MAX_EXPANDED_BYTES, fail, "compressed PNG text");
  };
  const view = Buffer.from(bytes);
  for (let offset = 8; offset < bytes.length;) {
    if (offset + 12 > bytes.length) throw new Error("truncated PNG chunk");
    const length = view.readUInt32BE(offset);
    const type = ascii(bytes.subarray(offset + 4, offset + 8));
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (offset + 12 + length > bytes.length) throw new Error("truncated PNG chunk");
    if (!PNG_CHUNKS.has(type)) fail(`has a PNG ${tagName(type)} chunk, which the guard does not read`);
    if (seen.has(type) && !PNG_REPEATABLE.has(type)) fail(`repeats its PNG ${type} chunk`);
    seen.add(type);
    if (crc32(bytes.subarray(offset + 4, offset + 8 + length)) !== view.readUInt32BE(offset + 8 + length)) fail(`has a PNG ${type} chunk whose CRC is wrong`);
    if (type === "IEND" && length !== 0) fail("has data inside its PNG IEND chunk");
    if (PNG_LENGTHS[type]?.(length, png.colour) === false) fail(`has a PNG ${type} chunk of a length PNG does not allow for its colour type`);
    offset += 12 + length;
    // Every chunk's data is also read on its own, so the chunk type before it
    // and the CRC after it cannot run into a word at its edges. That holds for
    // each IDAT chunk too: a later one can open, and any one can close, inside
    // a stored block, whose bytes reach the rows unchanged between pixel bytes
    // the author picks.
    texts.push(textReadings(data));
    const nul = data.indexOf(0);
    if (type === "IDAT") {
      idat.push(data);
    } else if (type === "zTXt") {
      if (nul < 0) throw new Error("malformed zTXt chunk");
      keyword(data, nul);
      read(inflate(data.subarray(nul + 2), data[nul + 1]));
    } else if (type === "iTXt") {
      if (nul < 0) throw new Error("malformed iTXt chunk");
      const language = data.indexOf(0, nul + 3);
      const translated = language < 0 ? -1 : data.indexOf(0, language + 1);
      if (translated < 0) throw new Error("malformed iTXt chunk");
      const [flag, method] = [data[nul + 1], data[nul + 2]];
      if ((flag !== 0 && flag !== 1) || method !== 0) fail("has a PNG iTXt chunk with an unknown compression flag or method");
      keyword(data, nul);
      read(data.subarray(nul + 3, language));
      read(data.subarray(language + 1, translated));
      const text = data.subarray(translated + 1);
      read(flag === 1 ? inflate(text, method) : text);
    } else if (type === "tEXt") {
      keyword(data, nul);
      read(data.subarray(nul + 1));
    }
    if (type === "IEND") {
      texts.push(pixelRows(idat, png));
      return { text: texts.join("\n"), end: offset };
    }
  }
  return { text: texts.join("\n"), end: undefined };
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

/**
 * What the guard reads in a PNG, in a file or inside an icon: its printable
 * strings and its chunks' text, read by pngText. Its IHDR must name a valid
 * bit depth for its colour type, compression and filter method 0, no
 * interlacing, at least one pixel a side, and rows the guard may inflate; the
 * PNG must end at its IEND. Inside an icon it is at most 256 pixels a side
 * and its pixel rows are read with textReadings. A PNG file's rows can run to
 * megabytes, so they are read for their printable strings, which keeps the
 * guard's time near what it was. Returns the PNG's size and bits per pixel
 * too, which an icon's directory entry must match.
 */
function strictPng(bytes: Uint8Array, fail: (why: string) => never, inIcon = false): { text: string; width: number; height: number; bits: number } {
  const header = Buffer.from(bytes.subarray(8, 29));
  if (header.length < 21 || header.readUInt32BE(0) !== 13 || ascii(header.subarray(4, 8)) !== "IHDR") fail("is a PNG that does not open with IHDR");
  const [width, height] = [header.readUInt32BE(8), header.readUInt32BE(12)];
  const [depth, colour, compression, filter, interlace] = header.subarray(16, 21);
  const channels = PNG_CHANNELS[colour!];
  if (channels === undefined) fail("is a PNG of an unknown colour type");
  if (!PNG_DEPTHS[colour!]!.includes(depth!)) fail("is a PNG of a bit depth its colour type does not allow");
  if (compression !== 0 || filter !== 0) fail("is a PNG of an unknown compression or filter method");
  if (interlace !== 0) fail("is an interlaced PNG");
  if (width < 1 || height < 1) fail("is an empty PNG");
  if (inIcon && (width > 256 || height > 256)) fail("is a PNG larger than 256 pixels a side");
  const rowBytes = 1 + Math.ceil((width * depth! * channels!) / 8);
  if (height * rowBytes > MAX_EXPANDED_BYTES) fail(`is a PNG whose pixel rows would inflate past ${MAX_EXPANDED_BYTES} bytes`);
  const chunks = pngText(bytes, { fail, colour: colour!, rows: height, rowBytes, readRows: inIcon ? textReadings : printableStrings });
  if (chunks.end !== bytes.length) fail(chunks.end === undefined ? "is a PNG without an IEND chunk" : "has data after its PNG IEND chunk");
  return { text: `${printableStrings(bytes)}\n${chunks.text}`, width, height, bits: depth! * channels! };
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
 * last. Each image must be a PNG, read as a PNG file is (see strictPng) and
 * at most 256 pixels a side; each directory entry names one plane, the image's size, a colour
 * count of 0, and a bit count of 0 or the PNG's bits per pixel. A cursor, any
 * other image type (a bitmap among them, which the guard refuses on its own
 * too), and anything malformed throw, so the caller refuses the file as
 * unreadable.
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
    if (entry.reserved !== 0 || entry.planes !== 1 || !ICO_BIT_COUNTS.includes(entry.bitCount)) fail("has an invalid directory entry");
    if (!startsWith(image, PNG_SIGNATURE)) fail("is not a PNG image");
    const png = strictPng(image, fail, true);
    if (entry.bitCount !== 0 && entry.bitCount !== png.bits) fail("has a bit count its directory entry does not match");
    // The directory names 256 pixels as 0. A PNG image lists no palette count.
    const listed = (pixels: number) => (pixels === 256 ? 0 : pixels);
    if (entry.width !== listed(png.width) || entry.height !== listed(png.height)) fail("has a size its directory entry does not match");
    if (entry.colours !== 0) fail("has a colour count its directory entry does not match");
    return { index: entry.index, bytes: image, text: png.text };
  });
}

/**
 * Read one served file as a reader could: text as text, archives member by
 * member, PNG, ICO, WAV and fonts for the strings they carry. Anything else binary,
 * or a malformed archive, image, icon, audio file or font, is reported as unreadable.
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
        const fields = gzipHeaderFields(content);
        if (fields.length > 0) reading.texts.push({ path: at, text: textReadings(fields) });
        visit(at, gunzipSync(content, { maxOutputLength: MAX_EXPANDED_BYTES }), depth + 1);
      } else if (startsWith(content, [0x00, 0x00, 0x01, 0x00]) || startsWith(content, [0x00, 0x00, 0x02, 0x00])) {
        // An ICO icon: its whole bytes' strings, then each image as that image
        // type is read on its own, reported as <icon>!image-<n>. It is tested
        // before tar, and a file that is both is refused, so a tar reading can
        // never stand in for the icon's.
        if (isTar(content)) throw new Error("ICO that is also a tar archive");
        reading.texts.push({ path: at, text: textReadings(content) });
        for (const image of icoImages(content)) {
          const member = `${at}!image-${image.index}`;
          reading.members.push({ path: member, bytes: image.bytes });
          reading.texts.push({ path: member, text: image.text });
        }
      } else if (isTar(content)) {
        const archive = tarEntries(content);
        // Every header field, each on its own line so none runs into the next,
        // read as Latin-1, UTF-8, UTF-16 and for its strings.
        const fields = Buffer.concat(archive.fields.flatMap((field) => [field, NEWLINE]));
        reading.texts.push({ path: at, text: textReadings(fields) });
        for (const entry of archive.entries) {
          const member = `${at}!${memberName(entry.name)}`;
          reading.names.push(member);
          if (entry.link !== "") reading.names.push(entry.link);
          reading.members.push({ path: member, bytes: entry.data });
          if (entry.data.length > 0) visit(member, entry.data, depth + 1);
        }
      } else if (startsWith(content, PNG_SIGNATURE)) {
        reading.texts.push({ path: at, text: strictPng(content, (why) => { throw new Error(`PNG file ${why}`); }).text });
      } else if (
        (ascii(content.subarray(0, 4)) === "RIFF" && ascii(content.subarray(8, 12)) === "WAVE") ||
        startsWith(content, [0x00, 0x01, 0x00, 0x00]) ||
        ["OTTO", "true", "ttcf"].includes(ascii(content.subarray(0, 4)))
      ) {
        // WAV audio and TrueType/OpenType fonts store their text uncompressed,
        // so once every byte is accounted for, they are read for their
        // printable strings, and a font's name table with every reading
        // textReadings makes, which keeps names outside ASCII (UTF-16BE). The
        // rest of a font is glyph and metric bytes, whose full readings would
        // match by chance.
        if (ascii(content.subarray(0, 4)) === "RIFF") {
          checkWav(content);
          reading.texts.push({ path: at, text: printableStrings(content) });
        } else {
          const names = checkFont(content);
          reading.texts.push({ path: at, text: `${printableStrings(content)}\n${textReadings(names)}` });
        }
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
