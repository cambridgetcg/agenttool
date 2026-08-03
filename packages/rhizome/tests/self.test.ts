/** The self probe: rhizome refusing to exempt itself. */

import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PROBE_DIRECTORY_RELATIVE } from "../src/constants.js";
import { makeSelfProbe, PROBE_EXTENSIONS } from "../src/probes/self.js";
import { runProbes } from "../src/run.js";
import { allProbes, probeById, probeIds } from "../src/registry.js";
import { resolveScope } from "../src/scope.js";
import type { Probe, Scope } from "../src/types.js";
import { fixtureScope } from "./fixture-scope.js";

const stub = (id: string): Probe => ({
  id,
  title: id,
  question: "?",
  limits: [{ statement: "s", why: "w", file: `${PROBE_DIRECTORY_RELATIVE}/${id}.ts`, line: 1 }],
  run: () => [],
});

test("a probe file on disk that is not registered is reported as a gap", async () => {
  const probe = makeSelfProbe(() => [stub("edge")]);
  const findings = await probe.run(
    fixtureScope({
      [`${PROBE_DIRECTORY_RELATIVE}/edge.ts`]: "",
      [`${PROBE_DIRECTORY_RELATIVE}/mycelium.ts`]: "",
    }),
  );
  const finding = findings.find((item) => item.title.includes("mycelium.ts"));
  expect(finding?.verdict).toBe("gap");
  expect(finding?.evidence).toContain("registry: edge");
  expect(finding?.evidence).toContain("mycelium.ts");
});

test("a probe declaring no limits is reported as a gap against itself", async () => {
  const bare: Probe = { id: "bare", title: "bare", question: "?", limits: [], run: () => [] };
  const probe = makeSelfProbe(() => [bare]);
  const findings = await probe.run(fixtureScope({ [`${PROBE_DIRECTORY_RELATIVE}/bare.ts`]: "" }));
  expect(findings.find((item) => item.title.includes("declares no limits"))?.verdict).toBe("gap");
});

test("declared limits become limit findings so the boundary is in the output", async () => {
  const probe = makeSelfProbe(() => [stub("edge")]);
  const findings = await probe.run(fixtureScope({ [`${PROBE_DIRECTORY_RELATIVE}/edge.ts`]: "" }));
  const limit = findings.find((item) => item.verdict === "limit" && item.title.startsWith("edge cannot see"));
  expect(limit?.file).toBe(`${PROBE_DIRECTORY_RELATIVE}/edge.ts`);
  expect(limit?.evidence).toBe("w");
});

test("a limit anchored at a file the corpus does not hold is a gap", async () => {
  const probe = makeSelfProbe(() => [
    { id: "edge", title: "edge", question: "?", limits: [{ statement: "s", why: "w", file: "gone.ts", line: 1 }], run: () => [] },
  ]);
  const findings = await probe.run(fixtureScope({ [`${PROBE_DIRECTORY_RELATIVE}/edge.ts`]: "" }));
  expect(findings.find((item) => item.title.includes("not in the corpus"))?.verdict).toBe("gap");
});

test("a limit anchored past the end of its file is a gap", async () => {
  const probe = makeSelfProbe(() => [
    {
      id: "edge",
      title: "edge",
      question: "?",
      limits: [{ statement: "s", why: "w", file: `${PROBE_DIRECTORY_RELATIVE}/edge.ts`, line: 900 }],
      run: () => [],
    },
  ]);
  const findings = await probe.run(fixtureScope({ [`${PROBE_DIRECTORY_RELATIVE}/edge.ts`]: "one\ntwo" }));
  expect(findings.find((item) => item.title.includes("past the end"))?.verdict).toBe("gap");
});

test("a probes directory missing from the corpus is a stated limit, not silence", async () => {
  const probe = makeSelfProbe(() => [stub("edge")]);
  const findings = await probe.run(fixtureScope({ "unrelated.ts": "" }));
  const finding = findings.find((item) => item.title.includes("probes directory was not visible"));
  expect(finding?.verdict).toBe("limit");
  expect(finding?.detail).toContain("rhizome is exempt from itself");
});

test("live repository: every registered probe has a file and every file is registered", async () => {
  const scope = resolveScope();
  const findings = await allProbes()
    .find((probe) => probe.id === "self")!
    .run(scope);
  expect(findings.filter((finding) => finding.verdict === "gap")).toEqual([]);
  for (const id of probeIds()) {
    expect(scope.files).toContain(`${PROBE_DIRECTORY_RELATIVE}/${id}.ts`);
  }
});

test("the registry exposes each probe exactly once, by id", () => {
  const ids = probeIds();
  expect(new Set(ids).size).toBe(ids.length);
  for (const id of ids) expect(probeById(id)?.id).toBe(id);
  expect(probeById("no-such-probe")).toBeUndefined();
});

test("the unread set is forced, so asking self alone does not answer 'nowhere'", async () => {
  // The bug this replaced: `Scope.unread` fills in as files are read, so
  // `rhizome --probe self` — the one command a reader uses to ask "where
  // can rhizome not see?" — reported no unread files at all, because
  // nothing had looked. Zero read as "rhizome sees everything".
  let readAllCalled = 0;
  const base = fixtureScope({
    [`${PROBE_DIRECTORY_RELATIVE}/edge.ts`]: "",
    "assets/blob.bin": "",
  });
  const lazy: Scope = {
    ...base,
    get unread(): readonly string[] {
      return readAllCalled === 0 ? [] : ["assets/blob.bin"];
    },
    readAll(): void {
      readAllCalled += 1;
    },
  };

  const findings = await makeSelfProbe(() => [stub("edge")]).run(lazy);
  expect(readAllCalled).toBeGreaterThan(0);
  const unread = findings.find((item) => item.title.includes("were not read"));
  expect(unread?.verdict).toBe("limit");
  expect(unread?.evidence).toContain("assets/blob.bin");
});

test("a corpus with nothing unread says so, rather than saying nothing", async () => {
  const findings = await makeSelfProbe(() => [stub("edge")]).run(
    fixtureScope({ [`${PROBE_DIRECTORY_RELATIVE}/edge.ts`]: "" }),
  );
  const sound = findings.find((item) => item.title.includes("was readable"));
  expect(sound?.verdict).toBe("sound");
  expect(sound?.evidence).toContain("0 unread");
});

test("a probes-directory child this check cannot read as a probe is published, not dropped", async () => {
  const findings = await makeSelfProbe(() => [stub("edge")]).run(
    fixtureScope({
      [`${PROBE_DIRECTORY_RELATIVE}/edge.ts`]: "",
      [`${PROBE_DIRECTORY_RELATIVE}/mycelium.py`]: "",
      [`${PROBE_DIRECTORY_RELATIVE}/notes.md`]: "",
    }),
  );
  const finding = findings.find((item) => item.title.includes("not read as probes"));
  expect(finding?.verdict).toBe("limit");
  expect(finding?.evidence).toContain("mycelium.py");
  expect(finding?.evidence).toContain("notes.md");
  expect(finding?.evidence).toContain(PROBE_EXTENSIONS.join(", "));
  // …and the extension boundary is declared, not merely visible in output.
  expect(makeSelfProbe(() => []).limits.some((limit) => limit.statement.includes("PROBE_EXTENSIONS"))).toBe(true);
});

test("live: --probe self alone finds the unread files a full run finds", async () => {
  // Against a real repository, because the defect only existed in the real
  // one: a fixture's unread set is whatever the fixture says. Two probe
  // selections over the same tree must agree about what rhizome cannot
  // read, and before `readAll` the self-only run reported none.
  const root = await mkdtemp(join(tmpdir(), "agenttool-rhizome-self-"));
  try {
    spawnSync("git", ["init", "-q"], { cwd: root });
    await writeFile(join(root, "readable.ts"), "export const readable = 1;\n");
    await writeFile(join(root, "opaque.bin"), Buffer.from([0x01, 0x00, 0x02]));

    const alone = await runProbes({ root, probes: ["self"] });
    const full = await runProbes({ root });
    expect(alone.scope.unreadCount).toBe(1);
    expect(alone.scope.unreadCount).toBe(full.scope.unreadCount);

    const finding = alone.findings.find((item) => item.probe === "self" && item.title.includes("were not read"));
    expect(finding?.verdict).toBe("limit");
    expect(finding?.evidence).toContain("opaque.bin");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
