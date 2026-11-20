#!/usr/bin/env bun

/**
 * Test vectors for transport-hints/v1 (docs/specs/TRANSPORT-HINTS-0.1-DRAFT.md,
 * section 14). Every subject is a pattern file generated in memory with the
 * draft's generator; nothing is stored, and no pattern file is a real file.
 * Every file stays under 5 MiB.
 *
 * The committed docs/specs/transport-hints-v1-vectors.json is this builder's
 * own output. Its status says so until the cross-check workflow
 * (.github/workflows/transport-hints.yml) has compared it with independent
 * hashers on a GitHub-hosted runner.
 *
 * Zero dependencies and no network.
 *
 * Usage:
 *   bin/transport-hints-vectors.ts --write                regenerate the vectors file
 *   bin/transport-hints-vectors.ts --check                exit 1 if the file differs
 *   bin/transport-hints-vectors.ts --torrents-out <dir>   write each vector's .torrent into a new directory
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  BLOCK_SIZE,
  PIECE_LENGTHS,
  PROFILE,
  buildDescriptor,
  buildTorrentFromBytes,
  canonicalJson,
  padHash,
  parseDescriptorFields,
  profilePieceLength,
  sha256Hex,
  type TorrentBuild,
} from "./build-transport-hints.ts";

export const VECTORS_PATH = "docs/specs/transport-hints-v1-vectors.json";
export const PATTERN_DOMAIN = "transport-hints-pattern/v1";
export const MAX_VECTOR_BYTES = 5 * 1024 * 1024 - 1;
export const VECTORS_STATUS = "builder-output-unconfirmed";

const ROOT = resolve(import.meta.dir, "..");

/**
 * The generator of draft section 14.1:
 *   block(seed, k)      = SHA-256(utf8(domain) || 0x00 || utf8(seed) || 0x00 || uint64be(k))
 *   pattern(seed, size) = the first size bytes of block(seed, 0) || block(seed, 1) || ...
 */
export function patternBytes(seed: string, size: number): Uint8Array {
  if (typeof seed !== "string" || !/^[\x21-\x7e]{1,64}$/u.test(seed)) {
    throw new Error("a pattern seed is 1 to 64 printable ASCII characters (U+0021 to U+007E)");
  }
  if (!Number.isSafeInteger(size) || size < 1) throw new Error("a pattern size is at least 1");
  const prefix = Buffer.concat([Buffer.from(PATTERN_DOMAIN, "ascii"), Buffer.from([0]), Buffer.from(seed, "ascii"), Buffer.from([0])]);
  const counter = Buffer.alloc(8);
  const out = new Uint8Array(size);
  const blocks = Math.ceil(size / 32);
  for (let k = 0; k < blocks; k += 1) {
    counter.writeBigUInt64BE(BigInt(k));
    const block = createHash("sha256").update(prefix).update(counter).digest();
    out.set(block.subarray(0, Math.min(32, size - 32 * k)), 32 * k);
  }
  return out;
}

export interface VectorPlan {
  readonly seed: string;
  readonly size: number;
  /** Undefined: the profile rule. A number: an explicit test-vector piece length. */
  readonly explicitPieceLength?: number;
  readonly case: string;
}

const KIB = 1024;
const MIB = 1024 * 1024;

/** The vectors of draft section 14.2. Names are the seed plus '.bin'. */
export const VECTOR_PLAN: readonly VectorPlan[] = [
  { seed: "th-16k-1-byte", size: 1, case: "one byte: one short block" },
  { seed: "th-16k-one-block", size: 16 * KIB, case: "exactly one 16 KiB block, one piece" },
  { seed: "th-16k-one-block-plus-one", size: 16 * KIB + 1, case: "one piece plus one byte" },
  { seed: "th-16k-46000", size: 46_000, case: "three pieces, the last short; the layer is balanced with one zero leaf" },
  { seed: "th-32k-one-short-block", size: 10_000, explicitPieceLength: 32 * KIB, case: "smaller than one piece: one short block, so the tree has one leaf and is not padded to the piece" },
  { seed: "th-32k-one-piece", size: 32 * KIB, explicitPieceLength: 32 * KIB, case: "exactly one piece of two blocks" },
  { seed: "th-32k-one-piece-plus-one", size: 32 * KIB + 1, explicitPieceLength: 32 * KIB, case: "one piece plus one byte: the last piece's subtree holds one short block and one zero leaf" },
  { seed: "th-32k-3-pieces", size: 2 * 32 * KIB + 5_000, explicitPieceLength: 32 * KIB, case: "three pieces, the last one short block; the layer is balanced with one pad hash of height 1" },
  { seed: "th-32k-5-pieces", size: 4 * 32 * KIB + 20_000, explicitPieceLength: 32 * KIB, case: "five pieces, the last of two blocks with the second short; the layer is balanced with three pad hashes" },
  { seed: "th-1m-7-blocks", size: 6 * 16 * KIB + 1_000, explicitPieceLength: MIB, case: "smaller than one piece: seven blocks, so the tree has eight leaves, not 64" },
  { seed: "th-1m-one-piece", size: MIB, explicitPieceLength: MIB, case: "exactly one piece of 64 blocks" },
  { seed: "th-1m-one-piece-plus-one", size: MIB + 1, explicitPieceLength: MIB, case: "one piece plus one byte: the last piece's subtree holds one short block and 63 zero leaves" },
  { seed: "th-1m-3-pieces", size: 2 * MIB + 70_000, explicitPieceLength: MIB, case: "three pieces, the last of five blocks; the layer is balanced with one pad hash of height 6" },
  { seed: "th-1m-5-pieces", size: 4 * MIB + 300_000, explicitPieceLength: MIB, case: "five pieces, the last of 19 blocks; the layer is balanced with three pad hashes of height 6" },
];

export function vectorName(plan: VectorPlan): string {
  return `${plan.seed}.bin`;
}

/** A fixed example url-list, deliberately not in sorted order: the builder keeps the order given. */
export function exampleUrlList(name: string): string[] {
  return [
    `https://example.org/transport-hints/vectors/${name}`,
    `https://download.example.org/transport-hints/vectors/${name}`,
  ];
}

/** The inputs of the draft's section 4.5 example descriptor. */
export const DESCRIPTOR_EXAMPLE = {
  subjectSeed: "transport-hints-example",
  subjectSize: 46_000,
  noticeSeed: "transport-hints-example-notice",
  noticeSize: 1_000,
  filename: "transport-hints-example.bin",
  name: "transport-hints-example.bin",
  noticeFilename: "example-notice.txt",
  noticeUrl: "https://example.org/transport-hints/example-notice.txt",
  authority: { kind: "json-pointer", url: "https://example.org/transport-hints/example-record.json", pointer: "/files/0/sha256" },
  home: "https://example.org/transport-hints/",
  license: "CC0-1.0",
  urlList: ["https://example.org/files/transport-hints-example.bin"],
} as const;

export interface ComputedVector {
  readonly plan: VectorPlan;
  readonly build: TorrentBuild;
  readonly record: Record<string, unknown>;
}

export interface ComputedDescriptorVector {
  readonly build: TorrentBuild;
  readonly text: string;
  readonly sha256: string;
  readonly record: Record<string, unknown>;
}

export function computeVector(plan: VectorPlan, bytes: Uint8Array = patternBytes(plan.seed, plan.size)): ComputedVector {
  if (plan.size > MAX_VECTOR_BYTES) throw new Error(`vector ${plan.seed} is not under 5 MiB`);
  const name = vectorName(plan);
  const build = buildTorrentFromBytes({
    name,
    size: plan.size,
    sha256: sha256Hex(bytes),
    urlList: exampleUrlList(name),
    ...(plan.explicitPieceLength === undefined ? {} : { testVectorPieceLength: plan.explicitPieceLength }),
  }, bytes);
  const explicit = plan.explicitPieceLength !== undefined;
  if (explicit && plan.explicitPieceLength === profilePieceLength(plan.size)) {
    throw new Error(`vector ${plan.seed}: an explicit piece length must differ from the profile's`);
  }
  const record = {
    name,
    seed: plan.seed,
    size: plan.size,
    case: plan.case,
    piece_length: build.pieceLength,
    piece_length_rule: explicit ? "explicit, hashing only; not a conforming descriptor" : "profile (draft section 7.3)",
    pieces_count: Math.ceil(plan.size / build.pieceLength),
    blocks_count: Math.ceil(plan.size / BLOCK_SIZE),
    sha256: build.sha256,
    pieces: Buffer.from(build.pieces).toString("hex"),
    pieces_root: build.piecesRoot,
    piece_layers: build.pieceLayer ? Buffer.from(build.pieceLayer).toString("hex") : null,
    btih: build.btih,
    btmh: build.btmh,
    url_list: [...build.urlList],
    torrent_size: build.torrent.length,
    torrent_sha256: build.torrentSha256,
  };
  return { plan, build, record };
}

export function computeDescriptorVector(): ComputedDescriptorVector {
  const e = DESCRIPTOR_EXAMPLE;
  const subject = patternBytes(e.subjectSeed, e.subjectSize);
  const notice = patternBytes(e.noticeSeed, e.noticeSize);
  const subjectSha256 = sha256Hex(subject);
  const build = buildTorrentFromBytes({ name: e.name, size: e.subjectSize, sha256: subjectSha256, urlList: [...e.urlList] }, subject);
  const fields = parseDescriptorFields({
    subject: { filename: e.filename, size: e.subjectSize, sha256: subjectSha256 },
    authority: { ...e.authority },
    home: e.home,
    license: e.license,
    notices: {
      inside_subject: [],
      beside_subject: [{ filename: e.noticeFilename, size: e.noticeSize, sha256: sha256Hex(notice), url: e.noticeUrl }],
    },
  });
  const descriptor = buildDescriptor(fields, build);
  const record = {
    label: "draft section 4.5 example",
    subject_seed: e.subjectSeed,
    subject_size: e.subjectSize,
    notice_seed: e.noticeSeed,
    notice_size: e.noticeSize,
    url_list: [...build.urlList],
    torrent_sha256: build.torrentSha256,
    descriptor_sha256: descriptor.sha256,
    descriptor_text: descriptor.text,
  };
  return { build, text: descriptor.text, sha256: descriptor.sha256, record };
}

/** Pad hashes for every piece length of the profile: the root of a subtree of zero leaves. */
export function padHashRecords(): Array<Record<string, unknown>> {
  return PIECE_LENGTHS.map((pieceLength) => {
    const height = Math.log2(pieceLength / BLOCK_SIZE);
    return { piece_length: pieceLength, height, hash: Buffer.from(padHash(height)).toString("hex") };
  });
}

export interface VectorsDocument {
  readonly text: string;
  readonly vectors: readonly ComputedVector[];
  readonly descriptor: ComputedDescriptorVector;
}

export function computeVectorsDocument(
  patterns: (plan: VectorPlan) => Uint8Array = (plan) => patternBytes(plan.seed, plan.size),
): VectorsDocument {
  const vectors = VECTOR_PLAN.map((plan) => computeVector(plan, patterns(plan)));
  const descriptor = computeDescriptorVector();
  const document = {
    title: "transport-hints/v1 test vectors (Working Draft 0.1)",
    status: VECTORS_STATUS,
    status_note:
      "Every value here is the output of bin/build-transport-hints.ts alone. It stays the builder's own output, " +
      "confirmed by no independent hasher, until the cross-check workflow .github/workflows/transport-hints.yml has " +
      "passed on a GitHub-hosted runner, comparing each value with libtorrent's create_torrent and the BEP 52 " +
      "reference creator. Changing this status is a separate, deliberate edit after such a run.",
    profile: PROFILE,
    spec: "docs/specs/TRANSPORT-HINTS-0.1-DRAFT.md",
    generator: `${PATTERN_DOMAIN} (draft section 14.1); pattern files are generated when needed and never stored`,
    regenerate: "bun bin/transport-hints-vectors.ts --write",
    vectors: vectors.map((vector) => vector.record),
    descriptor_vectors: [descriptor.record],
    pad_hashes: padHashRecords(),
  };
  return { text: canonicalJson(document), vectors, descriptor };
}

async function main(argv: readonly string[]): Promise<number> {
  const [flag, value, ...extra] = argv;
  const path = join(ROOT, VECTORS_PATH);
  if (flag === "--write" && value === undefined) {
    await writeFile(path, computeVectorsDocument().text, { mode: 0o644 });
    console.log(`wrote ${VECTORS_PATH}`);
    return 0;
  }
  if (flag === "--check" && value === undefined) {
    const current = await readFile(path, "utf8");
    if (current !== computeVectorsDocument().text) {
      console.error(`${VECTORS_PATH} differs from the builder's output; run bun bin/transport-hints-vectors.ts --write`);
      return 1;
    }
    console.log(`${VECTORS_PATH} matches the builder's output`);
    return 0;
  }
  if (flag === "--torrents-out" && value !== undefined && extra.length === 0) {
    await mkdir(value, { recursive: false, mode: 0o755 });
    const document = computeVectorsDocument();
    const builds = [...document.vectors.map((vector) => vector.build), document.descriptor.build];
    for (const build of builds) {
      await writeFile(join(value, `${build.name}.torrent`), build.torrent, { flag: "wx", mode: 0o644 });
    }
    console.log(`wrote ${builds.length} .torrent files to ${value}`);
    return 0;
  }
  console.error("usage: bin/transport-hints-vectors.ts --write | --check | --torrents-out <new directory>");
  return 2;
}

if (import.meta.main) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error: unknown) => {
      console.error(`transport-hints vectors: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    },
  );
}
