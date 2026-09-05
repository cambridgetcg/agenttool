import { expect, test } from "bun:test";

// Each case loads the public abstraction in its own process. The native
// boundary is replaced before import, including on Linux CI: no test can
// read or mutate any real Keychain item or leak a mock into another test.
const runner = String.raw`
  const input = JSON.parse(await Bun.stdin.text());
  Object.defineProperty(process, "platform", { value: "darwin" });
  const calls = [];
  Bun.spawnSync = (argv, options = {}) => {
    calls.push({
      argv, stdin: options.stdin ? Buffer.from(options.stdin).toString("utf8") : null,
      stdout: options.stdout, stderr: options.stderr,
      explicit_env: Object.hasOwn(options, "env"),
    });
    if (input.throwAt === calls.length) throw new Error("synthetic-private-driver-detail");
    if (calls.length === 1) return { exitCode: input.writeExit ?? 0 };
    if (calls.length === 2) return {
      exitCode: input.readExit ?? 0,
      stdout: Buffer.from(input.readback ?? input.value + "\n"),
    };
    throw new Error("unexpected native call");
  };
  let error = null;
  try {
    const { setSecret } = await import(process.argv[1]);
    await setSecret(input.service, input.value);
  } catch (caught) { error = caught.message; }
  process.stdout.write(JSON.stringify({ calls, error }));
`;

type Input = {
  service?: string; value: string; account?: string;
  writeExit?: number; readExit?: number; readback?: string; throwAt?: number;
};
type Result = {
  error: string | null;
  calls: Array<{
    argv: string[]; stdin: string | null; stdout: string; stderr: string;
    explicit_env: boolean;
  }>;
};
function run(input: Input): Result {
  const child = Bun.spawnSync([
    process.execPath, "--no-env-file", "-e", runner,
    new URL("../_secret-store.ts", import.meta.url).href,
  ], {
    env: { USER: input.account ?? "fixture-account" },
    stdin: Buffer.from(JSON.stringify({ service: "agenttool-fixture", ...input })),
    stdout: "pipe", stderr: "pipe", timeout: 5_000,
  });
  expect(child.exitCode).toBe(0);
  expect(child.stderr.byteLength).toBe(0);
  return JSON.parse(child.stdout.toString());
}

function parseCommand(line: string) {
  // Closed grammar corresponding to security's quoted argument parser.
  const match = /^add-generic-password -U -s "((?:[^"\\\r\n]|\\["\\])*)" -a "((?:[^"\\\r\n]|\\["\\])*)" -X ([0-9a-f]+)\n$/u.exec(line);
  expect(match).not.toBeNull();
  const unquote = (text: string) => text.replace(/\\(["\\])/gu, "$1");
  return {
    service: unquote(match![1]!), account: unquote(match![2]!),
    value: Buffer.from(match![3]!, "hex").toString("utf8"),
  };
}

test("macOS writer preserves ASCII punctuation through one stdin-only hex command", () => {
  const service = 'agenttool-fixture "quoted" \\ tail ; $(fixture) `literal`';
  const account = 'fixture account "quoted" \\ tail ; $(fixture) `literal`';
  const value = Array.from({ length: 95 }, (_, index) => String.fromCharCode(32 + index)).join("");
  const result = run({ service, account, value });
  expect(result.error).toBeNull();
  expect(result.calls).toHaveLength(2);
  const write = result.calls[0]!;
  expect(write.argv).toEqual(["/usr/bin/security", "-i"]);
  expect(write.stdout).toBe("ignore");
  expect(write.stderr).toBe("ignore");
  expect(write.explicit_env).toBe(false);
  expect(parseCommand(write.stdin!)).toEqual({ service, account, value });
  expect(write.stdin!.split("\n")).toHaveLength(2);
  expect(write.stdin).not.toContain(value);
  expect(JSON.stringify(write.argv)).not.toContain(value);
  expect(result.calls[1]!.argv).toEqual([
    "/usr/bin/security", "find-generic-password", "-s", service, "-a", account, "-w",
  ]);
});

test("macOS writer preserves well-formed Unicode selectors", () => {
  const service = "agenttool-fixture-秘密";
  const account = "fixture-人";
  const result = run({ service, account, value: "synthetic-token" });
  expect(result.error).toBeNull();
  expect(parseCommand(result.calls[0]!.stdin!)).toEqual({ service, account, value: "synthetic-token" });
});

test.each(["", "line\nbreak", "carriage\rreturn", "tab\tvalue", "nul\0value", "delete\x7f", "秘密", "\ud800"])(
  "unsupported macOS value is rejected before any native operation (case %#)", (value) => {
    const result = run({ value });
    expect(result.error).toBe("macosSet: only non-empty printable ASCII values are supported");
    expect(result.calls).toEqual([]);
  },
);

test.each(["", "fixture\nhelp", "fixture\rhelp", "fixture\0suffix", "fixture\tvalue", "fixture\x7f", "fixture\ud800"])(
  "unsupported selectors cannot mutate an existing item (case %#)", (selector) => {
    // NUL and lone surrogates cannot survive OS environment encoding;
    // they are still exercised at the public service-string boundary.
    const fields = selector.includes("\0") || selector.includes("\ud800")
      ? ["service"] as const : ["service", "account"] as const;
    for (const field of fields) {
      const result = run({ [field]: selector, value: "existing-item-must-survive" });
      expect(result.error).toBe("macosSet: selectors must be non-empty text without ASCII control characters");
      expect(result.calls).toEqual([]);
    }
  },
);

test("macOS command limit accounts for encoded values and UTF-8 selector bytes", () => {
  const service = "agenttool-fixture";
  const account = "fixture-account";
  const overhead = Buffer.byteLength(`add-generic-password -U -s "${service}" -a "${account}" -X \n`);
  const capacity = Math.floor((4095 - overhead) / 2);
  const accepted = run({ service, account, value: "x".repeat(capacity) });
  expect(accepted.error).toBeNull();
  expect(Buffer.byteLength(accepted.calls[0]!.stdin!)).toBeLessThanOrEqual(4095);
  for (const input of [
    { service, account, value: "x".repeat(capacity + 1) },
    { service: service + "人", account, value: "x".repeat(capacity) },
    { service: '"'.repeat(2100), account, value: "x" },
  ]) {
    const rejected = run(input);
    expect(rejected.error).toBe("macosSet: encoded command exceeds the macOS keychain input limit");
    expect(rejected.calls).toEqual([]);
  }
});

test("native write failure cannot be masked by readback or a second stdin command", () => {
  const result = run({ value: "synthetic-value", writeExit: 36 });
  expect(result.error).toBe("macosSet: security add-generic-password exit=36");
  expect(result.calls).toHaveLength(1);
  parseCommand(result.calls[0]!.stdin!);
});

test.each([
  { readback: "\n" }, { readback: "different\n" },
  { readback: "synthetic-value" }, { readExit: 44 },
])("exit-zero writes require exact successful readback (case %#)", (options) => {
  const result = run({ value: "synthetic-value", ...options });
  expect(result.error).toBe("macosSet: keychain readback did not match the supplied value");
  expect(result.calls).toHaveLength(2);
  expect(result.calls.some(({ argv }) => argv.includes("delete-generic-password"))).toBe(false);
});

test.each([1, 2])("native exceptions are redacted (call %i)", (throwAt) => {
  const result = run({ value: "synthetic-value", throwAt });
  expect(result.error).toBe(`macosSet: security ${throwAt === 1 ? "write" : "readback"} invocation failed`);
  expect(result.error).not.toContain("synthetic-private-driver-detail");
});
