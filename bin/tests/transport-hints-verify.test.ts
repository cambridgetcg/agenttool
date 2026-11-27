import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  buildDescriptor,
  buildTorrentFromBytes,
  canonicalJson,
  parseDescriptorFields,
  sha256Hex,
  type Authority,
} from "../build-transport-hints.ts";
import { DESCRIPTOR_EXAMPLE, patternBytes } from "../transport-hints-vectors.ts";
import {
  MAX_DESCRIPTOR_DOCUMENT_BYTES,
  buildDescriptorSet,
  buildDescriptorSetFromTexts,
  defaultAuthorityAllowUrl,
  deriveMagnetLink,
  descriptorSetProblems,
  effectiveEntryStatus,
  hintsIndexProblems,
  isValidIsoDate,
  isValidIsoDateTime,
  parseStrictIJson,
  resolveJsonPointer,
  verifyDescriptorAuthority,
  verifyHintsIndexChain,
  verifySubjectBytes,
  verifySubjectChunks,
  type AuthorityFetch,
  type AuthorityRequestInit,
  type AuthorityResponse,
} from "../transport-hints-verify.ts";

// Hermetic tests for bin/transport-hints-verify.ts (draft sections 4.2, 4.4, 6,
// 7.5, 8 and 9). Every fixture uses generated pattern files or single-digit
// fake hex on example.org / huggingface.co/fake-owner; no real file is named
// and no socket is opened.

const ROOT = resolve(import.meta.dir, "../..");
const SCHEMA_PATH = "docs/specs/transport-hints-v1.schema.json";
const VERIFY_MODULE_PATH = "bin/transport-hints-verify.ts";

type Json = Record<string, any>;
type Validator = ((value: unknown) => boolean) & { errors?: unknown };

const schema = JSON.parse(readFileSync(join(ROOT, SCHEMA_PATH), "utf8")) as Json;

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
const fake = (digit: string, len: number): string => digit.repeat(len);
const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);

interface MockReply {
  readonly status?: number;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string | Uint8Array;
  readonly streamChunks?: readonly Uint8Array[];
}

function makeFakeFetch(
  handler: (url: string, init: AuthorityRequestInit) => MockReply,
): { readonly fetch: AuthorityFetch; readonly calls: Array<{ url: string; init: AuthorityRequestInit; cancelled: boolean }> } {
  const calls: Array<{ url: string; init: AuthorityRequestInit; cancelled: boolean }> = [];
  const fetch: AuthorityFetch = async (url, init) => {
    const callRecord = { url, init, cancelled: false };
    calls.push(callRecord);
    const reply = handler(url, init);
    const lowerHeaders = new Map<string, string>(
      Object.entries(reply.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
    );
    const rawBytes =
      reply.body === undefined
        ? new Uint8Array(0)
        : typeof reply.body === "string"
          ? utf8(reply.body)
          : reply.body;

    let body: ReadableStream<Uint8Array> | null = null;
    if (reply.streamChunks) {
      let idx = 0;
      body = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (idx < reply.streamChunks!.length) {
            controller.enqueue(reply.streamChunks![idx]!);
            idx += 1;
          } else {
            controller.close();
          }
        },
        cancel() {
          callRecord.cancelled = true;
        },
      });
    } else {
      body = new ReadableStream<Uint8Array>({
        start(controller) {
          if (rawBytes.byteLength > 0) controller.enqueue(rawBytes);
          controller.close();
        },
        cancel() {
          callRecord.cancelled = true;
        },
      });
    }

    const response: AuthorityResponse = {
      status: reply.status ?? 200,
      headers: {
        get(name: string) {
          return lowerHeaders.get(name.toLowerCase()) ?? null;
        },
      },
      body,
      async arrayBuffer() {
        return rawBytes.buffer.slice(rawBytes.byteOffset, rawBytes.byteOffset + rawBytes.byteLength) as ArrayBuffer;
      },
    };
    return response;
  };
  return { fetch, calls };
}

function buildPatternDescriptor(overrides: {
  seed?: string;
  size?: number;
  filename?: string;
  name?: string;
  authority?: Authority;
  license?: string;
  urlList?: readonly string[];
} = {}) {
  const seed = overrides.seed ?? DESCRIPTOR_EXAMPLE.subjectSeed;
  const size = overrides.size ?? DESCRIPTOR_EXAMPLE.subjectSize;
  const filename = overrides.filename ?? DESCRIPTOR_EXAMPLE.filename;
  const name = overrides.name ?? filename;
  const bytes = patternBytes(seed, size);
  const sha256 = sha256Hex(bytes);
  const noticeBytes = patternBytes(DESCRIPTOR_EXAMPLE.noticeSeed, DESCRIPTOR_EXAMPLE.noticeSize);
  const urlList = overrides.urlList ?? [...DESCRIPTOR_EXAMPLE.urlList];
  const torrentBuild = buildTorrentFromBytes({ name, size, sha256, urlList }, bytes);
  const fields = parseDescriptorFields({
    subject: { filename, size, sha256 },
    authority: overrides.authority ?? { ...DESCRIPTOR_EXAMPLE.authority },
    home: DESCRIPTOR_EXAMPLE.home,
    license: overrides.license ?? DESCRIPTOR_EXAMPLE.license,
    notices: {
      inside_subject: [],
      beside_subject: [
        {
          filename: DESCRIPTOR_EXAMPLE.noticeFilename,
          size: DESCRIPTOR_EXAMPLE.noticeSize,
          sha256: sha256Hex(noticeBytes),
          url: DESCRIPTOR_EXAMPLE.noticeUrl,
        },
      ],
    },
  });
  const descriptor = buildDescriptor(fields, torrentBuild);
  return { bytes, sha256, size, filename, name, torrentBuild, descriptor };
}

describe("strict I-JSON and RFC 6901 JSON Pointer", () => {
  test("rejects duplicate keys directly, nested, and after \\uXXXX unescaping", () => {
    expect(() => parseStrictIJson('{"a": 1, "a": 2}')).toThrow(/duplicate object key 'a'/u);
    expect(() => parseStrictIJson('{"nested": {"x": true, "x": false}}')).toThrow(/duplicate object key 'x'/u);
    expect(() => parseStrictIJson('{"a": 1, "\\u0061": 2}')).toThrow(/duplicate object key 'a'/u);
  });

  test("rejects lone surrogates, leading-zero numbers, deep nesting and trailing garbage", () => {
    expect(() => parseStrictIJson('"\\uD800"')).toThrow(/surrogate/u);
    expect(() => parseStrictIJson('"\\uDC00"')).toThrow(/surrogate/u);
    expect(() => parseStrictIJson('"\\uD800\\u0041"')).toThrow(/surrogate/u);
    expect(parseStrictIJson('"\\uD83D\\uDE00"')).toBe("😀");
    expect(() => parseStrictIJson("01")).toThrow(/leading zero/u);
    expect(() => parseStrictIJson('{"a":1} trailing')).toThrow(/trailing/u);
    expect(() => parseStrictIJson("[".repeat(70) + "]".repeat(70))).toThrow(/maximum depth/u);
  });

  test("stores __proto__ safely as an own data property without polluting Object.prototype", () => {
    const parsed = parseStrictIJson('{"__proto__": {"polluted": "yes"}, "safe": 1}') as Record<string, unknown>;
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.hasOwn(parsed, "__proto__")).toBe(true);
    expect(resolveJsonPointer(parsed, "/__proto__/polluted")).toEqual({ found: true, value: "yes" });
  });

  test("evaluates RFC 6901 pointers including ~1 and ~0 order and rejects bad escapes or array indices", () => {
    const doc = {
      files: [{ "a/b~c": { "~1": "literal-tilde-one", sha256: fake("a", 64) } }],
    };
    expect(resolveJsonPointer(doc, "")).toEqual({ found: true, value: doc });
    expect(resolveJsonPointer(doc, "/files/0/a~1b~0c/sha256")).toEqual({ found: true, value: fake("a", 64) });
    // RFC 6901 §4: ~1 becomes /, ~0 becomes ~, so ~01 decodes to '~1', NOT '/'.
    expect(resolveJsonPointer(doc, "/files/0/a~1b~0c/~01")).toEqual({ found: true, value: "literal-tilde-one" });
    expect(resolveJsonPointer(doc, "/files/01/a~1b~0c").found).toBe(false);
    expect(resolveJsonPointer(doc, "/files/0/bad~2escape").found).toBe(false);
    expect(resolveJsonPointer(doc, "no-leading-slash").found).toBe(false);
  });

  test("validates real calendar dates and leap years", () => {
    expect(isValidIsoDate("2026-11-20")).toBe(true);
    expect(isValidIsoDate("2024-02-29")).toBe(true);
    expect(isValidIsoDate("2026-02-29")).toBe(false);
    expect(isValidIsoDate("2026-13-01")).toBe(false);
    expect(isValidIsoDateTime("2026-11-20T23:59:59Z")).toBe(true);
    expect(isValidIsoDateTime("2026-02-29T12:00:00Z")).toBe(false);
    expect(isValidIsoDateTime("2026-11-20T24:00:00Z")).toBe(false);
  });
});

describe("verifyDescriptorAuthority across all five authority kinds (sections 4.2, 4.4 rule 6, 9.1-9.2)", () => {
  test("refuses oversized or non-canonical descriptors before making any network call", async () => {
    const { descriptor } = buildPatternDescriptor();
    const { fetch, calls } = makeFakeFetch(() => ({ body: "{}" }));

    const padded = `${descriptor.text} `;
    const badFormat = await verifyDescriptorAuthority(padded, { fetch });
    expect(badFormat.ok).toBe(false);
    expect(calls).toHaveLength(0);

    const huge = "x".repeat(MAX_DESCRIPTOR_DOCUMENT_BYTES + 1);
    const tooLarge = await verifyDescriptorAuthority(huge, { fetch });
    expect(tooLarge.ok).toBe(false);
    expect(tooLarge.problems[0]).toContain("exceeds");
    expect(calls).toHaveLength(0);
  });

  test("verifies love-package/v1 manifests and enforces section 4.4 rule 6 cross-field equality", async () => {
    const manifestUrl = "https://example.org/packages/v1/@fake/pkg/1.0.0/manifest.json";
    const built = buildPatternDescriptor({
      filename: "fake-pkg-1.0.0.tgz",
      name: "fake-pkg-1.0.0.tgz",
      license: "Apache-2.0",
      authority: { kind: "love-package/v1", url: manifestUrl, pointer: "/artifact/sha256" },
    });

    const validManifest = {
      protocol: "love-package/v1",
      document_type: "package-manifest",
      name: "@fake/pkg",
      version: "1.0.0",
      license: "Apache-2.0",
      artifact: {
        format: "npm-tarball",
        filename: built.filename,
        sha256: built.sha256,
        size: built.size,
        mirrors: [
          { url: "https://example.org/packages/v1/@fake/pkg/1.0.0/fake-pkg-1.0.0.tgz" },
          { url: "https://mirror.example.org/releases/fake-pkg-1.0.0.tgz" },
        ],
      },
    };

    const okMock = makeFakeFetch((url, init) => {
      expect(url).toBe(manifestUrl);
      expect(init.headers["Accept-Encoding"]).toBe("identity");
      expect(init.redirect).toBe("manual");
      return { body: JSON.stringify(validManifest) };
    });
    const okRes = await verifyDescriptorAuthority(built.descriptor.text, { fetch: okMock.fetch });
    expect(okRes.ok, okRes.problems.join("; ")).toBe(true);
    expect(okRes.kind).toBe("love-package/v1");
    expect(okRes.mirrors).toEqual([
      "https://example.org/packages/v1/@fake/pkg/1.0.0/fake-pkg-1.0.0.tgz",
      "https://mirror.example.org/releases/fake-pkg-1.0.0.tgz",
    ]);

    // Null license on manifest is refused (section 4.2)
    const nullLic = await verifyDescriptorAuthority(built.descriptor.text, {
      fetch: makeFakeFetch(() => ({ body: JSON.stringify({ ...validManifest, license: null }) })).fetch,
    });
    expect(nullLic.ok).toBe(false);
    expect(nullLic.problems.join("; ")).toContain("manifest license is null");

    // Mismatched license, size, filename, or sha256 is refused (rule 6)
    for (const [label, mutated] of [
      ["license", { ...validManifest, license: "MIT" }],
      ["size", { ...validManifest, artifact: { ...validManifest.artifact, size: built.size + 1 } }],
      ["filename", { ...validManifest, artifact: { ...validManifest.artifact, filename: "other.tgz" } }],
      ["sha256", { ...validManifest, artifact: { ...validManifest.artifact, sha256: fake("0", 64) } }],
      [
        "unvetted loopback/fragment mirror",
        {
          ...validManifest,
          artifact: {
            ...validManifest.artifact,
            mirrors: [{ url: "https://127.0.0.1:8443/evil.bin?x=1#frag" }],
          },
        },
      ],
      [
        "localhost mirror refused by egress policy",
        {
          ...validManifest,
          artifact: {
            ...validManifest.artifact,
            mirrors: [{ url: "https://localhost/evil.tgz" }],
          },
        },
      ],
      [
        "fragment mirror breaking section 4.1 URL rule",
        {
          ...validManifest,
          artifact: {
            ...validManifest.artifact,
            mirrors: [{ url: "https://example.org/releases/fake-pkg-1.0.0.tgz#frag" }],
          },
        },
      ],
    ] as const) {
      const res = await verifyDescriptorAuthority(built.descriptor.text, {
        fetch: makeFakeFetch(() => ({ body: JSON.stringify(mutated) })).fetch,
      });
      expect(res.ok, `expected ${label} mismatch to fail`).toBe(false);
      expect(res.mirrors).toEqual([]);
    }
  });

  test("verifies json-pointer across one HTTPS redirect and refuses duplicate keys, bad digests, gzip and SSRF redirects", async () => {
    const built = buildPatternDescriptor({
      authority: {
        kind: "json-pointer",
        url: "https://example.org/transport-hints/example-record.json",
        pointer: "/files/0/sha256",
      },
    });

    const redirectMock = makeFakeFetch((url) =>
      url === "https://example.org/transport-hints/example-record.json"
        ? { status: 302, headers: { Location: "https://cdn.example.org/records/v1.json" } }
        : { body: JSON.stringify({ files: [{ sha256: built.sha256 }] }) },
    );
    const okRes = await verifyDescriptorAuthority(built.descriptor.text, { fetch: redirectMock.fetch });
    expect(okRes.ok, okRes.problems.join("; ")).toBe(true);
    expect(okRes.redirects).toBe(1);
    expect(okRes.finalUrl).toBe("https://cdn.example.org/records/v1.json");

    // Duplicate key in authority I-JSON is an error (section 4.2)
    const dupRes = await verifyDescriptorAuthority(built.descriptor.text, {
      fetch: makeFakeFetch(() => ({
        body: `{"files": [{"sha256": "${fake("0", 64)}", "sha256": "${built.sha256}"}]}`,
      })).fetch,
    });
    expect(dupRes.ok).toBe(false);
    expect(dupRes.problems.join("; ")).toContain("duplicate object key");

    // Uppercase or prefixed digest in authority fails
    for (const badVal of [built.sha256.toUpperCase(), `sha256:${built.sha256}`]) {
      const bad = await verifyDescriptorAuthority(built.descriptor.text, {
        fetch: makeFakeFetch(() => ({ body: JSON.stringify({ files: [{ sha256: badVal }] }) })).fetch,
      });
      expect(bad.ok).toBe(false);
    }

    // Content-Encoding: gzip is refused
    const gzipRes = await verifyDescriptorAuthority(built.descriptor.text, {
      fetch: makeFakeFetch(() => ({
        headers: { "Content-Encoding": "gzip" },
        body: JSON.stringify({ files: [{ sha256: built.sha256 }] }),
      })).fetch,
    });
    expect(gzipRes.ok).toBe(false);
    expect(gzipRes.problems.join("; ")).toContain("Content-Encoding");

    // Redirect to http:// or IP literal or localhost is refused by defaultAuthorityAllowUrl
    for (const badTarget of ["http://cdn.example.org/x.json", "https://127.0.0.1/x.json", "https://localhost/x.json"]) {
      const ssrf = await verifyDescriptorAuthority(built.descriptor.text, {
        fetch: makeFakeFetch((url) =>
          url.includes("example-record") ? { status: 302, headers: { Location: badTarget } } : { body: "{}" },
        ).fetch,
      });
      expect(ssrf.ok, `target ${badTarget}`).toBe(false);
      expect(ssrf.problems.join("; ")).toContain("egress policy");
    }

    // Oversized authority stream is cancelled once cap is exceeded
    const streamMock = makeFakeFetch(() => ({
      streamChunks: [new Uint8Array(600), new Uint8Array(600), new Uint8Array(600)],
    }));
    const capped = await verifyDescriptorAuthority(built.descriptor.text, {
      fetch: streamMock.fetch,
      maxAuthorityBytes: 1024,
    });
    expect(capped.ok).toBe(false);
    expect(capped.problems.join("; ")).toContain("1024-byte ceiling");
    expect(streamMock.calls[0]!.cancelled).toBe(true);
  });

  test("verifies hf-resolve-etag without following redirects and checks x-linked-etag, x-linked-size and x-repo-commit", async () => {
    const commit = fake("a", 40);
    const hfUrl = `https://huggingface.co/fake-owner/fake-model/resolve/${commit}/model.safetensors`;
    const built = buildPatternDescriptor({
      filename: "model.safetensors",
      name: "fake-model.aaaaaaaa.model.safetensors",
      authority: { kind: "hf-resolve-etag", url: hfUrl, header: "x-linked-etag" },
    });

    const hfMock = makeFakeFetch((url) => {
      if (url !== hfUrl) throw new Error(`unexpected redirect follow to ${url}`);
      return {
        status: 302,
        headers: {
          Location: "https://cdn-lfs.example.org/signed?exp=3600",
          "x-linked-etag": `"${built.sha256}"`,
          "x-linked-size": String(built.size),
          "x-repo-commit": commit,
          etag: '"different-cdn-etag"',
        },
      };
    });
    const okRes = await verifyDescriptorAuthority(built.descriptor.text, { fetch: hfMock.fetch });
    expect(okRes.ok, okRes.problems.join("; ")).toBe(true);
    expect(okRes.redirects).toBe(0);
    expect(hfMock.calls).toHaveLength(1);

    // Compressed redirect body is ignored because hf-resolve-etag does not read the body
    const gzipRedirect = await verifyDescriptorAuthority(built.descriptor.text, {
      fetch: makeFakeFetch(() => ({
        status: 302,
        headers: {
          Location: "https://cdn-lfs.example.org/signed?exp=3600",
          "Content-Encoding": "gzip",
          "x-linked-etag": `"${built.sha256}"`,
          "x-linked-size": String(built.size),
          "x-repo-commit": commit,
        },
      })).fetch,
    });
    expect(gzipRedirect.ok, gzipRedirect.problems.join("; ")).toBe(true);

    // Weak ETag, double-quoted ETag, wrong size, and wrong commit all fail
    const badCases: ReadonlyArray<readonly [string, Record<string, string>]> = [
      ["weak etag", { "x-linked-etag": `W/"${built.sha256}"` }],
      ["double quotes", { "x-linked-etag": `""${built.sha256}""` }],
      ["wrong size", { "x-linked-etag": `"${built.sha256}"`, "x-linked-size": String(built.size + 1) }],
      ["wrong commit", { "x-linked-etag": `"${built.sha256}"`, "x-repo-commit": fake("b", 40) }],
      ["missing etag", { Location: "https://cdn.example.org/x" }],
    ];
    for (const [label, headers] of badCases) {
      const res = await verifyDescriptorAuthority(built.descriptor.text, {
        fetch: makeFakeFetch(() => ({ status: 302, headers })).fetch,
      });
      expect(res.ok, `${label} should fail`).toBe(false);
    }
  });

  test("verifies sums-line (space and binary *, CRLF, uppercase hex, ignoring \\-escaped lines) and refuses duplicates", async () => {
    const built = buildPatternDescriptor({
      filename: "artifact.tar",
      name: "artifact.tar",
      authority: { kind: "sums-line", url: "https://example.org/releases/SHA256SUMS" },
    });

    const sumsBody = [
      `\\${fake("0", 64)}  artifact.tar`,
      `${fake("1", 64)}  other-file.tar`,
      `${built.sha256.toUpperCase()} *artifact.tar`,
      "",
    ].join("\r\n");

    const okRes = await verifyDescriptorAuthority(built.descriptor.text, {
      fetch: makeFakeFetch(() => ({ body: sumsBody })).fetch,
    });
    expect(okRes.ok, okRes.problems.join("; ")).toBe(true);

    // Duplicate matching line for the same filename fails (section 4.2: "Exactly one line MUST match")
    const dupSums = `${built.sha256}  artifact.tar\n${built.sha256} *artifact.tar\n`;
    const dupRes = await verifyDescriptorAuthority(built.descriptor.text, {
      fetch: makeFakeFetch(() => ({ body: dupSums })).fetch,
    });
    expect(dupRes.ok).toBe(false);
    expect(dupRes.problems.join("; ")).toContain("2 matching lines");
  });

  test("refuses none-prior by default without network calls and accepts only when allowNonePrior is true", async () => {
    const built = buildPatternDescriptor({ authority: { kind: "none-prior" } });
    const refused = await verifyDescriptorAuthority(built.descriptor.text);
    expect(refused.ok).toBe(false);
    expect(refused.kind).toBe("none-prior");
    expect(refused.problems[0]).toContain("none-prior descriptor refused");

    const allowed = await verifyDescriptorAuthority(built.descriptor.text, { allowNonePrior: true });
    expect(allowed.ok).toBe(true);
  });
});

describe("consumer byte acceptance (section 9.4)", () => {
  test("accepts exact size and SHA-256 and aborts oversized streams immediately", async () => {
    const bytes = patternBytes("consumer-check", 20_000);
    const expected = { size: bytes.byteLength, sha256: sha256Hex(bytes) };

    expect(verifySubjectBytes(expected, bytes).accepted).toBe(true);
    const flipped = new Uint8Array(bytes);
    flipped[0]! ^= 0xff;
    expect(verifySubjectBytes(expected, flipped).accepted).toBe(false);
    expect(verifySubjectBytes(expected, bytes.subarray(0, 19_999)).accepted).toBe(false);

    let yielded = 0;
    async function* oversizedStream(): AsyncGenerator<Uint8Array> {
      for (let i = 0; i < 10; i += 1) {
        yielded += 1;
        yield new Uint8Array(8_000);
      }
    }
    const streamRes = await verifySubjectChunks(expected, oversizedStream());
    expect(streamRes.accepted).toBe(false);
    expect(streamRes.problems[0]).toContain("exceeded expected subject.size");
    expect(yielded).toBe(3); // 3 * 8000 = 24000 > 20000; stops before reading chunks 4..10
  });
});

describe("descriptor-set builder and verifier (section 6)", () => {
  test("sorts entries strictly ascending, validates against the schema, agrees with Python json.dumps, and cross-checks descriptors", () => {
    const d1 = buildPatternDescriptor({ seed: "set-item-a", size: 1024, filename: "a.bin" });
    const d2 = buildPatternDescriptor({ seed: "set-item-b", size: 2048, filename: "b.bin" });

    const set = buildDescriptorSetFromTexts("round-01.initial", [d1.descriptor.text, d2.descriptor.text]);
    expect(validate(JSON.parse(set.text)), JSON.stringify(validate.errors)).toBe(true);

    const py = spawnSync("python3", ["-c", "import json, sys; d = json.loads(sys.stdin.read()); sys.stdout.write(json.dumps(d, indent=2) + '\\n')"], {
      input: set.text,
      encoding: "utf8",
    });
    expect(py.status).toBe(0);
    expect(py.stdout).toBe(set.text);

    const map = new Map<string, string>([
      [d1.descriptor.sha256, d1.descriptor.text],
      [d2.descriptor.sha256, d2.descriptor.text],
    ]);
    expect(descriptorSetProblems(set.text, { descriptorsBySha256: map })).toEqual([]);

    // Unsorted entries, duplicate subjects, bad set_id, and mismatched linked descriptor fail
    const parsed = JSON.parse(set.text) as Json;
    parsed.descriptors.reverse();
    expect(descriptorSetProblems(canonicalJson(parsed)).join("; ")).toContain("sorted strictly ascending");

    expect(() =>
      buildDescriptorSet("round-1", [
        { subject_sha256: d1.sha256, descriptor_sha256: fake("1", 64) },
        { subject_sha256: d1.sha256, descriptor_sha256: fake("2", 64) },
      ]),
    ).toThrow(/duplicate subject_sha256/u);

    expect(() => buildDescriptorSet("UPPERCASE", [{ subject_sha256: d1.sha256, descriptor_sha256: d1.descriptor.sha256 }])).toThrow(/set_id/u);

    const wrongSubjectSet = buildDescriptorSet("round-mismatch", [
      { subject_sha256: fake("0", 64), descriptor_sha256: d1.descriptor.sha256 },
    ]);
    expect(descriptorSetProblems(wrongSubjectSet.text, { descriptorsBySha256: map }).join("; ")).toContain("differs from linked descriptor");
  });
});

describe("magnet link derivation (section 7.5) and hints-index invariants (sections 8.1-8.3)", () => {
  test("derives schema-valid magnet links preserving + in dn= while percent-encoding + in ws=/xs= and never adding tr=", () => {
    const magnet = deriveMagnetLink({
      btih: fake("3", 40),
      btmh: `1220${fake("4", 64)}`,
      name: "pkg+v1.0.tgz",
      urlList: ["https://example.org/files/pkg+v1.0.tgz", "https://mirror.example.org/pkg+v1.0.tgz"],
      torrentUrl: "https://example.org/transport/pkg+v1.0.tgz.torrent",
    });
    expect(magnet).toContain("&dn=pkg+v1.0.tgz&ws=https%3A%2F%2Fexample.org%2Ffiles%2Fpkg%2Bv1.0.tgz");
    expect(magnet.includes("tr=")).toBe(false);

    const indexCandidate = {
      protocol: "transport-hints/v1",
      document_type: "hints-index",
      version: 1,
      previous_sha256: null,
      entries: [
        {
          subject_sha256: fake("1", 64),
          name: "pkg+v1.0.tgz",
          descriptor_sha256: fake("2", 64),
          status: "listed",
          descriptor_url: "https://example.org/transport/pkg+v1.0.tgz.json",
          clearance_sha256: fake("5", 64),
          irreversibility_notice_sha256: fake("6", 64),
          promise_until: "2027-05-14",
          torrent: {
            url: "https://example.org/transport/pkg+v1.0.tgz.torrent",
            sha256: fake("7", 64),
            url_list: ["https://example.org/files/pkg+v1.0.tgz", "https://mirror.example.org/pkg+v1.0.tgz"],
          },
          magnet,
        },
      ],
    };
    expect(validate(indexCandidate), JSON.stringify(validate.errors)).toBe(true);
    expect(hintsIndexProblems(canonicalJson(indexCandidate))).toEqual([]);
  });

  test("downgrades expired listed entries to unmaintained without mutating the index (section 8.2)", () => {
    expect(effectiveEntryStatus({ status: "listed", promise_until: "2027-05-14" }, "2027-05-14")).toBe("listed");
    expect(effectiveEntryStatus({ status: "listed", promise_until: "2027-05-14" }, "2027-05-15")).toBe("unmaintained");
    expect(effectiveEntryStatus({ status: "withdrawn" }, "2029-01-01")).toBe("withdrawn");
  });

  test("enforces all eight non-schema rules of section 8.3 across entries, descriptors, .torrents, and index chains", () => {
    const itemA = buildPatternDescriptor({
      seed: "index-item-a",
      size: 46_000,
      filename: "item-a.bin",
      urlList: ["https://example.org/files/item-a.bin"],
    });
    const itemA2 = buildPatternDescriptor({
      seed: "index-item-a",
      size: 46_000,
      filename: "item-a.bin",
      authority: { kind: "sums-line", url: "https://example.org/files/SHA256SUMS" },
      urlList: ["https://example.org/files/item-a.bin", "https://mirror.example.org/files/item-a.bin"],
    });
    const itemNonePrior = buildPatternDescriptor({
      seed: "index-none-prior",
      size: 16_384,
      filename: "first-seen.bin",
      authority: { kind: "none-prior" },
      urlList: ["https://example.org/files/first-seen.bin"],
    });

    const descriptorsBySha256 = new Map<string, string>([
      [itemA.descriptor.sha256, itemA.descriptor.text],
      [itemA2.descriptor.sha256, itemA2.descriptor.text],
      [itemNonePrior.descriptor.sha256, itemNonePrior.descriptor.text],
    ]);
    const torrentsBySha256 = new Map<string, Uint8Array>([
      [itemA.torrentBuild.torrentSha256, itemA.torrentBuild.torrent],
      [itemA2.torrentBuild.torrentSha256, itemA2.torrentBuild.torrent],
      [itemNonePrior.torrentBuild.torrentSha256, itemNonePrior.torrentBuild.torrent],
    ]);

    const torrentUrlA = "https://example.org/transport/item-a.bin.torrent";
    const torrentUrlA2 = "https://example.org/transport/item-a-v2.bin.torrent";
    const torrentUrlNP = "https://example.org/transport/first-seen.bin.torrent";

    const v1Text = canonicalJson({
      protocol: "transport-hints/v1",
      document_type: "hints-index",
      version: 1,
      previous_sha256: null,
      entries: [
        {
          subject_sha256: itemA.sha256,
          name: itemA.name,
          descriptor_sha256: itemA.descriptor.sha256,
          status: "listed",
          descriptor_url: "https://example.org/transport/item-a.json",
          clearance_sha256: fake("9", 64),
          irreversibility_notice_sha256: fake("a", 64),
          promise_until: "2027-05-14",
          torrent: {
            url: torrentUrlA,
            sha256: itemA.torrentBuild.torrentSha256,
            url_list: [...itemA.torrentBuild.urlList],
          },
          magnet: deriveMagnetLink({
            btih: itemA.torrentBuild.btih,
            btmh: itemA.torrentBuild.btmh,
            name: itemA.name,
            urlList: itemA.torrentBuild.urlList,
            torrentUrl: torrentUrlA,
          }),
        },
      ],
    });

    // Version 2 deliberately uses compact JSON formatting: section 8.3 rule 8 requires
    // version 3's previous_sha256 to hash the EXACT served bytes of version 2.
    const v2Compact = JSON.stringify({
      protocol: "transport-hints/v1",
      document_type: "hints-index",
      version: 2,
      previous_sha256: sha256Hex(v1Text),
      entries: [
        {
          subject_sha256: itemA.sha256,
          name: itemA.name,
          descriptor_sha256: itemA.descriptor.sha256,
          status: "superseded",
          superseded_at: "2026-12-01",
          superseded_by: itemA2.descriptor.sha256,
          stopped: ["descriptor", "torrent file"],
          cannot_stop: ["peers", "caches"],
        },
        {
          subject_sha256: itemA2.sha256,
          name: itemA2.name,
          descriptor_sha256: itemA2.descriptor.sha256,
          status: "listed",
          descriptor_url: "https://example.org/transport/item-a-v2.json",
          clearance_sha256: fake("b", 64),
          irreversibility_notice_sha256: fake("a", 64),
          promise_until: "2027-06-01",
          torrent: {
            url: torrentUrlA2,
            sha256: itemA2.torrentBuild.torrentSha256,
            url_list: [...itemA2.torrentBuild.urlList],
          },
          magnet: deriveMagnetLink({
            btih: itemA2.torrentBuild.btih,
            btmh: itemA2.torrentBuild.btmh,
            name: itemA2.name,
            urlList: itemA2.torrentBuild.urlList,
            torrentUrl: torrentUrlA2,
          }),
        },
        {
          subject_sha256: itemNonePrior.sha256,
          name: itemNonePrior.name,
          descriptor_sha256: itemNonePrior.descriptor.sha256,
          status: "listed",
          descriptor_url: "https://example.org/transport/first-seen.json",
          clearance_sha256: fake("c", 64),
          irreversibility_notice_sha256: fake("a", 64),
          promise_until: "2027-06-01",
          torrent: {
            url: torrentUrlNP,
            sha256: itemNonePrior.torrentBuild.torrentSha256,
            url_list: [...itemNonePrior.torrentBuild.urlList],
          },
          magnet: deriveMagnetLink({
            btih: itemNonePrior.torrentBuild.btih,
            btmh: itemNonePrior.torrentBuild.btmh,
            name: itemNonePrior.name,
            urlList: itemNonePrior.torrentBuild.urlList,
            torrentUrl: torrentUrlNP,
          }),
          none_prior: { hashed_at: "2026-11-20T10:00:00Z" },
        },
      ],
    });

    const v3Text = canonicalJson({
      protocol: "transport-hints/v1",
      document_type: "hints-index",
      version: 3,
      previous_sha256: sha256Hex(v2Compact),
      entries: [
        ...JSON.parse(v2Compact).entries.slice(0, 2),
        {
          subject_sha256: itemNonePrior.sha256,
          name: itemNonePrior.name,
          descriptor_sha256: itemNonePrior.descriptor.sha256,
          status: "withdrawn",
          withdrawn_at: "2026-12-10",
          stopped: ["descriptor", "torrent file", "pointers"],
          cannot_stop: ["peers", "caches", "home copy"],
          none_prior: { hashed_at: "2026-11-20T10:00:00Z" },
        },
      ],
    });

    expect(verifyHintsIndexChain([v1Text, v2Compact, v3Text], { descriptorsBySha256, torrentsBySha256 })).toEqual([]);

    // Rule 8.3.1 violation: reusing a name for different bytes
    const badNameReuse = JSON.parse(v1Text) as Json;
    badNameReuse.entries.push({
      subject_sha256: fake("f", 64),
      name: itemA.name,
      descriptor_sha256: fake("e", 64),
      status: "withdrawn",
      withdrawn_at: "2026-12-01",
      stopped: ["descriptor"],
      cannot_stop: ["peers"],
    });
    expect(hintsIndexProblems(canonicalJson(badNameReuse)).join("; ")).toContain("rule 8.3.1");

    // Rule 8.3.2 violation: two active (listed + unmaintained) entries for the same subject_sha256
    const badTwoActive = JSON.parse(v1Text) as Json;
    badTwoActive.entries.push({
      subject_sha256: itemA.sha256,
      name: itemA.name,
      descriptor_sha256: itemA2.descriptor.sha256,
      status: "unmaintained",
    });
    expect(hintsIndexProblems(canonicalJson(badTwoActive)).join("; ")).toContain("rule 8.3.2");

    // Rule 8.3.3 violation: none_prior omitted for none-prior descriptor, or added to json-pointer descriptor
    const badNonePrior = JSON.parse(v1Text) as Json;
    badNonePrior.entries[0].none_prior = { hashed_at: "2026-11-20T10:00:00Z" };
    expect(hintsIndexProblems(canonicalJson(badNonePrior), { descriptorsBySha256 }).join("; ")).toContain("rule 8.3.3");

    // Rule 8.3.4 violation: torrent.url_list disagrees with the .torrent's url-list
    const badUrlList = JSON.parse(v1Text) as Json;
    badUrlList.entries[0].torrent.url_list = ["https://other.example.org/files/item-a.bin"];
    expect(hintsIndexProblems(canonicalJson(badUrlList), { torrentsBySha256 }).join("; ")).toContain("rule 8.3.4");

    // Rule 8.3.5 violation: magnet carries tr= or lowercase %3a
    const badTrackerMagnet = JSON.parse(v1Text) as Json;
    badTrackerMagnet.entries[0].magnet += "&tr=https%3A%2F%2Ftracker.example.org%2Fannounce";
    expect(hintsIndexProblems(canonicalJson(badTrackerMagnet)).join("; ")).toContain("tracker ('tr=')");

    const badLowercaseHexMagnet = JSON.parse(v1Text) as Json;
    badLowercaseHexMagnet.entries[0].magnet = badLowercaseHexMagnet.entries[0].magnet.replace("%3A", "%3a");
    expect(hintsIndexProblems(canonicalJson(badLowercaseHexMagnet)).join("; ")).toContain("rule 8.3.5");

    // Rule 8.3.6 violation: superseded_by points to missing descriptor
    const badSuperseded = JSON.parse(v2Compact) as Json;
    badSuperseded.entries[0].superseded_by = fake("d", 64);
    expect(hintsIndexProblems(canonicalJson(badSuperseded)).join("; ")).toContain("rule 8.3.6");

    // Rule 8.3.7 violation: dropping a previously published entry in a later index version
    const badDroppedV3 = canonicalJson({
      protocol: "transport-hints/v1",
      document_type: "hints-index",
      version: 3,
      previous_sha256: sha256Hex(v2Compact),
      entries: JSON.parse(v2Compact).entries.slice(1),
    });
    expect(verifyHintsIndexChain([v1Text, v2Compact, badDroppedV3]).join("; ")).toContain("rule 8.3.7");

    // Signature field forbidden at arbitrary nesting depth (section 8.1)
    const badSig = JSON.parse(v1Text) as Json;
    badSig.entries[0].observations = [
      { at: "2026-12-01", by: "probe", web_seeds: [{ url: "https://example.org/files/item-a.bin", signature: "leaked" }] },
    ];
    expect(hintsIndexProblems(canonicalJson(badSig)).join("; ")).toContain("signature");

    const badExtSig = JSON.parse(v1Text) as Json;
    badExtSig.extra = { nested: [{ signature: "leaked-deep" }] };
    expect(hintsIndexProblems(canonicalJson(badExtSig)).join("; ")).toContain("signature");

    // Duplicate ws= inside magnet is refused even when torrent is absent
    const dupWsNoTorrent = JSON.parse(v1Text) as Json;
    dupWsNoTorrent.entries[0].status = "unmaintained";
    delete dupWsNoTorrent.entries[0].torrent;
    const oneSeed = encodeURIComponent("https://example.org/files/item-a.bin");
    dupWsNoTorrent.entries[0].magnet =
      `magnet:?xt=urn:btih:${itemA.torrentBuild.btih}&xt=urn:btmh:${itemA.torrentBuild.btmh}&dn=${itemA.name}&ws=${oneSeed}&ws=${oneSeed}`;
    expect(hintsIndexProblems(canonicalJson(dupWsNoTorrent)).join("; ")).toContain("duplicate ws=");

    // Minor error in v1 must NOT mask v2 cross-version violations (version jump + dropped entries)
    const badObsV1Obj = JSON.parse(v1Text) as Json;
    badObsV1Obj.entries[0].observations = [{ at: "not-a-date", by: "probe" }];
    const badObsV1Text = canonicalJson(badObsV1Obj);
    const badJumpDropV2Text = canonicalJson({
      protocol: "transport-hints/v1",
      document_type: "hints-index",
      version: 99,
      previous_sha256: sha256Hex(badObsV1Text),
      entries: [],
    });
    const chainProblems = verifyHintsIndexChain([badObsV1Text, badJumpDropV2Text]).join("; ");
    expect(chainProblems).toContain("chain[0]");
    expect(chainProblems).toContain("rule 8.1: chain[1] version 99 does not increment 1 by 1");
    expect(chainProblems).toContain("rule 8.3.7: chain[1]");
  });
});

describe("CLI and source hygiene", () => {
  test("check-set, check-index and check-index-chain succeed on valid inputs and exit 1 on violations", () => {
    const dir = mkdtempSync(join(tmpdir(), "th-verify-cli-"));
    try {
      const item = buildPatternDescriptor({ seed: "cli-item", size: 16_384, filename: "cli-item.bin" });
      const descPath = join(dir, "cli-item.transport.json");
      const torrentPath = join(dir, "cli-item.torrent");
      const setPath = join(dir, "set.json");
      const v1Path = join(dir, "index-v1.json");
      const v2Path = join(dir, "index-v2.json");

      writeFileSync(descPath, item.descriptor.text);
      writeFileSync(torrentPath, item.torrentBuild.torrent);
      const set = buildDescriptorSetFromTexts("cli-round", [item.descriptor.text]);
      writeFileSync(setPath, set.text);

      const v1 = canonicalJson({
        protocol: "transport-hints/v1",
        document_type: "hints-index",
        version: 1,
        previous_sha256: null,
        entries: [
          {
            subject_sha256: item.sha256,
            name: item.name,
            descriptor_sha256: item.descriptor.sha256,
            status: "listed",
            descriptor_url: "https://example.org/transport/cli-item.json",
            clearance_sha256: fake("1", 64),
            irreversibility_notice_sha256: fake("2", 64),
            promise_until: "2027-05-14",
            torrent: {
              url: "https://example.org/transport/cli-item.torrent",
              sha256: item.torrentBuild.torrentSha256,
              url_list: [...item.torrentBuild.urlList],
            },
          },
        ],
      });
      const v2 = canonicalJson({
        protocol: "transport-hints/v1",
        document_type: "hints-index",
        version: 2,
        previous_sha256: sha256Hex(v1),
        entries: [
          {
            subject_sha256: item.sha256,
            name: item.name,
            descriptor_sha256: item.descriptor.sha256,
            status: "withdrawn",
            withdrawn_at: "2026-12-01",
            stopped: ["descriptor", "torrent file"],
            cannot_stop: ["peers"],
          },
        ],
      });
      writeFileSync(v1Path, v1);
      writeFileSync(v2Path, v2);

      const run = (...args: string[]) =>
        spawnSync(process.execPath, [join(ROOT, VERIFY_MODULE_PATH), ...args], { encoding: "utf8" });

      const setOk = run("check-set", setPath, "--descriptor", descPath);
      expect(setOk.status, setOk.stderr).toBe(0);
      expect(setOk.stdout).toContain("descriptor-set ok:");

      const idxOk = run("check-index", v1Path, "--descriptor", descPath, "--torrent", torrentPath);
      expect(idxOk.status, idxOk.stderr).toBe(0);
      expect(idxOk.stdout).toContain("hints-index ok:");

      const chainOk = run("check-index-chain", v1Path, v2Path, "--descriptor", descPath, "--torrent", torrentPath);
      expect(chainOk.status, chainOk.stderr).toBe(0);
      expect(chainOk.stdout).toContain("hints-index chain ok (2 version(s))");

      const chainBad = run("check-index-chain", v2Path);
      expect(chainBad.status).toBe(1);
      expect(chainBad.stderr).toContain("version 1");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("holds no ambient network client, socket, or BitTorrent session code of its own", () => {
    const source = readFileSync(join(ROOT, VERIFY_MODULE_PATH), "utf8");
    for (const forbidden of [
      /\bglobalThis\.fetch\b/u,
      /\bnode:(?:http|https|http2|net|tls|dgram|dns)\b/u,
      /\bBun\.(?:serve|connect|listen|udpSocket)\b/u,
      /\bnew\s+WebSocket\b/u,
    ]) {
      expect(forbidden.test(source), `${VERIFY_MODULE_PATH} matched ${forbidden}`).toBe(false);
    }
    expect(defaultAuthorityAllowUrl(new URL("https://example.org/a/b"))).toBe(true);
    expect(defaultAuthorityAllowUrl(new URL("https://127.0.0.1/a/b"))).toBe(false);
    expect(defaultAuthorityAllowUrl(new URL("https://[::1]/a/b"))).toBe(false);
    expect(defaultAuthorityAllowUrl(new URL("https://user:pass@example.org/a/b"))).toBe(false);
  });
});
