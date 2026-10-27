/** ferry-admin is the only writer of authorized_keys: one golden restricted
 * line per lane, a typed `yes` on the terminal for every change, and no
 * fingerprint ever pre-filled into a command for another machine. */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DARWIN_ONLY, FIXED_EXPIRY, Lab, readScript, rewriteBlock, SHELLS } from "./helpers.ts";

const HEADER = "# ferry lanes. Written only by /Library/Ferry/bin/ferry-admin; do not edit by hand.";

function keygen(dir: string, name: string, type = "ed25519"): { path: string; b64: string; fp: string } {
  const path = join(dir, name);
  Bun.spawnSync({ cmd: ["/usr/bin/ssh-keygen", "-q", "-t", type, "-N", "", "-C", `ferry:${name}`, "-f", path] });
  const b64 = readFileSync(`${path}.pub`, "utf8").split(" ")[1]!;
  const fp = Bun.spawnSync({ cmd: ["/usr/bin/ssh-keygen", "-l", "-E", "sha256", "-f", `${path}.pub`], stdout: "pipe" }).stdout.toString().split(" ")[1]!;
  return { path: `${path}.pub`, b64, fp };
}

function modeOf(path: string): string {
  return (statSync(path).mode & 0o7777).toString(8).padStart(4, "0");
}

describe.skipIf(DARWIN_ONLY)("ferry-admin (macOS only: BSD stat, date -v, xattr)", () => {
  describe.each(SHELLS)("under %s", (shell) => {
    let lab: Lab;
    let ak: string;
    beforeEach(() => {
      lab = new Lab(shell, { peers: [] });
      ak = join(lab.ferryHome, ".ssh/authorized_keys");
    });
    afterEach(() => lab.cleanup());

    const line = (peer: string, b64: string, exp = FIXED_EXPIRY) =>
      `restrict,from="192.0.2.0/24",expiry-time="${exp}Z",command="${lab.ferryRoot}/libexec/ferry-gate --peer ${peer}" ssh-ed25519 ${b64} ferry-lane:${peer}`;

    test("lane add writes the golden line, keeps .prev and creates three 2770 directories", () => {
      const k = keygen(lab.root, "air");
      const r = lab.admin(["lane", "add", "--peer", "air", "--pubkey-file", k.path, "--expect-fp", k.fp], "yes\n");
      expect(r.code).toBe(0);
      expect(readFileSync(ak, "utf8")).toBe(`${HEADER}\n${line("air", k.b64)}\n`);
      expect(readFileSync(`${ak}.prev`, "utf8")).toBe(`${HEADER}\n`);
      expect(modeOf(ak)).toBe("0644");
      for (const d of ["lobby/in/air", "lobby/out/air", "files/air"]) expect(modeOf(join(lab.spool, d))).toBe("2770");
      expect(r.out).toMatch(/^lane air added; expires 2027-01-25 \(\d+ days\)\. Next on air: ferry peer add hub --host <this lab's mdns name> --host-key-fp <type the SHA256 fingerprint from ferry-admin whoami on the lab's own screen>, then ferry ping\n$/);
      const shown = readFileSync(join(lab.ctl, "tty"), "utf8");
      expect(shown).toContain(line("air", k.b64));
      expect(shown).toContain(`${k.fp} (matches what you typed)`);
      expect(shown).toContain("type yes to continue: ");
      expect(r.out.includes(k.fp)).toBe(false);
      expect(lab.gate("air", "ping").code).toBe(0);
    });

    test("a fingerprint mismatch is 1 and the computed value is not printed", () => {
      const k = keygen(lab.root, "air");
      const other = keygen(lab.root, "other");
      const r = lab.admin(["lane", "add", "--peer", "air", "--pubkey-file", k.path, "--expect-fp", other.fp], "yes\n");
      expect(r.code).toBe(1);
      expect(r.err).toBe("ferry-admin: refused: the key file does not match the fingerprint you typed\n");
      expect(`${r.out}${r.err}${readFileSync(join(lab.ctl, "tty"), "utf8")}`.includes(k.fp)).toBe(false);
      expect(readFileSync(ak, "utf8")).toBe(`${HEADER}\n`);
    });

    test("duplicate peers, duplicate keys and reserved names are refused", () => {
      const k = keygen(lab.root, "air");
      expect(lab.admin(["lane", "add", "--peer", "air", "--pubkey-file", k.path, "--expect-fp", k.fp], "yes\n").code).toBe(0);
      const before = readFileSync(ak, "utf8");
      const k2 = keygen(lab.root, "air2");
      expect(lab.admin(["lane", "add", "--peer", "air", "--pubkey-file", k2.path, "--expect-fp", k2.fp], "yes\n").code).toBe(1);
      expect(lab.admin(["lane", "add", "--peer", "studio", "--pubkey-file", k.path, "--expect-fp", k.fp], "yes\n").code).toBe(1);
      for (const name of ["hub", "lab", "ferry", "all"]) {
        expect(lab.admin(["lane", "add", "--peer", name, "--pubkey-file", k2.path, "--expect-fp", k2.fp], "yes\n").code).toBe(1);
      }
      expect(lab.admin(["lane", "add", "--peer", "Bad_Name", "--pubkey-file", k2.path, "--expect-fp", k2.fp], "yes\n").code).toBe(2);
      expect(readFileSync(ak, "utf8")).toBe(before);
    });

    test("pubkey files with options, two lines, RSA, over 1 KiB or a symlink are refused", () => {
      const k = keygen(lab.root, "air");
      const pub = readFileSync(k.path, "utf8");
      const cases: [string, () => string][] = [
        ["options", () => { const p = join(lab.root, "opt.pub"); writeFileSync(p, `restrict ${pub}`); return p; }],
        ["two lines", () => { const p = join(lab.root, "two.pub"); writeFileSync(p, `${pub}${pub}`); return p; }],
        ["rsa", () => keygen(lab.root, "rsa", "rsa").path],
        ["over 1 KiB", () => { const p = join(lab.root, "big.pub"); writeFileSync(p, `${pub.trimEnd()} ${"c".repeat(1100)}\n`); return p; }],
        ["a symlink", () => { const p = join(lab.root, "link.pub"); symlinkSync(k.path, p); return p; }],
      ];
      for (const [name, make] of cases) {
        const r = lab.admin(["lane", "add", "--peer", "air", "--pubkey-file", make(), "--expect-fp", k.fp], "yes\n");
        expect({ name, code: r.code }).toEqual({ name, code: 1 });
      }
      expect(readFileSync(ak, "utf8")).toBe(`${HEADER}\n`);
      expect(existsSync(join(lab.spool, "files/air"))).toBe(false);
    });

    test("a link planted where a lane directory belongs is 6 and nothing changes", () => {
      const outside = join(lab.root, "outside");
      mkdirSync(outside);
      chmodSync(outside, 0o755);
      symlinkSync(outside, join(lab.spool, "files/air"));
      const k = keygen(lab.root, "air");
      const r = lab.admin(["lane", "add", "--peer", "air", "--pubkey-file", k.path, "--expect-fp", k.fp], "yes\n");
      expect(r.code).toBe(6);
      expect(readFileSync(ak, "utf8")).toBe(`${HEADER}\n`);
      expect((statSync(outside).mode & 0o7777).toString(8)).toBe("755");
      expect(existsSync(join(lab.spool, "lobby/in/air"))).toBe(false);
    });

    test("a line ferry-admin did not write is 6", () => {
      writeFileSync(ak, `${HEADER}\nssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIexample someone\n`);
      const k = keygen(lab.root, "air");
      const r = lab.admin(["lane", "add", "--peer", "air", "--pubkey-file", k.path, "--expect-fp", k.fp], "yes\n");
      expect(r.code).toBe(6);
      expect(r.err).toBe("ferry-admin: unsafe: authorized_keys has a line ferry-admin did not write; inspect it by hand\n");
      expect(lab.admin(["lane", "list"]).code).toBe(6);
    });

    test("no yes, or no terminal, is 3 and nothing changes", () => {
      const k = keygen(lab.root, "air");
      const no = lab.admin(["lane", "add", "--peer", "air", "--pubkey-file", k.path, "--expect-fp", k.fp], "no\n");
      expect(no.code).toBe(3);
      expect(no.err).toBe("ferry-admin: notconfirmed: not confirmed; nothing changed\n");
      const yesish = lab.admin(["lane", "add", "--peer", "air", "--pubkey-file", k.path, "--expect-fp", k.fp], "YES\n");
      expect(yesish.code).toBe(3);
      const notty = lab.admin(["lane", "add", "--peer", "air", "--pubkey-file", k.path, "--expect-fp", k.fp]);
      expect(notty.code).toBe(3);
      expect(readFileSync(ak, "utf8")).toBe(`${HEADER}\n`);
      expect(existsSync(`${ak}.prev`)).toBe(false);
      expect(existsSync(join(lab.spool, "files/air"))).toBe(false);
    });

    test("without root, changes are 1; list and whoami still work and print placeholders", () => {
      const rootAdmin = join(lab.ferryRoot, "bin", "ferry-admin-root");
      writeFileSync(rootAdmin, rewriteBlock(readScript("admin"), {
        FERRY_ROOT: lab.ferryRoot, REQUIRE_ROOT: "1", TTY: join(lab.ctl, "tty"), HOST_KEYS: lab.hostKeyPub,
        DATE: join(lab.bin, "date"), SCUTIL: join(lab.bin, "scutil"), IPCONFIG: join(lab.bin, "ipconfig"),
      }));
      writeFileSync(join(lab.ctl, "tty"), "yes\n");
      const k = keygen(lab.root, "air");
      const run = (args: string[]) => lab.run([shell, rootAdmin, ...args]);
      expect(run(["lane", "add", "--peer", "air", "--pubkey-file", k.path, "--expect-fp", k.fp]).code).toBe(1);
      expect(readFileSync(ak, "utf8")).toBe(`${HEADER}\n`);
      expect(lab.admin(["lane", "add", "--peer", "air", "--pubkey-file", k.path, "--expect-fp", k.fp], "yes\n").code).toBe(0);
      const list = run(["lane", "list"]);
      expect(list.code).toBe(0);
      expect(list.out).toMatch(new RegExp(`^air +${k.fp.replace(/[+/]/g, "\\$&")}  expires 2027-01-25 \\(\\d+ days left\\)  from 192\\.0\\.2\\.0/24\\n1 lanes\\n$`));
      const who = run(["whoami"]);
      expect(who.code).toBe(0);
      expect(who.out).toBe([
        `host key (ed25519) ${lab.hostKeyFp}`,
        "mdns ferry-test-lab.local",
        "ipv4 192.0.2.10",
        "lane subnet 192.0.2.0/24",
        "on each Mac: ferry peer add hub --host ferry-test-lab.local --host-key-fp <type the SHA256 fingerprint from the lab's own screen>",
        "",
      ].join("\n"));
    });

    test("renew changes only the expiry, even for an expired lane", () => {
      const a = keygen(lab.root, "air");
      const s = keygen(lab.root, "studio");
      lab.admin(["lane", "add", "--peer", "air", "--pubkey-file", a.path, "--expect-fp", a.fp], "yes\n");
      lab.admin(["lane", "add", "--peer", "studio", "--pubkey-file", s.path, "--expect-fp", s.fp], "yes\n");
      writeFileSync(ak, `${HEADER}\n${line("air", a.b64, "20250101000000")}\n${line("studio", s.b64, "20260101000000")}\n`);
      const listed = lab.admin(["lane", "list"]);
      expect(listed.out).toContain("(EXPIRED)");
      const r = lab.admin(["lane", "renew", "--peer", "air"], "yes\n");
      expect(r.code).toBe(0);
      expect(r.out).toBe("lane air renewed; expires 2027-01-25\n");
      expect(readFileSync(ak, "utf8")).toBe(`${HEADER}\n${line("air", a.b64)}\n${line("studio", s.b64, "20260101000000")}\n`);
      expect(lab.admin(["lane", "renew", "--peer", "mini"], "yes\n").code).toBe(3);
    });

    test("remove deletes the line and the lane's spool directories", () => {
      const a = keygen(lab.root, "air");
      const s = keygen(lab.root, "studio");
      lab.admin(["lane", "add", "--peer", "air", "--pubkey-file", a.path, "--expect-fp", a.fp], "yes\n");
      lab.admin(["lane", "add", "--peer", "studio", "--pubkey-file", s.path, "--expect-fp", s.fp], "yes\n");
      lab.putFile("studio", "air", "x.txt", "x\n");
      const r = lab.admin(["lane", "remove", "--peer", "air"], "yes\n");
      expect(r.code).toBe(0);
      expect(readFileSync(join(lab.ctl, "tty"), "utf8")).toContain(`${join(lab.spool, "files/air")} (1 items)`);
      expect(readFileSync(ak, "utf8")).toBe(`${HEADER}\n${line("studio", s.b64)}\n`);
      for (const d of ["lobby/in/air", "lobby/out/air", "files/air"]) expect(existsSync(join(lab.spool, d))).toBe(false);
      expect(lab.gate("air", "ping").code).toBe(1);
      expect(lab.putFile("studio", "air", "y.txt", "y\n").code).toBe(3);
    });
  });
});
