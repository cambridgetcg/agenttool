/** The private relational denylist guards the three sites, not only the package projection.
 *
 * Reads repository files and writes only a scratch directory: no network,
 * credentials, or deployment. Guard: bin/served-surface-guard.ts. Policy:
 * public/private-guard/served-surface.json. Findings carry rule ids, paths,
 * line numbers and line hashes, so a failure never prints protected text.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { deflateSync, gzipSync } from "node:zlib";

import { DENYLIST_PATH, parseDenylist, reachesPrivateArea } from "../project-public.ts";
import { scanText, sha256Hex } from "../../public/overlay/tools/public-guard.ts";
import { formatServedFinding, POLICY_PATH, readServed, SERVED_ROOTS, servedFiles, servedSurfaceFindings, type ServedFile } from "../served-surface-guard.ts";

const ROOT = resolve(import.meta.dir, "../..");
const bytes = (path: string) => readFileSync(join(ROOT, path));
const text = (path: string) => bytes(path).toString("utf8");
/** Names bin/frontend-deploy.sh deletes from the staging tree before upload. */
const NOT_UPLOADED = [".gitignore", "CLAUDE.md", "AGENTS.md", "README.md"] as const;
const scratch: string[] = [];

afterAll(() => {
  for (const path of scratch) rmSync(path, { recursive: true, force: true });
});

/** What the three Pages projects would upload from this checkout. */
function uploadSet() {
  return servedFiles(ROOT).filter((file) => !(NOT_UPLOADED as readonly string[]).includes(basename(file.served)));
}

/** docs/THE-SEAT.md stays in the repository precisely because it is private. */
const PRIVATE_TEXT = () => bytes("docs/THE-SEAT.md");

/** A minimal ustar archive of regular files. */
function tarOf(entries: ReadonlyArray<readonly [string, Uint8Array]>): Buffer {
  const blocks: Buffer[] = [];
  for (const [name, data] of entries) {
    const header = Buffer.alloc(512);
    header.write(name, 0, 100, "utf8");
    header.write("0000644\0", 100);
    header.write("0000000\0", 108);
    header.write("0000000\0", 116);
    header.write(`${data.length.toString(8).padStart(11, "0")}\0`, 124);
    header.write("00000000000\0", 136);
    header.fill(0x20, 148, 156);
    header.write("0", 156);
    header.write("ustar\0", 257);
    header.write("00", 263);
    const sum = header.reduce((total, byte) => total + byte, 0);
    header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148);
    blocks.push(header, Buffer.from(data), Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  return Buffer.concat([...blocks, Buffer.alloc(1024)]);
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** A PNG chunk with its CRC, which the guard checks for a PNG inside an icon. */
function pngChunk(type: string, data: Uint8Array): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(Bun.hash.crc32(Buffer.concat([Buffer.from(type, "latin1"), Buffer.from(data)])) >>> 0);
  return Buffer.concat([length, Buffer.from(type, "latin1"), Buffer.from(data), crc]);
}

/** A 1x1 RGBA PNG with one blank pixel whose only text is a compressed zTXt chunk. */
function pngWithCompressedText(text: Uint8Array): Buffer {
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0])),
    pngChunk("zTXt", Buffer.concat([Buffer.from("Comment\0", "latin1"), Buffer.from([0]), deflateSync(text)])),
    pngChunk("IDAT", deflateSync(Buffer.alloc(5))),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

const CHANNELS: Readonly<Record<number, number>> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
interface PngOptions {
  /** Chunks after IHDR. */
  extra?: Buffer[];
  /** IEND's body. */
  iend?: Buffer;
  /** The chunks between the signature and IDAT, in place of IHDR and extra. */
  head?: Buffer[];
  /** IHDR's bit depth, colour type (default 8-bit RGBA), and compression, filter and interlace bytes. */
  depth?: number;
  colour?: number;
  methods?: readonly [number, number, number];
  /** The unfiltered rows (default blank), or IDAT's whole body; null leaves IDAT out. */
  rows?: Buffer;
  idat?: Buffer | null;
}

/** The bytes per row of a square PNG: a filter byte and the packed pixels. */
const rowBytes = (pixels: number, depth = 8, colour = 6) => 1 + Math.ceil((pixels * depth * CHANNELS[colour]!) / 8);

/** A square PNG, by default 8-bit RGBA with blank pixels. */
function pngOf(pixels: number, options: PngOptions = {}): Buffer {
  const [depth, colour] = [options.depth ?? 8, options.colour ?? 6];
  const header = Buffer.alloc(13);
  header.writeUInt32BE(pixels, 0);
  header.writeUInt32BE(pixels, 4);
  header.set([depth, colour, ...(options.methods ?? [0, 0, 0])], 8);
  const idat = options.idat === undefined ? deflateSync(options.rows ?? Buffer.alloc(pixels * rowBytes(pixels, depth, colour))) : options.idat;
  return Buffer.concat([
    PNG_SIGNATURE,
    ...(options.head ?? [pngChunk("IHDR", header), ...(options.extra ?? [])]),
    ...(idat === null ? [] : [pngChunk("IDAT", idat)]),
    pngChunk("IEND", options.iend ?? Buffer.alloc(0)),
  ]);
}

/** Blank rows of a square 8-bit RGBA PNG with `content` at the start of the first row's pixels. */
function rowsHolding(pixels: number, content: Uint8Array): Buffer {
  const rows = Buffer.alloc(pixels * rowBytes(pixels));
  rows.set(content, 1);
  return rows;
}

/** A square 32-bit bitmap as an ICO stores it: BITMAPINFOHEADER, colour rows, then 1-bit mask rows. The guard refuses it. */
function bitmapOf(pixels: number): Buffer {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(pixels, 4);
  header.writeInt32LE(pixels * 2, 8);
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  return Buffer.concat([header, Buffer.alloc(pixels * pixels * 4), Buffer.alloc(Math.ceil(pixels / 32) * 4 * pixels)]);
}

/**
 * An ICO file: header, one 16-byte directory entry per image, then the images
 * in order. Options rewrite the header or an entry without moving the bytes.
 */
function icoOf(
  images: ReadonlyArray<readonly [pixels: number, image: Buffer]>,
  options: { type?: number; count?: number; offsets?: number[]; sizes?: number[]; bitCounts?: number[] } = {},
): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(options.type ?? 1, 2);
  header.writeUInt16LE(options.count ?? images.length, 4);
  const directory = Buffer.alloc(16 * images.length);
  let offset = header.length + directory.length;
  images.forEach(([pixels, image], index) => {
    directory.set([pixels % 256, pixels % 256], 16 * index);
    directory.writeUInt16LE(1, 16 * index + 4);
    directory.writeUInt16LE(options.bitCounts?.[index] ?? 32, 16 * index + 6);
    directory.writeUInt32LE(options.sizes?.[index] ?? image.length, 16 * index + 8);
    directory.writeUInt32LE(options.offsets?.[index] ?? offset, 16 * index + 12);
    offset += image.length;
  });
  return Buffer.concat([header, directory, ...images.map(([, image]) => image)]);
}

const served = (path: string, content: Uint8Array): ServedFile => ({ served: path, real: path, bytes: Buffer.from(content) });
const ownFindings = (findings: ReturnType<typeof servedSurfaceFindings>, path: string) =>
  findings.filter((finding) => finding.path === path || finding.path.startsWith(`${path}!`));

/**
 * A private term a rule finds in docs/THE-SEAT.md and finds again on its own,
 * from a rule the policy does not make public. Taken at run time, so no term
 * is written here; never printed.
 */
function privateTerm(accept: (term: string) => boolean): string {
  const rules = parseDenylist(bytes(DENYLIST_PATH)).rules;
  const publicRules = new Set((JSON.parse(text(POLICY_PATH)).public_rules as Array<{ rule: string }>).map((entry) => entry.rule));
  const content = PRIVATE_TEXT().toString("utf8");
  const found = (term: string) => scanText("term", term, rules).some((hit) => !publicRules.has(hit.rule));
  for (const hit of scanText("seat", content, rules)) {
    if (publicRules.has(hit.rule)) continue;
    const rule = rules.find((candidate) => candidate.id === hit.rule)!;
    const line = content.split("\n")[hit.line! - 1]!;
    for (const match of line.matchAll(new RegExp(rule.pattern.source, rule.pattern.flags.includes("g") ? rule.pattern.flags : `${rule.pattern.flags}g`))) {
      if (found(match[0]) && accept(match[0])) return match[0];
    }
  }
  throw new Error("docs/THE-SEAT.md holds no private term this test can use");
}
/** An ASCII term of six or more characters that fits a PNG keyword. */
const asciiTerm = () => privateTerm((term) => /^[\x20-\x7e]{6,79}$/u.test(term));
/** A term written only in characters above U+00FF, whose UTF-16 holds no NUL byte. */
const wideTerm = () => privateTerm((term) => [...term].every((char) => char.codePointAt(0)! > 0xff));
const utf16be = (value: string) => Buffer.from(value, "utf16le").swap16();
const latin1 = (value: string) => Buffer.from(value, "latin1");
/** ASCII text stored 32 bits a character. */
const utf32 = (value: string, little: boolean) => {
  const out = Buffer.alloc(value.length * 4);
  for (let index = 0; index < value.length; index += 1) out[little ? index * 4 : index * 4 + 3] = value.charCodeAt(index);
  return out;
};

/** A copy of a ustar archive with `value` written into its first header at `at`, checksum redone. */
function withHeaderField(archive: Buffer, at: number, value: Buffer): Buffer {
  const changed = Buffer.from(archive);
  value.copy(changed, at);
  changed.fill(0x20, 148, 156);
  const sum = changed.subarray(0, 512).reduce((total, byte) => total + byte, 0);
  changed.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148);
  return changed;
}

/** A gzip file whose header carries `value` in the field `flag` names (0x08 file name, 0x10 comment). */
function gzipWithHeaderField(content: Buffer, flag: number, value: Buffer): Buffer {
  const gzip = gzipSync(content);
  const header = Buffer.from(gzip.subarray(0, 10));
  header[3] = flag;
  return Buffer.concat([header, value, Buffer.from([0]), gzip.subarray(10)]);
}

/** A RIFF chunk, padded to an even length. */
function riffChunk(id: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.write(id, "latin1");
  head.writeUInt32LE(data.length, 4);
  return Buffer.concat([head, data, Buffer.alloc(data.length % 2)]);
}

/** A WAV file: RIFF, WAVE, then the chunks (by default 16-bit mono PCM and `samples`). */
function wavOf(samples: Buffer, chunks?: Buffer[]): Buffer {
  const format = Buffer.alloc(16);
  [1, 1].forEach((value, index) => format.writeUInt16LE(value, index * 2));
  format.writeUInt32LE(8000, 4);
  format.writeUInt32LE(16000, 8);
  format.writeUInt16LE(2, 12);
  format.writeUInt16LE(16, 14);
  const body = Buffer.concat([latin1("WAVE"), ...(chunks ?? [riffChunk("fmt ", format), riffChunk("data", samples)])]);
  const head = Buffer.alloc(8);
  head.write("RIFF", "latin1");
  head.writeUInt32LE(body.length, 4);
  return Buffer.concat([head, body]);
}

/** A font: the sfnt header and table directory, then each table at a 4-byte boundary. */
function fontOf(tables: ReadonlyArray<readonly [tag: string, data: Buffer]>, magic: Buffer = Buffer.from([0, 1, 0, 0])): Buffer {
  const directory = Buffer.alloc(12 + 16 * tables.length);
  magic.copy(directory);
  directory.writeUInt16BE(tables.length, 4);
  let offset = directory.length;
  const bodies = tables.map(([tag, data], index) => {
    directory.write(tag, 12 + 16 * index, "latin1");
    directory.writeUInt32BE(offset, 12 + 16 * index + 8);
    directory.writeUInt32BE(data.length, 12 + 16 * index + 12);
    const padded = Buffer.concat([data, Buffer.alloc((4 - (data.length % 4)) % 4)]);
    offset += padded.length;
    return padded;
  });
  return Buffer.concat([directory, ...bodies]);
}

describe("served surface relational guard", () => {
  test("the upload set publishes nothing the denylist protects", () => {
    const findings = servedSurfaceFindings(uploadSet(), bytes(DENYLIST_PATH), bytes(POLICY_PATH));
    expect(findings.map(formatServedFinding)).toEqual([]);
  });

  test("the guard reads the deploy's upload roots and runs after its deletions, before any upload", () => {
    const deploy = text("bin/frontend-deploy.sh");
    const block = deploy.match(/^ALL_TARGETS=\(\n([\s\S]*?)\n\)/m)?.[1] ?? "";
    const roots = [...block.matchAll(/^\s*"[a-z]+\|([^|"]+)\|[^|"]+"\s*$/gm)].map((match) => match[1]);
    expect(roots).toEqual([...SERVED_ROOTS]);
    for (const name of NOT_UPLOADED) expect(deploy.includes(`-name '${name}'`)).toBe(true);
    const guard = deploy.indexOf('bin/served-surface-guard.ts --root "$STAGE_ROOT" --revision "$COMMIT_HASH"');
    expect(guard).toBeGreaterThan(deploy.indexOf("-name 'README.md'"));
    expect(guard).toBeLessThan(deploy.indexOf("wrangler pages deploy"));
    expect(guard).toBeLessThan(deploy.indexOf("deploy_one \"$arg\""));
  });

  test("the denylist and the policy are never uploaded or projected", () => {
    const releasePaths = text("bin/frontend-release-paths.txt").split("\n").map((line) => line.trim());
    expect(releasePaths.filter((path) => path === "public" || path.startsWith("public/"))).toEqual([]);
    expect(reachesPrivateArea(POLICY_PATH, "blob")).toBe(true);
    expect(reachesPrivateArea(DENYLIST_PATH, "blob")).toBe(true);
    const guarded = new Set([sha256Hex(bytes(DENYLIST_PATH)), sha256Hex(bytes(POLICY_PATH))]);
    expect(servedFiles(ROOT).filter((file) => guarded.has(sha256Hex(file.bytes))).map((file) => file.served)).toEqual([]);
  });

  test("operator identifiers and machine paths stay off the sites", () => {
    const projectRef = text("supabase/config.toml").match(/^project_id = "([a-z]{20})"$/m)?.[1];
    expect(projectRef?.length).toBe(20);
    const findings: string[] = [];
    for (const file of uploadSet()) {
      const content = file.bytes.toString("latin1");
      if (content.includes(projectRef!)) findings.push(`${file.served}: database project id`);
      if (/\/Users\/[a-z][a-z0-9._-]*\//.test(content)) findings.push(`${file.served}: machine home path`);
    }
    expect(findings).toEqual([]);
  });

  test("a private document, a symlink to one, and a denylist copy are refused by rule id only", () => {
    const stage = mkdtempSync(join(tmpdir(), "served-surface-guard-"));
    scratch.push(stage);
    for (const dir of [...SERVED_ROOTS, "docs"]) mkdirSync(join(stage, dir), { recursive: true });
    copyFileSync(join(ROOT, "docs/THE-SEAT.md"), join(stage, "apps/docs/THE-SEAT.md"));
    copyFileSync(join(ROOT, "docs/THE-SEAT.md"), join(stage, "docs/linked.md"));
    symlinkSync("../../docs/linked.md", join(stage, "apps/dashboard/linked.md"));
    copyFileSync(join(ROOT, DENYLIST_PATH), join(stage, "apps/web/terms.json"));

    const findings = servedSurfaceFindings(servedFiles(stage), bytes(DENYLIST_PATH), bytes(POLICY_PATH));
    const rules = (path: string) => findings.filter((finding) => finding.path === path).map((finding) => finding.rule);
    expect(rules("apps/docs/THE-SEAT.md").some((rule) => rule.startsWith("relational/"))).toBe(true);
    expect(rules("docs/linked.md").some((rule) => rule.startsWith("relational/"))).toBe(true);
    expect(rules("apps/web/terms.json")).toContain("served/private-guard-copy");
    // Allowances that cover nothing in this scratch tree are reported, so the policy shrinks with the content.
    expect(findings.some((finding) => finding.rule === "served/unused-public-rule")).toBe(true);
    expect(findings.some((finding) => finding.rule === "served/unused-file")).toBe(true);
    for (const line of findings.map(formatServedFinding)) {
      expect(/^ {2}✗ \S+ \S+( line_sha256=[0-9a-f]{64})?( \([^)]*\))?$/u.test(line)).toBe(true);
    }
  });

  test("a compressed archive is read member by member", () => {
    const archive = "apps/docs/packages/demo.tgz";
    const tgz = gzipSync(tarOf([["package/README.md", Buffer.from("A neutral readme.\n")], ["package/dist/private.md", PRIVATE_TEXT()]]));
    const findings = ownFindings(servedSurfaceFindings([served(archive, tgz)], bytes(DENYLIST_PATH), bytes(POLICY_PATH)), archive);
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((finding) => finding.path === `${archive}!package/dist/private.md` && finding.rule.startsWith("relational/"))).toBe(true);
    expect(findings.every((finding) => finding.line !== undefined && /^[0-9a-f]{64}$/u.test(finding.lineSha256 ?? ""))).toBe(true);

    // The same archive, bound by an exact files entry, passes; any other bytes do not.
    const policy = JSON.parse(text(POLICY_PATH));
    policy.files.push({ path: archive, sha256: sha256Hex(tgz), reason: "test" });
    const allowed = Buffer.from(JSON.stringify(policy));
    expect(ownFindings(servedSurfaceFindings([served(archive, tgz)], bytes(DENYLIST_PATH), allowed), archive)).toEqual([]);
    const changed = gzipSync(tarOf([["package/dist/private.md", PRIVATE_TEXT()]]));
    expect(ownFindings(servedSurfaceFindings([served(archive, changed)], bytes(DENYLIST_PATH), allowed), archive).length).toBeGreaterThan(0);
  });

  test("text a PNG keeps in a compressed chunk is read", () => {
    const image = "apps/web/card.png";
    const findings = ownFindings(servedSurfaceFindings([served(image, pngWithCompressedText(PRIVATE_TEXT()))], bytes(DENYLIST_PATH), bytes(POLICY_PATH)), image);
    expect(findings.some((finding) => finding.rule.startsWith("relational/"))).toBe(true);
  });

  test("an ICO whose every byte is accounted for is read image by image", () => {
    const icon = "apps/web/favicon.ico";
    const clear = (content: Uint8Array) => ownFindings(servedSurfaceFindings([served(icon, content)], bytes(DENYLIST_PATH), bytes(POLICY_PATH)), icon);
    expect(clear(icoOf([[16, pngOf(16)], [32, pngOf(32)]]))).toEqual([]);
    expect(clear(icoOf([[16, pngOf(16, { extra: [pngChunk("sRGB", Buffer.from([0])), pngChunk("tEXt", Buffer.from("Software\0a neutral tool", "latin1"))] })]]))).toEqual([]);
    const neutralText = [
      pngChunk("zTXt", Buffer.concat([latin1("Comment\0\0"), deflateSync(latin1("neutral words"))])),
      pngChunk("iTXt", Buffer.concat([latin1("Title\0\x01\0en\0Title\0"), deflateSync(latin1("neutral"))])),
    ];
    expect(clear(icoOf([[16, pngOf(16, { extra: neutralText })]]))).toEqual([]);
    // 256 pixels a side is listed as 0; pixels that pack below a byte fill whole bytes per row.
    expect(clear(icoOf([[256, pngOf(256)]]))).toEqual([]);
    expect(clear(icoOf([[13, pngOf(13, { depth: 1, colour: 0 })], [16, pngOf(16, { depth: 16, colour: 0 })]], { bitCounts: [0, 16] }))).toEqual([]);

    // The brand kit's icon, which the three sites serve: three PNG images, each read as a PNG file is.
    const kit = bytes("brand/kit/web/favicon.ico");
    expect(clear(kit)).toEqual([]);
    const reading = readServed(icon, kit);
    expect(reading.unreadable).toEqual([]);
    expect(reading.members.map((member) => member.path)).toEqual([0, 1, 2].map((index) => `${icon}!image-${index}`));
    expect(reading.members.every((member) => PNG_SIGNATURE.equals(member.bytes.subarray(0, 8)))).toBe(true);
  });

  test("a PNG inside an ICO is refused for the text a PNG file is refused for", () => {
    const png = pngWithCompressedText(PRIVATE_TEXT());
    const findings = servedSurfaceFindings(
      [served("apps/web/card.png", png), served("apps/web/favicon.ico", icoOf([[1, png]]))],
      bytes(DENYLIST_PATH),
      bytes(POLICY_PATH),
    );
    const rules = (path: string) => [...new Set(findings.filter((finding) => finding.path === path).map((finding) => finding.rule))].sort();
    expect(rules("apps/web/card.png").some((rule) => rule.startsWith("relational/"))).toBe(true);
    expect(rules("apps/web/favicon.ico!image-0")).toEqual(rules("apps/web/card.png"));
  });

  test("private plain text in an icon's PNG text chunk is found, in the image and in the whole file", () => {
    const icon = "apps/web/favicon.ico";
    const content = icoOf([[16, pngOf(16, { extra: [pngChunk("tEXt", Buffer.concat([Buffer.from("Comment\0", "latin1"), PRIVATE_TEXT()]))] })]]);
    const findings = ownFindings(servedSurfaceFindings([served(icon, content)], bytes(DENYLIST_PATH), bytes(POLICY_PATH)), icon);
    expect(findings.some((finding) => finding.rule === "served/unreadable-binary")).toBe(false);
    for (const path of [icon, `${icon}!image-0`]) {
      expect(findings.some((finding) => finding.path === path && finding.rule.startsWith("relational/"))).toBe(true);
    }
  });

  test("every field of an icon's PNG text chunks is read on its own, as Latin-1, UTF-8 and UTF-16", () => {
    const icon = "apps/web/favicon.ico";
    const term = Buffer.from(asciiTerm(), "utf8");
    const wide = wideTerm();
    const cases: Array<readonly [string, Buffer]> = [
      ["a tEXt keyword", pngChunk("tEXt", Buffer.concat([term, latin1("\0neutral")]))],
      ["a zTXt keyword", pngChunk("zTXt", Buffer.concat([term, latin1("\0\0"), deflateSync(latin1("neutral"))]))],
      ["an iTXt keyword", pngChunk("iTXt", Buffer.concat([term, latin1("\0\0\0\0\0neutral")]))],
      ["an iTXt language tag", pngChunk("iTXt", Buffer.concat([latin1("Title\0\0\0"), term, latin1("\0\0neutral")]))],
      ["an iTXt translated keyword", pngChunk("iTXt", Buffer.concat([latin1("Title\0\0\0\0"), term, latin1("\0neutral")]))],
      ["UTF-8 text behind a UTF-16 byte-order mark in zTXt", pngChunk("zTXt", Buffer.concat([latin1("Comment\0\0"), deflateSync(Buffer.concat([Buffer.from([0xff, 0xfe]), term]))]))],
      ["UTF-8 text behind a UTF-16 byte-order mark in tEXt", pngChunk("tEXt", Buffer.concat([latin1("Comment\0"), Buffer.from([0xfe, 0xff]), term]))],
      ["UTF-16 text with no NUL byte in tEXt", pngChunk("tEXt", Buffer.concat([latin1("Comment\0"), Buffer.from(wide, "utf16le")]))],
      ["UTF-16 text with no NUL byte in zTXt", pngChunk("zTXt", Buffer.concat([latin1("Comment\0\0"), deflateSync(utf16be(wide))]))],
    ];
    for (const [name, chunk] of cases) {
      const findings = ownFindings(servedSurfaceFindings([served(icon, icoOf([[16, pngOf(16, { extra: [chunk] })]]))], bytes(DENYLIST_PATH), bytes(POLICY_PATH)), icon);
      expect({ name, unreadable: findings.filter((finding) => finding.rule === "served/unreadable-binary").length }).toEqual({ name, unreadable: 0 });
      expect({ name, found: findings.some((finding) => finding.path === `${icon}!image-0` && finding.rule.startsWith("relational/")) }).toEqual({ name, found: true });
    }
  });

  test("an icon's PNG pixel rows are inflated and read for text", () => {
    const icon = "apps/web/favicon.ico";
    const term = asciiTerm();
    const cases: Array<readonly [string, Buffer]> = [
      ["UTF-8", Buffer.from(term, "utf8")],
      ["UTF-16LE", Buffer.from(term, "utf16le")],
      ["UTF-16BE", utf16be(term)],
      ["UTF-16 with no NUL byte", Buffer.from(wideTerm(), "utf16le")],
    ];
    for (const [name, content] of cases) {
      const findings = ownFindings(servedSurfaceFindings([served(icon, icoOf([[64, pngOf(64, { rows: rowsHolding(64, content) })]]))], bytes(DENYLIST_PATH), bytes(POLICY_PATH)), icon);
      expect({ name, unreadable: findings.filter((finding) => finding.rule === "served/unreadable-binary").length }).toEqual({ name, unreadable: 0 });
      expect({ name, found: findings.some((finding) => finding.path === `${icon}!image-0` && finding.rule.startsWith("relational/")) }).toEqual({ name, found: true });
    }
  });

  test("each chunk's data in an icon's PNG is read on its own, so plain text at its start is found", () => {
    const icon = "apps/web/favicon.ico";
    const term = latin1(privateTerm((value) => /^[\x20-\x7e]{6,32}$/u.test(value)));
    const padded = (length: number) => Buffer.concat([term, Buffer.alloc(length - term.length, 0x20)]);
    // Read only with the whole file, a word at the start of a chunk's data runs into the chunk type just before it.
    // Each colour chunk has the length PNG gives it, so only a palette and the chromaticities can hold a word.
    for (const [type, data] of [["PLTE", padded(3 * Math.ceil(term.length / 3))], ["cHRM", padded(32)]] as const) {
      const findings = ownFindings(servedSurfaceFindings([served(icon, icoOf([[16, pngOf(16, { extra: [pngChunk(type, data)] })]]))], bytes(DENYLIST_PATH), bytes(POLICY_PATH)), icon);
      expect({ type, unreadable: findings.filter((finding) => finding.rule === "served/unreadable-binary").length }).toEqual({ type, unreadable: 0 });
      expect({ type, found: findings.some((finding) => finding.path === `${icon}!image-0` && finding.rule.startsWith("relational/")) }).toEqual({ type, found: true });
    }
  });

  test("each IDAT chunk's data in an icon's PNG is read on its own, so plain text at a chunk's edge is found", () => {
    const icon = "apps/web/favicon.ico";
    const term = latin1(asciiTerm());
    // Stored deflate blocks pass the rows' bytes through unchanged, so IDAT can be split anywhere among them.
    const splitAt = (rows: Buffer, at: (stream: Buffer) => number) => {
      const stream = deflateSync(rows, { level: 0 });
      return [stream.subarray(0, at(stream)), stream.subarray(at(stream))] as const;
    };
    // The second chunk opens with the term: "IDAT" is just before it in the file, a letter in the rows.
    const opening = splitAt(rowsHolding(64, Buffer.concat([latin1("x"), term])), (stream) => stream.indexOf(term));
    // The first chunk closes with the term: a letter is just after it in the rows, its CRC in the file, made here to open with a word character.
    const closingRows = (pixel: number) => rowsHolding(64, Buffer.concat([Buffer.from([pixel, 0]), term, latin1("x")]));
    const closeAt = (stream: Buffer) => stream.indexOf(term) + term.length;
    const pixel = Array.from({ length: 256 }, (_, value) => value).find((value) => {
      const [first] = splitAt(closingRows(value), closeAt);
      return /\w/u.test(String.fromCharCode(Bun.hash.crc32(Buffer.concat([latin1("IDAT"), first])) >>> 24));
    })!;
    const closing = splitAt(closingRows(pixel), closeAt);
    for (const [name, [first, second]] of [["opening", opening], ["closing", closing]] as const) {
      const png = pngOf(64, { extra: [pngChunk("IDAT", first)], idat: second });
      const findings = ownFindings(servedSurfaceFindings([served(icon, icoOf([[64, png]]))], bytes(DENYLIST_PATH), bytes(POLICY_PATH)), icon);
      expect({ name, unreadable: findings.filter((finding) => finding.rule === "served/unreadable-binary").length }).toEqual({ name, unreadable: 0 });
      expect({ name, found: findings.some((finding) => finding.path === `${icon}!image-0` && finding.rule.startsWith("relational/")) }).toEqual({ name, found: true });
    }
  });

  test("an ICO that leaves a byte unaccounted for, or holds anything the guard cannot fully read, is refused", () => {
    const icon = "apps/web/favicon.ico";
    const [denylist, policy] = [bytes(DENYLIST_PATH), bytes(POLICY_PATH)];
    const small = pngOf(16);
    const large = pngOf(32);
    const clean = icoOf([[16, small], [32, large]]);
    const start = 6 + 2 * 16;
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);
    /** The clean icon with one byte of its first directory entry changed. */
    const entry = (at: number, value: number) => {
      const changed = Buffer.from(clean);
      changed[6 + at] = value;
      return changed;
    };
    const swapped = Buffer.from(clean);
    clean.copy(swapped, 6, 22, 38);
    clean.copy(swapped, 22, 6, 22);
    const tarLike = Buffer.alloc(1024);
    tarLike.set([0, 0, 1, 0, 1, 0]);
    tarLike.write("ustar\0", 257);
    const badCrc = pngOf(16);
    badCrc[badCrc.length - 1] ^= 0xff;
    const blankRows = Buffer.alloc(16 * rowBytes(16));
    const badFilter = Buffer.from(blankRows);
    badFilter[rowBytes(16)] = 5;
    const streams = (first: Uint8Array) => Buffer.concat([deflateSync(first), deflateSync(Buffer.from("hidden"))]);
    const textChunk = (type: string, head: string, body: Buffer) => icoOf([[16, pngOf(16, { extra: [pngChunk(type, Buffer.concat([latin1(head), body]))] })]]);
    const cases: Array<readonly [string, Uint8Array, RegExp]> = [
      ["bytes after the last image", Buffer.concat([clean, Buffer.from([0x00, 0x01, 0x02, 0x03])]), /after its last image/u],
      ["a gap between images", icoOf([[16, small], [32, Buffer.concat([Buffer.alloc(4), large])]], { offsets: [start, start + small.length + 4], sizes: [small.length, large.length] }), /unaccounted bytes before image 1/u],
      ["overlapping images", icoOf([[16, small], [32, large.subarray(8)]], { offsets: [start, start + small.length - 8], sizes: [small.length, large.length] }), /image 1 overlaps/u],
      ["two entries sharing one image", icoOf([[16, small], [16, Buffer.alloc(0)]], { offsets: [start, start], sizes: [small.length, small.length] }), /image 1 overlaps/u],
      ["data after a PNG image's IEND inside its slot", icoOf([[16, Buffer.concat([small, Buffer.from([0x00, 0x01, 0x02, 0x03])])]]), /image 0 has data after its PNG IEND/u],
      ["a truncated file", clean.subarray(0, clean.length - 10), /runs past the file/u],
      ["a truncated directory", clean.subarray(0, 20), /truncated ICO directory/u],
      ["a count above the directory", icoOf([[16, small], [32, large]], { count: 3 }), /image 0 starts inside the header or directory/u],
      ["a count below the directory", icoOf([[16, small], [32, large]], { count: 1 }), /unaccounted bytes before image 0/u],
      ["a zero count", icoOf([]), /declares 0 images/u],
      ["an absurd count", icoOf([[16, small]], { count: 0xffff }), /declares 65535 images/u],
      ["an entry pointing into the header", icoOf([[16, small]], { offsets: [2] }), /inside the header or directory/u],
      ["an entry pointing outside the file", icoOf([[16, small]], { offsets: [clean.length * 4] }), /runs past the file/u],
      ["a cursor file", icoOf([[16, small]], { type: 2 }), /cursor/u],
      ["a bitmap image, which the guard refuses on its own too", icoOf([[16, bitmapOf(16)]]), /image 0 is not a PNG image/u],
      ["a bitmap beside a PNG", icoOf([[16, small], [16, bitmapOf(16)]]), /image 1 is not a PNG image/u],
      ["a JPEG image", icoOf([[16, jpeg]]), /image 0 is not a PNG image/u],
      ["a directory size that does not match the image", icoOf([[48, small]]), /size its directory entry does not match/u],
      ["a directory entry's reserved byte set", entry(3, 1), /image 0 has an invalid directory entry/u],
      ["a directory entry with two planes", entry(4, 2), /image 0 has an invalid directory entry/u],
      ["a directory entry with bit count 3", entry(6, 3), /image 0 has an invalid directory entry/u],
      ["a bit count that is not the PNG's", entry(6, 8), /image 0 has a bit count its directory entry does not match/u],
      ["a colour count for a PNG image", entry(2, 16), /image 0 has a colour count its directory entry does not match/u],
      ["a directory out of file order", swapped, /lists image 1 out of file order/u],
      ["a PNG that does not open with IHDR", icoOf([[16, pngOf(16, { head: [pngChunk("sRGB", Buffer.from([0])), small.subarray(8, 33)] })]]), /does not open with IHDR/u],
      ["data inside a PNG's IEND chunk", icoOf([[16, pngOf(16, { iend: deflateSync(Buffer.from("hidden")) })]]), /image 0 has data inside its PNG IEND chunk/u],
      ["a PNG chunk the guard does not read", icoOf([[16, pngOf(16, { extra: [pngChunk("prVt", deflateSync(Buffer.from("hidden")))] })]]), /image 0 has a PNG prVt chunk, which the guard does not read/u],
      ["a colour chunk longer than PNG gives it", icoOf([[16, pngOf(16, { extra: [pngChunk("gAMA", deflateSync(Buffer.from("hidden")))] })]]), /image 0 has a PNG gAMA chunk of a length PNG does not allow/u],
      ["a profile chunk, whose binary profile the guard reads only for strings", icoOf([[16, pngOf(16, { extra: [pngChunk("iCCP", Buffer.concat([Buffer.from("icc\0\0", "latin1"), deflateSync(Buffer.alloc(16))]))] })]]), /the guard does not read/u],
      ["a repeated chunk that may appear once", icoOf([[16, pngOf(16, { extra: [pngChunk("sRGB", Buffer.from([0])), pngChunk("sRGB", Buffer.from([1]))] })]]), /image 0 repeats its PNG sRGB chunk/u],
      ["a PNG chunk with a wrong CRC", icoOf([[16, badCrc]]), /image 0 has a PNG IEND chunk whose CRC is wrong/u],
      ["16- or 32-bit text in a text chunk", icoOf([[16, pngOf(16, { extra: [pngChunk("tEXt", Buffer.from("Comment\0h\0\0\0i\0\0\0", "latin1"))] })]]), /image 0 has a NUL in the text of a PNG text chunk/u],
      ["a directory entry with no planes", entry(4, 0), /image 0 has an invalid directory entry/u],
      ["an interlaced PNG", icoOf([[16, pngOf(16, { methods: [0, 0, 1] })]]), /image 0 is an interlaced PNG/u],
      ["a PNG compression method other than 0", icoOf([[16, pngOf(16, { methods: [1, 0, 0] })]]), /image 0 is a PNG of an unknown compression or filter method/u],
      ["a PNG filter method other than 0", icoOf([[16, pngOf(16, { methods: [0, 1, 0] })]]), /image 0 is a PNG of an unknown compression or filter method/u],
      ["a bit depth its colour type does not allow", icoOf([[16, pngOf(16, { depth: 3, colour: 0 })]], { bitCounts: [0] }), /image 0 is a PNG of a bit depth/u],
      ["a PNG more than 256 pixels a side, listed as 0", icoOf([[256, pngOf(300)]]), /image 0 is a PNG larger than 256 pixels a side/u],
      ["a PNG without IDAT", icoOf([[16, pngOf(16, { idat: null })]]), /image 0 has no PNG IDAT chunk/u],
      ["a second zlib stream after the pixel data", icoOf([[16, pngOf(16, { idat: streams(blankRows) })]]), /image 0 has bytes after the end of its PNG pixel data/u],
      ["a byte after the pixel data's zlib stream", icoOf([[16, pngOf(16, { idat: Buffer.concat([deflateSync(blankRows), Buffer.from([7])]) })]]), /image 0 has bytes after the end of its PNG pixel data/u],
      ["pixel data shorter than its rows", icoOf([[16, pngOf(16, { rows: blankRows.subarray(1) })]]), /image 0 has PNG pixel data that is not the size its IHDR implies/u],
      ["pixel data longer than its rows", icoOf([[16, pngOf(16, { rows: Buffer.alloc(blankRows.length + 1) })]]), /image 0 has PNG pixel data that does not inflate, or inflates past/u],
      ["pixel data that is not a zlib stream", icoOf([[16, pngOf(16, { idat: Buffer.from("not zlib") })]]), /image 0 has PNG pixel data that does not inflate/u],
      ["a row filter type above 4", icoOf([[16, pngOf(16, { rows: badFilter })]]), /image 0 has a PNG row with an unknown filter type/u],
      ["a second zlib stream in zTXt", textChunk("zTXt", "Comment\0\0", streams(Buffer.from("neutral"))), /image 0 has bytes after the end of its compressed PNG text/u],
      ["a second zlib stream in a compressed iTXt", textChunk("iTXt", "Comment\0\x01\0\0\0", streams(Buffer.from("neutral"))), /image 0 has bytes after the end of its compressed PNG text/u],
      ["a zTXt compression method other than 0", textChunk("zTXt", "Comment\0\x01", deflateSync(Buffer.from("neutral"))), /image 0 has a PNG text chunk with an unknown compression method/u],
      ["an iTXt compression flag of 2", textChunk("iTXt", "Title\0\x02\0\0\0", deflateSync(Buffer.from("neutral"))), /image 0 has a PNG iTXt chunk with an unknown compression flag or method/u],
      ["an iTXt compression method other than 0", textChunk("iTXt", "Title\0\x01\x01\0\0", deflateSync(Buffer.from("neutral"))), /image 0 has a PNG iTXt chunk with an unknown compression flag or method/u],
      ["an empty text keyword", textChunk("tEXt", "\0", Buffer.from("neutral")), /image 0 has a PNG text chunk whose keyword is empty or longer than 79 bytes/u],
      ["a text keyword longer than 79 bytes", textChunk("tEXt", `${"k".repeat(80)}\0`, Buffer.from("neutral")), /image 0 has a PNG text chunk whose keyword is empty or longer than 79 bytes/u],
      ["a file that is an icon and a tar archive at once", tarLike, /ICO that is also a tar archive/u],
      ["a non-ICO file named .ico", jpeg, /binary format the guard cannot read/u],
    ];
    for (const [name, content, reason] of cases) {
      const findings = ownFindings(servedSurfaceFindings([served(icon, content)], denylist, policy), icon);
      expect(findings.map((finding) => ({ name, rule: finding.rule, path: finding.path, reason: reason.test(finding.detail ?? "") }))).toEqual([
        { name, rule: "served/unreadable-binary", path: icon, reason: true },
      ]);
    }
  });

  test("UTF-8 text behind a UTF-16 byte-order mark is read as UTF-8 too", () => {
    for (const [path, mark] of [["apps/web/notes.txt", [0xff, 0xfe]], ["apps/web/page.html", [0xfe, 0xff]]] as const) {
      const content = Buffer.concat([Buffer.from(mark), PRIVATE_TEXT()]);
      const findings = ownFindings(servedSurfaceFindings([served(path, content)], bytes(DENYLIST_PATH), bytes(POLICY_PATH)), path);
      expect({ path, found: findings.some((finding) => finding.rule.startsWith("relational/")) }).toEqual({ path, found: true });
    }
  });

  test("text behind a byte-order mark that names another reading, or past the NUL window, is read for its strings", () => {
    const path = "apps/web/notes.txt";
    const term = asciiTerm();
    const seat = PRIVATE_TEXT().toString("utf8");
    const lines = (length: number) => "a neutral line of text.\n".repeat(Math.ceil(length / 24)).slice(0, length);
    const cases: Array<readonly [string, Buffer]> = [
      ["FE FF, then UTF-16LE", Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(seat, "utf16le")])],
      ["FF FE, then UTF-16BE", Buffer.concat([Buffer.from([0xff, 0xfe]), utf16be(seat)])],
      ["FF FE and one byte, then UTF-16LE at an odd offset", Buffer.concat([Buffer.from([0xff, 0xfe, 0x41]), Buffer.from(seat, "utf16le")])],
      ["FF FE, then UTF-32 past the 16000-byte window", Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(lines(9000), "utf16le"), utf32(` ${term} `, true)])],
      ["no mark, then UTF-16LE past the 8000-byte window", Buffer.concat([latin1(lines(8200)), Buffer.from(seat, "utf16le")])],
    ];
    for (const [name, content] of cases) {
      const findings = ownFindings(servedSurfaceFindings([served(path, content)], bytes(DENYLIST_PATH), bytes(POLICY_PATH)), path);
      expect({ name, found: findings.some((finding) => finding.rule.startsWith("relational/")) }).toEqual({ name, found: true });
    }
  });

  test("an archive's header fields are read, and bytes a tar leaves after its end or in its padding are refused", () => {
    const archive = "apps/docs/packages/demo.tgz";
    const term = latin1(privateTerm((value) => /^[\x20-\x7e]{6,31}$/u.test(value)));
    const tar = tarOf([["package/README.md", Buffer.from("A neutral readme.\n")]]);
    const check = (content: Buffer) => ownFindings(servedSurfaceFindings([served(archive, content)], bytes(DENYLIST_PATH), bytes(POLICY_PATH)), archive);
    expect(check(gzipSync(tar))).toEqual([]);
    expect(check(gzipSync(withHeaderField(withHeaderField(tar, 156, latin1("2")), 157, latin1("neutral-target"))))).toEqual([]);
    // What real npm tarballs hold: access and change times in a short prefix's last 24 bytes (star, node-tar), and a base-256 user id.
    expect(check(gzipSync(withHeaderField(tar, 476, latin1("14715561552\x0014715561552\x00"))))).toEqual([]);
    expect(check(gzipSync(withHeaderField(tar, 108, Buffer.from([0x80, 0, 0, 0, 0, 0x01, 0, 0]))))).toEqual([]);
    const found: Array<readonly [string, Buffer]> = [
      ["the user name", gzipSync(withHeaderField(tar, 265, term))],
      ["the group name", gzipSync(withHeaderField(tar, 297, term))],
      ["the gzip file name", gzipWithHeaderField(tar, 0x08, term)],
      ["the gzip comment", gzipWithHeaderField(tar, 0x10, term)],
      ["a user name outside ASCII, as UTF-16", gzipSync(withHeaderField(tar, 265, Buffer.from(wideTerm(), "utf16le")))],
    ];
    for (const [name, content] of found) {
      const findings = check(content);
      expect({ name, found: findings.some((finding) => finding.path === archive && finding.rule.startsWith("relational/")) }).toEqual({ name, found: true });
    }
    const after = Buffer.concat([tar, PRIVATE_TEXT()]);
    const padded = Buffer.from(tar);
    padded.write("neutral", 512 + 18, "latin1");
    const hidden = deflateSync(PRIVATE_TEXT());
    const extra = Buffer.from(gzipSync(tar));
    extra[3] = 0x04;
    const extraLength = Buffer.alloc(2);
    extraLength.writeUInt16LE(hidden.length);
    const refused: Array<readonly [string, Buffer, RegExp]> = [
      ["text after the end blocks of a .tar", after, /after its end marker/u],
      ["text after the end blocks of a .tgz", gzipSync(after), /after its end marker/u],
      ["text in a member's padding", gzipSync(padded), /in its padding/u],
      ["text after a .tgz's gzip member", Buffer.concat([gzipSync(tar), PRIVATE_TEXT()]), /gzip file has bytes after the end of its first member/u],
      ["zero bytes after a .tgz's gzip member", Buffer.concat([gzipSync(tar), Buffer.alloc(512)]), /gzip file has bytes after the end of its first member/u],
      ["a second gzip member, whose file name gunzip skips", Buffer.concat([gzipSync(tar), gzipWithHeaderField(Buffer.alloc(0), 0x08, term)]), /gzip file has bytes after the end of its first member/u],
      ["a gzip extra field", Buffer.concat([extra.subarray(0, 10), extraLength, hidden, extra.subarray(10)]), /gzip header with an extra field/u],
      ["a link name on a regular file", gzipSync(withHeaderField(tar, 157, latin1("neutral-target"))), /tar entry that is not a link has a link name/u],
      ["bytes after a user name's NUL", gzipSync(withHeaderField(tar, 265, latin1("user\0hidden"))), /tar header field at byte 265 has bytes after its NUL/u],
      ["a number that is not octal", gzipSync(withHeaderField(tar, 136, latin1("0000000009\0"))), /tar header number at byte 136 is not octal/u],
      ["bytes after a header's prefix", gzipSync(withHeaderField(tar, 500, latin1("hidden"))), /tar header has bytes after its prefix/u],
      ["text where a short prefix keeps its times", gzipSync(withHeaderField(tar, 476, latin1("hidden"))), /tar header field at byte 345 has bytes after its NUL/u],
      ["a base-256 number outside the ids", gzipSync(withHeaderField(tar, 136, Buffer.from([0x80, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]))), /tar header number at byte 136 is not octal/u],
    ];
    for (const [name, content, reason] of refused) {
      const findings = check(content).filter((finding) => finding.rule === "served/unreadable-binary");
      expect({ name, refused: findings.length === 1 && reason.test(findings[0]!.detail ?? "") }).toEqual({ name, refused: true });
    }
  });

  test("a font or a WAV is read only when every byte is accounted for", () => {
    const path = "apps/web/asset.bin";
    const check = (content: Buffer) => ownFindings(servedSurfaceFindings([served(path, content)], bytes(DENYLIST_PATH), bytes(POLICY_PATH)), path);
    const font = fontOf([["head", Buffer.alloc(54)], ["name", Buffer.from("a neutral font name", "utf16le").swap16()]]);
    const samples = Buffer.alloc(800);
    expect(check(font)).toEqual([]);
    // A font stores its names as UTF-16BE, so a name outside ASCII is read too.
    const named = check(fontOf([["head", Buffer.alloc(54)], ["name", utf16be(wideTerm())]]));
    expect(named.some((finding) => finding.rule.startsWith("relational/"))).toBe(true);
    expect(check(fontOf([["head", Buffer.alloc(54)]], latin1("OTTO")))).toEqual([]);
    expect(check(wavOf(samples))).toEqual([]);
    const hidden = deflateSync(PRIVATE_TEXT());
    const gap = fontOf([["head", Buffer.alloc(54)], ["name", Buffer.alloc(8)]]);
    gap.writeUInt32BE(gap.readUInt32BE(12 + 16 + 8) + 4, 12 + 16 + 8);
    const format = wavOf(samples).subarray(12, 36);
    const cases: Array<readonly [string, Buffer, RegExp]> = [
      ["TrueType magic then compressed text", Buffer.concat([Buffer.from([0, 1, 0, 0]), hidden]), /table directory|the guard does not read|overlaps/u],
      ["OpenType magic then compressed text", Buffer.concat([latin1("OTTO"), hidden]), /table directory|the guard does not read|overlaps/u],
      ["a font collection", Buffer.concat([latin1("ttcf"), hidden]), /font collection/u],
      ["a font with bytes after its last table", Buffer.concat([font, hidden]), /after its last table/u],
      ["a font with a table the guard does not read", fontOf([["head", Buffer.alloc(54)], ["zzzz", hidden]]), /a zzzz table, which the guard does not read/u],
      ["a signature table, named in the refusal", fontOf([["head", Buffer.alloc(54)], ["DSIG", Buffer.alloc(8)]]), /a DSIG table, which the guard does not read/u],
      ["a font table moved past a gap", gap, /overlaps another or leaves bytes unaccounted for|runs past/u],
      ["RIFF WAVE magic then compressed text", Buffer.concat([latin1("RIFF"), Buffer.alloc(4), latin1("WAVE"), hidden]), /RIFF size/u],
      ["a WAV with bytes after its RIFF", Buffer.concat([wavOf(samples), hidden]), /RIFF size/u],
      ["a WAV with a chunk the guard does not read", wavOf(samples, [format, riffChunk("LIST", hidden), riffChunk("data", samples)]), /a LIST chunk where the guard reads only one fmt chunk, then one data chunk/u],
      ["a WAV filler chunk, named in the refusal", wavOf(samples, [riffChunk("JUNK", Buffer.alloc(28)), format, riffChunk("data", samples)]), /a JUNK chunk where/u],
      ["a WAV that is not PCM", wavOf(samples, [riffChunk("fmt ", Buffer.alloc(16)), riffChunk("data", samples)]), /not plain PCM/u],
    ];
    for (const [name, content, reason] of cases) {
      const findings = check(content);
      expect({ name, findings: findings.map((finding) => ({ rule: finding.rule, reason: reason.test(finding.detail ?? "") })) }).toEqual({
        name,
        findings: [{ rule: "served/unreadable-binary", reason: true }],
      });
    }
  });

  test("text stored 32 bits a character is read in a binary's strings", () => {
    const path = "apps/docs/tone.wav";
    const term = asciiTerm();
    for (const little of [true, false]) {
      const samples = Buffer.concat([Buffer.alloc(4), utf32(term, little), Buffer.alloc(800)]);
      const findings = ownFindings(servedSurfaceFindings([served(path, wavOf(samples))], bytes(DENYLIST_PATH), bytes(POLICY_PATH)), path);
      expect({ little, found: findings.some((finding) => finding.rule.startsWith("relational/")) }).toEqual({ little, found: true });
    }
  });

  test("a PNG file is read as strictly as a PNG inside an icon", () => {
    const image = "apps/web/card.png";
    const check = (content: Buffer) => ownFindings(servedSurfaceFindings([served(image, content)], bytes(DENYLIST_PATH), bytes(POLICY_PATH)), image);
    const blankRows = Buffer.alloc(16 * rowBytes(16));
    const hidden = deflateSync(PRIVATE_TEXT());
    // No side limit in a file, and a background colour is allowed.
    expect(check(pngOf(300, { extra: [pngChunk("bKGD", Buffer.from([0, 0, 0, 0, 0, 0])), pngChunk("tEXt", latin1("Software\0a neutral tool"))] }))).toEqual([]);
    // Each colour chunk at the length PNG gives it for the image's colour type.
    const colour = [pngChunk("gAMA", Buffer.alloc(4)), pngChunk("cHRM", Buffer.alloc(32)), pngChunk("sRGB", Buffer.alloc(1)), pngChunk("pHYs", Buffer.alloc(9))];
    expect(check(pngOf(16, { colour: 3, extra: [...colour, pngChunk("PLTE", Buffer.alloc(6)), pngChunk("tRNS", Buffer.alloc(2)), pngChunk("bKGD", Buffer.alloc(1))] }))).toEqual([]);
    expect(check(pngOf(16, { colour: 0, extra: [...colour, pngChunk("tRNS", Buffer.alloc(2)), pngChunk("bKGD", Buffer.alloc(2))] }))).toEqual([]);
    expect(check(pngOf(16, { colour: 2, extra: [...colour, pngChunk("PLTE", Buffer.alloc(3)), pngChunk("tRNS", Buffer.alloc(6)), pngChunk("bKGD", Buffer.alloc(6))] }))).toEqual([]);
    const term = asciiTerm();
    const gray = Buffer.concat([Buffer.from([0]), latin1(term)]);
    const header = Buffer.alloc(13);
    header.writeUInt32BE(term.length, 0);
    header.writeUInt32BE(1, 4);
    header.set([8, 0, 0, 0, 0], 8);
    const grayscale = Buffer.concat([PNG_SIGNATURE, pngChunk("IHDR", header), pngChunk("IDAT", deflateSync(gray)), pngChunk("IEND", Buffer.alloc(0))]);
    expect(check(grayscale).some((finding) => finding.rule.startsWith("relational/"))).toBe(true);
    const cases: Array<readonly [string, Buffer, RegExp]> = [
      ["a second zlib stream after the pixel data", pngOf(16, { idat: Buffer.concat([deflateSync(blankRows), hidden]) }), /bytes after the end of its PNG pixel data/u],
      ["pixel data that is not the rows its IHDR implies", pngOf(16, { idat: hidden }), /PNG pixel data/u],
      ["a second zlib stream in zTXt", pngOf(16, { extra: [pngChunk("zTXt", Buffer.concat([latin1("Comment\0\0"), deflateSync(latin1("neutral")), hidden]))] }), /bytes after the end of its compressed PNG text/u],
      ["a chunk the guard does not read", pngOf(16, { extra: [pngChunk("prVt", hidden)] }), /PNG prVt chunk, which the guard does not read/u],
      ["a chunk tag outside letters, escaped in the refusal", pngOf(16, { extra: [pngChunk("p\x01(t", hidden)] }), /PNG p%01%28t chunk, which/u],
      ["a colour chunk longer than PNG gives it", pngOf(16, { extra: [pngChunk("gAMA", hidden)] }), /PNG gAMA chunk of a length PNG does not allow for its colour type/u],
      ["chromaticities longer than PNG gives them", pngOf(16, { extra: [pngChunk("cHRM", Buffer.concat([Buffer.alloc(32), hidden]))] }), /PNG cHRM chunk of a length/u],
      ["a background colour of a palette image's length in an RGBA image", pngOf(16, { extra: [pngChunk("bKGD", Buffer.from([0]))] }), /PNG bKGD chunk of a length/u],
      ["a palette in a greyscale image", pngOf(16, { colour: 0, extra: [pngChunk("PLTE", Buffer.alloc(3))] }), /PNG PLTE chunk of a length/u],
      ["a palette longer than 256 entries", pngOf(16, { colour: 3, extra: [pngChunk("PLTE", Buffer.alloc(771))] }), /PNG PLTE chunk of a length/u],
      ["transparency in an image with an alpha channel", pngOf(16, { extra: [pngChunk("tRNS", Buffer.alloc(2))] }), /PNG tRNS chunk of a length/u],
      ["data inside IEND", pngOf(16, { iend: hidden }), /data inside its PNG IEND chunk/u],
      ["data after IEND", Buffer.concat([pngOf(16), hidden]), /data after its PNG IEND chunk/u],
      ["an interlaced PNG", pngOf(16, { methods: [0, 0, 1] }), /interlaced/u],
    ];
    for (const [name, content, reason] of cases) {
      const findings = check(content);
      expect({ name, findings: findings.map((finding) => ({ rule: finding.rule, reason: reason.test(finding.detail ?? "") })) }).toEqual({
        name,
        findings: [{ rule: "served/unreadable-binary", reason: true }],
      });
    }
  });

  test("a binary the guard cannot read is refused unless an exact files entry covers it", () => {
    const blob = "apps/web/data.bin";
    const content = Buffer.from([0x00, 0xff, 0x13, 0x37, 0x00, 0x42, 0x9a, 0x00]);
    const refused = ownFindings(servedSurfaceFindings([served(blob, content)], bytes(DENYLIST_PATH), bytes(POLICY_PATH)), blob);
    expect(refused.map((finding) => finding.rule)).toEqual(["served/unreadable-binary"]);
    const broken = gzipSync(Buffer.from("not an archive")).subarray(0, 12);
    expect(ownFindings(servedSurfaceFindings([served(blob, broken)], bytes(DENYLIST_PATH), bytes(POLICY_PATH)), blob).map((finding) => finding.rule)).toEqual(["served/unreadable-binary"]);

    const policy = JSON.parse(text(POLICY_PATH));
    policy.files.push({ path: blob, sha256: sha256Hex(content), reason: "test" });
    expect(ownFindings(servedSurfaceFindings([served(blob, content)], bytes(DENYLIST_PATH), Buffer.from(JSON.stringify(policy))), blob)).toEqual([]);
  });

  test("a file the denylist names by digest is refused, loose or inside an archive, whatever the policy says", () => {
    const content = Buffer.from("A neutral page with no term in it.\n");
    const denylist = JSON.parse(text(DENYLIST_PATH));
    denylist.blob_sha256 = [{ id: "b01", sha256: sha256Hex(content) }];
    const archive = gzipSync(tarOf([["package/page.txt", content]]));
    const policy = JSON.parse(text(POLICY_PATH));
    policy.files.push({ path: "apps/web/page.txt", sha256: sha256Hex(content), reason: "test" });
    const findings = servedSurfaceFindings(
      [served("apps/web/page.txt", content), served("apps/docs/bundle.tgz", archive)],
      Buffer.from(JSON.stringify(denylist)),
      Buffer.from(JSON.stringify(policy)),
    );
    const named = findings.filter((finding) => finding.rule === "relational/b01").map((finding) => finding.path);
    expect(named.sort()).toEqual(["apps/docs/bundle.tgz!package/page.txt", "apps/web/page.txt"]);
  });

  test("served names are checked too, and reported by hash only", () => {
    // Build a name from a private match at run time, so no term is written here.
    const rules = parseDenylist(bytes(DENYLIST_PATH)).rules;
    const publicRules = new Set((JSON.parse(text(POLICY_PATH)).public_rules as Array<{ rule: string }>).map((entry) => entry.rule));
    const content = PRIVATE_TEXT().toString("utf8");
    const hit = scanText("seat", content, rules).find((finding) => !publicRules.has(finding.rule))!;
    const rule = rules.find((candidate) => candidate.id === hit.rule)!;
    const line = content.split("\n")[hit.line! - 1]!;
    const term = new RegExp(rule.pattern.source, rule.pattern.flags.replace("g", "")).exec(line)![0];
    const name = `apps/web/${term.replace(/[/\n]/gu, "-")}.txt`;
    const findings = servedSurfaceFindings([served(name, Buffer.from("neutral\n"))], bytes(DENYLIST_PATH), bytes(POLICY_PATH));
    const nameFindings = findings.filter((finding) => finding.path === "(served-name)");
    expect(nameFindings.map((finding) => finding.rule)).toContain(hit.rule);
    expect(findings.map(formatServedFinding).join("\n").includes(term)).toBe(false);
  });
});
