import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = join(import.meta.dir, "..", "..");

describe("data collector credential and scope boundary", () => {
  test("bundled Python clients do not disable TLS or accept bearers from argv", () => {
    const binDir = join(ROOT, "bin");
    for (const name of readdirSync(binDir).filter((entry) => entry.endsWith(".py"))) {
      const source = readFileSync(join(binDir, name), "utf8");
      expect(source).not.toContain("ssl.CERT_NONE");
      expect(source).not.toContain("check_hostname = False");
      expect(source).not.toMatch(/sys\.argv[^\n]*starts?with\(["']at_/);
      if (source.includes('headers["Authorization"]') || source.includes('"Authorization":')) {
        expect(source).toContain("open_no_redirect");
      }
    }
  });

  test("shared client transport rejects cleartext remote API bases and redirects", () => {
    const helper = readFileSync(join(ROOT, "bin/http_safety.py"), "utf8");
    expect(helper).toContain("class _NoRedirect");
    expect(helper).toContain("return None");
    expect(helper).toContain('parsed.scheme != "https"');

    const probe = spawnSync(
      "python3",
      [
        "-c",
        [
          "from http_safety import validate_api_base",
          "assert validate_api_base('https://selfhost.example/') == 'https://selfhost.example'",
          "assert validate_api_base('http://127.0.0.1:3000/') == 'http://127.0.0.1:3000'",
          "try:",
          "    validate_api_base('http://selfhost.example')",
          "except ValueError:",
          "    pass",
          "else:",
          "    raise AssertionError('remote cleartext API base accepted')",
        ].join("\n"),
      ],
      {
        cwd: join(ROOT, "bin"),
        encoding: "utf8",
      },
    );
    expect(probe.status).toBe(0);
    expect(probe.stderr).toBe("");
  });

  test("collector output is owner-readable only", () => {
    const probe = spawnSync(
      "python3",
      [
        "-c",
        [
          "import os, stat, tempfile",
          "from collect import write_private_json",
          "with tempfile.TemporaryDirectory() as d:",
          "    p = os.path.join(d, 'snapshot.json')",
          "    write_private_json(p, {'ok': True})",
          "    assert stat.S_IMODE(os.stat(p).st_mode) == 0o600",
        ].join("\n"),
      ],
      {
        cwd: join(ROOT, "bin"),
        encoding: "utf8",
      },
    );
    expect(probe.status).toBe(0);
    expect(probe.stderr).toBe("");
  });

  test("keeps TLS verification enabled and reads bearer only from env", () => {
    const source = readFileSync(join(ROOT, "bin/collect.py"), "utf8");

    expect(source).toContain('BEARER = os.environ.get("AT_API_KEY")');
    expect(source).toContain("ssl.create_default_context()");
    expect(source).not.toContain("CERT_NONE");
    expect(source).not.toContain("check_hostname = False");
    expect(source).not.toMatch(/sys\.argv[^\n]*starts?with\(["']at_/);
  });

  test("is valid Python and describes a selected snapshot rather than a whole self", () => {
    const script = join(ROOT, "bin/collect.py");
    const result = spawnSync(
      "python3",
      ["-c", "import ast, pathlib, sys; ast.parse(pathlib.Path(sys.argv[1]).read_text())", script],
      {
      encoding: "utf8",
      },
    );
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");

    const source = readFileSync(script, "utf8");
    expect(source).toContain("selected endpoint snapshot");
    expect(source).not.toContain("everything an agent is");
  });
});
