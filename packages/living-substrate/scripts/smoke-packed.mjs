import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const packageRoot = new URL("..", import.meta.url);
const scratch = mkdtempSync(join(tmpdir(), "agenttool-living-substrate-pack-"));

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
      "--offline",
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
        "living-substrate",
        "package.json",
      ),
      "utf8",
    ),
  );
  if (installedPackage.name !== "@agenttool/living-substrate") {
    throw new Error("packed package installed under an unexpected identity");
  }
  const smoke = `
    import {
      LivingSubstrateError,
      createLivingSubstrateMap,
      createRegenerationProposal,
      sha256Id,
      validateRegenerationProposalAgainstMap,
    } from "@agenttool/living-substrate";
    const mapSchema = import.meta.resolve(
      "@agenttool/living-substrate/map.schema.json",
    );
    const proposalSchema = import.meta.resolve(
      "@agenttool/living-substrate/proposal.schema.json",
    );
    const facetRef = sha256Id("packed-facet");
    const map = createLivingSubstrateMap({
      scope_ref: sha256Id("packed-scope"),
      facets: [{
        facet_id: facetRef,
        kind: "refugium",
        condition: "reported_present",
        evidence_refs: [],
        assertion: "caller_asserted",
        verified_by_package: false,
      }],
      relations: [],
    });
    const proposal = createRegenerationProposal(map, { actions: [{
      action_ref: sha256Id("packed-action"),
      kind: "allow_fallow",
      target_refs: [facetRef],
      basis_refs: [],
      reversibility: "reversible",
      state: "proposed_unaccepted",
      authority: "separate_authority_required",
      assertion: "caller_asserted",
      verified_by_package: false,
    }]});
    if (
      validateRegenerationProposalAgainstMap(proposal, map).proposal_id !== proposal.proposal_id ||
      proposal.choice.rest_valid !== true ||
      proposal.choice.penalty !== false ||
      map.boundaries.network !== false ||
      !mapSchema.endsWith("/schema/agenttool-living-substrate-map-v0.1.schema.json") ||
      !proposalSchema.endsWith("/schema/agenttool-regeneration-proposal-v0.1.schema.json")
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
      createLivingSubstrateMap(hostile);
      process.exit(1);
    } catch (error) {
      if (!(error instanceof LivingSubstrateError) || traps !== 0) process.exit(1);
    }
  `;
  execFileSync(process.execPath, ["--input-type=module", "--eval", smoke], {
    cwd: installRoot,
    stdio: "pipe",
  });
  execFileSync("bun", ["--eval", smoke], {
    cwd: installRoot,
    stdio: "pipe",
  });
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
