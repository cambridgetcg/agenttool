import {
  afterAll,
  beforeAll,
  describe,
  expect,
  setDefaultTimeout,
  test,
} from "bun:test";
import { createHash } from "node:crypto";
import {
  chmod,
  chown,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const ROOT = resolve(import.meta.dir, "../..");
const DEPLOY = join(ROOT, "bin/deploy.sh");
const BRIDGE = join(ROOT, "bin/phase-b-refence-maintenance-bridge.ts");
const GUARD = join(ROOT, "bin/phase-b-deploy-guard.ts");
const BEGIN = "# BEGIN agenttool-phase-b-refence-maintenance-dispatch/v1\n";
const END = "# END agenttool-phase-b-refence-maintenance-dispatch/v1\n\n";
const BASE_SIZE = 206_660;
const BASE_SHA256 =
  "64b51b69255201e14b7a46c85b846700cb66a117a5be9d883e9919f084f95dc3";
const BASE_BLOB_SHA1 = "4db101ffec2ce6912aa32bbfae75139942e8d6d0";
const BASE_REVISION = "a5b59e638195cbca30f9e10c9ebf71b92cd7a5f6";
const GUARD_SHA256 =
  "10fe5012e8069ede11eaa3abe0a05f08225d855bb722d52746279dbc21c5fade";
const FIXED_REPO =
  "/Users/yournameisai/.cache/codex-worktrees/agenttool-phase-b-refence-maintenance-bridge-v1";
const FIXED_BUN_SHA256 =
  "66262f09134f780b1563bd1ae3dad13ea7d2ac669f8a5754f924b3c82abcc8f3";
const FIXED_CONTROLLER_SHA256 =
  "047a68a9505197481c1997d98e7931f3137fb0bd09cb3a691e88ec714837f7ec";
const FIXED_CONTROLLER_NORMALIZED_SHA256 =
  "90b7cae46ba8b5a91720650699cef93d63006ddecc66f4c16a216df7335e8d35";
const INVALID = "maintenance_refence_bridge_invalid_invocation\n";
const REFUSED = "maintenance_refence_bridge_refused\n";
const PERL_LAUNCHER =
  'my $refusal="maintenance_refence_bridge_refused\\n";@ARGV==17 or do{print STDERR $refusal;exit 74};my($home,$operator,$path,$bun,@arguments)=@ARGV;%ENV=("HOME"=>$home,"USER"=>$operator,"LOGNAME"=>$operator,"LANG"=>"C","LC_ALL"=>"C","NO_COLOR"=>"1","TERM"=>"dumb","PATH"=>$path);{local $SIG{"__WARN__"}=sub{};exec {$bun} $bun,@arguments}print STDERR $refusal;exit 74';
const RECEIPT = "a".repeat(64);
const IDS = [
  "11111111111111",
  "22222222222222",
  "33333333333333",
  "44444444444444",
  "55555555555555",
] as const;
const VALID = [
  "--no-migrate",
  "--no-frontend",
  "--maintenance-fenced-api",
  `--maintenance-refence-receipt-sha256=${RECEIPT}`,
  `--maintenance-app-machines=${IDS[0]},${IDS[1]},${IDS[2]}`,
  `--maintenance-thinker-primary=${IDS[3]}`,
  `--maintenance-thinker-standby=${IDS[4]}`,
] as const;

setDefaultTimeout(120_000);

let deployBytes: Buffer;
let deploySource: string;
let dispatcherSpan: string;
const cleanup: string[] = [];

function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function gitBlobSHA1(bytes: Uint8Array): string {
  return createHash("sha1")
    .update(`blob ${bytes.byteLength}\0`)
    .update(bytes)
    .digest("hex");
}

function occurrences(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

function replaceExact(
  source: string,
  before: string,
  after: string,
  count: number,
): string {
  if (before === after) {
    expect(occurrences(source, before)).toBe(count);
    return source;
  }
  expect(occurrences(source, before)).toBe(count);
  expect(occurrences(source, after)).toBe(0);
  const replaced = source.split(before).join(after);
  expect(occurrences(replaced, before)).toBe(0);
  expect(occurrences(replaced, after)).toBe(count);
  expect(replaced.split(after).join(before)).toBe(source);
  return replaced;
}

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

async function run(
  command: readonly string[],
  cwd: string,
  env: Record<string, string>,
): Promise<RunResult> {
  const child = Bun.spawn([...command], {
    cwd,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { code, stdout, stderr };
}

function fixtureEnvironment(): Record<string, string> {
  return {
    HOME: "/ambient/home",
    USER: "ambient-user",
    LOGNAME: "ambient-logname",
    LANG: "C",
    LC_ALL: "C",
    NO_COLOR: "ambient",
    TERM: "ambient",
    PATH: "/usr/bin:/bin",
    DISPATCH_AMBIENT_POISON: "must-not-cross",
  };
}

function toolSource(
  kind: "stat" | "xxd" | "shasum",
  ledger: string,
  fault: string,
): string {
  return `#!${process.execPath}
import { appendFileSync, existsSync, lstatSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const ledger=${JSON.stringify(ledger)};
const faultPath=${JSON.stringify(fault)};
const prior=existsSync(ledger)?readFileSync(ledger,"utf8").split("\\n").filter(Boolean):[];
const index=prior.length+1;
const args=process.argv.slice(2);
const target=args.at(-1);
let observed=null;
if(${JSON.stringify(kind)}==="stat"&&typeof target==="string"){
  const value=lstatSync(target,{bigint:true});
  observed=[value.isDirectory()?"Directory":value.isFile()?"Regular File":value.isSymbolicLink()?"Symbolic Link":"Other",value.uid,value.gid,Number(value.mode&0o777n).toString(8),value.nlink,value.size,value.dev,value.ino].join("|");
}
appendFileSync(ledger,JSON.stringify({index,kind:${
    JSON.stringify(kind)
  },args,observed,env:Object.fromEntries(Object.entries(process.env).sort(([a],[b])=>a<b?-1:a>b?1:0))})+"\\n");
const faults=existsSync(faultPath)?JSON.parse(readFileSync(faultPath,"utf8")):{};
const injected=faults[String(index)];
if(injected?.stdout!==undefined)process.stdout.write(injected.stdout);
if(injected){process.exit(injected.status??0)}
const path=target;
if(typeof path!=="string")process.exit(91);
if(${JSON.stringify(kind)}==="stat"){
  const value=lstatSync(path,{bigint:true});
  const type=value.isDirectory()?"Directory":value.isFile()?"Regular File":value.isSymbolicLink()?"Symbolic Link":"Other";
  const mode=Number(value.mode&0o777n).toString(8);
  const format=args[args.indexOf("-f")+1];
  if(format==="%HT|%u|%g|%Lp|%d|%i")process.stdout.write([type,value.uid,value.gid,mode,value.dev,value.ino].join("|")+"\\n");
  else if(format==="%HT|%u|%g|%Lp|%l|%z|%d|%i")process.stdout.write([type,value.uid,value.gid,mode,value.nlink,value.size,value.dev,value.ino].join("|")+"\\n");
  else process.exit(92);
}else if(${JSON.stringify(kind)}==="xxd"){
  process.stdout.write(readFileSync(path).subarray(0,8).toString("hex")+"\\n");
}else{
  process.stdout.write(createHash("sha256").update(readFileSync(path)).digest("hex")+"  "+path+"\\n");
}
`;
}

function bunSource(
  ledger: string,
  fault: string,
  capture: string,
  bunPath: string,
): string {
  return `#!${process.execPath}
import { appendFileSync, chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
const ledger=${JSON.stringify(ledger)};
const faultPath=${JSON.stringify(fault)};
const capture=${JSON.stringify(capture)};
const bunPath=${JSON.stringify(bunPath)};
const prior=existsSync(ledger)?readFileSync(ledger,"utf8").split("\\n").filter(Boolean):[];
const index=prior.length+1;
const args=process.argv.slice(2);
const env=Object.fromEntries(Object.entries(process.env).sort(([a],[b])=>a<b?-1:a>b?1:0));
appendFileSync(ledger,JSON.stringify({index,kind:"bun",args,env})+"\\n");
const faults=existsSync(faultPath)?JSON.parse(readFileSync(faultPath,"utf8")):{};
const injected=faults[String(index)];
if(injected?.chmod!==undefined)chmodSync(bunPath,injected.chmod);
if(injected?.stdout!==undefined)process.stdout.write(injected.stdout);
if(injected)process.exit(injected.status??0);
if(args.at(-1)==="--version"){process.stdout.write("1.3.5\\n");process.exit(0)}
writeFileSync(capture,JSON.stringify({args,env})+"\\n");
process.exit(73);
`;
}

interface DispatcherFixture {
  root: string;
  harness: string;
  baseline: string;
  ledger: string;
  fault: string;
  capture: string;
  bun: string;
  bunStat: string;
  controller: string;
  controllerStat: string;
}

async function createFixture(): Promise<DispatcherFixture> {
  const root = await mkdtemp(join(tmpdir(), "agenttool-refence-dispatch-"));
  cleanup.push(root);
  const uid = process.getuid?.() ?? 501;
  const gid = process.getgid?.() ?? 20;
  const usersRoot = join(root, "Users");
  const operator = "fixtureoperator";
  const home = join(usersRoot, operator);
  const repo = join(
    home,
    ".cache/codex-worktrees/agenttool-phase-b-refence-maintenance-bridge-v1",
  );
  const bunDirectory = join(
    home,
    ".cache/pinned-runtimes/bun-v1.3.5/bun-darwin-aarch64",
  );
  const bun = join(bunDirectory, "bun");
  const tools = join(root, "tools");
  const ledger = join(root, "ledger.jsonl");
  const fault = join(root, "fault.json");
  const capture = join(root, "capture.json");
  const controller = join(repo, "bin/phase-b-refence-maintenance-bridge.ts");
  await mkdir(join(repo, "bin"), { recursive: true });
  await mkdir(bunDirectory, { recursive: true });
  await mkdir(tools, { recursive: true });
  const custodyDirectories: Array<[string, number]> = [
    [root, 0o755],
    [usersRoot, 0o755],
    [home, 0o700],
    [join(home, ".cache"), 0o755],
    [join(home, ".cache/pinned-runtimes"), 0o755],
    [join(home, ".cache/pinned-runtimes/bun-v1.3.5"), 0o755],
    [bunDirectory, 0o755],
    [join(home, ".cache/codex-worktrees"), 0o755],
    [repo, 0o755],
    [join(repo, "bin"), 0o755],
  ];
  for (const [path, mode] of custodyDirectories) {
    await chown(path, uid, gid);
    await chmod(path, mode);
  }
  const controllerBytes = Buffer.from(
    "export const dispatcherFixtureController = true;\n",
  );
  await writeFile(controller, controllerBytes);
  await chown(controller, uid, gid);
  await chmod(controller, 0o644);
  await writeFile(bun, bunSource(ledger, fault, capture, bun));
  const statTool = join(tools, "stat");
  const xxdTool = join(tools, "xxd");
  const shasumTool = join(tools, "shasum");
  await Promise.all([
    writeFile(statTool, toolSource("stat", ledger, fault)),
    writeFile(xxdTool, toolSource("xxd", ledger, fault)),
    writeFile(shasumTool, toolSource("shasum", ledger, fault)),
  ]);
  await Promise.all([
    chmod(bun, 0o755),
    chmod(statTool, 0o755),
    chmod(xxdTool, 0o755),
    chmod(shasumTool, 0o755),
  ]);
  const bunBytes = await readFile(bun);
  const identity = await lstat(bun, { bigint: true });
  const controllerIdentity = await lstat(controller, { bigint: true });
  const bunStat = [
    "Regular File",
    uid,
    gid,
    "755",
    "1",
    identity.size,
    identity.dev,
    identity.ino,
  ].join("|");
  const controllerStat = [
    "Regular File",
    uid,
    gid,
    "644",
    "1",
    controllerIdentity.size,
    controllerIdentity.dev,
    controllerIdentity.ino,
  ].join("|");
  let transformed = dispatcherSpan;
  transformed = replaceExact(
    transformed,
    'local filesystem_root="/"',
    `local filesystem_root=${JSON.stringify(root)}`,
    1,
  );
  transformed = replaceExact(
    transformed,
    'local users_root="/Users"',
    `local users_root=${JSON.stringify(usersRoot)}`,
    1,
  );
  transformed = replaceExact(
    transformed,
    'local home="/Users/yournameisai"',
    `local home=${JSON.stringify(home)}`,
    1,
  );
  transformed = replaceExact(
    transformed,
    'local operator="yournameisai"',
    `local operator=${JSON.stringify(operator)}`,
    1,
  );
  transformed = replaceExact(
    transformed,
    'local operator_uid="501"',
    `local operator_uid=${JSON.stringify(String(uid))}`,
    1,
  );
  transformed = replaceExact(
    transformed,
    'local operator_gid="20"',
    `local operator_gid=${JSON.stringify(String(gid))}`,
    1,
  );
  transformed = replaceExact(
    transformed,
    '"$filesystem_root|0|0|755"',
    '"$filesystem_root|$operator_uid|$operator_gid|755"',
    1,
  );
  transformed = replaceExact(
    transformed,
    '"$users_root|0|80|755"',
    '"$users_root|$operator_uid|$operator_gid|755"',
    1,
  );
  transformed = replaceExact(
    transformed,
    `local repo=${JSON.stringify(FIXED_REPO)}`,
    `local repo=${JSON.stringify(repo)}`,
    1,
  );
  transformed = replaceExact(
    transformed,
    `local bun_sha256=${JSON.stringify(FIXED_BUN_SHA256)}`,
    `local bun_sha256=${JSON.stringify(sha256(bunBytes))}`,
    1,
  );
  transformed = replaceExact(
    transformed,
    `local controller_sha256=${JSON.stringify(FIXED_CONTROLLER_SHA256)}`,
    `local controller_sha256=${JSON.stringify(sha256(controllerBytes))}`,
    1,
  );
  transformed = replaceExact(
    transformed,
    'local controller_size="494986"',
    `local controller_size=${
      JSON.stringify(String(controllerBytes.byteLength))
    }`,
    1,
  );
  transformed = replaceExact(
    transformed,
    'local bun_size="59885424"',
    `local bun_size=${JSON.stringify(String(bunBytes.byteLength))}`,
    1,
  );
  transformed = replaceExact(
    transformed,
    'local bun_magic="cffaedfe0c000001"',
    `local bun_magic=${
      JSON.stringify(bunBytes.subarray(0, 8).toString("hex"))
    }`,
    1,
  );
  transformed = replaceExact(transformed, "/usr/bin/stat", statTool, 9);
  transformed = replaceExact(transformed, "/usr/bin/xxd", xxdTool, 2);
  transformed = replaceExact(transformed, "/usr/bin/shasum", shasumTool, 4);
  const tail =
    'if builtin shopt -q nocasematch; then _ordinary_nocasematch=on; else _ordinary_nocasematch=off; fi\nprintf \'ordinary_tail|%s|%s|%s|%s|%s|%s|%s|%s|%s\\n\' "$PWD" "$#" "$*" "$HOME" "$USER" "$PATH" "$LANG" "$LC_ALL" "$_ordinary_nocasematch"\n';
  const harness = join(root, "dispatcher.sh");
  const baseline = join(root, "baseline.sh");
  await writeFile(
    harness,
    `#!/usr/bin/env bash\nset -uo pipefail\n\n${transformed}${tail}`,
  );
  await writeFile(baseline, `#!/usr/bin/env bash\nset -uo pipefail\n\n${tail}`);
  await Promise.all([chmod(harness, 0o755), chmod(baseline, 0o755)]);
  return {
    root,
    harness,
    baseline,
    ledger,
    fault,
    capture,
    bun,
    bunStat,
    controller,
    controllerStat,
  };
}

async function resetFixture(
  fixture: DispatcherFixture,
  faults: Record<string, unknown> = {},
): Promise<void> {
  for (const path of [fixture.ledger, fixture.capture, fixture.fault]) {
    try {
      await unlink(path);
    } catch {}
  }
  await chmod(fixture.bun, 0o755);
  await writeFile(fixture.fault, JSON.stringify(faults));
}

async function ledger(fixture: DispatcherFixture): Promise<any[]> {
  try {
    return (await readFile(fixture.ledger, "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

async function runFixture(
  fixture: DispatcherFixture,
  arguments_: readonly string[],
): Promise<RunResult> {
  return run(
    ["/bin/bash", fixture.harness, ...arguments_],
    fixture.root,
    fixtureEnvironment(),
  );
}

function permutations<T>(values: readonly T[]): T[][] {
  if (values.length === 0) return [[]];
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += 1) {
    const remaining = [...values.slice(0, index), ...values.slice(index + 1)];
    for (const tail of permutations(remaining)) {
      result.push([values[index]!, ...tail]);
    }
  }
  return result;
}

beforeAll(async () => {
  deployBytes = await readFile(DEPLOY);
  deploySource = deployBytes.toString("utf8");
  const begin = deploySource.indexOf(BEGIN);
  const end = deploySource.indexOf(END, begin);
  if (begin < 0 || end < 0) throw new Error("dispatcher markers absent");
  dispatcherSpan = deploySource.slice(begin, end + END.length);
});

afterAll(async () => {
  await Promise.all(
    cleanup.map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("Phase-B refence maintenance deploy dispatcher", () => {
  test("is one reversible span at byte 1841 over the exact main deploy", async () => {
    expect(Buffer.byteLength(BEGIN)).toBe(BEGIN.length);
    const beginBytes = Buffer.from(BEGIN);
    const endBytes = Buffer.from(END);
    expect(deployBytes.indexOf(beginBytes)).toBe(1841);
    expect(deployBytes.lastIndexOf(beginBytes)).toBe(1841);
    const end = deployBytes.indexOf(endBytes, 1841);
    expect(end).toBeGreaterThan(1841);
    expect(deployBytes.lastIndexOf(endBytes)).toBe(end);
    const recovered = Buffer.concat([
      deployBytes.subarray(0, 1841),
      deployBytes.subarray(end + endBytes.byteLength),
    ]);
    expect(recovered.byteLength).toBe(BASE_SIZE);
    expect(sha256(recovered)).toBe(BASE_SHA256);
    expect(gitBlobSHA1(recovered)).toBe(BASE_BLOB_SHA1);
    const base = Bun.spawn(
      ["/usr/bin/git", "show", `${BASE_REVISION}:bin/deploy.sh`],
      {
        cwd: ROOT,
        env: { LANG: "C", LC_ALL: "C", PATH: "/usr/bin:/bin" },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [baseBytes, baseStderr, baseStatus] = await Promise.all([
      new Response(base.stdout).arrayBuffer(),
      new Response(base.stderr).text(),
      base.exited,
    ]);
    expect(baseStatus).toBe(0);
    expect(baseStderr).toBe("");
    expect(Buffer.from(baseBytes)).toEqual(recovered);
    const metadata = await lstat(DEPLOY);
    expect(metadata.isFile()).toBe(true);
    expect(metadata.isSymbolicLink()).toBe(false);
    expect(metadata.mode & 0o777).toBe(0o755);
    expect(metadata.nlink).toBe(1);
  });

  test("preserves the guard and binds the activated controller entry and self-pin", async () => {
    expect(sha256(await readFile(GUARD))).toBe(GUARD_SHA256);
    const bridgeBytes = await readFile(BRIDGE);
    expect(sha256(bridgeBytes)).toBe(FIXED_CONTROLLER_SHA256);
    expect(dispatcherSpan).toContain(
      `local controller_sha256=${JSON.stringify(FIXED_CONTROLLER_SHA256)}`,
    );
    expect(dispatcherSpan).toContain("REFRESH_CONTROLLER_DISPATCH_PIN");
    const bridge = bridgeBytes.toString("utf8");
    expect(bridge).toContain(
      `const BRIDGE_NORMALIZED_SHA256 =\n  "${FIXED_CONTROLLER_NORMALIZED_SHA256}";`,
    );
    expect(bridge).not.toContain("__PIN_BRIDGE_SELF_NORMALIZED_SHA256__");
    const main = bridge.slice(
      bridge.indexOf("async function main(): Promise<void>"),
      bridge.indexOf("if (import.meta.main)"),
    );
    expect(main).toContain(
      "const arguments_ = parseArguments(process.argv.slice(3));",
    );
    expect(main.match(/parseArguments\(/g)).toHaveLength(1);
    expect(main.match(/await runProductionController\(arguments_\);/g))
      .toHaveLength(1);
    expect(main).not.toContain("controller_not_activated");
  });

  test("has a Bash-3.2-safe builtin-only ordinary selector", async () => {
    const selectorEnd = dispatcherSpan.indexOf("  local LC_ALL=C LANG=C");
    expect(selectorEnd).toBeGreaterThan(0);
    const selector = dispatcherSpan.slice(0, selectorEnd);
    expect(selector).toContain("--maintenance-refence*");
    expect(selector).not.toMatch(/\$\(|`|\/usr\/bin\//);
    const bashSurface = dispatcherSpan.replace(
      `  local perl_launcher='${PERL_LAUNCHER}'\n`,
      "",
    );
    expect(bashSurface).not.toMatch(
      /declare\s+-A|\bmapfile\b|\breadarray\b|\$\{[^}]+,,\}|local\s+-n|exec\s+\{[^}]+\}/,
    );
    expect(dispatcherSpan).toContain(
      `local perl_launcher='${PERL_LAUNCHER}'`,
    );
    expect(occurrences(dispatcherSpan, "/usr/bin/perl")).toBe(1);
    expect(dispatcherSpan).toContain(
      'builtin exec /usr/bin/env -i LANG=C LC_ALL=C PATH=/usr/bin:/bin \\\n    /usr/bin/perl -e "$perl_launcher"',
    );
    expect(PERL_LAUNCHER).not.toMatch(
      /\b(?:eval|fork|open|qx|read|require|socket|syscall|system|use)\b|`/,
    );
    expect(PERL_LAUNCHER.match(/\bexec\b/g)).toHaveLength(1);
    const syntax = await run(
      ["/bin/bash", "-n", DEPLOY],
      ROOT,
      { LANG: "C", LC_ALL: "C", PATH: "/usr/bin:/bin" },
    );
    expect(syntax).toEqual({ code: 0, stdout: "", stderr: "" });
  });

  test("ordinary and legacy argv fall through byte-for-byte with no tool call", async () => {
    const fixture = await createFixture();
    const cases: readonly string[][] = [
      [],
      ["--survey"],
      ["--maintenance-refenc"],
      ["--maintenance-reference"],
      [
        "--no-migrate",
        "--no-frontend",
        "--maintenance-fenced-api",
        `--maintenance-app-machines=${IDS[0]},${IDS[1]},${IDS[2]}`,
        `--maintenance-thinker-primary=${IDS[3]}`,
        `--maintenance-thinker-standby=${IDS[4]}`,
      ],
      ["--unknown-ordinary"],
    ];
    for (const arguments_ of cases) {
      await resetFixture(fixture);
      const [observed, baseline] = await Promise.all([
        run(
          ["/bin/bash", fixture.harness, ...arguments_],
          fixture.root,
          fixtureEnvironment(),
        ),
        run(
          ["/bin/bash", fixture.baseline, ...arguments_],
          fixture.root,
          fixtureEnvironment(),
        ),
      ]);
      expect(observed).toEqual(baseline);
      expect(await ledger(fixture)).toEqual([]);
    }
    const ambient = {
      ...fixtureEnvironment(),
      LANG: "en_GB.UTF-8",
      LC_ALL: "C",
    };
    const [observedOption, baselineOption] = await Promise.all([
      run(
        ["/bin/bash", "-O", "nocasematch", fixture.harness, "--survey"],
        fixture.root,
        ambient,
      ),
      run(
        ["/bin/bash", "-O", "nocasematch", fixture.baseline, "--survey"],
        fixture.root,
        ambient,
      ),
    ]);
    expect(observedOption).toEqual(baselineOption);
    expect(observedOption.stdout).toEndWith("|en_GB.UTF-8|C|on\n");
    expect(await ledger(fixture)).toEqual([]);

    const uppercasePrefix = VALID.map((value, index) =>
      index === 3 ? `--MAINTENANCE-REFENCE-RECEIPT-SHA256=${RECEIPT}` : value
    );
    const [observedUppercase, baselineUppercase] = await Promise.all([
      run(
        [
          "/bin/bash",
          "-O",
          "nocasematch",
          fixture.harness,
          ...uppercasePrefix,
        ],
        fixture.root,
        ambient,
      ),
      run(
        [
          "/bin/bash",
          "-O",
          "nocasematch",
          fixture.baseline,
          ...uppercasePrefix,
        ],
        fixture.root,
        ambient,
      ),
    ]);
    expect(observedUppercase).toEqual(baselineUppercase);
    expect(observedUppercase.stdout).toEndWith("|en_GB.UTF-8|C|on\n");
    expect(await ledger(fixture)).toEqual([]);
  });

  test("rejects every missing, duplicate, malformed, mixed, and colliding reserved form before tools", async () => {
    const fixture = await createFixture();
    const cases: string[][] = [];
    for (let index = 0; index < VALID.length; index += 1) {
      const missing = VALID.filter((_, candidate) => candidate !== index);
      if (index === 3) missing.push("--maintenance-refence-invalid");
      cases.push(missing, [...VALID, VALID[index]!]);
    }
    const reservedExtras = [
      "--help",
      "-h",
      "--survey",
      "--dry-run",
      "--no-api",
      "--no-cache-api",
      "--skip-preflight",
      "--allow-dirty-release",
      "--allow-non-release-head",
      "--oauth-fallback",
      "--mirror-codeberg",
      "positional",
      "--",
    ];
    cases.push(
      ...reservedExtras.map((extra) => [...VALID, extra]),
      ["--maintenance-refence"],
      ["--maintenance-refenceX"],
      ["--maintenance-refence-"],
      ["--maintenance-refence-bogus"],
      ["--maintenance-refence-receipt-sha256"],
      VALID.map((value, index) =>
        index === 3 ? "--maintenance-refence-receipt-sha256=" : value
      ),
      VALID.map((value, index) =>
        index === 3
          ? `--maintenance-refence-receipt-sha256=${"A".repeat(64)}`
          : value
      ),
      VALID.map((value, index) =>
        index === 3
          ? `--maintenance-refence-receipt-sha256=${"a".repeat(63)}`
          : value
      ),
      VALID.map((value, index) =>
        index === 3
          ? `--maintenance-refence-receipt-sha256=${"a".repeat(65)}`
          : value
      ),
      VALID.map((value, index) =>
        index === 3
          ? `--maintenance-refence-receipt-sha256=${"a".repeat(63)}g`
          : value
      ),
      VALID.map((value, index) =>
        index === 3 ? `--maintenance-refence-receipt-sha256==${RECEIPT}` : value
      ),
      VALID.map((value, index) =>
        index === 4 ? `--maintenance-app-machines=${IDS[0]},${IDS[1]}` : value
      ),
      VALID.map((value, index) =>
        index === 4
          ? `--maintenance-app-machines=${IDS[0]},${IDS[1]},ABCDEFABCDEFAB`
          : value
      ),
      VALID.map((value, index) =>
        index === 5 ? "--maintenance-thinker-primary=0000" : value
      ),
      VALID.map((value, index) =>
        index === 6 ? "--maintenance-thinker-standby=0000" : value
      ),
    );
    for (let first = 0; first < IDS.length; first += 1) {
      for (let second = first + 1; second < IDS.length; second += 1) {
        const ids = [...IDS];
        ids[second] = ids[first]!;
        cases.push([
          "--no-migrate",
          "--no-frontend",
          "--maintenance-fenced-api",
          `--maintenance-refence-receipt-sha256=${RECEIPT}`,
          `--maintenance-app-machines=${ids[0]},${ids[1]},${ids[2]}`,
          `--maintenance-thinker-primary=${ids[3]}`,
          `--maintenance-thinker-standby=${ids[4]}`,
        ]);
      }
    }
    for (const arguments_ of cases) {
      await resetFixture(fixture);
      const result = await runFixture(fixture, arguments_);
      expect(result).toEqual({ code: 64, stdout: "", stderr: INVALID });
      expect(await ledger(fixture)).toEqual([]);
    }
    expect(cases.length).toBe(52);

    await resetFixture(fixture);
    const nocasematch = await run(
      [
        "/bin/bash",
        "-O",
        "nocasematch",
        fixture.harness,
        ...VALID.map((value, index) =>
          index === 3
            ? `--maintenance-refence-receipt-sha256=${"A".repeat(64)}`
            : value
        ),
      ],
      fixture.root,
      fixtureEnvironment(),
    );
    expect(nocasematch).toEqual({ code: 64, stdout: "", stderr: INVALID });
    expect(await ledger(fixture)).toEqual([]);
  });

  test("canonicalizes all 7! valid presentations through the exact parser", async () => {
    const runtimeNeedle = '  local users_root="/Users"';
    expect(occurrences(dispatcherSpan, runtimeNeedle)).toBe(1);
    const parserOnly = dispatcherSpan.replace(
      runtimeNeedle,
      `  printf '%s\\n' "--no-migrate|--no-frontend|--maintenance-fenced-api|--maintenance-refence-receipt-sha256=$receipt|--maintenance-app-machines=$apps|--maintenance-thinker-primary=$primary|--maintenance-thinker-standby=$standby"\n  return 0\n${runtimeNeedle}`,
    ).replace(
      '_agenttool_refence_dispatch "$@"\nbuiltin unset -f _agenttool_refence_dispatch',
      permutations(VALID)
        .map((arguments_) =>
          `_agenttool_refence_dispatch ${
            arguments_.map((value) => JSON.stringify(value)).join(" ")
          }`
        )
        .join("\n") + "\nbuiltin unset -f _agenttool_refence_dispatch",
    );
    expect(occurrences(parserOnly, '_agenttool_refence_dispatch "$@"')).toBe(0);
    const root = await mkdtemp(
      join(tmpdir(), "agenttool-refence-permutations-"),
    );
    cleanup.push(root);
    const script = join(root, "permutations.sh");
    await writeFile(
      script,
      `#!/usr/bin/env bash\nset -uo pipefail\n\n${parserOnly}`,
    );
    const result = await run(
      ["/bin/bash", script],
      root,
      { LANG: "C", LC_ALL: "C", PATH: "/usr/bin:/bin" },
    );
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    const lines = result.stdout.trimEnd().split("\n");
    expect(lines.length).toBe(5_040);
    expect(new Set(lines)).toEqual(new Set([VALID.join("|")]));
  });

  test("sandwiches the Bun pin and execs one exact canonical argv and eight-key env", async () => {
    const fixture = await createFixture();
    await resetFixture(fixture);
    const shuffled = [
      VALID[6],
      VALID[2],
      VALID[4],
      VALID[0],
      VALID[5],
      VALID[3],
      VALID[1],
    ];
    const result = await runFixture(fixture, shuffled);
    expect(result, JSON.stringify(await ledger(fixture))).toEqual({
      code: 73,
      stdout: "",
      stderr: "",
    });
    const events = await ledger(fixture);
    expect(events.map((event) => event.kind)).toEqual([
      ...Array(11).fill("stat"),
      "xxd",
      "shasum",
      "stat",
      "stat",
      "shasum",
      "stat",
      "bun",
      "stat",
      ...Array(10).fill("stat"),
      "shasum",
      "stat",
      "xxd",
      "shasum",
      "stat",
      "bun",
    ]);
    for (const event of events.filter((entry) => entry.kind !== "bun")) {
      expect(event.env).toEqual({
        LANG: "C",
        LC_ALL: "C",
        PATH: "/usr/bin:/bin",
      });
    }
    const version = events[17]!;
    expect(version.args).toEqual([
      "--no-install",
      "--no-env-file",
      "--config=/dev/null",
      `--cwd=${
        join(
          fixture.root,
          "Users/fixtureoperator/.cache/codex-worktrees/agenttool-phase-b-refence-maintenance-bridge-v1",
        )
      }`,
      "--version",
    ]);
    const invoked = JSON.parse(await readFile(fixture.capture, "utf8"));
    const home = join(fixture.root, "Users/fixtureoperator");
    const repo = join(
      home,
      ".cache/codex-worktrees/agenttool-phase-b-refence-maintenance-bridge-v1",
    );
    const bunDirectory = join(
      home,
      ".cache/pinned-runtimes/bun-v1.3.5/bun-darwin-aarch64",
    );
    expect(invoked.env).toEqual({
      HOME: home,
      LANG: "C",
      LC_ALL: "C",
      LOGNAME: "fixtureoperator",
      NO_COLOR: "1",
      PATH:
        `${home}/.cache/codex-tools/flyctl-v0.4.74:${bunDirectory}:/usr/bin:/bin:/usr/sbin:/sbin`,
      TERM: "dumb",
      USER: "fixtureoperator",
    });
    expect(invoked.args).toEqual([
      "--no-install",
      "--no-env-file",
      "--config=/dev/null",
      `--cwd=${repo}`,
      `${repo}/bin/phase-b-refence-maintenance-bridge.ts`,
      "controller",
      ...VALID,
    ]);
  });

  test("refuses every custody and sandwich drift before controller execution", async () => {
    const fixture = await createFixture();
    const fields = fixture.bunStat.split("|");
    const controllerFields = fixture.controllerStat.split("|");
    const changed = (index: number, value: string): string => {
      const copy = [...fields];
      copy[index] = value;
      return `${copy.join("|")}\n`;
    };
    const changedController = (index: number, value: string): string => {
      const copy = [...controllerFields];
      copy[index] = value;
      return `${copy.join("|")}\n`;
    };
    const faults: Array<[string, Record<string, unknown>]> = [];
    for (let event = 1; event <= 10; event += 1) {
      faults.push([`directory_${event}`, {
        [event]: { stdout: "Directory|999|999|777\n" },
      }]);
    }
    faults.push(
      ["directory_status", { 1: { status: 9 } }],
      ["bun_type", { 11: { stdout: changed(0, "Symbolic Link") } }],
      ["bun_uid", { 11: { stdout: changed(1, "999") } }],
      ["bun_gid", { 11: { stdout: changed(2, "999") } }],
      ["bun_mode", { 11: { stdout: changed(3, "700") } }],
      ["bun_nlink", { 11: { stdout: changed(4, "2") } }],
      ["bun_size", { 11: { stdout: changed(5, "1") } }],
      ["bun_device", { 11: { stdout: changed(6, "x") } }],
      ["bun_inode", { 11: { stdout: changed(7, "0") } }],
      ["magic_one", { 12: { stdout: "0000000000000000\n" } }],
      ["magic_one_status", { 12: { status: 9 } }],
      ["hash_one", { 13: { stdout: `${"0".repeat(64)}  ${fixture.bun}\n` } }],
      ["hash_one_status", { 13: { status: 9 } }],
      ["stat_b", {
        14: { stdout: changed(7, String(BigInt(fields[7]!) + 1n)) },
      }],
      ["stat_b_status", { 14: { status: 9 } }],
      ["controller_type", {
        15: { stdout: changedController(0, "Symbolic Link") },
      }],
      ["controller_uid", { 15: { stdout: changedController(1, "999") } }],
      ["controller_gid", { 15: { stdout: changedController(2, "999") } }],
      ["controller_mode", { 15: { stdout: changedController(3, "600") } }],
      ["controller_nlink", { 15: { stdout: changedController(4, "2") } }],
      ["controller_size", { 15: { stdout: changedController(5, "1") } }],
      ["controller_device", { 15: { stdout: changedController(6, "x") } }],
      ["controller_inode", { 15: { stdout: changedController(7, "0") } }],
      ["controller_hash_one", {
        16: { stdout: `${"0".repeat(64)}  ${fixture.controller}\n` },
      }],
      ["controller_hash_one_status", { 16: { status: 9 } }],
      ["controller_stat_b", {
        17: {
          stdout: changedController(
            7,
            String(BigInt(controllerFields[7]!) + 1n),
          ),
        },
      }],
      ["controller_stat_b_status", { 17: { status: 9 } }],
      ["version", { 18: { stdout: "1.3.6\n" } }],
      ["version_extra_lf", { 18: { stdout: "1.3.5\n\n" } }],
      ["version_status", { 18: { status: 9 } }],
      ["version_mutation", { 18: { stdout: "1.3.5\n", chmod: 0o700 } }],
      ["stat_c", {
        19: { stdout: changed(7, String(BigInt(fields[7]!) + 1n)) },
      }],
      ["stat_c_status", { 19: { status: 9 } }],
      ["magic_two", { 32: { stdout: "0000000000000000\n" } }],
      ["magic_two_status", { 32: { status: 9 } }],
      ["hash_two", { 33: { stdout: `${"0".repeat(64)}  ${fixture.bun}\n` } }],
      ["hash_two_status", { 33: { status: 9 } }],
      ["controller_hash_two", {
        30: { stdout: `${"0".repeat(64)}  ${fixture.controller}\n` },
      }],
      ["controller_hash_two_status", { 30: { status: 9 } }],
      ["controller_stat_c", {
        31: {
          stdout: changedController(
            7,
            String(BigInt(controllerFields[7]!) + 1n),
          ),
        },
      }],
      ["controller_stat_c_status", { 31: { status: 9 } }],
      ["bun_stat_d", {
        34: { stdout: changed(7, String(BigInt(fields[7]!) + 1n)) },
      }],
      ["bun_stat_d_status", { 34: { status: 9 } }],
    );
    for (let event = 20; event <= 29; event += 1) {
      faults.push([`directory_recheck_${event}`, {
        [event]: { stdout: "Directory|999|999|777|1|1\n" },
      }]);
    }
    faults.push(["directory_recheck_status", { 20: { status: 9 } }]);
    for (const [name, injection] of faults) {
      await resetFixture(fixture, injection);
      const result = await runFixture(fixture, VALID);
      expect(result, name).toEqual({ code: 74, stdout: "", stderr: REFUSED });
      expect(
        (await ledger(fixture)).some((event) =>
          event.kind === "bun" && event.args.at(-1) !== "--version"
        ),
        name,
      ).toBe(false);
    }
  });

  test("refuses an actual Bun symlink before reading or executing it", async () => {
    const fixture = await createFixture();
    const target = `${fixture.bun}.target`;
    await writeFile(target, await readFile(fixture.bun));
    await chmod(target, 0o755);
    await unlink(fixture.bun);
    await symlink(target, fixture.bun);
    await resetFixture(fixture);
    const result = await runFixture(fixture, VALID);
    expect(result).toEqual({ code: 74, stdout: "", stderr: REFUSED });
    const events = await ledger(fixture);
    expect(events.map((event) => event.kind)).toEqual(Array(11).fill("stat"));
  });

  test("refuses an actual controller symlink before hashing or executing it", async () => {
    const fixture = await createFixture();
    const target = `${fixture.controller}.target`;
    await writeFile(target, await readFile(fixture.controller));
    await chmod(target, 0o644);
    await unlink(fixture.controller);
    await symlink(target, fixture.controller);
    await resetFixture(fixture);
    const result = await runFixture(fixture, VALID);
    expect(result).toEqual({ code: 74, stdout: "", stderr: REFUSED });
    const events = await ledger(fixture);
    expect(events.at(-1)?.kind).toBe("stat");
    expect(events.at(-1)?.args.at(-1)).toBe(fixture.controller);
    expect(events.at(-1)?.observed.startsWith("Symbolic Link|")).toBe(true);
    expect(
      events.some((event) =>
        event.kind === "bun" && event.args.at(-1) !== "--version"
      ),
    ).toBe(false);
  });

  test("refuses an actual custody ancestor symlink", async () => {
    const fixture = await createFixture();
    const ancestor = resolve(fixture.bun, "..");
    const target = `${ancestor}.target`;
    await rename(ancestor, target);
    await symlink(target, ancestor);
    await resetFixture(fixture);
    const result = await runFixture(fixture, VALID);
    expect(result).toEqual({ code: 74, stdout: "", stderr: REFUSED });
    const events = await ledger(fixture);
    expect(events.at(-1)?.kind).toBe("stat");
    expect(events.at(-1)?.args.at(-1)).toBe(ancestor);
    expect(events.at(-1)?.observed.startsWith("Symbolic Link|")).toBe(true);
  });

  test.skipIf(process.platform !== "darwin")(
    "the pinned Bun launcher preserves closed cwd, environment, argv, and PID",
    async () => {
      const expectedEnvironment = {
        HOME: "/Users/yournameisai",
        USER: "yournameisai",
        LOGNAME: "yournameisai",
        LANG: "C",
        LC_ALL: "C",
        NO_COLOR: "1",
        TERM: "dumb",
        PATH:
          "/Users/yournameisai/.cache/codex-tools/flyctl-v0.4.74:/Users/yournameisai/.cache/pinned-runtimes/bun-v1.3.5/bun-darwin-aarch64:/usr/bin:/bin:/usr/sbin:/sbin",
      };
      const bun =
        "/Users/yournameisai/.cache/pinned-runtimes/bun-v1.3.5/bun-darwin-aarch64/bun";
      const probeRoot = await mkdtemp(
        join(tmpdir(), "agenttool-refence-launcher-probe-"),
      );
      cleanup.push(probeRoot);
      const probe = join(probeRoot, "probe.ts");
      await writeFile(
        probe,
        "console.log(JSON.stringify({pid:process.pid,cwd:process.cwd(),args:process.argv.slice(2),env:Object.fromEntries(Object.entries(process.env).sort(([a],[b])=>a<b?-1:a>b?1:0))}));\n",
      );
      const spawnThroughLauncher = (
        source: string,
        arguments_: readonly string[],
      ) =>
        Bun.spawn(
          [
            "/usr/bin/env",
            "-i",
            "LANG=C",
            "LC_ALL=C",
            "PATH=/usr/bin:/bin",
            "/usr/bin/perl",
            "-e",
            PERL_LAUNCHER,
            expectedEnvironment.HOME,
            expectedEnvironment.USER,
            expectedEnvironment.PATH,
            bun,
            "--no-install",
            "--no-env-file",
            "--config=/dev/null",
            `--cwd=${ROOT}`,
            source,
            ...arguments_,
          ],
          { cwd: "/", stdout: "pipe", stderr: "pipe" },
        );
      const settle = async (child: ReturnType<typeof spawnThroughLauncher>) => {
        const [stdout, stderr, status] = await Promise.all([
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
          child.exited,
        ]);
        return { code: status, stdout, stderr };
      };
      const child = spawnThroughLauncher(probe, ["controller", ...VALID]);
      const result = await settle(child);
      expect(result.code).toBe(0);
      expect(result.stderr).toBe("");
      const observed = JSON.parse(result.stdout);
      expect(observed.pid).toBe(child.pid);
      expect(observed.cwd).toBe(ROOT);
      expect(observed.args).toEqual(["controller", ...VALID]);
      expect(observed.env).toEqual(expectedEnvironment);

      const controller = join(
        ROOT,
        "bin/phase-b-refence-maintenance-bridge.ts",
      );
      expect(
        await settle(
          spawnThroughLauncher(controller, ["not-controller", ...VALID]),
        ),
      ).toEqual({
        code: 64,
        stdout: "",
        stderr: INVALID,
      });
    },
  );

  test("normalizes a missing inner Bun without ordinary fallthrough", async () => {
    const fixture = await createFixture();
    const source = await readFile(fixture.harness, "utf8");
    const bunArgument = '    "$home" "$operator" "$runtime_path" "$bun" \\\n';
    expect(occurrences(source, bunArgument)).toBe(1);
    const broken = source.replace(
      bunArgument,
      `    "$home" "$operator" "$runtime_path" ${fixture.root}/missing-inner-bun \\\n`,
    );
    const script = join(fixture.root, "inner-bun-failure.sh");
    await writeFile(script, broken);
    await chmod(script, 0o755);
    await resetFixture(fixture);
    const result = await run(
      ["/bin/bash", script, ...VALID],
      fixture.root,
      fixtureEnvironment(),
    );
    expect(result).toEqual({ code: 74, stdout: "", stderr: REFUSED });
    expect(result.stderr).not.toContain("missing-inner-bun");
    expect(result.stderr).not.toContain("ordinary_tail");
    expect(
      (await ledger(fixture)).filter((event) => event.kind === "bun"),
    ).toHaveLength(1);
  });

  test("cannot fall through when the final exec builtin returns", async () => {
    const fixture = await createFixture();
    const execNeedle = "  builtin exec /usr/bin/env -i";
    const source = await readFile(fixture.harness, "utf8");
    expect(occurrences(source, execNeedle)).toBe(1);
    const broken = source.replace(
      execNeedle,
      `  exec ${fixture.root}/missing-env -i`,
    );
    const script = join(fixture.root, "exec-failure.sh");
    await writeFile(script, broken);
    await chmod(script, 0o755);
    for (const options of [[], ["-O", "execfail"]]) {
      await resetFixture(fixture);
      const result = await run(
        ["/bin/bash", ...options, script, ...VALID],
        fixture.root,
        fixtureEnvironment(),
      );
      expect(result.code).toBe(74);
      expect(result.stdout).toBe("");
      expect(result.stderr.endsWith(REFUSED)).toBe(true);
      expect(result.stderr).not.toContain("ordinary_tail");
      expect(
        (await ledger(fixture)).some((event) =>
          event.kind === "bun" && event.args.at(-1) !== "--version"
        ),
      ).toBe(false);
    }
  });
});
