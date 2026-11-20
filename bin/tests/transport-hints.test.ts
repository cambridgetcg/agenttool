import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  BLOCK_SIZE,
  BencodeDict,
  DESCRIPTOR_KEY_ORDER,
  FORBIDDEN_KEYS,
  INFO_KEYS,
  PIECE_LENGTHS,
  SCHEMA_PATTERNS,
  TOP_LEVEL_KEYS,
  SubjectHasher,
  assertProfileTorrent,
  bdecode,
  bencode,
  buildDescriptor,
  buildTorrentFromBytes,
  canonicalJson,
  descriptorBytesProblems,
  descriptorProblems,
  hashSubject,
  parseDescriptorFields,
  profilePieceLength,
  requestPieceLength,
  sha256Hex,
  torrentFromHashes,
  type BencodeValue,
  type SubjectHashes,
  type TorrentRequest,
} from "../build-transport-hints.ts";
import { probeRanges, probeWebSeed, type ProbeFetch, type ProbeRequestInit } from "../transport-hints-probe.ts";
import {
  DESCRIPTOR_EXAMPLE,
  MAX_VECTOR_BYTES,
  VECTORS_PATH,
  VECTORS_STATUS,
  VECTOR_PLAN,
  computeVectorsDocument,
  exampleUrlList,
  patternBytes,
  vectorName,
  type VectorPlan,
} from "../transport-hints-vectors.ts";

// transport-hints/v1 builder, vectors and probe
// (docs/specs/TRANSPORT-HINTS-0.1-DRAFT.md). Light and network-free: every
// subject is a pattern file generated in memory (all under 5 MiB), the probe
// is driven by a fake fetch, and no test opens a socket or a listening port.
// The independent hashers run only in .github/workflows/transport-hints.yml.

const ROOT = resolve(import.meta.dir, "../..");
const SPEC_PATH = "docs/specs/TRANSPORT-HINTS-0.1-DRAFT.md";
const SCHEMA_PATH = "docs/specs/transport-hints-v1.schema.json";
const WORKFLOW_PATH = ".github/workflows/transport-hints.yml";
const CROSSCHECK_PATH = "bin/transport-hints-crosscheck.py";

type Json = Record<string, any>;
type Validator = ((value: unknown) => boolean) & { errors?: unknown };

const specText = readFileSync(join(ROOT, SPEC_PATH), "utf8");
const schema = JSON.parse(readFileSync(join(ROOT, SCHEMA_PATH), "utf8")) as Json;
const vectorsText = readFileSync(join(ROOT, VECTORS_PATH), "utf8");
const vectorsFile = JSON.parse(vectorsText) as Json;

// One in-memory computation shared by the tests; a second one checks that two
// builds give the same bytes.
const patterns = new Map<string, Uint8Array>(VECTOR_PLAN.map((plan) => [plan.seed, patternBytes(plan.seed, plan.size)]));
const patternOf = (plan: VectorPlan): Uint8Array => patterns.get(plan.seed)!;
const computed = computeVectorsDocument(patternOf);

// Ajv 2020 from the API's locked dependencies, configured as
// bin/build-love-packages.ts and bin/tests/transport-hints-schema.test.ts do.
async function loadValidator(): Promise<Validator> {
  const ajvPath = join(ROOT, "api", "node_modules", "ajv", "dist", "2020.js");
  const formatsPath = join(ROOT, "api", "node_modules", "ajv-formats", "dist", "index.js");
  if (!existsSync(ajvPath) || !existsSync(formatsPath)) {
    throw new Error("transport-hints schema validation requires the API's locked dependencies; run bun install in api/");
  }
  const [{ default: Ajv2020 }, { default: addFormats }] = await Promise.all([
    import(pathToFileURL(ajvPath).href),
    import(pathToFileURL(formatsPath).href),
  ]);
  const ajv = new Ajv2020({ allErrors: true, strict: true, validateFormats: true });
  addFormats(ajv);
  return ajv.compile(schema) as Validator;
}

const validate = await loadValidator();

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString("hex");
const sha256 = (...parts: Uint8Array[]): Buffer => {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part);
  return hash.digest();
};

function expectThrow(fn: () => unknown, pattern: RegExp, label: string): void {
  let message = "";
  try {
    fn();
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  expect(message, `${label} did not throw`).not.toBe("");
  expect(message, label).toMatch(pattern);
}

// ---------------------------------------------------------------------------
// A second construction, written here from the BEP texts and independent of
// the builder's streaming code: one tree over all leaves, completed with zero
// leaves to the next power of two; the piece layer is the layer whose nodes
// each cover one piece, cut to the pieces that hold data.

function naiveHashes(bytes: Uint8Array, pieceLength: number): { root: string; layer: string | null; pieces: string } {
  const leaves: Buffer[] = [];
  for (let offset = 0; offset < bytes.length; offset += BLOCK_SIZE) leaves.push(sha256(bytes.subarray(offset, offset + BLOCK_SIZE)));
  let width = 1;
  while (width < leaves.length) width *= 2;
  while (leaves.length < width) leaves.push(Buffer.alloc(32));
  const layers: Buffer[][] = [leaves];
  while (layers[layers.length - 1]!.length > 1) {
    const below = layers[layers.length - 1]!;
    const next: Buffer[] = [];
    for (let i = 0; i < below.length; i += 2) next.push(sha256(below[i]!, below[i + 1]!));
    layers.push(next);
  }
  const count = Math.ceil(bytes.length / pieceLength);
  const height = Math.log2(pieceLength / BLOCK_SIZE);
  const layer = bytes.length > pieceLength ? Buffer.concat(layers[height]!.slice(0, count)).toString("hex") : null;
  const pieces: Buffer[] = [];
  for (let offset = 0; offset < bytes.length; offset += pieceLength) {
    pieces.push(createHash("sha1").update(bytes.subarray(offset, offset + pieceLength)).digest());
  }
  return { root: layers[layers.length - 1]![0]!.toString("hex"), layer, pieces: Buffer.concat(pieces).toString("hex") };
}

/** An independent bencoder for plain values: numbers, strings, bytes, arrays and objects. */
function benc(value: unknown): Buffer {
  if (typeof value === "number") return Buffer.from(`i${value}e`);
  if (typeof value === "string") return benc(Buffer.from(value, "utf8"));
  if (value instanceof Uint8Array) return Buffer.concat([Buffer.from(`${value.length}:`), Buffer.from(value)]);
  if (Array.isArray(value)) return Buffer.concat([Buffer.from("l"), ...value.map(benc), Buffer.from("e")]);
  if (value instanceof Map) {
    const entries = [...value.entries()] as Array<[Buffer, unknown]>;
    entries.sort((a, b) => Buffer.compare(a[0], b[0]));
    return Buffer.concat([Buffer.from("d"), ...entries.flatMap(([k, v]) => [benc(k), benc(v)]), Buffer.from("e")]);
  }
  const object = value as Record<string, unknown>;
  return benc(new Map(Object.keys(object).map((key) => [Buffer.from(key, "utf8"), object[key]])));
}

function naiveInfo(name: string, size: number, pieceLength: number, root: string, pieces: string): Buffer {
  return benc({
    "file tree": { [name]: { "": { length: size, "pieces root": Buffer.from(root, "hex") } } },
    length: size,
    "meta version": 2,
    name,
    "piece length": pieceLength,
    pieces: Buffer.from(pieces, "hex"),
  });
}

function codeBlockAfter(heading: string): string {
  const start = specText.indexOf(`\n### ${heading}`);
  expect(start, heading).toBeGreaterThan(-1);
  const match = /\n```json\n([\s\S]*?)```\n/u.exec(specText.slice(start));
  expect(match, heading).not.toBeNull();
  return match![1]!;
}

function descriptorFieldsFor(subject: Uint8Array, filename: string): ReturnType<typeof parseDescriptorFields> {
  const e = DESCRIPTOR_EXAMPLE;
  return parseDescriptorFields({
    subject: { filename, size: subject.length, sha256: sha256Hex(subject) },
    authority: { ...e.authority },
    home: e.home,
    license: e.license,
    notices: {
      inside_subject: [],
      beside_subject: [{
        filename: e.noticeFilename,
        size: e.noticeSize,
        sha256: sha256Hex(patternBytes(e.noticeSeed, e.noticeSize)),
        url: e.noticeUrl,
      }],
    },
  });
}

describe("pattern files (draft section 14.1)", () => {
  test("follow the generator exactly", () => {
    const prefix = Buffer.concat([Buffer.from("transport-hints-pattern/v1"), Buffer.from([0]), Buffer.from("x"), Buffer.from([0])]);
    const block = (k: number) => {
      const counter = Buffer.alloc(8);
      counter.writeBigUInt64BE(BigInt(k));
      return sha256(prefix, counter);
    };
    expect(hex(patternBytes("x", 32))).toBe(block(0).toString("hex"));
    expect(hex(patternBytes("x", 70))).toBe(Buffer.concat([block(0), block(1), block(2).subarray(0, 6)]).toString("hex"));
    expect(hex(patternBytes("x", 1))).toBe(block(0).subarray(0, 1).toString("hex"));
    expect(hex(patternBytes("seed", 100).subarray(0, 40))).toBe(hex(patternBytes("seed", 40)));
    expect(hex(patternBytes("a", 64))).not.toBe(hex(patternBytes("b", 64)));
  });

  test("refuse a bad seed or size", () => {
    for (const seed of ["", "a b", "faké", "x".repeat(65), "tab\there"]) {
      expectThrow(() => patternBytes(seed, 10), /seed/u, `seed ${JSON.stringify(seed)}`);
    }
    for (const size of [0, -1, 1.5, Number.NaN]) expectThrow(() => patternBytes("x", size), /size/u, `size ${size}`);
  });
});

describe("the committed vectors file", () => {
  test("is exactly the builder's output for the generated pattern files", () => {
    expect(vectorsText === computed.text, `${VECTORS_PATH} is stale; run bun bin/transport-hints-vectors.ts --write`).toBe(true);
  });

  test("says it is the builder's own output until the cross-check has passed", () => {
    expect(vectorsFile.status).toBe(VECTORS_STATUS);
    expect(VECTORS_STATUS).toBe("builder-output-unconfirmed");
    expect(vectorsFile.status_note).toContain(".github/workflows/transport-hints.yml");
    expect(vectorsFile.status_note).toContain("GitHub-hosted runner");
    expect(vectorsFile.regenerate).toBe("bun bin/transport-hints-vectors.ts --write");
  });

  test("matches every field of every recomputed vector", () => {
    expect(vectorsFile.vectors).toHaveLength(VECTOR_PLAN.length);
    computed.vectors.forEach((vector, i) => {
      const committed = vectorsFile.vectors[i] as Json;
      for (const [field, value] of Object.entries(vector.record)) {
        expect(committed[field], `${vector.record.name} ${field}`).toEqual(value);
      }
      expect(Object.keys(committed)).toEqual(Object.keys(vector.record));
    });
    expect(vectorsFile.descriptor_vectors).toEqual([computed.descriptor.record]);
  });

  test("covers the planned cases, each under 5 MiB", () => {
    const at = (length: number | undefined) => VECTOR_PLAN.filter((plan) => plan.explicitPieceLength === length);
    expect(at(undefined).map((plan) => plan.size)).toEqual([1, 16384, 16385, 46000]);
    for (const length of [32768, 1048576]) {
      const sizes = at(length).map((plan) => plan.size);
      expect(sizes).toHaveLength(5);
      expect(sizes[0]!, `smaller than one piece at ${length}`).toBeLessThan(length);
      expect(sizes[1]).toBe(length);
      expect(sizes[2]).toBe(length + 1);
      for (const [index, pieces] of [[3, 3], [4, 5]] as const) {
        expect(Math.ceil(sizes[index]! / length), `${pieces} pieces at ${length}`).toBe(pieces);
        expect(sizes[index]! % length, `short last piece at ${length}`).not.toBe(0);
      }
    }
    const smallAtOneMiB = at(1048576)[0]!;
    expect(Math.ceil(smallAtOneMiB.size / BLOCK_SIZE), "7 blocks at 1 MiB").toBe(7);
    for (const plan of VECTOR_PLAN) {
      expect(plan.size).toBeLessThanOrEqual(MAX_VECTOR_BYTES);
      expect(plan.size).toBeLessThan(5 * 1024 * 1024);
      if (plan.explicitPieceLength !== undefined) expect(plan.explicitPieceLength).not.toBe(profilePieceLength(plan.size));
    }
    for (const vector of vectorsFile.vectors as Json[]) {
      if (vector.size <= BLOCK_SIZE) expect(vector.pieces_root, `${vector.name}: rule 2`).toBe(vector.sha256);
      expect(vector.piece_layers === null, vector.name).toBe(vector.size <= vector.piece_length);
      expect(vector.url_list).toEqual(exampleUrlList(vector.name));
      expect([...vector.url_list].sort()).not.toEqual(vector.url_list);
    }
  });

  test("agree with a second merkle and bencode construction written in this test", () => {
    for (const vector of vectorsFile.vectors as Json[]) {
      const plan = VECTOR_PLAN.find((candidate) => vectorName(candidate) === vector.name)!;
      const bytes = patternOf(plan);
      expect(sha256Hex(bytes), vector.name).toBe(vector.sha256);
      const naive = naiveHashes(bytes, vector.piece_length);
      expect(naive.root, `${vector.name} pieces_root`).toBe(vector.pieces_root);
      expect(naive.layer, `${vector.name} piece_layers`).toBe(vector.piece_layers);
      expect(naive.pieces, `${vector.name} pieces`).toBe(vector.pieces);
      const info = naiveInfo(vector.name, vector.size, vector.piece_length, naive.root, naive.pieces);
      expect(createHash("sha1").update(info).digest("hex"), `${vector.name} btih`).toBe(vector.btih);
      expect(`1220${sha256(info).toString("hex")}`, `${vector.name} btmh`).toBe(vector.btmh);
      const layers = new Map<Buffer, unknown>(vector.piece_layers ? [[Buffer.from(naive.root, "hex"), Buffer.from(naive.layer!, "hex")]] : []);
      const torrent = benc(new Map<Buffer, unknown>([
        [Buffer.from("info"), new Map(Object.entries({
          "file tree": { [vector.name]: { "": { length: vector.size, "pieces root": Buffer.from(naive.root, "hex") } } },
          length: vector.size,
          "meta version": 2,
          name: vector.name,
          "piece length": vector.piece_length,
          pieces: Buffer.from(naive.pieces, "hex"),
        }).map(([k, v]) => [Buffer.from(k), v]))],
        [Buffer.from("piece layers"), layers],
        [Buffer.from("url-list"), vector.url_list],
      ]));
      expect(torrent.length, `${vector.name} torrent_size`).toBe(vector.torrent_size);
      expect(sha256(torrent).toString("hex"), `${vector.name} torrent_sha256`).toBe(vector.torrent_sha256);
    }
    for (const record of vectorsFile.pad_hashes as Json[]) {
      let value: Buffer = Buffer.alloc(32);
      for (let k = 0; k < record.height; k += 1) value = sha256(value, value);
      expect(record.piece_length).toBe(BLOCK_SIZE * 2 ** record.height);
      expect(value.toString("hex"), `pad hash at ${record.piece_length}`).toBe(record.hash);
    }
    expect((vectorsFile.pad_hashes as Json[]).map((record) => record.piece_length)).toEqual([...PIECE_LENGTHS]);
  });

  test("give the same hashes whatever the chunking of the one pass", () => {
    const cases: Array<[string, number[]]> = [
      ["th-16k-46000", [1, 7, 16383, 16385]],
      ["th-32k-5-pieces", [7, 16383, 32769, 65536]],
      ["th-1m-3-pieces", [65537, 1048575]],
      ["th-1m-one-piece-plus-one", [16384, 1048577]],
    ];
    for (const [seed, chunkSizes] of cases) {
      const plan = VECTOR_PLAN.find((candidate) => candidate.seed === seed)!;
      const bytes = patternOf(plan);
      const pieceLength = plan.explicitPieceLength ?? profilePieceLength(plan.size);
      const whole = hashSubject(bytes, pieceLength);
      for (const chunkSize of chunkSizes) {
        const hasher = new SubjectHasher(pieceLength);
        for (let offset = 0; offset < bytes.length; offset += chunkSize) hasher.update(bytes.subarray(offset, offset + chunkSize));
        const chunked = hasher.digest();
        const label = `${seed} in chunks of ${chunkSize}`;
        expect(chunked.sha256, label).toBe(whole.sha256);
        expect(hex(chunked.pieces), label).toBe(hex(whole.pieces));
        expect(hex(chunked.piecesRoot), label).toBe(hex(whole.piecesRoot));
        expect(chunked.pieceLayer === null ? null : hex(chunked.pieceLayer), label).toBe(whole.pieceLayer === null ? null : hex(whole.pieceLayer));
      }
    }
  });

  test("build twice to the same bytes", () => {
    const again = computeVectorsDocument(patternOf);
    expect(again.text === computed.text).toBe(true);
    again.vectors.forEach((vector, i) => {
      expect(Buffer.compare(Buffer.from(vector.build.torrent), Buffer.from(computed.vectors[i]!.build.torrent)), vector.build.name).toBe(0);
    });
    expect(again.descriptor.text === computed.descriptor.text).toBe(true);
  });
});

describe("the single-file-hybrid/1 .torrent", () => {
  test("holds exactly the profile's keys, the plain length form, and piece layers even when empty", () => {
    for (const vector of [...computed.vectors.map((v) => v.build), computed.descriptor.build]) {
      const parsed = assertProfileTorrent(vector.torrent);
      expect(parsed.btih).toBe(vector.btih);
      expect(parsed.btmh).toBe(vector.btmh);
      expect(parsed.urlList).toEqual(vector.urlList);
      const top = bdecode(vector.torrent);
      if (top.type !== "dict") throw new Error("not a dictionary");
      expect(top.entries.map(([key]) => Buffer.from(key).toString("latin1"))).toEqual([...TOP_LEVEL_KEYS]);
      const info = top.entries[0]![1];
      if (info.type !== "dict") throw new Error("info is not a dictionary");
      expect(info.entries.map(([key]) => Buffer.from(key).toString("latin1"))).toEqual([...INFO_KEYS]);
      const text = Buffer.from(vector.torrent).toString("latin1");
      for (const key of [...FORBIDDEN_KEYS, "files", "private", "attr"]) expect(text.includes(`${key.length}:${key}`), `${vector.name} holds ${key}`).toBe(false);
      if (vector.pieceLayer === null) expect(text).toContain("12:piece layersde");
      expect(text).toContain(`8:url-listl${vector.urlList.map((url) => `${url.length}:${url}`).join("")}e`);
    }
  });

  test("checks refuse forbidden keys, the files form, pad entries and broken layers", () => {
    const plan = VECTOR_PLAN.find((candidate) => candidate.seed === "th-32k-3-pieces")!;
    const bytes = patternOf(plan);
    const hashes = hashSubject(bytes, plan.explicitPieceLength!);
    const name = vectorName(plan);
    const urls = exampleUrlList(name);
    const fileTree = (n: string, root: Uint8Array = hashes.piecesRoot) =>
      new BencodeDict([[n, new BencodeDict([["", new BencodeDict([["length", hashes.size], ["pieces root", root]])]])]]);
    const infoEntries = (n = name): Array<[string, BencodeValue]> => [
      ["file tree", fileTree(n)],
      ["length", hashes.size],
      ["meta version", 2],
      ["name", n],
      ["piece length", hashes.pieceLength],
      ["pieces", hashes.pieces],
    ];
    const layers = (layer: Uint8Array = hashes.pieceLayer!) => new BencodeDict([[hashes.piecesRoot, layer]]);
    const torrent = (info: Array<[string, BencodeValue]>, top: Array<[string, BencodeValue]> = []) =>
      bencode(new BencodeDict([["info", new BencodeDict(info)], ["piece layers", layers()], ["url-list", urls], ...top]));

    expect(() => assertProfileTorrent(torrent(infoEntries()))).not.toThrow();
    for (const key of FORBIDDEN_KEYS) {
      const value: BencodeValue = key === "creation date" ? 1763078400 : key === "announce-list" || key === "nodes" || key === "httpseeds" ? [] : "x";
      expectThrow(() => assertProfileTorrent(torrent(infoEntries(), [[key, value]])), new RegExp(`forbidden key '${key}' at the top level`, "u"), `top-level ${key}`);
      expectThrow(() => assertProfileTorrent(torrent([...infoEntries(), [key, value]])), new RegExp(`forbidden key '${key}' at the info`, "u"), `info ${key}`);
    }
    expectThrow(() => assertProfileTorrent(torrent([...infoEntries(), ["private", 1]])), /must hold exactly/u, "private flag");
    expectThrow(() => assertProfileTorrent(torrent(infoEntries(), [["x-extra", "y"]])), /must hold exactly/u, "unknown top-level key");
    const withPad: Array<[string, BencodeValue]> = infoEntries().filter(([key]) => key !== "length");
    withPad.push(["files", [
      new BencodeDict([["length", hashes.size], ["path", [name]]]),
      new BencodeDict([["attr", "p"], ["length", 3 * 32768 - hashes.size], ["path", [".pad", String(3 * 32768 - hashes.size)]]]),
    ]]);
    expectThrow(() => assertProfileTorrent(torrent(withPad)), /plain 'length' form.*pad entry/u, "files list with a pad entry");
    expectThrow(() => assertProfileTorrent(bencode(new BencodeDict([["info", new BencodeDict(infoEntries())], ["url-list", urls]]))), /must hold exactly/u, "missing piece layers");
    expectThrow(() => assertProfileTorrent(bencode(new BencodeDict([["info", new BencodeDict(infoEntries())], ["piece layers", layers()], ["url-list", urls[0]!]]))), /'url-list' must be a list/u, "url-list as a string");
    expectThrow(() => assertProfileTorrent(bencode(new BencodeDict([["info", new BencodeDict(infoEntries())], ["piece layers", layers()], ["url-list", ["https://example.org/files/"]]]))), /web seed/u, "web seed ending in a slash");
    const tampered = new Uint8Array(hashes.pieceLayer!);
    tampered[0] = tampered[0]! ^ 1;
    expectThrow(() => assertProfileTorrent(bencode(new BencodeDict([["info", new BencodeDict(infoEntries())], ["piece layers", layers(tampered)], ["url-list", urls]]))), /does not match the pieces root/u, "tampered piece layer");
    const shortPieces = infoEntries().map(([key, value]): [string, BencodeValue] => [key, key === "pieces" ? hashes.pieces.subarray(20) : value]);
    expectThrow(() => assertProfileTorrent(torrent(shortPieces)), /'pieces' must hold 3/u, "missing piece hash");
    expectThrow(() => assertProfileTorrent(torrent(infoEntries("dir/x.bin"))), /name rule/u, "name with a slash");
    const mismatchedTree = infoEntries().map(([key, value]): [string, BencodeValue] => [key, key === "file tree" ? fileTree("other.bin") : value]);
    expectThrow(() => assertProfileTorrent(torrent(mismatchedTree)), /equal to 'name'/u, "file tree key differs from name");
    const good = torrent(infoEntries());
    expectThrow(() => assertProfileTorrent(Buffer.concat([good, Buffer.from("x")])), /trailing bytes/u, "trailing bytes");
    expectThrow(() => bdecode(Buffer.from("i03e")), /non-canonical integer/u, "leading zero");
    expectThrow(() => bdecode(Buffer.from("i-0e")), /non-canonical integer/u, "negative zero");
    expectThrow(() => bdecode(Buffer.from("d1:bi1e1:ai2ee")), /not strictly sorted/u, "unsorted keys");
    expectThrow(() => bdecode(Buffer.from("d1:ai1e1:ai2ee")), /not strictly sorted/u, "duplicate keys");
    expectThrow(() => bdecode(Buffer.from("di1ei2ee")), /key is not a string/u, "integer key");
    expectThrow(() => bdecode(Buffer.from("5:abc")), /truncated/u, "truncated string");
  });
});

describe("builder refusals", () => {
  const plan = VECTOR_PLAN.find((candidate) => candidate.seed === "th-16k-46000")!;
  const bytes = patternOf(plan);
  const name = vectorName(plan);
  const request: TorrentRequest = { name, size: bytes.length, sha256: sha256Hex(bytes), urlList: exampleUrlList(name) };

  test("refuse bytes whose size or SHA-256 differ from the expected values", () => {
    const hashes = hashSubject(bytes, 16384);
    expectThrow(() => torrentFromHashes({ ...request, size: bytes.length + 1 }, hashes), /refused: the bytes hold 46000 bytes/u, "size");
    expectThrow(() => torrentFromHashes({ ...request, sha256: "0".repeat(64) }, hashes), /refused: the bytes' SHA-256/u, "sha256");
    expectThrow(() => buildTorrentFromBytes(request, bytes.subarray(1)), /refused/u, "truncated bytes");
    expectThrow(() => hashSubject(new Uint8Array(0), 16384), /empty subjects are out of scope/u, "empty file");
    const hasher = new SubjectHasher(16384);
    hasher.update(bytes);
    hasher.digest();
    expectThrow(() => hasher.update(bytes), /already finished/u, "update after digest");
  });

  test("refuse names, web seeds and piece lengths outside the profile", () => {
    for (const bad of ["", "con", "NUL.txt", "lpt9", "dir/x.bin", "../x", ".hidden", "x.", "with space", "faké.bin", `a${"-".repeat(199)}z`]) {
      expectThrow(() => requestPieceLength({ ...request, name: bad }), /name rule/u, `name ${JSON.stringify(bad)}`);
    }
    const badSeeds: Array<[string, string[]]> = [
      ["empty list", []],
      ["http", ["http://example.org/x.bin"]],
      ["trailing slash", ["https://example.org/files/"]],
      ["query", ["https://example.org/x.bin?sig=1"]],
      ["fragment", ["https://example.org/x.bin#a"]],
      ["port", ["https://example.org:443/x.bin"]],
      ["uppercase host", ["https://Example.org/x.bin"]],
      ["IP literal", ["https://192.0.2.1/x.bin"]],
      ["dot segment", ["https://example.org/a/../x.bin"]],
      ["lowercase escape", ["https://example.org/a%2fb"]],
      ["duplicate", ["https://example.org/x.bin", "https://example.org/x.bin"]],
    ];
    for (const [label, urlList] of badSeeds) expectThrow(() => requestPieceLength({ ...request, urlList }), /web seed|url-list/u, label);
    for (const length of [8192, 20000, 33554432, 0]) {
      expectThrow(() => requestPieceLength({ ...request, testVectorPieceLength: length }), /not a power of two from 16 KiB to 16 MiB/u, `piece length ${length}`);
    }
    expectThrow(() => requestPieceLength({ ...request, sha256: "A".repeat(64) }), /64 lowercase hexadecimal/u, "uppercase sha256");
    expect(requestPieceLength(request)).toBe(16384);
  });

  test("never write a descriptor from a test-vector piece length or for other bytes", () => {
    const testVector = buildTorrentFromBytes({ ...request, testVectorPieceLength: 32768 }, bytes);
    expect(testVector.testVector).toBe(true);
    const fields = descriptorFieldsFor(bytes, name);
    expectThrow(() => buildDescriptor(fields, testVector), /never written from an explicit test-vector piece length/u, "test vector");
    const profile = buildTorrentFromBytes(request, bytes);
    expect(profile.testVector).toBe(false);
    expect(() => buildDescriptor(fields, profile)).not.toThrow();
    const other = descriptorFieldsFor(patternBytes("other", bytes.length), name);
    expectThrow(() => buildDescriptor(other, profile), /differs from the hashed bytes/u, "another subject");
  });

  test("refuse descriptor fields outside the draft's rules", () => {
    const base = () => JSON.parse(JSON.stringify(descriptorFieldsFor(bytes, name))) as Json;
    const mutations: Array<[string, (v: Json) => void, RegExp]> = [
      ["unknown field", (v) => { v.created_at = "2026-11-14"; }, /unknown field 'created_at'/u],
      ["signature in authority", (v) => { v.authority.signature = "00"; }, /unknown field 'signature'/u],
      ["licence NONE", (v) => { v.license = "NONE"; }, /license/u],
      ["licence expression", (v) => { v.license = "MIT OR Apache-2.0"; }, /license/u],
      ["no notice", (v) => { v.notices.beside_subject = []; }, /at least one notice/u],
      ["unsorted members", (v) => { v.notices.inside_subject = ["package/NOTICE", "package/LICENSE"]; }, /sorted strictly ascending by byte value/u],
      ["duplicate members", (v) => { v.notices.inside_subject = ["LICENSE", "LICENSE"]; }, /sorted strictly ascending/u],
      ["unsorted notice files", (v) => { v.notices.beside_subject = [{ ...v.notices.beside_subject[0], filename: "b.txt" }, { ...v.notices.beside_subject[0], filename: "a.txt" }]; }, /sorted strictly ascending by filename/u],
      ["love-package pointer", (v) => { v.authority = { kind: "love-package/v1", url: "https://example.org/m.json", pointer: "/artifact/size" }; }, /always \/artifact\/sha256/u],
      ["hf branch", (v) => { v.authority = { kind: "hf-resolve-etag", url: "https://huggingface.co/o/r/resolve/main/f.bin", header: "x-linked-etag" }; }, /commit-pinned/u],
      ["unknown kind", (v) => { v.authority = { kind: "document-contains", url: "https://example.org/x" }; }, /unknown authority kind/u],
      ["http home", (v) => { v.home = "http://example.org/"; }, /home/u],
      ["subject filename with a slash", (v) => { v.subject.filename = "a/b.bin"; }, /subject.filename/u],
    ];
    for (const [label, mutate, pattern] of mutations) {
      const value = base();
      mutate(value);
      expectThrow(() => parseDescriptorFields(value), pattern, label);
    }
  });

  test("the CLI writes nothing on a refusal and reproduces the example descriptor", () => {
    const dir = mkdtempSync(join(tmpdir(), "transport-hints-test-"));
    try {
      const e = DESCRIPTOR_EXAMPLE;
      const subject = patternBytes(e.subjectSeed, e.subjectSize);
      const input = join(dir, e.filename);
      writeFileSync(input, subject);
      const fields = descriptorFieldsFor(subject, e.filename);
      const requestFile = (overrides: Json = {}) => {
        const path = join(dir, `request-${Math.random().toString(36).slice(2)}.json`);
        writeFileSync(path, JSON.stringify({ ...fields, name: e.name, url_list: [...e.urlList], ...overrides }));
        return path;
      };
      const run = (args: string[], stdin?: Uint8Array) =>
        spawnSync(process.execPath, ["--no-install", "--no-env-file", join(ROOT, "bin/build-transport-hints.ts"), ...args], {
          cwd: dir,
          input: stdin,
          env: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
        });

      const wrong = run(["build", "--request", requestFile({ subject: { ...fields.subject, sha256: "0".repeat(64) } }), "--input", input, "--torrent-out", join(dir, "a.torrent"), "--descriptor-out", join(dir, "a.json")]);
      expect(wrong.status).toBe(1);
      expect(wrong.stderr.toString()).toContain("refused: the bytes' SHA-256");
      const wrongSize = run(["build", "--request", requestFile({ subject: { ...fields.subject, size: 46001 } }), "--input", input, "--torrent-out", join(dir, "a.torrent")]);
      expect(wrongSize.status).toBe(1);
      expect(wrongSize.stderr.toString()).toContain("refused: the bytes hold 46000 bytes, expected 46001");
      const vectorWithDescriptor = run(["build", "--request", requestFile(), "--input", input, "--torrent-out", join(dir, "a.test-vector.torrent"), "--descriptor-out", join(dir, "a.json"), "--test-vector-piece-length", "32768"]);
      expect(vectorWithDescriptor.status).toBe(1);
      expect(vectorWithDescriptor.stderr.toString()).toContain("never writes a descriptor");
      const unmarked = run(["build", "--request", requestFile(), "--input", input, "--torrent-out", join(dir, "a.torrent"), "--test-vector-piece-length", "32768"]);
      expect(unmarked.status).toBe(1);
      expect(unmarked.stderr.toString()).toContain(".test-vector.torrent");
      expect(readdirSync(dir).filter((file) => !file.startsWith("request-") && file !== e.filename)).toEqual([]);

      const ok = run(["build", "--request", requestFile(), "--input", "-", "--torrent-out", join(dir, "example.torrent"), "--descriptor-out", join(dir, "example.transport.json")], subject);
      expect(ok.status, ok.stderr.toString()).toBe(0);
      const summary = JSON.parse(ok.stdout.toString()) as Json;
      expect(summary.test_vector).toBe(false);
      expect(summary.descriptor_sha256).toBe(computed.descriptor.sha256);
      expect(summary.torrent_sha256).toBe(computed.descriptor.build.torrentSha256);
      expect(readFileSync(join(dir, "example.transport.json"), "utf8")).toBe(computed.descriptor.text);
      expect(Buffer.compare(readFileSync(join(dir, "example.torrent")), Buffer.from(computed.descriptor.build.torrent))).toBe(0);

      const again = run(["build", "--request", requestFile(), "--input", input, "--torrent-out", join(dir, "example.torrent")]);
      expect(again.status).toBe(1);
      expect(again.stderr.toString()).toContain("never overwritten");

      const vector = run(["build", "--request", requestFile(), "--input", input, "--torrent-out", join(dir, "example.test-vector.torrent"), "--test-vector-piece-length", "32768"]);
      expect(vector.status, vector.stderr.toString()).toBe(0);
      expect((JSON.parse(vector.stdout.toString()) as Json).test_vector).toBe(true);

      const check = run(["check-descriptor", join(dir, "example.transport.json"), "--input", input]);
      expect(check.status, check.stderr.toString()).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("the example descriptor (draft section 4.5)", () => {
  const text = computed.descriptor.text;

  test("is the draft's example block, byte for byte, and validates against the schema", () => {
    expect(codeBlockAfter("4.5 Example")).toBe(text);
    expect(sha256Hex(text)).toBe(vectorsFile.descriptor_vectors[0].descriptor_sha256);
    const value = JSON.parse(text);
    expect(validate(value), JSON.stringify(validate.errors)).toBe(true);
    expect(canonicalJson(value)).toBe(text);
    expect(descriptorProblems(text)).toEqual([]);
    const e = DESCRIPTOR_EXAMPLE;
    expect(descriptorBytesProblems(text, hashSubject(patternBytes(e.subjectSeed, e.subjectSize), 16384))).toEqual([]);
    expect(value.bittorrent.btih).toBe(computed.descriptor.build.btih);
  });

  test("the cross-field rules catch what the schema cannot", () => {
    const value = JSON.parse(text) as Json;
    const { protocol, ...withoutProtocol } = value;
    const reserialise = (mutate: (v: Json) => void) => {
      const copy = JSON.parse(text) as Json;
      mutate(copy);
      return canonicalJson(copy);
    };
    const wrongLength = reserialise((v) => { v.bittorrent.piece_length = 32768; });
    expect(validate(JSON.parse(wrongLength))).toBe(true);
    expect(descriptorProblems(wrongLength).join("\n")).toContain("rule 1");

    const unsorted = reserialise((v) => { v.notices.beside_subject = [{ ...v.notices.beside_subject[0], filename: "z.txt" }, { ...v.notices.beside_subject[0], filename: "a.txt" }]; });
    expect(validate(JSON.parse(unsorted))).toBe(true);
    expect(descriptorProblems(unsorted).join("\n")).toContain("sorted strictly ascending by filename");

    for (const [label, bad] of [
      ["CRLF", text.replace(/\n/gu, "\r\n")],
      ["no final newline", text.slice(0, -1)],
      ["four-space indent", `${JSON.stringify(value, null, 4)}\n`],
      ["one line", `${JSON.stringify(value)}\n`],
      ["escaped slash", text.replace("https://example.org/transport-hints/", "https:\\/\\/example.org\\/transport-hints\\/")],
      ["keys reordered", canonicalJson({ ...withoutProtocol, protocol })],
    ] as const) {
      expect(descriptorProblems(bad).length, label).toBeGreaterThan(0);
    }

    const small = patternBytes("th-16k-1-byte", 1);
    const smallBuild = buildTorrentFromBytes({ name: "small.bin", size: 1, sha256: sha256Hex(small), urlList: ["https://example.org/small.bin"] }, small);
    const smallText = buildDescriptor(descriptorFieldsFor(small, "small.bin"), smallBuild).text;
    expect(descriptorProblems(smallText)).toEqual([]);
    const rootChanged = canonicalJson({ ...JSON.parse(smallText), bittorrent: { ...JSON.parse(smallText).bittorrent, pieces_root: "1".repeat(64) } });
    expect(descriptorProblems(rootChanged).join("\n")).toContain("rule 2");

    const otherBtih = reserialise((v) => { v.bittorrent.btih = "3".repeat(40); });
    const e = DESCRIPTOR_EXAMPLE;
    const hashes: SubjectHashes = hashSubject(patternBytes(e.subjectSeed, e.subjectSize), 16384);
    expect(descriptorProblems(otherBtih)).toEqual([]);
    expect(descriptorBytesProblems(otherBtih, hashes).join("\n")).toContain("rule 3: btih");
    const otherName = reserialise((v) => { v.bittorrent.name = "renamed.bin"; });
    expect(descriptorBytesProblems(otherName, hashes).join("\n")).toContain("rule 3: btih");
  });
});

describe("the builder agrees with the schema and the draft", () => {
  test("its patterns, key order and piece lengths are the schema's", () => {
    const defs = schema.$defs as Json;
    const fromSchema: Record<keyof typeof SCHEMA_PATTERNS, string> = {
      sha256Hex: defs.sha256Hex.pattern,
      httpsUrl: defs.httpsUrl.pattern,
      webSeedEnd: defs.webSeedUrl.allOf[1].pattern,
      bareFilename: defs.bareFilename.pattern,
      torrentName: defs.torrentName.pattern,
      memberPath: defs.memberPath.pattern,
      spdxLicenseId: defs.spdxLicenseId.pattern,
      jsonPointer: defs.authorityJsonPointer.properties.pointer.pattern,
      hfResolveUrl: defs.authorityHfResolveEtag.properties.url.allOf[1].pattern,
    };
    expect({ ...SCHEMA_PATTERNS }).toEqual(fromSchema);
    const pairs: Array<[keyof typeof DESCRIPTOR_KEY_ORDER, string]> = [
      ["descriptor", "artifactDescriptor"],
      ["subject", "subject"],
      ["love-package/v1", "authorityLovePackage"],
      ["json-pointer", "authorityJsonPointer"],
      ["hf-resolve-etag", "authorityHfResolveEtag"],
      ["sums-line", "authoritySumsLine"],
      ["none-prior", "authorityNonePrior"],
      ["notices", "notices"],
      ["noticeFile", "noticeFile"],
      ["bittorrent", "bittorrent"],
    ];
    for (const [key, def] of pairs) expect(Object.keys(defs[def].properties), key).toEqual([...DESCRIPTOR_KEY_ORDER[key]]);
    expect([...PIECE_LENGTHS]).toEqual(defs.pieceLength.enum);
  });

  test("the piece-length rule gives the draft's worked values", () => {
    const worked: Array<[number, number]> = [
      [1, 16384], [16384, 16384], [16385, 16384], [46000, 16384], [16777216, 16384],
      [16777217, 32768], [538090408, 1048576], [1503300328, 2097152],
      [17179869184, 16777216], [17179869185, 16777216], [Number.MAX_SAFE_INTEGER, 16777216],
    ];
    for (const [size, length] of worked) expect(profilePieceLength(size), `size ${size}`).toBe(length);
    for (const bad of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) expectThrow(() => profilePieceLength(bad), /size must be an integer/u, `size ${bad}`);
    expect(specText).toContain("| 538,090,408 | 1,048,576 (1 MiB) | 514 (512 KiB would give 1,027) |");
  });

  test("the builder, vectors and probe modules hold no network code of their own", () => {
    for (const path of ["bin/build-transport-hints.ts", "bin/transport-hints-vectors.ts", "bin/transport-hints-probe.ts"]) {
      const source = readFileSync(join(ROOT, path), "utf8");
      for (const forbidden of ["node:net", "node:http", "node:https", "node:dns", "node:tls", "node:dgram", "Bun.connect", "Bun.listen", "Bun.serve", "WebSocket", "globalThis.fetch"]) {
        expect(source.includes(forbidden), `${path} mentions ${forbidden}`).toBe(false);
      }
      expect(/(?<![.\w])fetch\(/u.test(source), `${path} calls a global fetch`).toBe(false);
    }
  });
});

describe("the web-seed probe (draft section 7.4) with a fake fetch", () => {
  const size = 46000;
  const seed = "https://example.org/files/transport-hints-example.bin";
  type Answer = { status: number; headers?: Record<string, string>; body?: Uint8Array<ArrayBuffer> };
  const fakeFetch = (answer: (url: string, init: ProbeRequestInit) => Answer, log: Array<{ url: string; init: ProbeRequestInit }> = []): ProbeFetch =>
    async (url, init) => {
      log.push({ url, init });
      const { status, headers = {}, body } = answer(url, init);
      return new Response(body ?? null, { status, headers });
    };
  const rangeOf = (init: ProbeRequestInit): [number, number] => {
    const match = /^bytes=(\d+)-(\d+)$/u.exec(init.headers.Range ?? "")!;
    return [Number(match[1]), Number(match[2])];
  };
  const partial = (init: ProbeRequestInit, extra: Record<string, string> = {}): Answer => {
    const [first, last] = rangeOf(init);
    return { status: 206, headers: { "Content-Range": `bytes ${first}-${last}/${size}`, ...extra }, body: new Uint8Array(last - first + 1) };
  };

  test("asks for the first byte and a middle range with identity encoding and manual redirects", async () => {
    expect(probeRanges(1)).toEqual([[0, 0]]);
    expect(probeRanges(2)).toEqual([[0, 0], [1, 1]]);
    expect(probeRanges(size)).toEqual([[0, 0], [23000, 24023]]);
    const log: Array<{ url: string; init: ProbeRequestInit }> = [];
    const result = await probeWebSeed({ url: seed, size, fetch: fakeFetch((_url, init) => partial(init), log) });
    expect(result.ok).toBe(true);
    expect(result.redirects).toBe(0);
    expect(log.map((entry) => entry.init.headers.Range)).toEqual(["bytes=0-0", "bytes=23000-24023"]);
    for (const entry of log) {
      expect(entry.init.headers["Accept-Encoding"]).toBe("identity");
      expect(entry.init.redirect).toBe("manual");
      expect(entry.init.method).toBe("GET");
    }
    const identity = await probeWebSeed({ url: seed, size, fetch: fakeFetch((_url, init) => partial(init, { "Content-Encoding": "identity" })) });
    expect(identity.ok).toBe(true);
  });

  test("refuses 200, a wrong Content-Range, any compression and a wrong body length", async () => {
    const cases: Array<[string, (url: string, init: ProbeRequestInit) => Answer, RegExp]> = [
      ["whole file with 200", () => ({ status: 200, body: new Uint8Array(size) }), /status 200, not 206/u],
      ["unknown total", (_u, init) => { const a = partial(init); return { ...a, headers: { "Content-Range": `bytes ${rangeOf(init)[0]}-${rangeOf(init)[1]}/*` } }; }, /Content-Range/u],
      ["another size", (_u, init) => ({ ...partial(init), headers: { "Content-Range": `bytes ${rangeOf(init)[0]}-${rangeOf(init)[1]}/${size + 1}` } }), /Content-Range/u],
      ["no Content-Range", (_u, init) => ({ ...partial(init), headers: {} }), /Content-Range is absent/u],
      ["gzip", (_u, init) => partial(init, { "Content-Encoding": "gzip" }), /Content-Encoding is 'gzip'/u],
      ["long body", (_u, init) => ({ ...partial(init), body: new Uint8Array(rangeOf(init)[1] - rangeOf(init)[0] + 2) }), /not exactly/u],
      ["short body", (_u, init) => ({ ...partial(init), body: new Uint8Array(0) }), /not exactly/u],
      ["server error", () => ({ status: 503 }), /status 503/u],
    ];
    for (const [label, answer, pattern] of cases) {
      const result = await probeWebSeed({ url: seed, size, fetch: fakeFetch(answer) });
      expect(result.ok, label).toBe(false);
      expect(result.ranges.flatMap((range) => range.problems).join("\n"), label).toMatch(pattern);
    }
    const thrown = await probeWebSeed({ url: seed, size, fetch: async () => { throw new Error("offline"); } });
    expect(thrown.ok).toBe(false);
    expect(thrown.ranges[0]!.problems.join("\n")).toContain("request failed: offline");
  });

  test("counts redirects, allows one hop, and applies the egress policy to every target", async () => {
    const target = "https://objects.example.org/signed/transport-hints-example.bin";
    const oneHop = await probeWebSeed({
      url: seed,
      size,
      fetch: fakeFetch((url, init) => (url === seed ? { status: 302, headers: { Location: target } } : partial(init))),
    });
    expect(oneHop.ok).toBe(true);
    expect(oneHop.redirects).toBe(1);
    expect(oneHop.ranges.every((range) => range.finalUrl === target)).toBe(true);

    const twoHops = await probeWebSeed({
      url: seed,
      size,
      fetch: fakeFetch((url, init) =>
        url === seed ? { status: 301, headers: { Location: "https://a.example.org/x" } }
        : url === "https://a.example.org/x" ? { status: 307, headers: { Location: target } }
        : partial(init)),
    });
    expect(twoHops.ok).toBe(false);
    expect(twoHops.ranges[0]!.problems.join("\n")).toContain("more than 1 redirect");

    const toHttp = await probeWebSeed({
      url: seed,
      size,
      fetch: fakeFetch((url, init) => (url === seed ? { status: 302, headers: { Location: "http://objects.example.org/x" } } : partial(init))),
    });
    expect(toHttp.ok).toBe(false);
    expect(toHttp.ranges[0]!.problems.join("\n")).toContain("refused by the egress policy");

    const policy = await probeWebSeed({
      url: seed,
      size,
      allowUrl: (url) => url.hostname === "example.org",
      fetch: fakeFetch((url, init) => (url === seed ? { status: 302, headers: { Location: target } } : partial(init))),
    });
    expect(policy.ok).toBe(false);
    expect(policy.ranges[0]!.problems.join("\n")).toContain(`refused by the egress policy: ${target}`);

    const noLocation = await probeWebSeed({ url: seed, size, fetch: fakeFetch(() => ({ status: 302 })) });
    expect(noLocation.ranges[0]!.problems.join("\n")).toContain("without a Location header");

    const refusedStart = await probeWebSeed({ url: "http://example.org/x.bin", size, fetch: fakeFetch((_u, init) => partial(init)) });
    expect(refusedStart.ok).toBe(false);
  });

  test("has no fetch of its own", async () => {
    await expect(probeWebSeed({ url: seed, size } as never)).rejects.toThrow(/explicit fetch function/u);
  });
});

describe("the cross-check workflow", () => {
  const source = readFileSync(join(ROOT, WORKFLOW_PATH), "utf8");
  const workflow = Bun.YAML.parse(source) as Json;
  const crosscheck = readFileSync(join(ROOT, CROSSCHECK_PATH), "utf8");

  test("is a read-only check with no inputs, no secrets and pinned actions", () => {
    expect(WORKFLOW_PATH.split("/").pop()!.startsWith("publish-")).toBe(false);
    expect(Object.keys(workflow.on).sort()).toEqual(["pull_request", "workflow_dispatch"]);
    expect(workflow.on.workflow_dispatch).toBeNull();
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(workflow.concurrency?.group).toContain("transport-hints-");
    // No secrets, no extra permission, and no untrusted event text or inputs
    // that could reach a shell command.
    for (const forbidden of [/secrets\./u, /id-token/u, /continue-on-error/u, /\binputs\.\w/u, /github\.event\.pull_request\.(?:title|body|head)/u, /github\.head_ref/u, /:\s*write\b/u]) {
      expect(forbidden.test(source), `the workflow matches ${forbidden}`).toBe(false);
    }
    const paths = workflow.on.pull_request.paths as string[];
    expect(paths).toContain(WORKFLOW_PATH);
    for (const path of paths) {
      expect(existsSync(join(ROOT, path)), `path filter ${path} names a file`).toBe(true);
      expect(/transport-hints|TRANSPORT-HINTS/u.test(path), `path filter ${path} belongs to this item`).toBe(true);
    }
    const otherWorkflows = readdirSync(join(ROOT, ".github", "workflows"))
      .filter((name) => name !== "transport-hints.yml")
      .map((name) => readFileSync(join(ROOT, ".github", "workflows", name), "utf8"))
      .join("\n");
    for (const match of source.matchAll(/uses:\s*(\S+)/gu)) {
      expect(match[1]!, "pinned by full commit id").toMatch(/@[0-9a-f]{40}$/u);
      expect(otherWorkflows.includes(match[1]!), `${match[1]} is pinned as elsewhere in this repository`).toBe(true);
    }
    for (const [name, job] of Object.entries(workflow.jobs as Record<string, Json>)) {
      expect(job["timeout-minutes"], `${name} timeout`).toBeLessThanOrEqual(20);
      expect(job.permissions, `${name} adds no permission`).toBeUndefined();
      const checkout = (job.steps as Json[]).find((step) => String(step.uses ?? "").startsWith("actions/checkout@"));
      expect(checkout?.with?.["persist-credentials"], `${name} checkout`).toBe(false);
    }
  });

  test("hashes with the network removed and pins wheels that match its Python", () => {
    const job = workflow.jobs.crosscheck as Json;
    expect(job.needs).toBe("in-tree");
    const include = job.strategy.matrix.include as Json[];
    // 2.0.15 was dropped on 2026-11-20: its Python binding segfaulted before comparing anything.
    expect(include.map((entry) => entry.libtorrent)).toEqual(["2.1.1"]);
    const python = (job.steps as Json[]).find((step) => String(step.uses ?? "").startsWith("actions/setup-python@"))!;
    const tag = `cp${String(python.with["python-version"]).replace(".", "")}`;
    expect(tag).toBe("cp313");
    for (const entry of include) {
      expect(entry.wheel).toBe(`libtorrent-${entry.libtorrent}-${tag}-${tag}-manylinux_2_17_x86_64.manylinux2014_x86_64.whl`);
      expect(entry.wheel_sha256).toMatch(/^[0-9a-f]{64}$/u);
    }
    expect(job["runs-on"]).toBe("ubuntu-24.04");
    const pin = /PINNED_REFERENCE_SHA256 = "([0-9a-f]{64})"/u.exec(crosscheck)![1];
    expect(job.env.REFERENCE_SHA256).toBe(pin);
    expect(job.env.REFERENCE_URL).toBe("https://www.bittorrent.org/beps/bep_0052_torrent_creator.py");
    expect(crosscheck).toContain("PINNED_REFERENCE_SIZE = 10177");
    const runs = (job.steps as Json[]).map((step) => String(step.run ?? ""));
    const hashing = runs.filter((run) => run.includes("transport-hints-crosscheck.py") || run.includes("--torrents-out"));
    expect(hashing).toHaveLength(2);
    for (const run of hashing) expect(run).toContain("sudo unshare --net -- setpriv");
    expect(runs.some((run) => run.includes("--require-hashes") && run.includes("--only-binary=:all:") && run.includes("--no-deps"))).toBe(true);
    expect(runs.some((run) => run.includes("sha256sum --check --strict"))).toBe(true);
    expect(runs.some((run) => run.includes("diff --recursive"))).toBe(true);
    // The cross-check never creates a session and proves the network is gone first.
    expect(crosscheck.includes("lt.session")).toBe(false);
    expect(crosscheck.indexOf("proof = prove_no_network()")).toBeGreaterThan(-1);
    expect(crosscheck.indexOf("proof = prove_no_network()")).toBeLessThan(crosscheck.indexOf("import libtorrent as lt"));
    const upload = (job.steps as Json[]).find((step) => String(step.uses ?? "").startsWith("actions/upload-artifact@"))!;
    expect(String(upload.with.path)).toContain("th-tables");
  });
});
