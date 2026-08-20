import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, test } from "bun:test";

import {
  compareUtf8Paths,
  CORE_CORPUS_PIN,
} from "../scripts/core-corpus-pin.mjs";
import {
  importPinnedCoreCorpus,
  inspectPinnedCoreCorpus,
} from "../scripts/import-core-corpus.mjs";

const fixture = resolve(import.meta.dir, "../vectors/core-v0.1");
const temporaryRoots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "agenttool-witness-import-"));
  temporaryRoots.push(root);
  return root;
}

async function digest(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("pinned Core corpus importer", () => {
  test("pins every advertised identity and stages a validated replacement", async () => {
    const root = await temporaryRoot();
    const source = join(root, "source");
    const destination = join(root, "destination");
    await cp(fixture, source, { recursive: true });
    await cp(fixture, destination, { recursive: true });

    const result = await importPinnedCoreCorpus(source, destination);
    const inspected = await inspectPinnedCoreCorpus(destination);

    expect(result).toEqual({
      file_count: CORE_CORPUS_PIN.vector_count + 1,
      corpus_digest: CORE_CORPUS_PIN.corpus_digest,
    });
    expect(inspected.corpus_digest).toBe(CORE_CORPUS_PIN.corpus_digest);
    expect(await digest(join(destination, "known-answer.json"))).toBe(
      CORE_CORPUS_PIN.manifest_file_sha256.slice(7),
    );
  });

  test("rejects pin drift before changing the destination", async () => {
    const root = await temporaryRoot();
    const source = join(root, "source");
    const destination = join(root, "destination");
    await cp(fixture, source, { recursive: true });
    await cp(fixture, destination, { recursive: true });
    const before = await digest(join(destination, "known-answer.json"));
    const manifestPath = join(source, "known-answer.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.schema_set_digest = `sha256:${"0".repeat(64)}`;
    await writeFile(manifestPath, JSON.stringify(manifest));

    await expect(importPinnedCoreCorpus(source, destination)).rejects.toThrow(/core pin drift/u);
    expect(await digest(join(destination, "known-answer.json"))).toBe(before);
  });

  test("refuses equal or overlapping trees without deleting the source", async () => {
    const root = await temporaryRoot();
    const corpus = join(root, "corpus");
    await cp(fixture, corpus, { recursive: true });
    const before = await digest(join(corpus, "known-answer.json"));

    await expect(importPinnedCoreCorpus(corpus, corpus)).rejects.toThrow(/disjoint/u);
    await expect(importPinnedCoreCorpus(corpus, join(corpus, "nested"))).rejects.toThrow(/disjoint/u);
    expect(await digest(join(corpus, "known-answer.json"))).toBe(before);

    const outerDestination = join(root, "outer-destination");
    const nestedSource = join(outerDestination, "source");
    await cp(fixture, nestedSource, { recursive: true });
    const nestedBefore = await digest(join(nestedSource, "known-answer.json"));
    await expect(importPinnedCoreCorpus(nestedSource, outerDestination)).rejects.toThrow(/disjoint/u);
    expect(await digest(join(nestedSource, "known-answer.json"))).toBe(nestedBefore);
  });

  test("uses deterministic UTF-8 byte ordering", () => {
    const paths = ["\u{10000}.json", "\uE000.json", "a.json"];
    expect(paths.sort(compareUtf8Paths)).toEqual(["a.json", "\uE000.json", "\u{10000}.json"]);
  });
});
