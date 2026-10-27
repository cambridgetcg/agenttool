/** The gate reads SSH_ORIGINAL_COMMAND as data against a closed grammar:
 * anything else exits 2 (or 4 for a bad file name or size, 1 for a lane that
 * is not one), leaves the spool byte-identical, and never echoes the input.
 * Every put declares its size; the forms without one are refused. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { DARWIN_ONLY, Lab, SHELLS } from "./helpers.ts";

const ID = "20261027T120000Z-0a1b2c3d";

const HOSTILE: [string, string | undefined, number][] = [
  ["unset", undefined, 2],
  ["empty", "", 2],
  ["a ; chain", "ping; id", 2],
  ["an && chain", "ping && id", 2],
  ["a $() substitution", "$(id)", 2],
  ["backticks", "`id`", 2],
  ["a newline", "put lobby 2\nid", 2],
  ["a TAB", "put\tlobby", 2],
  ["a doubled space", "put  lobby", 2],
  ["a leading space", " ping", 2],
  ["a trailing space", "ping ", 2],
  ["161 characters", `ping ${"a".repeat(156)}`, 2],
  ["upper case", "PING", 2],
  ["a path in get", "get ../../etc/passwd", 2],
  ["an extra word", `get ${ID} extra`, 2],
  ["a glob in get", "get 2026*", 2],
  ["a glob in ack", "ack *", 2],
  ["a path as recipient", "put file ../x y 1", 2],
  ["a path as name", "put file studio ../../x 1", 2],
  ["a dot name", "put file studio .hidden 1", 4],
  ["an option-like name", "put file studio -rf 1", 4],
  ["a .part name", "put file studio a.part 1", 4],
  ["sending to itself", "put file air x 1", 2],
  ["a reserved recipient", "put file hub x 1", 2],
  ["a doubled space in put lobby", "put  lobby 1", 2],
  ["put lobby without a size", "put lobby", 2],
  ["put file without a size", "put file studio x.txt", 2],
  ["a size that is not a number", "put file studio x.txt ten", 2],
  ["a size with a leading zero", "put lobby 01", 2],
  ["a negative size", "put lobby -1", 2],
  ["a 13-digit size", "put file studio x.txt 1234567890123", 2],
  ["a zero size", "put file studio x.txt 0", 4],
  ["a lobby size over 64 KiB", "put lobby 65537", 4],
  ["a file size over 16 MiB", "put file studio x.txt 16777217", 4],
  ["non-ASCII", "pïng", 2],
  ["sftp", "sftp", 2],
  ["internal-sftp", "internal-sftp", 2],
  ["scp", "scp -t /tmp", 2],
  ["rsync", "rsync --server -vlogDtpre.iLsfxC . /tmp", 2],
  ["an id that is not one", "get 20261027T120000Z-0A1B2C3D", 2],
  ["put with a word for a size", "put lobby now", 2],
  ["put lobby with a fourth word", "put lobby 1 now", 2],
];

describe.skipIf(DARWIN_ONLY)("gate grammar (macOS only: BSD stat, date -v, xattr)", () => {
  describe.each(SHELLS)("under %s", (shell) => {
    let lab: Lab;
    beforeAll(() => {
      lab = new Lab(shell);
    });
    afterAll(() => lab.cleanup());

    test.each(HOSTILE)("%s is refused without echo or change", (_label, cmd, code) => {
      const before = lab.spoolDigest();
      const logBefore = lab.gateLog();
      const r = lab.gate("air", cmd, "x");
      expect(r.code).toBe(code);
      expect(r.stdout.length).toBe(0);
      expect(lab.spoolDigest()).toBe(before);
      expect(r.err).toMatch(/^ferry-gate: [a-z]+: [^\n]+\n$/);
      if (cmd !== undefined && cmd.length >= 3) {
        expect(r.err.includes(cmd)).toBe(false);
        expect(lab.gateLog().includes(cmd)).toBe(false);
      }
      const added = lab.gateLog().slice(logBefore.length).split("\n").filter((l) => l !== "");
      expect(added.length).toBe(1);
      expect(added[0]).toContain(` code=${code} `);
    });

    test("a well-formed ping answers on stdout only", () => {
      const r = lab.gate("air", "ping");
      expect(r.code).toBe(0);
      expect(r.out).toBe("ok ping gate=2 peer=air\n");
      expect(r.err).toBe("");
    });

    test.each([
      ["no argv", [], 2],
      ["--peer alone", ["--peer"], 2],
      ["--peer ../x", ["--peer", "../x"], 2],
      ["two peers", ["--peer", "air", "--peer", "studio"], 2],
      ["the local peer", ["--peer", "lab"], 1],
      ["a reserved name", ["--peer", "hub"], 1],
      ["a lane not provisioned", ["--peer", "ghost"], 1],
      ["an unknown flag", ["--shell"], 2],
    ] as [string, string[], number][])("bad argv: %s", (_label, argv, code) => {
      const before = lab.spoolDigest();
      const r = lab.gate("air", "ping", undefined, { argv });
      expect(r.code).toBe(code);
      expect(r.stdout.length).toBe(0);
      expect(lab.spoolDigest()).toBe(before);
    });

    test("--self-check reports on stdout", () => {
      const r = lab.gate("air", undefined, undefined, { argv: ["--self-check"] });
      expect(r.code).toBe(0);
      expect(r.out).toBe("ok self-check gate=2\n");
    });

    test("a get or ack for an id that is not there is 3", () => {
      expect(lab.gate("air", `get ${ID}`).code).toBe(3);
      expect(lab.gate("air", `ack ${ID}`).code).toBe(3);
    });

    test("the client's locale never changes the grammar", () => {
      // The fake environment passes LANG/LC_* like sshd's AcceptEnv; the gate
      // pins LC_ALL=C, so a UTF-8 byte is still outside [a-z0-9A-Z._ -].
      const r = lab.gate("air", "ping ");
      expect(r.code).toBe(2);
    });
  });
});
