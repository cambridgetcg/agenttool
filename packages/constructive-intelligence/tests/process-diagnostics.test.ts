import { expect, test } from "bun:test";
import { classifyCapturedOutput, classifyLinuxSyscall } from "./process-diagnostics.js";

test("child diagnostic classification keeps only closed codes and known source frames", () => {
  const secret = "private-fixture-value-must-not-appear";
  const text = [
    JSON.stringify({ error: "file_error", message: secret }),
    `ConstructiveError: ${secret}; no group/other write bits`,
    `    at /private/${secret}/src/store.ts:675:12`,
    `    at /private/${secret}/src/cli.ts:152:5`,
    `    at /private/${secret}/unrelated.ts:99:1`,
    `ENOENT EPIPE arbitrary ${secret}`,
  ].join("\n");
  const result = classifyCapturedOutput(text);
  expect(result.json_line_errors).toEqual(["file_error"]);
  expect(result.markers).toContain("constructive_error_header");
  expect(result.markers).toContain("permission_refusal");
  expect(result.system_errors).toEqual(["ENOENT", "EPIPE"]);
  expect(result.source_frames).toEqual([
    { file: "store.ts", line: 675, column: 12 },
    { file: "cli.ts", line: 152, column: 5 },
  ]);
  expect(JSON.stringify(result)).not.toContain(secret);
  expect(JSON.stringify(result)).not.toContain("/private/");
  expect(JSON.stringify(result)).not.toContain("unrelated");
});

test("partial crash output remains classified without a full JSON response", () => {
  const result = classifyCapturedOutput("Bun v1.3.5 (private-machine-details)\npanic(main thread): private detail\noh no: Bun has crashed.\nSQLiteError: database is locked\n");
  expect(result.markers).toContain("bun_version_banner");
  expect(result.markers).toContain("bun_panic");
  expect(result.markers).toContain("bun_crash_banner");
  expect(result.markers).toContain("sqlite_busy");
  expect(JSON.stringify(result)).not.toContain("private");
  expect(classifyCapturedOutput('arbitrary secret {"error":"unrecognized-secret"}')).toEqual({
    json_line_errors: [], markers: [], system_errors: [], source_frames: [],
  });
});

test("diagnostic source-frame output is capped even for a large stderr body", () => {
  const text = Array.from({ length: 100 }, (_, index) => `/private/value/src/store.ts:${index + 1}:1`).join("\n");
  expect(classifyCapturedOutput(text).source_frames).toHaveLength(8);
});

test("Linux syscall classification omits arguments, addresses and non-stdio descriptors", () => {
  expect(classifyLinuxSyscall("1 0x2 0xdeadbeef 0x2000 0x0", "x64")).toEqual({ syscall: "write", stdio_descriptor: 2 });
  expect(classifyLinuxSyscall("74 0x8 0xdeadbeef 0x0", "x64")).toEqual({ syscall: "fsync", stdio_descriptor: null });
  expect(classifyLinuxSyscall("1 0x8 0xdeadbeef 0x0", "x64")).toEqual({ syscall: "write", stdio_descriptor: null });
  expect(classifyLinuxSyscall("running", "x64")).toEqual({ syscall: null, stdio_descriptor: null });
  expect(classifyLinuxSyscall("toString 0x2", "x64")).toEqual({ syscall: null, stdio_descriptor: null });
  expect(classifyLinuxSyscall("74 0x8 0xdeadbeef 0x0", "arm64")).toEqual({ syscall: null, stdio_descriptor: null });
  expect(JSON.stringify(classifyLinuxSyscall("1 0x2 0xdeadbeef 0x0", "x64"))).not.toContain("deadbeef");
});
