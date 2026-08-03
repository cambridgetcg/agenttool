/** The self probe: rhizome refusing to exempt itself. */

import { expect, test } from "bun:test";

import { PROBE_DIRECTORY_RELATIVE } from "../src/constants.js";
import { makeSelfProbe } from "../src/probes/self.js";
import { allProbes, probeById, probeIds } from "../src/registry.js";
import { resolveScope } from "../src/scope.js";
import type { Probe } from "../src/types.js";
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
