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

/** A PNG chunk. The guard does not check CRCs, so they are zero. */
function pngChunk(type: string, data: Uint8Array): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  return Buffer.concat([length, Buffer.from(type, "latin1"), Buffer.from(data), Buffer.alloc(4)]);
}

/** A PNG whose only text is a compressed zTXt chunk. */
function pngWithCompressedText(text: Uint8Array): Buffer {
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 0, 0, 0, 0])),
    pngChunk("zTXt", Buffer.concat([Buffer.from("Comment\0", "latin1"), Buffer.from([0]), deflateSync(text)])),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/** A square RGBA PNG with blank pixels and no text. */
function pngOf(pixels: number): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(pixels, 0);
  header.writeUInt32BE(pixels, 4);
  header.set([8, 6], 8);
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(Buffer.alloc(pixels * (pixels * 4 + 1)))),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/** A square 32-bit bitmap as an ICO stores it: BITMAPINFOHEADER, colour rows, then 1-bit mask rows. */
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
  options: { type?: number; count?: number; offsets?: number[]; sizes?: number[] } = {},
): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(options.type ?? 1, 2);
  header.writeUInt16LE(options.count ?? images.length, 4);
  const directory = Buffer.alloc(16 * images.length);
  let offset = header.length + directory.length;
  images.forEach(([pixels, image], index) => {
    directory.set([pixels % 256, pixels % 256], 16 * index);
    directory.writeUInt16LE(1, 16 * index + 4);
    directory.writeUInt16LE(32, 16 * index + 6);
    directory.writeUInt32LE(options.sizes?.[index] ?? image.length, 16 * index + 8);
    directory.writeUInt32LE(options.offsets?.[index] ?? offset, 16 * index + 12);
    offset += image.length;
  });
  return Buffer.concat([header, directory, ...images.map(([, image]) => image)]);
}

const served = (path: string, content: Uint8Array): ServedFile => ({ served: path, real: path, bytes: Buffer.from(content) });
const ownFindings = (findings: ReturnType<typeof servedSurfaceFindings>, path: string) =>
  findings.filter((finding) => finding.path === path || finding.path.startsWith(`${path}!`));

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
    expect(clear(icoOf([[16, bitmapOf(16)]]))).toEqual([]);
    expect(clear(icoOf([[16, bitmapOf(16)], [32, pngOf(32)]]))).toEqual([]);

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

  test("an ICO that leaves a byte unaccounted for, or holds an image the guard cannot read, is refused", () => {
    const icon = "apps/web/favicon.ico";
    const [denylist, policy] = [bytes(DENYLIST_PATH), bytes(POLICY_PATH)];
    const small = pngOf(16);
    const large = pngOf(32);
    const clean = icoOf([[16, small], [32, large]]);
    const start = 6 + 2 * 16;
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);
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
      ["a bitmap with a byte its header does not declare", icoOf([[16, Buffer.concat([bitmapOf(16), Buffer.from([0x00])])]]), /header does not account for its bytes/u],
      ["an image that is neither PNG nor bitmap", icoOf([[16, jpeg]]), /neither a PNG nor a classic bitmap/u],
      ["a directory size that does not match the image", icoOf([[48, small]]), /size its directory entry does not match/u],
      ["a non-ICO file named .ico", jpeg, /binary format the guard cannot read/u],
    ];
    for (const [name, content, reason] of cases) {
      const findings = ownFindings(servedSurfaceFindings([served(icon, content)], denylist, policy), icon);
      expect(findings.map((finding) => ({ name, rule: finding.rule, path: finding.path, reason: reason.test(finding.detail ?? "") }))).toEqual([
        { name, rule: "served/unreadable-binary", path: icon, reason: true },
      ]);
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
