import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// transport-hints/v1 (docs/specs/TRANSPORT-HINTS-0.1-DRAFT.md): the closed
// descriptor and descriptor-set schemas, the open index, and the one
// serialisation. Every fixture here is shape-only with obviously fake hex
// (runs of one digit); none describes a real file.

const ROOT = resolve(import.meta.dir, "../..");
const SCHEMA_PATH = "docs/specs/transport-hints-v1.schema.json";
const SPEC_PATH = "docs/specs/TRANSPORT-HINTS-0.1-DRAFT.md";
const VECTORS_PATH = "docs/specs/transport-hints-v1-vectors.json";

type Json = Record<string, any>;
type Validator = ((value: unknown) => boolean) & { errors?: unknown };

const schemaText = readFileSync(join(ROOT, SCHEMA_PATH), "utf8");
const schema = JSON.parse(schemaText) as Json;
const specText = readFileSync(join(ROOT, SPEC_PATH), "utf8");

// Ajv 2020 from the API's locked dependencies, loaded and configured the way
// bin/build-love-packages.ts loads it (strict, all errors, format assertion).
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

function expectValid(value: unknown, label: string): void {
  const ok = validate(value);
  expect(ok, `${label}: ${JSON.stringify(validate.errors)}`).toBe(true);
}

function expectInvalid(value: unknown, label: string): void {
  expect(validate(value), `${label} was accepted`).toBe(false);
}

const clone = <T>(value: T): T => structuredClone(value);
const fake = (digit: string, length: number) => digit.repeat(length);

/** The serialisation of the draft's section 5. */
function canonicalJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function descriptor(): Json {
  return {
    protocol: "transport-hints/v1",
    document_type: "artifact-descriptor",
    subject: {
      filename: "fake-pattern.bin",
      size: 46000,
      sha256: fake("1", 64),
    },
    authority: {
      kind: "json-pointer",
      url: "https://example.org/records/fake-pattern.json",
      pointer: "/files/0/sha256",
    },
    home: "https://example.org/records/",
    license: "CC0-1.0",
    notices: {
      inside_subject: [],
      beside_subject: [
        {
          filename: "LICENSE",
          size: 1000,
          sha256: fake("5", 64),
          url: "https://example.org/records/LICENSE",
        },
      ],
    },
    bittorrent: {
      profile: "single-file-hybrid/1",
      name: "fake-pattern.bin",
      piece_length: 16384,
      pieces_root: fake("2", 64),
      btih: fake("3", 40),
      btmh: `1220${fake("4", 64)}`,
    },
    recall: "none",
  };
}

function descriptorSet(): Json {
  return {
    protocol: "transport-hints/v1",
    document_type: "descriptor-set",
    set_id: "fake-round-1",
    descriptors: [
      { subject_sha256: fake("1", 64), descriptor_sha256: fake("6", 64) },
      { subject_sha256: fake("7", 64), descriptor_sha256: fake("8", 64) },
    ],
  };
}

function listedEntry(): Json {
  return {
    subject_sha256: fake("1", 64),
    name: "fake-pattern.bin",
    descriptor_sha256: fake("6", 64),
    status: "listed",
    descriptor_url: "https://example.org/transport/fake-pattern.bin.transport.json",
    clearance_sha256: fake("9", 64),
    irreversibility_notice_sha256: fake("a", 64),
    promise_until: "2027-05-14",
    torrent: {
      url: "https://example.org/transport/fake-pattern.bin.torrent",
      sha256: fake("b", 64),
      url_list: ["https://example.org/files/fake-pattern.bin"],
    },
    magnet:
      `magnet:?xt=urn:btih:${fake("3", 40)}&xt=urn:btmh:1220${fake("4", 64)}&dn=fake-pattern.bin` +
      "&ws=https%3A%2F%2Fexample.org%2Ffiles%2Ffake-pattern.bin" +
      "&xs=https%3A%2F%2Fexample.org%2Ftransport%2Ffake-pattern.bin.torrent",
    observations: [
      {
        at: "2026-12-01",
        by: "fake-probe",
        web_seeds: [{ url: "https://example.org/files/fake-pattern.bin", status: 206, redirects: 0 }],
        peers: "not measured",
      },
    ],
    other_replicas: [{ kind: "fake-archive", holds_bytes: true, recall: "formal request only" }],
  };
}

function hintsIndex(): Json {
  return {
    protocol: "transport-hints/v1",
    document_type: "hints-index",
    version: 2,
    previous_sha256: fake("c", 64),
    entries: [
      listedEntry(),
      {
        subject_sha256: fake("7", 64),
        name: "fake-withdrawn.bin",
        descriptor_sha256: fake("8", 64),
        status: "withdrawn",
        withdrawn_at: "2026-12-02",
        stopped: ["descriptor", "torrent file", "pointers"],
        cannot_stop: ["peers", "caches", "mirrors", "home copy", "rebuilt identical identifiers"],
      },
      {
        subject_sha256: fake("d", 64),
        name: "fake-superseded.bin",
        descriptor_sha256: fake("e", 64),
        status: "superseded",
        superseded_at: "2026-12-03",
        superseded_by: fake("f", 64),
        stopped: ["descriptor", "torrent file"],
        cannot_stop: ["peers", "caches"],
      },
      {
        subject_sha256: fake("0", 64),
        name: "fake-unmaintained.bin",
        descriptor_sha256: fake("9", 64),
        status: "unmaintained",
        none_prior: { hashed_at: "2026-11-30T12:00:00Z" },
      },
    ],
  };
}

/** The key-order table of the draft's section 5.2: label, schema $defs entry, keys. */
const KEY_ORDER: ReadonlyArray<readonly [string, string, readonly string[]]> = [
  ["descriptor", "artifactDescriptor", ["protocol", "document_type", "subject", "authority", "home", "license", "notices", "bittorrent", "recall"]],
  ["subject", "subject", ["filename", "size", "sha256"]],
  ["authority, love-package/v1", "authorityLovePackage", ["kind", "url", "pointer"]],
  ["authority, json-pointer", "authorityJsonPointer", ["kind", "url", "pointer"]],
  ["authority, hf-resolve-etag", "authorityHfResolveEtag", ["kind", "url", "header"]],
  ["authority, sums-line", "authoritySumsLine", ["kind", "url"]],
  ["authority, none-prior", "authorityNonePrior", ["kind"]],
  ["notices", "notices", ["inside_subject", "beside_subject"]],
  ["each beside_subject item", "noticeFile", ["filename", "size", "sha256", "url"]],
  ["bittorrent", "bittorrent", ["profile", "name", "piece_length", "pieces_root", "btih", "btmh"]],
  ["descriptor set", "descriptorSet", ["protocol", "document_type", "set_id", "descriptors"]],
  ["each descriptors item", "descriptorSetEntry", ["subject_sha256", "descriptor_sha256"]],
];

/** The piece-length rule of the draft's section 7.3. */
function pieceLength(size: number): number {
  let length = 16384;
  while (length < 16777216 && Math.ceil(size / length) > 1024) length *= 2;
  return length;
}

describe("transport-hints/v1 schema", () => {
  test("is a strict Draft 2020-12 schema whose closed objects list keys in serialisation order", () => {
    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    for (const [label, def, keys] of KEY_ORDER) {
      const node = schema.$defs[def];
      expect(Object.keys(node.properties), label).toEqual([...keys]);
      expect(node.required, label).toEqual([...keys]);
      expect(node.additionalProperties, label).toBe(false);
      const row = `| ${label} | \`$defs/${def}\` | ${keys.map((key) => `\`${key}\``).join(", ")} |`;
      expect(specText, `key-order table row for ${label}`).toContain(row);
    }
  });

  test("accepts shape-valid descriptors for every authority kind and notice form", () => {
    expectValid(descriptor(), "json-pointer descriptor");

    const love = descriptor();
    love.subject.filename = "fake-package-0.0.0.tgz";
    love.authority = { kind: "love-package/v1", url: "https://example.org/packages/v1/@fake/package/0.0.0/manifest.json", pointer: "/artifact/sha256" };
    love.license = "Apache-2.0";
    love.notices = { inside_subject: ["package/LICENSE", "package/NOTICE"], beside_subject: [] };
    expectValid(love, "love-package/v1 descriptor with notices inside the archive");

    const hf = descriptor();
    hf.authority = {
      kind: "hf-resolve-etag",
      url: `https://huggingface.co/fake-owner/fake-model/resolve/${fake("0", 40)}/model.safetensors`,
      header: "x-linked-etag",
    };
    expectValid(hf, "hf-resolve-etag descriptor");

    const sums = descriptor();
    sums.authority = { kind: "sums-line", url: "https://example.org/releases/SHA256SUMS" };
    expectValid(sums, "sums-line descriptor");

    const nonePrior = descriptor();
    nonePrior.authority = { kind: "none-prior" };
    expectValid(nonePrior, "none-prior descriptor");

    const bothNotices = descriptor();
    bothNotices.notices.inside_subject = ["LICENSE"];
    expectValid(bothNotices, "notices inside and beside");

    for (const length of schema.$defs.pieceLength.enum as number[]) {
      const value = descriptor();
      value.bittorrent.piece_length = length;
      expectValid(value, `piece_length ${length}`);
    }

    const longName = descriptor();
    longName.bittorrent.name = `a${"-".repeat(198)}z`;
    expectValid(longName, "200-character name");
  });

  test("rejects a descriptor that carries a date, a web-seed list, a .torrent URL or a signature", () => {
    const additions: Array<[string, (value: Json) => void]> = [
      ["top-level created_at", (v) => { v.created_at = "2026-11-14T00:00:00Z"; }],
      ["top-level date", (v) => { v.date = "2026-11-14"; }],
      ["bittorrent creation date", (v) => { v.bittorrent["creation date"] = 1763078400; }],
      ["subject hashed_at", (v) => { v.subject.hashed_at = "2026-11-14T00:00:00Z"; }],
      ["none-prior hashed_at in the descriptor", (v) => { v.authority = { kind: "none-prior", hashed_at: "2026-11-14T00:00:00Z" }; }],
      ["top-level url_list", (v) => { v.url_list = ["https://example.org/files/fake-pattern.bin"]; }],
      ["top-level web_seeds", (v) => { v.web_seeds = ["https://example.org/files/fake-pattern.bin"]; }],
      ["bittorrent url-list", (v) => { v.bittorrent["url-list"] = ["https://example.org/files/fake-pattern.bin"]; }],
      ["bittorrent url_list", (v) => { v.bittorrent.url_list = ["https://example.org/files/fake-pattern.bin"]; }],
      ["top-level torrent_url", (v) => { v.torrent_url = "https://example.org/transport/fake-pattern.bin.torrent"; }],
      ["top-level torrent object", (v) => { v.torrent = { url: "https://example.org/transport/fake-pattern.bin.torrent", sha256: fake("b", 64) }; }],
      ["bittorrent torrent_url", (v) => { v.bittorrent.torrent_url = "https://example.org/transport/fake-pattern.bin.torrent"; }],
      ["top-level magnet", (v) => { v.magnet = `magnet:?xt=urn:btih:${fake("3", 40)}`; }],
      ["top-level signature", (v) => { v.signature = fake("0", 128); }],
      ["bittorrent signature", (v) => { v.bittorrent.signature = fake("0", 128); }],
      ["authority signature", (v) => { v.authority.signature = fake("0", 128); }],
      ["notice signature", (v) => { v.notices.beside_subject[0].signature = fake("0", 128); }],
      ["tracker announce", (v) => { v.bittorrent.announce = "https://example.org/announce"; }],
      ["comment", (v) => { v.bittorrent.comment = "home is example.org"; }],
      ["status in the fixed descriptor", (v) => { v.status = "listed"; }],
    ];
    for (const [label, add] of additions) {
      const value = descriptor();
      add(value);
      expectInvalid(value, label);
    }
  });

  test("rejects malformed identifiers, licences, names, URLs and notices", () => {
    const mutations: Array<[string, (value: Json) => void]> = [
      ["uppercase sha256", (v) => { v.subject.sha256 = fake("A", 64); }],
      ["63-character sha256", (v) => { v.subject.sha256 = fake("1", 63); }],
      ["prefixed sha256", (v) => { v.subject.sha256 = `sha256:${fake("1", 64)}`; }],
      ["64-character btih", (v) => { v.bittorrent.btih = fake("3", 64); }],
      ["btmh without the multihash prefix", (v) => { v.bittorrent.btmh = fake("4", 64); }],
      ["btmh with a sha1 multihash prefix", (v) => { v.bittorrent.btmh = `1114${fake("4", 40)}`; }],
      ["uppercase btmh", (v) => { v.bittorrent.btmh = `1220${fake("D", 64)}`; }],
      ["short pieces_root", (v) => { v.bittorrent.pieces_root = fake("2", 40); }],
      ["piece_length not a power of two", (v) => { v.bittorrent.piece_length = 20000; }],
      ["piece_length below 16 KiB", (v) => { v.bittorrent.piece_length = 8192; }],
      ["piece_length above 16 MiB", (v) => { v.bittorrent.piece_length = 33554432; }],
      ["piece_length as a string", (v) => { v.bittorrent.piece_length = "16384"; }],
      ["other profile", (v) => { v.bittorrent.profile = "multi-file-hybrid/1"; }],
      ["size zero", (v) => { v.subject.size = 0; }],
      ["fractional size", (v) => { v.subject.size = 1.5; }],
      ["size as a string", (v) => { v.subject.size = "46000"; }],
      ["licence null", (v) => { v.license = null; }],
      ["licence missing", (v) => { delete v.license; }],
      ["licence spelled licence", (v) => { v.licence = v.license; delete v.license; }],
      ["licence NONE", (v) => { v.license = "NONE"; }],
      ["licence NOASSERTION", (v) => { v.license = "NOASSERTION"; }],
      ["licence LicenseRef", (v) => { v.license = "LicenseRef-fake"; }],
      ["licence expression", (v) => { v.license = "MIT OR Apache-2.0"; }],
      ["recall withdrawable", (v) => { v.recall = "withdrawable"; }],
      ["name with a slash", (v) => { v.bittorrent.name = "dir/fake-pattern.bin"; }],
      ["name of dot-dot", (v) => { v.bittorrent.name = ".."; }],
      ["hidden name", (v) => { v.bittorrent.name = ".fake"; }],
      ["name ending in a dot", (v) => { v.bittorrent.name = "fake."; }],
      ["name with a space", (v) => { v.bittorrent.name = "fake pattern.bin"; }],
      ["non-ASCII name", (v) => { v.bittorrent.name = "fak\u00e9.bin"; }],
      ["reserved device name", (v) => { v.bittorrent.name = "con"; }],
      ["reserved device name with extension", (v) => { v.bittorrent.name = "NUL.txt"; }],
      ["201-character name", (v) => { v.bittorrent.name = `a${"-".repeat(199)}z`; }],
      ["subject filename with a slash", (v) => { v.subject.filename = "dir/fake.bin"; }],
      ["unknown authority kind", (v) => { v.authority = { kind: "document-contains", url: "https://example.org/x" }; }],
      ["love-package pointer elsewhere", (v) => { v.authority = { kind: "love-package/v1", url: "https://example.org/m.json", pointer: "/artifact/size" }; }],
      ["json-pointer without pointer", (v) => { delete v.authority.pointer; }],
      ["json-pointer with an empty pointer", (v) => { v.authority.pointer = ""; }],
      ["hf-resolve-etag on a branch", (v) => { v.authority = { kind: "hf-resolve-etag", url: "https://huggingface.co/fake-owner/fake-model/resolve/main/model.safetensors", header: "x-linked-etag" }; }],
      ["hf-resolve-etag on another host", (v) => { v.authority = { kind: "hf-resolve-etag", url: `https://example.org/fake-owner/fake-model/resolve/${fake("0", 40)}/model.safetensors`, header: "x-linked-etag" }; }],
      ["hf-resolve-etag with the CDN etag header", (v) => { v.authority = { kind: "hf-resolve-etag", url: `https://huggingface.co/fake-owner/fake-model/resolve/${fake("0", 40)}/model.safetensors`, header: "etag" }; }],
      ["sums-line with a pointer", (v) => { v.authority = { kind: "sums-line", url: "https://example.org/SHA256SUMS", pointer: "/x" }; }],
      ["none-prior with a url", (v) => { v.authority = { kind: "none-prior", url: "https://example.org/x" }; }],
      ["http home", (v) => { v.home = "http://example.org/records/"; }],
      ["home with userinfo", (v) => { v.home = "https://user@example.org/records/"; }],
      ["home with a fragment", (v) => { v.home = "https://example.org/records/#top"; }],
      ["home with a query", (v) => { v.home = "https://example.org/records/?v=1"; }],
      ["home with a port", (v) => { v.home = "https://example.org:443/records/"; }],
      ["home with an uppercase host", (v) => { v.home = "https://Example.org/records/"; }],
      ["home on an IP literal", (v) => { v.home = "https://192.0.2.1/records/"; }],
      ["home with a dot segment", (v) => { v.home = "https://example.org/records/../other/"; }],
      ["home with a lowercase percent escape", (v) => { v.home = "https://example.org/a%2fb"; }],
      ["home without a path", (v) => { v.home = "https://example.org"; }],
      ["no notice at all", (v) => { v.notices = { inside_subject: [], beside_subject: [] }; }],
      ["notices without beside_subject", (v) => { v.notices = { inside_subject: ["LICENSE"] }; }],
      ["notice member escaping the archive", (v) => { v.notices.inside_subject = ["../LICENSE"]; }],
      ["absolute notice member", (v) => { v.notices.inside_subject = ["/LICENSE"]; }],
      ["duplicate notice members", (v) => { v.notices.inside_subject = ["LICENSE", "LICENSE"]; }],
      ["notice file without url", (v) => { delete v.notices.beside_subject[0].url; }],
      ["wrong document_type", (v) => { v.document_type = "hints-index"; }],
      ["wrong protocol", (v) => { v.protocol = "transport-hints/v2"; }],
      ["missing home", (v) => { delete v.home; }],
      ["missing recall", (v) => { delete v.recall; }],
    ];
    for (const [label, mutate] of mutations) {
      const value = descriptor();
      mutate(value);
      expectInvalid(value, label);
    }
  });

  test("the descriptor set is closed and holds only digests", () => {
    expectValid(descriptorSet(), "descriptor set");
    const mutations: Array<[string, (value: Json) => void]> = [
      ["signature", (v) => { v.signature = fake("0", 128); }],
      ["signed_at", (v) => { v.signed_at = "2026-11-14"; }],
      ["entry with a url", (v) => { v.descriptors[0].descriptor_url = "https://example.org/x.json"; }],
      ["entry with a signature", (v) => { v.descriptors[0].signature = fake("0", 128); }],
      ["empty set", (v) => { v.descriptors = []; }],
      ["duplicate entries", (v) => { v.descriptors = [v.descriptors[0], v.descriptors[0]]; }],
      ["uppercase digest", (v) => { v.descriptors[0].descriptor_sha256 = fake("A", 64); }],
      ["set_id with spaces", (v) => { v.set_id = "round one"; }],
      ["set_id uppercase", (v) => { v.set_id = "Round-1"; }],
    ];
    for (const [label, mutate] of mutations) {
      const value = descriptorSet();
      mutate(value);
      expectInvalid(value, label);
    }
  });

  test("the hints index is open for new fields but keeps its status rules", () => {
    expectValid(hintsIndex(), "index with every status");

    const first = hintsIndex();
    first.version = 1;
    first.previous_sha256 = null;
    expectValid(first, "first version");

    const extended = hintsIndex();
    extended.note = "an extension field";
    extended.entries[0].future_field = { anything: true };
    extended.entries[0].observations[0].content_range = "bytes 0-0/46000";
    expectValid(extended, "index with unknown fields");

    const mutations: Array<[string, (value: Json) => void]> = [
      ["index signature", (v) => { v.signature = fake("0", 128); }],
      ["entry signature", (v) => { v.entries[0].signature = fake("0", 128); }],
      ["observation signature", (v) => { v.entries[0].observations[0].signature = fake("0", 128); }],
      ["torrent signature", (v) => { v.entries[0].torrent.signature = fake("0", 128); }],
      ["unknown status", (v) => { v.entries[0].status = "deleted"; }],
      ["listed without torrent", (v) => { delete v.entries[0].torrent; }],
      ["listed without promise_until", (v) => { delete v.entries[0].promise_until; }],
      ["listed without clearance", (v) => { delete v.entries[0].clearance_sha256; }],
      ["withdrawn without cannot_stop", (v) => { delete v.entries[1].cannot_stop; }],
      ["withdrawn without withdrawn_at", (v) => { delete v.entries[1].withdrawn_at; }],
      ["superseded without superseded_by", (v) => { delete v.entries[2].superseded_by; }],
      ["version 1 with a previous digest", (v) => { v.version = 1; }],
      ["version 2 without a previous digest", (v) => { v.previous_sha256 = null; }],
      ["version 0", (v) => { v.version = 0; }],
      ["web seed ending in a slash", (v) => { v.entries[0].torrent.url_list = ["https://example.org/files/"]; }],
      ["web seed with a query", (v) => { v.entries[0].torrent.url_list = ["https://example.org/files/fake-pattern.bin?sig=1"]; }],
      ["empty url_list", (v) => { v.entries[0].torrent.url_list = []; }],
      ["magnet without btmh", (v) => { v.entries[0].magnet = `magnet:?xt=urn:btih:${fake("3", 40)}&dn=fake-pattern.bin`; }],
      ["observation without a date", (v) => { delete v.entries[0].observations[0].at; }],
      ["hashed_at with a time zone offset", (v) => { v.entries[3].none_prior.hashed_at = "2026-11-30T12:00:00+01:00"; }],
      ["promise_until as a time", (v) => { v.entries[0].promise_until = "2027-05-14T00:00:00Z"; }],
    ];
    for (const [label, mutate] of mutations) {
      const value = hintsIndex();
      mutate(value);
      expectInvalid(value, label);
    }
  });
});

describe("transport-hints/v1 exact bytes", () => {
  const expected = [
    "{",
    '  "protocol": "transport-hints/v1",',
    '  "document_type": "artifact-descriptor",',
    '  "subject": {',
    '    "filename": "fake-pattern.bin",',
    '    "size": 46000,',
    `    "sha256": "${fake("1", 64)}"`,
    "  },",
    '  "authority": {',
    '    "kind": "json-pointer",',
    '    "url": "https://example.org/records/fake-pattern.json",',
    '    "pointer": "/files/0/sha256"',
    "  },",
    '  "home": "https://example.org/records/",',
    '  "license": "CC0-1.0",',
    '  "notices": {',
    '    "inside_subject": [],',
    '    "beside_subject": [',
    "      {",
    '        "filename": "LICENSE",',
    '        "size": 1000,',
    `        "sha256": "${fake("5", 64)}",`,
    '        "url": "https://example.org/records/LICENSE"',
    "      }",
    "    ]",
    "  },",
    '  "bittorrent": {',
    '    "profile": "single-file-hybrid/1",',
    '    "name": "fake-pattern.bin",',
    '    "piece_length": 16384,',
    `    "pieces_root": "${fake("2", 64)}",`,
    `    "btih": "${fake("3", 40)}",`,
    `    "btmh": "1220${fake("4", 64)}"`,
    "  },",
    '  "recall": "none"',
    "}",
    "",
  ].join("\n");

  test("the LOVE builder's serialisation gives the documented layout", () => {
    const text = canonicalJson(descriptor());
    expect(text).toBe(expected);
    expect(text.endsWith("}\n")).toBe(true);
    expect(text.includes("\r")).toBe(false);
    expect(text.includes("\\")).toBe(false);
    expect(/[^\n\x20-\x7e]/u.test(text)).toBe(false);
    expect(/ \n/u.test(text)).toBe(false);
  });

  test("an independent serialiser (Python json, indent 2) emits the same bytes", () => {
    for (const ensureAscii of ["True", "False"]) {
      const result = spawnSync(
        "python3",
        ["-I", "-c", `import json,sys\nv=json.loads(sys.stdin.read())\nsys.stdout.write(json.dumps(v, indent=2, ensure_ascii=${ensureAscii})+"\\n")`],
        { input: expected, encoding: "utf8" },
      );
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout, `ensure_ascii=${ensureAscii}`).toBe(expected);
    }
    const set = canonicalJson(descriptorSet());
    const result = spawnSync(
      "python3",
      ["-I", "-c", 'import json,sys\nv=json.loads(sys.stdin.read())\nsys.stdout.write(json.dumps(v, indent=2)+"\\n")'],
      { input: set, encoding: "utf8" },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe(set);
  });

  test("the draft's examples, with placeholders filled by fake hex, validate and use the layout", () => {
    const codeBlock = (heading: string): string => {
      const start = specText.indexOf(`\n### ${heading}`);
      expect(start, heading).toBeGreaterThan(-1);
      const match = /\n```json\n([\s\S]*?)```\n/u.exec(specText.slice(start));
      expect(match, heading).not.toBeNull();
      return match![1]!;
    };
    const fill = (text: string) =>
      text
        .replace(/<64 (?:lowercase )?hex[^>]*>/gu, fake("1", 64))
        .replace(/<40 (?:lowercase )?hex>/gu, fake("3", 40))
        .replace(/<probe name>/gu, "fake-probe");
    for (const heading of ["4.5 Example", "8.4 Example (shape only)"]) {
      const text = fill(codeBlock(heading));
      expect(text.includes("<"), `${heading} has an unfilled placeholder`).toBe(false);
      const value = JSON.parse(text);
      expectValid(value, heading);
      expect(canonicalJson(value), heading).toBe(text);
    }
  });

  test("the piece-length rule gives the documented values, all inside the schema's range", () => {
    const worked: Array<[number, number]> = [
      [1, 16384],
      [16384, 16384],
      [16385, 16384],
      [16777216, 16384],
      [16777217, 32768],
      [538090408, 1048576],
      [1503300328, 2097152],
      [17179869184, 16777216],
      [17179869185, 16777216],
    ];
    for (const [size, length] of worked) {
      expect(pieceLength(size), `size ${size}`).toBe(length);
      expect(schema.$defs.pieceLength.enum).toContain(length);
    }
    expect(Math.ceil(538090408 / 524288)).toBe(1027);
    expect(Math.ceil(538090408 / 1048576)).toBe(514);
    expect(Math.ceil(1503300328 / 2097152)).toBe(717);
  });
});

describe("transport-hints/v1 draft names no real file", () => {
  // Until the profile is frozen no identifier of a real file may be
  // published. Any long hex run in the draft or the schema must come from
  // the pattern-file vectors once those exist; URLs are example or reference
  // hosts only.
  test("long hex values appear only if the pattern-file vectors carry them", () => {
    const allowed = new Set<string>();
    if (existsSync(join(ROOT, VECTORS_PATH))) {
      for (const match of readFileSync(join(ROOT, VECTORS_PATH), "utf8").matchAll(/[0-9a-f]{40,}/gu)) allowed.add(match[0]);
    }
    for (const [label, text] of [["draft", specText], ["schema", schemaText]] as const) {
      for (const match of text.matchAll(/[0-9a-f]{40,}/gu)) {
        expect(allowed.has(match[0]), `${label} holds an unlisted hex value`).toBe(true);
      }
    }
  });

  test("URLs in the draft name only example and reference hosts", () => {
    const hosts = new Set([
      "example.org",
      "www.bittorrent.org",
      "spdx.org",
      "www.rfc-editor.org",
      "json-schema.org",
      "huggingface.co",
    ]);
    for (const match of specText.matchAll(/https?:\/\/([^/\s)>`"'<]+)([^\s)>`"']*)/gu)) {
      expect(hosts.has(match[1]!), `unexpected host ${match[1]}`).toBe(true);
      if (match[1] === "huggingface.co") expect(match[2]!.includes("<"), "Hugging Face URLs are templates only").toBe(true);
    }
  });
});
