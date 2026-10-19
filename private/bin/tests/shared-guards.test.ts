/**
 * The shared, public tools: tools/public-guard.ts's shape-only token rules,
 * tree-mode history checks, and watch mode, and tools/workflow-lint.ts. They
 * hold no literal private value (critic MUST 1), which the last test checks
 * with the real private terms loaded in code.
 */
import { afterAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkCommittedTree, contentFindings, isPublicAddress, parseWatchAck, SECRET_RULES, sharedTreeRefusal, watchFindings, watchRefKey } from "../../../tools/public-guard.ts";
import { lintWorkflow, repositoryGuarded } from "../../../tools/workflow-lint.ts";
import { PRIVATE_REPOSITORY, PUBLIC_REPOSITORY } from "../../public-repository.ts";
import { gitBlobId, loadPrivateGuard, scanFiles } from "../relational-scan.ts";
import { git, publicCommit, ROOT, run, scratchDir, write } from "./fixtures.ts";

setDefaultTimeout(60_000);
const scratch = scratchDir("shared-guards");
afterAll(scratch.cleanup);
const ruleIds = (text: string) => [...new Set(contentFindings([{ path: "x.ts", bytes: Buffer.from(text) }], SECRET_RULES).map((finding) => finding.rule))];
const random = (length: number) => {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let out = "";
  for (let index = 0; index < length; index += 1) out += alphabet[(index * 37 + 11) % alphabet.length];
  return out;
};

describe("shape-only token rules", () => {
  test("AgentTool bearer, mission, local-context, and runtime-control tokens are found", () => {
    for (const token of [`at_${random(43)}`, `atcm_${random(43)}`, `atlc_${random(43)}`, `at_rt_${random(43)}`]) {
      expect(ruleIds(`const t = "${token}";`), token.slice(0, 6)).toEqual(["secret/agenttool-token"]);
    }
  });

  test("names, placeholders, and documented fixtures are not tokens", () => {
    for (const text of [
      "const at_rest_encryption_key_rotation_policy_for_long_names = 1;",
      `at_${"x".repeat(43)}`,
      "Bearer at_FAKEFAKE0000fakefake0000FAKEFAKE0000fakefak",
      "at_liveSECRETVALUE0123456789abcdefABCDEFghijk",
      "hf_training_garden_tending_schema_v0_1_for_all",
      "postgres://agenttool:agenttool@localhost:5432/agenttool",
    ]) expect(ruleIds(text), text.slice(0, 20)).toEqual([]);
  });

  test("published provider formats are found", () => {
    expect(ruleIds(`hf_${random(34).replace(/[-_]/gu, "Q")}`)).toEqual(["secret/huggingface-token"]);
    expect(ruleIds(`sk-ant-api03-${random(40)}`)).toEqual(["secret/anthropic-key"]);
    expect(ruleIds(`sk-proj-${random(40)}`)).toEqual(["secret/openai-key"]);
    expect(ruleIds(`FlyV1 fm2_${random(60)}`)).toEqual(["secret/fly-token"]);
    expect(ruleIds(`postgres://svc:${"Pq7".repeat(7)}@db.internal:5432/app`)).toEqual(["secret/url-password"]);
  });
});

describe("tree-mode history checks and watch mode", () => {
  let count = 0;
  function sharedRepo(canaryBytes = "canary bytes that stay private\n"): { repo: string; canaryId: string } {
    count += 1;
    const repo = join(scratch.dir, `shared-${count}`);
    git(scratch.dir, "init", "-q", "--initial-branch=main", repo);
    const canaryId = gitBlobId(Buffer.from(canaryBytes));
    write(repo, "README.md", "# Shared\n");
    write(repo, "tools/leak-canaries.txt", `# canaries\n${canaryId}\n`);
    publicCommit(repo, "root");
    return { repo, canaryId };
  }
  const treeRules = (repo: string) => [...new Set(checkCommittedTree({ cwd: repo, rev: "HEAD", tree: true }).map((finding) => finding.rule))].sort();

  test("a canary object anywhere in the history is found, even after it was deleted", () => {
    const { repo } = sharedRepo();
    write(repo, "docs/c.bin", "canary bytes that stay private\n");
    publicCommit(repo, "copy");
    git(repo, "rm", "-q", "docs/c.bin");
    publicCommit(repo, "remove");
    expect(treeRules(repo)).toEqual(["integrity/leak-canary"]);
  });

  test("a private-only path added and later removed is still found; a missing canary list is a finding", () => {
    const { repo } = sharedRepo();
    write(repo, "private/n.md", "x\n");
    write(repo, ".github/workflows/private-ci.yml", "name: x\n");
    publicCommit(repo, "leak");
    git(repo, "rm", "-q", "-r", "private", ".github/workflows/private-ci.yml");
    publicCommit(repo, "hide");
    expect(treeRules(repo)).toEqual(["path/history-private-namespace", "path/history-private-workflow"]);
    git(repo, "rm", "-q", "tools/leak-canaries.txt");
    publicCommit(repo, "drop the list");
    expect(treeRules(repo)).toContain("integrity/missing-canaries");
  });

  test("tools/public-root.txt pins the single root", () => {
    const { repo } = sharedRepo();
    const root = git(repo, "rev-parse", "HEAD");
    write(repo, "tools/public-root.txt", `${root}\n`);
    publicCommit(repo, "pin the root");
    expect(treeRules(repo)).toEqual([]);
    write(repo, "tools/public-root.txt", `${"a".repeat(40)}\n`);
    publicCommit(repo, "wrong root");
    expect(treeRules(repo)).toEqual(["integrity/public-root"]);
  });

  test("watch mode checks every ref: a pull request head with another root or a canary is found", () => {
    const { repo } = sharedRepo();
    expect(watchFindings(repo)).toEqual([]);
    git(repo, "switch", "-q", "--orphan", "foreign");
    write(repo, "x.md", "x\n");
    const foreign = publicCommit(repo, "foreign");
    git(repo, "switch", "-q", "-f", "main");
    git(repo, "update-ref", "refs/remotes/pull/3", foreign);
    git(repo, "branch", "-q", "-D", "foreign");
    expect(watchFindings(repo).map((finding) => `${finding.path} ${finding.rule}`)).toEqual(expect.arrayContaining(["(all refs) integrity/root-count"]));
    git(repo, "update-ref", "-d", "refs/remotes/pull/3");
    git(repo, "switch", "-q", "-c", "side");
    write(repo, "c.bin", "canary bytes that stay private\n");
    const side = publicCommit(repo, "canary");
    git(repo, "switch", "-q", "main");
    git(repo, "update-ref", "refs/remotes/pull/4", side);
    git(repo, "branch", "-q", "-D", "side");
    expect(watchFindings(repo).map((finding) => finding.rule)).toEqual(["integrity/leak-canary"]);
    const cli = run(repo, process.execPath, [join(ROOT, "tools/public-guard.ts"), "--watch"]);
    expect(cli.status).toBe(1);
    expect(run(repo, process.execPath, [join(ROOT, "tools/public-guard.ts"), "--watch", "--tree"]).status).toBe(2);
  });

  test("private paths are refused in any case and NFKC form, as a case-insensitive file system sees them; so is the retired public/private-guard", () => {
    for (const path of ["private/x", "Private/guard/relational-denylist.json", "PRIVATE/x", "\uff50rivate/x", ".github/workflows/Private-ci.yml", ".GitHub/workflows/PRIVATE-x.yml", "projection.json", "public/private-guard/relational-denylist.json", "Public/Private-Guard/x"]) {
      expect(sharedTreeRefusal(path), path).toBeDefined();
    }
    for (const path of ["privateer/x", "docs/private.md", "packages/private-notes/x", "public/index.html"]) expect(sharedTreeRefusal(path), path).toBeUndefined();
    const { repo } = sharedRepo();
    write(repo, "Private/guard/relational-denylist.json", "{}\n");
    publicCommit(repo, "a case variant of the private namespace");
    expect(treeRules(repo)).toEqual(["path/history-private-namespace", "path/private-namespace"]);
  });

  test("watch mode skips a ref acknowledged at its current commit, rechecks it when it moves, and checks annotated taggers", () => {
    const { repo } = sharedRepo();
    git(repo, "switch", "-q", "--orphan", "foreign");
    write(repo, "x.md", "x\n");
    const foreign = publicCommit(repo, "foreign");
    git(repo, "switch", "-q", "-f", "main");
    git(repo, "update-ref", "refs/remotes/pull/3", foreign);
    git(repo, "branch", "-q", "-D", "foreign");
    expect(watchFindings(repo).length).toBeGreaterThan(0);
    expect(watchFindings(repo, "HEAD", { ack: new Map([["pull/3", foreign]]) })).toEqual([]);
    write(repo, "tools/public-watch-ack.txt", `# handled\npull/3 ${foreign} # closed fork pull request\n`);
    publicCommit(repo, "acknowledge");
    expect(watchFindings(repo)).toEqual([]);
    // An explicit list (the private scan's) replaces the tree's.
    expect(watchFindings(repo, "HEAD", { ack: new Map() }).length).toBeGreaterThan(0);
    expect(watchFindings(repo, "HEAD", { ack: new Map([["pull/3", "f".repeat(40)]]) }).length).toBeGreaterThan(0);
    git(repo, "update-ref", "-d", "refs/remotes/pull/3");
    expect(() => parseWatchAck(Buffer.from("pull/3 nothex\n"))).toThrow("full commit id");
    expect(watchRefKey("refs/remotes/pull/12")).toBe("pull/12");
    expect(watchRefKey("refs/remotes/origin/topic/x")).toBe("heads/topic/x");
    expect(watchRefKey("refs/public-scan/tags/v1")).toBe("tags/v1");
    // Annotated tags must carry a public tagger address.
    run(repo, "git", ["tag", "-a", "v1", "-m", "release"], { env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_COMMITTER_NAME: "AgentTool", GIT_COMMITTER_EMAIL: "contact@cambridgetcg.com" } });
    expect(watchFindings(repo)).toEqual([]);
    run(repo, "git", ["tag", "-a", "v2", "-m", "release"], { env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_COMMITTER_NAME: "Ally", GIT_COMMITTER_EMAIL: ["ally", "privatemail.net"].join("@") } });
    expect(watchFindings(repo).map((finding) => `${finding.path} ${finding.rule}`)).toEqual(["refs/tags/v2 personal/tagger-address"]);
    expect(isPublicAddress("1+someone@users.noreply.github.com") && isPublicAddress("noreply@github.com") && isPublicAddress("contact@cambridgetcg.com")).toBe(true);
    expect(isPublicAddress("someone@github.com") || isPublicAddress("a@b@users.noreply.github.com")).toBe(false);
  });
});

describe("the workflow lint", () => {
  const ok = (extra = "") => `name: x\non:\n  pull_request:\npermissions:\n  contents: read\njobs:\n  a:\n    if: github.repository == 'example/shared'\n    runs-on: ubuntu-24.04\n    steps:\n      - uses: actions/checkout@${"a".repeat(40)}\n${extra}`;

  test("a guarded, read-only, pinned workflow is clean", () => {
    expect(lintWorkflow("ci.yml", ok(), "example/shared")).toEqual([]);
  });

  test("refuses private-* files, unguarded jobs, secrets, environments, writes, deploys, unpinned actions, and fork-privileged triggers", () => {
    const problems = (file: string, source: string) => lintWorkflow(file, source, "example/shared").join("\n");
    expect(problems("private-ci.yml", ok())).toContain("belongs to the private repository only");
    expect(problems("ci.yml", ok().replace("if: github.repository == 'example/shared'", "if: always()"))).toContain("does not start with if: github.repository");
    expect(problems("ci.yml", ok().replace("example/shared'", "example/shared' || true"))).toContain("does not start with if");
    expect(problems("ci.yml", ok("      - run: echo ${{ secrets.FLY_API_TOKEN }}\n"))).toContain("reads secret FLY_API_TOKEN");
    expect(problems("ci.yml", ok("      - run: echo ${{ secrets.GITHUB_TOKEN }}\n"))).not.toContain("reads secret");
    expect(problems("ci.yml", ok("      - run: echo '${{ toJSON(secrets) }}'\n"))).toContain("reads the secrets context");
    expect(problems("ci.yml", ok("      - run: echo ${{ secrets['NPM_TOKEN'] }}\n"))).toContain("reads secret NPM_TOKEN");
    expect(problems("ci.yml", ok("      - run: echo ${{ format('{0}', secrets) }}\n"))).toContain("reads the secrets context");
    expect(problems("ci.yml", ok().replace("    runs-on:", "    secrets: inherit\n    runs-on:"))).toContain("secrets: inherit");
    expect(problems("ci.yml", ok("      - name: Check that no secrets are used\n        run: echo none\n"))).not.toContain("secret");
    expect(problems("ci.yml", ok().replace("    runs-on:", "    environment: production\n    runs-on:"))).toContain("deployment environment");
    expect(problems("ci.yml", ok().replace("  contents: read", "  contents: write"))).toContain("write permission at the top level");
    expect(problems("ci.yml", ok().replace("  contents: read", "  id-token: write"))).toContain("write permission");
    expect(problems("ci.yml", ok("      - run: flyctl deploy --remote-only\n"))).toContain("Fly.io");
    expect(problems("ci.yml", ok("      - uses: superfly/flyctl-actions/setup-flyctl@master\n"))).toContain("not pinned by commit");
    expect(problems("ci.yml", ok().replace("pull_request:", "pull_request_target:"))).toContain("runs on pull_request_target");
    expect(problems("ci.yml", ok().replace("permissions:\n  contents: read\n", ""))).toContain("declares no top-level permissions");
  });

  test("the shared workflows are clean for the public name, and every private-only workflow fails it", () => {
    for (const file of ["ci.yml", "public-watch.yml"]) {
      expect(lintWorkflow(file, readFileSync(join(ROOT, ".github/workflows", file), "utf8"), PUBLIC_REPOSITORY), file).toEqual([]);
    }
    for (const file of ["deploy-api.yml", "private-ci.yml", "publish-pypi.yml"]) {
      expect(lintWorkflow(file, readFileSync(join(ROOT, ".github/workflows", file), "utf8"), PUBLIC_REPOSITORY).length, file).toBeGreaterThan(0);
    }
    expect(repositoryGuarded(`github.repository == '${PRIVATE_REPOSITORY}' && 'unterminated`, PRIVATE_REPOSITORY)).toBe(false);
  });
});

test("the shared tools spell out no private literal: the real terms find nothing in them", () => {
  const real = loadPrivateGuard(join(ROOT, "private/guard"));
  const shared = ["tools/public-guard.ts", "tools/workflow-lint.ts", "tools/githooks/pre-push", "tools/leak-canaries.txt", ".github/workflows/public-watch.yml", ".github/workflows/ci.yml"];
  const files = shared.map((path) => {
    const bytes = readFileSync(join(ROOT, path));
    return { path, mode: "100644", oid: gitBlobId(bytes), bytes };
  });
  expect(scanFiles(files, real).findings.map((finding) => `${finding.path} ${finding.rule}`)).toEqual([]);
});
