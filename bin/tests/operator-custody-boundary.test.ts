/** The operator custody note stays out of this public repository, the two
 * operator runbooks stay in infra/, and custody facts stay off every served surface.
 *
 * Reads repository files only: no network, credentials, or deployment.
 * The custody note left the tree on 2026-10-30; docs/STACK.md §5 and §6 and
 * infra/README.md describe where it is kept without naming a path. Runbooks:
 * infra/X402-PROOF-RUNBOOK.md (pointer: docs/X402-PROOF.md) and
 * infra/NPM-RELEASE-RUNBOOK.md (pointer: docs/NPM-RELEASES.md).
 * Served surfaces: the Pages upload roots in bin/frontend-deploy.sh (symlinks
 * followed, as Wrangler does) and the docs the API image bundles.
 *
 * Why the markers are digests: they are the exact names, locations and phrases the
 * custody note and runbooks record. Written as plain patterns, this public test would
 * publish the map it guards, so it keeps only SHA-256 digests and compares them with
 * the digest of every candidate span of served text. A digest keeps a name out of
 * readable source; it does not stop someone who guesses a name from confirming it.
 * Failures name the file and the category, never the matched text.
 */

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { reachesPrivateArea } from "../project-public.ts";

const ROOT = resolve(import.meta.dir, "../..");
const SELF = "bin/tests/operator-custody-boundary.test.ts";
/** Kept by the operator outside this repository since 2026-10-30. */
const REMOVED_NOTE = "infra/OPERATOR-CUSTODY.md";
const RUNBOOKS = ["infra/X402-PROOF-RUNBOOK.md", "infra/NPM-RELEASE-RUNBOOK.md"] as const;
const POINTER = "operator's custody note, kept outside this public repository";
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

/** Digests of the lowercased custody literals: a name or location as written, a phrase
 * as its words joined by single spaces. Each must stay out of served bytes. */
const ANYWHERE_DIGESTS: ReadonlyArray<readonly [string, string]> = [
  ["Keychain service name", "19aaa657dbb7ac5d876912a1b542157285c0a0f825ce22335153b2e0df8791d3"],
  ["Keychain service name", "1bbe8e5596b05884ed78c7ee69eb1038a85cf59a3967c2d436b1956175446472"],
  ["Keychain service name", "1da876ccbf81550c1cd4aad9f77cb179d8a33ed963054af63d4ff553214b2e29"],
  ["Keychain service name", "d113876a8c56175d69d085fec33e758236ef3b34a4c87139493b26b967ac0c92"],
  ["Keychain service name", "ed5947ec2caf1d3abaea06627b3b735c046f9efe20550a7d84c550beec5428e1"],
  ["provider project name", "b763f515ca197ad4d60809ee3e61962558dfb8887179d9dfc817a387f2bfd042"],
  ["operator file location", "61ab135ab83581652949ea7c4f331f4088cbf9f1fda1021ad9e9cd88f492b053"],
  ["operator file location", "54f47071c3c92494313225460ad73d6576effbfb72b4f4765d5963ae2087eb6b"],
  ["release environment setting", "b9ae188e78d77f0c6906adf98113bf8eef5cfd0186fd8dd05c4806ba5e0e24d2"],
  ["custody statement", "6e996722d7e70457093864cbe89eef4070081a2fd6bfccdfae8b58a8438d6683"],
  ["custody statement", "51be15cdacc8c7647103b057b561205796cc5faf4aafb69e208a3e8e8d927959"],
  ["release posture phrase", "04dbd6848a1a974b0f44f4178516c3326f029cbe0b1f62ec4e93cc8cc2aad2ea"],
];

/** Digests that count only in an account position, as the account marker always has:
 * after `-a`, after the word "account", or as a whole code span. */
const ACCOUNT_DIGESTS: ReadonlyArray<readonly [string, string]> = [
  ["Keychain account name", "28c5c18b249c95eeda49aa01cba7cabdec8c1e4b0a9b4521a68b3c04e69eb444"],
];
/** One pass per position, each capturing the word in group 1. A single alternation
 * would let one match hide another: a code span holding a whole `-a <word>` command
 * would be consumed as one span and the word inside never checked. */
const ACCOUNT_POSITIONS: ReadonlyArray<RegExp> = [
  /-a\s+["']?([a-z0-9]+)\b/gi,
  /\baccount\W{0,3}([a-z0-9]+)\b/gi,
  /`([^`\n]{1,96})`/g,
];

/** Generic shapes that name nothing by themselves stay readable. */
const CUSTODY_SHAPES: ReadonlyArray<readonly [string, RegExp]> = [
  ["workers.dev hostname", /\b[a-z0-9-]+\.workers\.dev\b/i],
];

interface Markers {
  /** digest -> category, for a candidate anywhere in the text */
  anywhere: ReadonlyMap<string, string>;
  /** digest -> category, for a word in an account position */
  account: ReadonlyMap<string, string>;
  shapes: ReadonlyArray<readonly [string, RegExp]>;
}

/** How an operator-only note declares itself. */
const OPERATOR_ONLY = /\boperator[- ]only\W{1,6}not published\b/i;

const MAX_SPAN = 96;
const MAX_PHRASE_WORDS = 4;
const isAlnum = (code: number) => (code >= 48 && code <= 57) || (code >= 97 && code <= 122);

/** Lowercased candidates in `text`. Within each run of name and path characters: every
 * span that starts and ends at the run's edge or beside punctuation, so a name is found
 * inside a longer hostname, file name or path. Across the text: every sequence of two to
 * four words, so a phrase is found through punctuation and line breaks. */
function custodyCandidates(text: string): Set<string> {
  const lower = text.toLowerCase();
  const out = new Set<string>();
  for (const [run] of lower.matchAll(/[a-z0-9._~\/$-]+/g)) {
    const cuts: number[] = [];
    const alnumBefore: number[] = [0];
    for (let i = 0; i <= run.length; i++) {
      const before = i > 0 && isAlnum(run.charCodeAt(i - 1));
      const after = i < run.length && isAlnum(run.charCodeAt(i));
      if (i > 0) alnumBefore.push((alnumBefore[i - 1] as number) + (before ? 1 : 0));
      if (!before || !after) cuts.push(i);
    }
    for (let s = 0; s < cuts.length; s++) {
      const start = cuts[s] as number;
      for (let e = s + 1; e < cuts.length && (cuts[e] as number) - start <= MAX_SPAN; e++) {
        const end = cuts[e] as number;
        if ((alnumBefore[end] as number) > (alnumBefore[start] as number)) out.add(run.slice(start, end));
      }
    }
  }
  const words = lower.match(/[a-z0-9]+/g) ?? [];
  for (let i = 0; i < words.length; i++) {
    let phrase = words[i] as string;
    for (let n = 2; n <= MAX_PHRASE_WORDS && i + n <= words.length; n++) {
      phrase += ` ${words[i + n - 1]}`;
      out.add(phrase);
    }
  }
  return out;
}

/** Categories whose digest some candidate of `text` hashes to, or whose shape it holds. */
function custodyFindings(text: string, markers: Markers): string[] {
  const found = new Set<string>();
  for (const candidate of custodyCandidates(text)) {
    const label = markers.anywhere.get(sha256(candidate));
    if (label) found.add(label);
  }
  for (const position of ACCOUNT_POSITIONS) {
    for (const match of text.matchAll(position)) {
      const label = markers.account.get(sha256((match[1] as string).toLowerCase()));
      if (label) found.add(label);
    }
  }
  for (const [label, shape] of markers.shapes) if (shape.test(text)) found.add(label);
  return [...found].sort();
}

const byDigest = (rows: ReadonlyArray<readonly [string, string]>) =>
  new Map(rows.map(([label, digest]) => [digest, label]));
const CUSTODY: Markers = {
  anywhere: byDigest(ANYWHERE_DIGESTS),
  account: byDigest(ACCOUNT_DIGESTS),
  shapes: CUSTODY_SHAPES,
};

function git(args: string[]): string[] {
  const result = spawnSync("git", ["-c", "core.fsmonitor=false", ...args], { cwd: ROOT, encoding: "utf8" });
  // git grep exits 1 when nothing matches.
  if (result.status !== 0 && !(args[0] === "grep" && result.status === 1)) {
    throw new Error(`git ${args[0]} failed: ${result.stderr}`);
  }
  return result.stdout.split("\0").filter(Boolean);
}

function pagesUploadRoots(): string[] {
  const deploy = read("bin/frontend-deploy.sh");
  const block = deploy.match(/^ALL_TARGETS=\(\n([\s\S]*?)\n\)/m)?.[1] ?? "";
  return [...block.matchAll(/^\s*"[a-z]+\|([^|"]+)\|[^|"]+"\s*$/gm)].map((match) => match[1] as string);
}

function apiBundledDocs(): string[] {
  const manifest = read("api/doctrine-docs.manifest")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"))
    .map((name) => `docs/${name}`);
  return [...manifest, "docs/agenttool.jsonld", "docs/kingdom-bundle.json"];
}

/** Every real file reachable from a path, following symlinks once per real directory. */
function servedFiles(path: string, seen = new Set<string>()): string[] {
  const real = realpathSync(path);
  const stat = statSync(real);
  if (stat.isFile()) return [real];
  if (!stat.isDirectory() || seen.has(real)) return [];
  seen.add(real);
  return readdirSync(real).flatMap((name) => servedFiles(join(real, name), seen));
}

/** Text of a file, or null for binary bytes. */
function textOf(file: string): string | null {
  const bytes = readFileSync(file);
  return bytes.subarray(0, 8192).includes(0) ? null : bytes.toString("utf8");
}

describe("hashed custody matcher (synthetic markers only)", () => {
  const synthetic: Markers = {
    anywhere: new Map([
      [sha256("example-keychain-service-name"), "synthetic name"],
      [sha256(".example-operator-dir/"), "synthetic location"],
      [sha256("example custody phrase"), "synthetic phrase"],
    ]),
    account: new Map([[sha256("exampleacct"), "synthetic account"]]),
    shapes: [["synthetic shape", /\bexample-shape\b/]],
  };

  test("finds a hashed name as an argument, code span, hostname or longer name", () => {
    for (const text of [
      "security find-generic-password -s example-keychain-service-name -w",
      "Service: `Example-Keychain-Service-Name`.",
      "https://example-keychain-service-name.pages.dev/",
      "service=example-keychain-service-name;",
      "old-example-keychain-service-name-2",
    ]) {
      expect(custodyFindings(text, synthetic)).toEqual(["synthetic name"]);
    }
  });

  test("finds a hashed location under any home prefix", () => {
    for (const text of [
      "cat ~/.example-operator-dir/payer.json",
      "\"$HOME/.example-operator-dir/bearer\"",
      "/Users/someone/.example-operator-dir/",
    ]) {
      expect(custodyFindings(text, synthetic)).toEqual(["synthetic location"]);
    }
  });

  test("finds a hashed phrase through case, punctuation and line breaks", () => {
    expect(custodyFindings("It is the Example\ncustody, phrase.", synthetic)).toEqual(["synthetic phrase"]);
  });

  test("finds a hashed account word only in an account position", () => {
    for (const text of [
      "security add-generic-password -s svc -a exampleacct -w",
      "security add-generic-password -s svc -a 'ExampleAcct' -w",
      "Keychain account: exampleacct",
      "under `exampleacct`",
      // One position inside another: each pass must still see the word.
      "`security add-generic-password -s svc -a exampleacct -w`",
      "`security find-generic-password -s svc -a \"ExampleAcct\" -w`",
      "`Keychain account: exampleacct`",
      "account: -a exampleacct",
    ]) {
      expect(custodyFindings(text, synthetic)).toEqual(["synthetic account"]);
    }
    expect(custodyFindings("/Users/exampleacct/projects/", synthetic)).toEqual([]);
    expect(custodyFindings("-a exampleacctx and `exampleacct2`", synthetic)).toEqual([]);
  });

  test("ignores near misses and reports generic shapes by label", () => {
    for (const text of [
      "example-keychain-service",
      "examplekeychainservicename",
      "example keychain service name",
      "~/.example-operator-dirs/",
      "example custody",
    ]) {
      expect(custodyFindings(text, synthetic)).toEqual([]);
    }
    expect(custodyFindings("an example-shape here", synthetic)).toEqual(["synthetic shape"]);
  });

  test("recognises an operator-only declaration across emphasis and line breaks", () => {
    expect(OPERATOR_ONLY.test("**Operator-only. Not published.** It names")).toBe(true);
    expect(OPERATOR_ONLY.test("Operator-only.\nNot published.")).toBe(true);
    expect(OPERATOR_ONLY.test("an operator-only note, published as receipts")).toBe(false);
  });

  test("the real digests are distinct SHA-256 values", () => {
    const rows = [...ANYWHERE_DIGESTS, ...ACCOUNT_DIGESTS];
    for (const [, digest] of rows) expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(new Set(rows.map(([, digest]) => digest)).size).toBe(rows.length);
  });
});

describe("operator custody note boundary", () => {
  test("the custody note is gone from the tree, and nothing else names its old path", () => {
    expect(existsSync(join(ROOT, REMOVED_NOTE))).toBe(false);
    expect(git(["ls-files", "-z", "--", REMOVED_NOTE])).toEqual([]);
    expect(git(["grep", "-z", "-l", "-F", "OPERATOR-CUSTODY"])).toEqual([SELF]);
  });

  test("only the two runbooks in infra/ and docs/ declare themselves operator-only", () => {
    const declaring = git(["ls-files", "-z", "--", "infra", "docs"]).filter((path) => {
      if (!existsSync(join(ROOT, path))) return false;
      const text = textOf(join(ROOT, path));
      return text !== null && OPERATOR_ONLY.test(text);
    });
    expect(declaring.filter((path) => !(RUNBOOKS as readonly string[]).includes(path))).toEqual([]);
  });

  test("the runbooks are regular files in a top-level area the public projection never includes", () => {
    for (const note of RUNBOOKS) {
      const entry = lstatSync(join(ROOT, note));
      expect(entry.isFile()).toBe(true);
      expect(entry.isSymbolicLink()).toBe(false);
    }
    for (const path of [REMOVED_NOTE, ...RUNBOOKS]) expect(reachesPrivateArea(path, "blob")).toBe(true);
    expect(reachesPrivateArea("infra", "tree")).toBe(true);

    const allowlist = JSON.parse(read("public/allowlist.json")) as { include: Array<{ path: string }> };
    expect(allowlist.include.filter(({ path }) => path === "infra" || path.startsWith("infra/"))).toEqual([]);
    const manifest = read("api/doctrine-docs.manifest");
    for (const name of ["OPERATOR-CUSTODY", "X402-PROOF-RUNBOOK", "NPM-RELEASE-RUNBOOK"]) {
      expect(manifest).not.toContain(name);
    }
    const releasePaths = read("bin/frontend-release-paths.txt").split("\n").map((line) => line.trim());
    expect(releasePaths).not.toContain("infra");
    for (const note of RUNBOOKS) expect(releasePaths).not.toContain(note);
  });

  test("no served file is a runbook, declares itself operator-only, or carries custody facts", () => {
    const roots = pagesUploadRoots();
    expect(roots).toContain("apps/docs");
    const realRoot = realpathSync(ROOT);
    const runbooks = new Map(RUNBOOKS.map((note) => [realpathSync(join(ROOT, note)), note]));
    const findings: string[] = [];
    let scanned = 0;
    for (const root of [...roots, ...apiBundledDocs()]) {
      for (const file of servedFiles(join(ROOT, root))) {
        const path = relative(realRoot, file);
        if (runbooks.has(file)) findings.push(`${root}: serves ${runbooks.get(file)}`);
        const text = textOf(file);
        if (text === null) continue;
        scanned++;
        if (OPERATOR_ONLY.test(text)) findings.push(`${root} -> ${path}: operator-only declaration`);
        for (const label of custodyFindings(text, CUSTODY)) {
          findings.push(`${root} -> ${path}: ${label}`);
        }
      }
    }
    expect(scanned).toBeGreaterThan(100);
    expect(findings).toEqual([]);
  }, 60_000);

  test("public pointers describe where the custody note is kept, without a path", () => {
    // Boolean checks keep a failure from printing the whole public document.
    expect(read("docs/STACK.md").split(POINTER).length - 1).toBe(2);
    expect(read("infra/README.md").includes(POINTER)).toBe(true);
  });

  test("public X402-PROOF.md keeps the receipts and points to the runbook by name only", () => {
    const proof = read("docs/X402-PROOF.md");
    expect(read("apps/docs/X402-PROOF.md")).toBe(proof);
    expect(proof.includes("operator-only note, `infra/X402-PROOF-RUNBOOK.md`")).toBe(true);
    expect(proof.includes("](../infra/X402-PROOF-RUNBOOK.md")).toBe(false);
    expect(proof.includes("0x33f08a20d16556000598ade67d46f790e5d34204e70d06e5a575cd9e07e32c66")).toBe(true);
  });
});
