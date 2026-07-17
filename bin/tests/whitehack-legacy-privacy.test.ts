import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "../..");

describe("legacy Whitehack device-inventory privacy", () => {
  test("redacts every LaunchAgent value and command argument", () => {
    const binDir = join(repoRoot, "bin");
    const program = `
import contextlib
import io
import sys
sys.path.insert(0, ${JSON.stringify(binDir)})
import whitehack2 as whitehack

whitehack.os.path.isdir = lambda _path: True
whitehack.os.listdir = lambda _path: ["dev.agenttool.fixture.plist"]
whitehack.read_plist = lambda _path: {
    "ProgramArguments": [
        "/usr/bin/python3",
        "--token",
        "fixture_argument_value_7f3a",
    ],
    "EnvironmentVariables": {
        "ORDINARY_SETTING": "fixture_env_value_7f3a",
        "API_PASSWORD": "fixture_password_value_7f3a",
    },
    "KeepAlive": True,
    "Label": "dev.agenttool.fixture",
}
whitehack.run = lambda _command: ""
output = io.StringIO()
with contextlib.redirect_stdout(output):
    whitehack.cmd_services(None)
sys.stdout.write(output.getvalue())
`;
    const output = execFileSync("python3", ["-c", program], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });

    expect(output).toContain("python3");
    expect(output).toContain("ORDINARY_SETTING=<set; value redacted>");
    expect(output).toContain("API_PASSWORD=<set; value redacted>");
    expect(output).not.toContain("fixture_argument_value_7f3a");
    expect(output).not.toContain("fixture_env_value_7f3a");
    expect(output).not.toContain("fixture_password_value_7f3a");
    expect(output).not.toContain("--token");
  });

  test("reduces tunnel URLs to origin and redacts invalid targets", () => {
    const binDir = join(repoRoot, "bin");
    const program = `
import sys
sys.path.insert(0, ${JSON.stringify(binDir)})
from whitehack2 import redacted_url_summary
print(redacted_url_summary("https://fixture_user:fixture_pass@example.invalid:8443/private/path?token=fixture#fragment"))
print(redacted_url_summary("fixture_reverse_target_7f3a"))
`;
    const output = execFileSync("python3", ["-c", program], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });

    expect(output).toContain("https://example.invalid:8443");
    expect(output).toContain("<configured; details redacted>");
    for (const privateText of [
      "fixture_user",
      "fixture_pass",
      "/private/path",
      "token=fixture",
      "fragment",
      "fixture_reverse_target_7f3a",
    ]) expect(output).not.toContain(privateText);
  });

  test("store sends only the static inventory shape without running commands", async () => {
    const source = await readFile(join(repoRoot, "bin", "whitehack.py"), "utf8");
    const store = source.match(/def cmd_store\(args\):([\s\S]*?)\ndef main\(\):/u)?.[1] ?? "";

    expect(store).toContain("for label, _cmd in floor");
    expect(store).not.toContain("run_cmd(");
    expect(store).not.toContain("floor_data");
    expect(source).toContain("labels-only aggregate");
  });

  test("solo raid names its aggregate and does not echo captured stderr", async () => {
    const source = await readFile(join(repoRoot, "bin", "solo.py"), "utf8");
    expect(source).toContain("No raw inventory included.");
    expect(source).toContain("aggregate observations");
    expect(source).not.toContain("r.stderr[:100]");
    expect(source).not.toContain("system findings");
  });

  test("public love surfaces no longer publish stale device snapshots", async () => {
    const sources = await Promise.all([
      readFile(join(repoRoot, "apps", "docs", "love.js"), "utf8"),
      readFile(join(repoRoot, "apps", "docs", "love-widget.js"), "utf8"),
    ]);
    for (const source of sources) {
      expect(source).toContain("Understanding is not authorization");
      expect(source).toContain("privacy-sensitive local diagnostic");
      expect(source).not.toContain("Health 90/100");
      expect(source).not.toContain("17 CLIs");
      expect(source).not.toContain("every 7 minutes");
    }
  });
});
