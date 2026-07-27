import { expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020.js";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import packageJson from "../package.json";
import schema from "../schema/agenttool-skills-inspection-v0.1.schema.json";
import { inspectLocalSkills } from "../src/index.js";

const SKILLS_RELEASE_SHA256 =
  "6fc378a4edaa10760095fe8c4655c42798741fa2f5f985a16627368726ceb391";
const SKILLS_RELEASE_URL =
  "https://github.com/cambridgetcg/agenttool/releases/download/skills-v0.2.1/agenttool-skills-0.2.1.tgz";

const NEN_SKILL_NAMES = [
  "nen-concealed-trace",
  "nen-contract-mantle",
  "nen-critical-path-forge",
  "nen-dependency-perimeter",
  "nen-godspeed-loop",
  "nen-smoke-squad",
  "nen-verification-ledger",
  "nen-vow-forge",
] as const;

const EXPLICIT_SKILL_NAMES = [
  "capability-conductor",
  "learn-by-contact",
  ...NEN_SKILL_NAMES,
  "use-agentcred-safely",
] as const;

function documentedInstallRecipe(readme: string): string {
  const match = readme.match(
    /Pin and verify\s+the exact artifact before installation:\n\n```sh\n([\s\S]*?)\n```/,
  );
  if (match?.[1] === undefined) {
    throw new Error("Skills README exact-artifact install recipe is missing");
  }
  return match[1];
}

async function writeExecutable(path: string, source: string): Promise<void> {
  await writeFile(path, source, "utf8");
  await chmod(path, 0o700);
}

interface InstallRecipeRun {
  exitCode: number;
  stderr: string;
  trace: string[];
}

async function runDocumentedInstallRecipe(options: {
  download?: "success" | "failure";
  verifier?: "sha256sum" | "shasum" | "none";
  actualSha256?: string;
  install?: "success" | "failure";
} = {}): Promise<InstallRecipeRun> {
  const packageRoot = join(import.meta.dir, "..");
  const readme = await readFile(join(packageRoot, "README.md"), "utf8");
  const recipe = documentedInstallRecipe(readme);
  const root = await mkdtemp(join(tmpdir(), "agenttool-skills-install-recipe-"));

  try {
    const fakeBin = join(root, "bin");
    const tracePath = join(root, "trace.log");
    await mkdir(fakeBin, { mode: 0o700 });
    await writeFile(tracePath, "", "utf8");

    await writeExecutable(join(fakeBin, "curl"), `#!/bin/sh
printf 'curl %s\\n' "$*" >> "$TRACE_FILE"
if [ "$DOWNLOAD_RESULT" = "failure" ]; then
  exit 22
fi
output=
while [ "$#" -gt 0 ]; do
  case "$1" in
    --output)
      shift
      output=$1
      ;;
  esac
  shift
done
[ -n "$output" ] || exit 64
printf '%s\\n' 'hermetic archive fixture' > "$output"
`);

    const verifier = options.verifier ?? "sha256sum";
    if (verifier !== "none") {
      await writeExecutable(join(fakeBin, verifier), `#!/bin/sh
printf '${verifier} %s\\n' "$*" >> "$TRACE_FILE"
for checksum_file in "$@"; do
  :
done
printf '%s  %s\\n' "$FAKE_SHA256" "$checksum_file"
`);
    }

    await writeExecutable(join(fakeBin, "npm"), `#!/bin/sh
printf 'npm %s\\n' "$*" >> "$TRACE_FILE"
[ "$INSTALL_RESULT" = "success" ]
`);
    await writeExecutable(join(fakeBin, "npx"), `#!/bin/sh
printf 'npx %s\\n' "$*" >> "$TRACE_FILE"
`);

    const child = Bun.spawn(["/bin/sh", "-c", recipe], {
      cwd: root,
      env: {
        PATH: fakeBin,
        TRACE_FILE: tracePath,
        DOWNLOAD_RESULT: options.download ?? "success",
        FAKE_SHA256: options.actualSha256 ?? SKILLS_RELEASE_SHA256,
        INSTALL_RESULT: options.install ?? "success",
        LANG: "C",
        LC_ALL: "C",
      },
      stdin: "ignore",
      stdout: "ignore",
      stderr: "pipe",
    });
    const [exitCode, stderr] = await Promise.all([
      child.exited,
      new Response(child.stderr).text(),
    ]);
    const trace = (await readFile(tracePath, "utf8"))
      .split("\n")
      .filter((line) => line.length > 0);
    return { exitCode, stderr, trace };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("publishes only the runtime, schema, bundled skills, and legal documentation", () => {
  expect(packageJson.name).toBe("@agenttool/skills");
  expect(packageJson.version).toBe("0.2.1");
  expect(packageJson.files).toEqual([
    "dist",
    "schema",
    "skills",
    "README.md",
    "LICENSE",
    "NOTICE",
  ]);
  expect(packageJson.files).not.toContain("tests");
  expect(packageJson.files).not.toContain("src");
  expect(packageJson.bin).toEqual({ "agenttool-skill": "dist/bin.js" });
  expect(packageJson.exports["./report.schema.json"].default).toBe(
    "./schema/agenttool-skills-inspection-v0.1.schema.json",
  );
  expect(schema.$id).toBe("urn:agenttool:skills:inspection:v0.1");
});

test("generated valid and finding reports conform to the bundled closed schema", async () => {
  const validate = new Ajv2020({ strict: true }).compile(schema);
  const validReport = await inspectLocalSkills(join(import.meta.dir, "..", "..", "collab"));
  expect(validate(validReport)).toBe(true);
  const findingReport = await inspectLocalSkills(join(import.meta.dir, "definitely-absent"));
  expect(validate(findingReport)).toBe(true);
});

test("bundles Capability Conductor as a valid instruction-only skill", async () => {
  const report = await inspectLocalSkills(
    join(import.meta.dir, "..", "skills", "capability-conductor"),
  );

  expect(report.valid).toBe(true);
  expect(report.issues).toEqual([]);
  expect(report.skills.map((skill) => skill.name)).toEqual(["capability-conductor"]);
  expect(report.skills.every((skill) => skill.scripts.length === 0)).toBe(true);
  expect(report.skills.every((skill) => typeof skill.digest === "string")).toBe(true);

  const sidecar = parse(await readFile(
    join(import.meta.dir, "..", "skills", "capability-conductor", "agents", "openai.yaml"),
    "utf8",
  ));
  expect(sidecar).toEqual({
    interface: {
      display_name: "Capability Conductor · 團長",
      short_description: "Compose skills with provenance and bounded authority",
      default_prompt: "Use $capability-conductor to open a task-scoped capability book and compose the smallest safe skill workflow for this task.",
    },
    policy: {
      allow_implicit_invocation: false,
    },
  });
});

test("bundles Learn by Contact as a valid instruction-only skill", async () => {
  const skillRoot = join(import.meta.dir, "..", "skills", "learn-by-contact");
  const report = await inspectLocalSkills(
    skillRoot,
  );

  expect(report.valid).toBe(true);
  expect(report.issues).toEqual([]);
  expect(report.skills.map((skill) => skill.name)).toEqual(["learn-by-contact"]);
  expect(report.skills[0]?.scripts).toEqual([]);
  expect(report.skills[0]?.resources).toEqual(["agents/openai.yaml"]);
  expect(typeof report.skills[0]?.digest).toBe("string");

  const sidecar = parse(await readFile(
    join(skillRoot, "agents", "openai.yaml"),
    "utf8",
  ));
  expect(sidecar).toEqual({
    interface: {
      display_name: "Learn by Contact",
      short_description: "Turn direct evidence into transferable capability",
      default_prompt: "Use $learn-by-contact to trace how this works, reproduce the mechanism, and adapt it to my task.",
    },
    policy: {
      allow_implicit_invocation: false,
    },
  });
});

test("bundles the Nen operating suite as valid instruction-only skills", async () => {
  const skillsRoot = join(import.meta.dir, "..", "skills");
  const report = await inspectLocalSkills(skillsRoot);

  expect(report.valid).toBe(true);
  expect(report.issues).toEqual([]);
  expect(
    report.skills
      .map((skill) => skill.name)
      .filter((name): name is typeof NEN_SKILL_NAMES[number] => name.startsWith("nen-")),
  ).toEqual(NEN_SKILL_NAMES);

  for (const name of NEN_SKILL_NAMES) {
    const skill = report.skills.find((candidate) => candidate.name === name);
    expect(skill?.scripts).toEqual([]);
    expect(skill?.resources).toEqual(["agents/openai.yaml"]);
    expect(typeof skill?.digest).toBe("string");
    expect(Object.keys(skill?.metadataShape ?? {}).sort()).toEqual(["description", "name"]);

    const sidecar = parse(await readFile(
      join(skillsRoot, name, "agents", "openai.yaml"),
      "utf8",
    ));
    expect(Object.keys(sidecar)).toEqual(["interface", "policy"]);
    expect(typeof sidecar.interface?.display_name).toBe("string");
    expect(sidecar.interface?.short_description?.length).toBeGreaterThanOrEqual(25);
    expect(sidecar.interface?.short_description?.length).toBeLessThanOrEqual(64);
    expect(sidecar.interface?.default_prompt).toContain(`$${name}`);
    expect(sidecar.policy).toEqual({ allow_implicit_invocation: false });
  }
});

test("keeps every bundled workflow explicit until routing is evaluated", async () => {
  const skillsRoot = join(import.meta.dir, "..", "skills");
  for (const name of EXPLICIT_SKILL_NAMES) {
    const sidecar = parse(await readFile(
      join(skillsRoot, name, "agents", "openai.yaml"),
      "utf8",
    ));
    expect(sidecar.policy).toEqual({ allow_implicit_invocation: false });
  }
});

test("documents non-activating installation and literal inspector path arguments", async () => {
  const packageRoot = join(import.meta.dir, "..");
  const readme = await readFile(join(packageRoot, "README.md"), "utf8");
  const conductor = await readFile(
    join(packageRoot, "skills", "capability-conductor", "SKILL.md"),
    "utf8",
  );
  const learnByContact = await readFile(
    join(packageRoot, "skills", "learn-by-contact", "SKILL.md"),
    "utf8",
  );
  const concealedTrace = await readFile(
    join(packageRoot, "skills", "nen-concealed-trace", "SKILL.md"),
    "utf8",
  );
  const contractMantle = await readFile(
    join(packageRoot, "skills", "nen-contract-mantle", "SKILL.md"),
    "utf8",
  );
  const verificationLedger = await readFile(
    join(packageRoot, "skills", "nen-verification-ledger", "SKILL.md"),
    "utf8",
  );

  expect(readme).toContain(SKILLS_RELEASE_URL);
  expect(readme).toContain(SKILLS_RELEASE_SHA256);
  expect(readme).toMatch(
    /npm 0\.2\.1 is unavailable.*npm `latest` remains 0\.1\.0/s,
  );
  expect(readme).toMatch(
    /curl[\s\S]*&&\s+verify_sha256 "\$archive" "\$expected_sha256" &&\s+npm install --ignore-scripts --no-audit --no-fund "\.\/\$archive" &&\s+npx --no-install agenttool-skill validate/s,
  );
  expect(readme).toContain("command -v sha256sum");
  expect(readme).toContain("command -v shasum");
  expect(readme).not.toContain("does not claim current registry availability");
  expect(readme).not.toContain("The npm archive has no host installer");
  expect(readme).not.toContain(
    "npm install --ignore-scripts --no-audit --no-fund --save-exact @agenttool/skills@0.2.1",
  );
  expect(readme).toMatch(/installing the package\s+alone does not register these skills/);
  expect(conductor).toContain("Pass the target path as one literal argument.");
  expect(conductor).not.toContain("inspect <local-path>");
  for (const skill of [conductor, learnByContact]) {
    expect(skill).toContain("## Lineage");
    expect(skill).toContain("unofficial original agent workflow");
    expect(skill).toMatch(/not affiliated\s+with or endorsed/);
  }
  expect(concealedTrace).toContain("Redact credentials, tokens, personal data");
  expect(verificationLedger).toMatch(/Never\s+place credential values, personal data/);
  expect(contractMantle).not.toContain("crunchyroll.com");
});

test("documented archive install stops before verification and npm when download fails", async () => {
  const result = await runDocumentedInstallRecipe({ download: "failure" });

  expect(result.exitCode).not.toBe(0);
  expect(result.trace).toEqual([
    `curl -q --fail --location --output agenttool-skills-0.2.1.tgz ${SKILLS_RELEASE_URL}`,
  ]);
  expect(result.trace.some((line) => line.startsWith("npm "))).toBe(false);
  expect(result.trace.some((line) => line.startsWith("npx "))).toBe(false);
});

test("documented archive install stops before npm and npx on a checksum mismatch", async () => {
  const result = await runDocumentedInstallRecipe({
    actualSha256: "0".repeat(64),
  });

  expect(result.exitCode).not.toBe(0);
  expect(result.trace.map((line) => line.split(" ", 1)[0])).toEqual([
    "curl",
    "sha256sum",
  ]);
  expect(result.trace.some((line) => line.startsWith("npm "))).toBe(false);
  expect(result.trace.some((line) => line.startsWith("npx "))).toBe(false);
});

test("documented archive install stops before npm when no SHA-256 verifier exists", async () => {
  const result = await runDocumentedInstallRecipe({ verifier: "none" });

  expect(result.exitCode).not.toBe(0);
  expect(result.stderr).toContain("sha256sum or shasum");
  expect(result.trace.map((line) => line.split(" ", 1)[0])).toEqual(["curl"]);
  expect(result.trace.some((line) => line.startsWith("npm "))).toBe(false);
  expect(result.trace.some((line) => line.startsWith("npx "))).toBe(false);
});

test("documented archive install stops before npx when local installation fails", async () => {
  const result = await runDocumentedInstallRecipe({ install: "failure" });

  expect(result.exitCode).not.toBe(0);
  expect(result.trace.map((line) => line.split(" ", 1)[0])).toEqual([
    "curl",
    "sha256sum",
    "npm",
  ]);
  expect(result.trace.some((line) => line.startsWith("npx "))).toBe(false);
});

test("documented archive install succeeds with either portable SHA-256 verifier", async () => {
  for (const verifier of ["sha256sum", "shasum"] as const) {
    const result = await runDocumentedInstallRecipe({ verifier });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.trace.map((line) => line.split(" ", 1)[0])).toEqual([
      "curl",
      verifier,
      "npm",
      "npx",
    ]);
    expect(result.trace).toContain(
      verifier === "sha256sum"
        ? "sha256sum agenttool-skills-0.2.1.tgz"
        : "shasum -a 256 agenttool-skills-0.2.1.tgz",
    );
    expect(result.trace).toContain(
      "npm install --ignore-scripts --no-audit --no-fund ./agenttool-skills-0.2.1.tgz",
    );
    expect(result.trace).toContain(
      "npx --no-install agenttool-skill validate ./path/to/plugin",
    );
  }
});
