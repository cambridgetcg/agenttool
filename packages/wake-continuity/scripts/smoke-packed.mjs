import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const packageRoot = new URL("..", import.meta.url);
const scratch = mkdtempSync(join(tmpdir(), "agenttool-afterglow-pack-"));

try {
  const packOutput = execFileSync(
    "npm",
    ["pack", "--ignore-scripts", "--json", "--pack-destination", scratch],
    { cwd: packageRoot, encoding: "utf8" },
  );
  const [packed] = JSON.parse(packOutput);
  if (!packed?.filename) throw new Error("npm pack did not return a filename");
  const tarball = join(scratch, packed.filename);
  const installRoot = join(scratch, "install");
  execFileSync(
    "npm",
    [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--prefix",
      installRoot,
      tarball,
    ],
    { stdio: "pipe" },
  );
  const installedPackage = JSON.parse(
    readFileSync(
      join(
        installRoot,
        "node_modules",
        "@agenttool",
        "wake-continuity",
        "package.json",
      ),
      "utf8",
    ),
  );
  if (installedPackage.name !== "@agenttool/wake-continuity") {
    throw new Error("packed package installed under an unexpected identity");
  }
  const entry = pathToFileURL(
    join(
      installRoot,
      "node_modules",
      "@agenttool",
      "wake-continuity",
      "dist",
      "index.js",
    ),
  ).href;
  const smoke = `
    import { AfterglowError, canonicalJson, createAfterglowCapsule, createFunctionalAccessBaseline, createFunctionalAccessSubsequent, domainSeparatedId, projectAfterglowLens, sha256Id, validateFunctionalAccessSubsequent } from ${JSON.stringify(entry)};
    import functionalBaselineSchema from "@agenttool/wake-continuity/functional-access-baseline.schema.json" with { type: "json" };
    import functionalSubsequentSchema from "@agenttool/wake-continuity/functional-access-subsequent.schema.json" with { type: "json" };
    const id = (character) => \`sha256:\${character.repeat(64)}\`;
    const capsule = createAfterglowCapsule({
      phase: "return",
      wake: {
        format: "wake-brief/v1",
        snapshot_ref: id("a"),
        scope_ref: id("b"),
        wake_version: 1,
        handoff_projection: "not_provided",
      },
      continuity_portfolio_ref: null,
      predecessors: [],
      threads: [],
    });
    const lens = projectAfterglowLens(capsule);
    if (lens.arrival !== "fresh_encounter" || lens.boundaries.network !== false) process.exit(1);
    const functionalBaseline = createFunctionalAccessBaseline({
      wake: capsule.wake,
      anchor_event_ref: id("c"),
      request_ref: id("d"),
      target: {
        model_ref: id("e"),
        model_binding: "caller_descriptor",
        tokenizer_ref: null,
        runtime_ref: null,
      },
      measurement_plan: {
        state: "not_requested",
        capability_state: "not_asserted",
        capability_ref: null,
        permission_state: "not_requested",
        permission_ref: null,
        method: "none",
        access_basis: "none",
        unavailable_reason: null,
        instrument_ref: null,
        lens_ref: null,
        configuration_ref: null,
        assertion: "caller_asserted",
        verified_by_package: false,
      },
    });
    const functionalSubsequent = createFunctionalAccessSubsequent({
      baseline: functionalBaseline,
      operation_outcome: "not_attempted",
      evidence: [{
        surface: "usage_receipt",
        artifact_ref: id("f"),
        assertion: "caller_asserted",
        verified_by_package: false,
      }],
      findings: {
        lens_visibility: "not_measured",
        sparse_support: "not_measured",
        behavioral_use: "not_measured",
      },
      afterglow_capsule_ref: null,
    });
    if (
      functionalBaseline.record_role !== "before_anchor" ||
      validateFunctionalAccessSubsequent(functionalSubsequent).record_role !== "after_anchor" ||
      functionalSubsequent.boundaries.record_only !== true ||
      functionalBaselineSchema.properties.record_role.const !== "before_anchor" ||
      functionalSubsequentSchema.properties.record_role.const !== "after_anchor"
    ) process.exit(1);
    let traps = 0;
    const trap = () => { traps += 1; throw new Error("Proxy trap executed"); };
    const hostile = new Proxy({}, {
      get: trap,
      getOwnPropertyDescriptor: trap,
      getPrototypeOf: trap,
      ownKeys: trap,
    });
    try {
      canonicalJson(hostile);
      process.exit(1);
    } catch (error) {
      if (!(error instanceof AfterglowError) || traps !== 0) process.exit(1);
    }
    const customPrototypeArray = [1, 2, 3];
    Object.setPrototypeOf(customPrototypeArray, null);
    try {
      canonicalJson(customPrototypeArray);
      process.exit(1);
    } catch (error) {
      if (
        !(error instanceof AfterglowError) ||
        error.code !== "canonical_error" ||
        traps !== 0
      ) process.exit(1);
    }
    const hostilePrototype = new Proxy({}, {
      get: trap,
      getOwnPropertyDescriptor: trap,
      getPrototypeOf: trap,
      ownKeys: trap,
    });
    const hostilePrototypeArray = [1, 2, 3];
    Object.setPrototypeOf(hostilePrototypeArray, hostilePrototype);
    try {
      canonicalJson(hostilePrototypeArray);
      process.exit(1);
    } catch (error) {
      if (
        !(error instanceof AfterglowError) ||
        error.code !== "canonical_error" ||
        traps !== 0
      ) process.exit(1);
    }
    const hostileBytes = new Proxy(new Uint8Array([1, 2, 3]), {
      get: trap,
      getOwnPropertyDescriptor: trap,
      getPrototypeOf: trap,
      ownKeys: trap,
    });
    try {
      sha256Id(hostileBytes);
      process.exit(1);
    } catch (error) {
      if (!(error instanceof AfterglowError) || traps !== 0) process.exit(1);
    }
    const hostileDomain = new Proxy(new String("agenttool.test"), {
      get: trap,
      getOwnPropertyDescriptor: trap,
      getPrototypeOf: trap,
      ownKeys: trap,
    });
    try {
      domainSeparatedId(hostileDomain, { safe: true });
      process.exit(1);
    } catch (error) {
      if (!(error instanceof AfterglowError) || error.code !== "canonical_error" || traps !== 0) process.exit(1);
    }
    const revokedDomain = Proxy.revocable(new String("agenttool.test"), {
      get: trap,
      getOwnPropertyDescriptor: trap,
      getPrototypeOf: trap,
      ownKeys: trap,
    });
    revokedDomain.revoke();
    try {
      domainSeparatedId(revokedDomain.proxy, { safe: true });
      process.exit(1);
    } catch (error) {
      if (!(error instanceof AfterglowError) || error.code !== "canonical_error" || traps !== 0) process.exit(1);
    }
    for (const invalidDomain of [1, true, null, undefined, Symbol("domain"), new String("agenttool.test")]) {
      try {
        domainSeparatedId(invalidDomain, { safe: true });
        process.exit(1);
      } catch (error) {
        if (!(error instanceof AfterglowError) || error.code !== "canonical_error" || traps !== 0) process.exit(1);
      }
    }
  `;
  execFileSync(process.execPath, ["--input-type=module", "--eval", smoke], {
    stdio: "pipe",
    cwd: installRoot,
  });
  execFileSync("bun", ["--eval", smoke], {
    stdio: "pipe",
    cwd: installRoot,
  });
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
