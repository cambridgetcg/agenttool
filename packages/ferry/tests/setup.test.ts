/** ferry-setup against recorder fakes: the dry run changes nothing, the
 * first --apply issues the golden sequence (the password is typed at the
 * sysadminctl prompt, never in argv), a second --apply creates nothing, and
 * --check reads only. Account tools are recorded; file tools run for real
 * inside the temp root with the runner standing in for root and ferry. The
 * fake sysadminctl, like the real one, exits 0 even when it creates nothing,
 * and gives the account the -GID it is asked for (the fake group id is 701). */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DARWIN_ONLY, readScript, rewriteBlock, RUNNER, RUNNER_GROUP, SCRIPTS, SHELLS, sha256Hex, sharedFakes } from "./helpers.ts";

const U = RUNNER;
const G = RUNNER_GROUP;
const MUTATING = /^(sysadminctl|createhomedir|install|chown|chmod|mkdir|dscl \. -create|dseditgroup -o (create|edit|delete))\b/;

class SetupEnv {
  readonly root: string;
  readonly pkg: string;
  readonly ferryRoot: string;
  readonly ferryHome: string;
  readonly hubHome: string;
  readonly ctl: string;
  readonly tmp: string;

  constructor(readonly shell: string, state: string[] = []) {
    this.root = realpathSync(mkdtempSync(join(tmpdir(), "ferry-setup-")));
    this.pkg = join(this.root, "pkg");
    this.ferryRoot = join(this.root, "Library/Ferry");
    this.ferryHome = join(this.root, "Users/ferry");
    this.hubHome = join(this.root, "Users/hub");
    this.ctl = join(this.root, "ctl");
    this.tmp = join(this.root, "tmp");
    for (const d of [join(this.pkg, "bin"), join(this.pkg, "libexec"), this.hubHome, this.ctl, this.tmp]) mkdirSync(d, { recursive: true });
    const fakes = sharedFakes();
    const copies: Record<keyof typeof SCRIPTS, string> = {
      setup: rewriteBlock(readScript("setup"), {
        FERRY_ROOT: this.ferryRoot, FERRY_HOME: this.ferryHome, REQUIRE_ROOT: "0",
        ROOT_OWNER: U, ROOT_GROUP: G, FERRY_USER: U, FERRY_GROUP: G, STAFF_GROUP: "test-staff", TMPROOT: this.tmp,
        ID: join(fakes, "rec-id"), SYSADMINCTL: join(fakes, "rec-sysadminctl"), DSCL: join(fakes, "rec-dscl"),
        DSEDITGROUP: join(fakes, "rec-dseditgroup"), CREATEHOMEDIR: join(fakes, "rec-createhomedir"),
        INSTALL: join(fakes, "rec-install"), CHOWN: join(fakes, "rec-chown"), CHMOD: join(fakes, "rec-chmod"),
        MKDIR: join(fakes, "rec-mkdir"), SUDO: join(fakes, "rec-sudo"),
      }),
      gate: rewriteBlock(readScript("gate"), { FERRY_ROOT: this.ferryRoot }),
      lib: rewriteBlock(readScript("lib"), { FERRY_HOME: this.ferryHome, ROOT_OWNER: U, ROOT_GROUP: G }),
      hub: rewriteBlock(readScript("hub"), { FERRY_ROOT: this.ferryRoot }),
      admin: rewriteBlock(readScript("admin"), { FERRY_ROOT: this.ferryRoot }),
      ferry: readScript("ferry"),
    };
    const sums: string[] = [];
    for (const [name, text] of Object.entries(copies) as [keyof typeof SCRIPTS, string][]) {
      const p = join(this.pkg, SCRIPTS[name]);
      writeFileSync(p, text);
      chmodSync(p, name === "lib" ? 0o644 : 0o755);
      sums.push(`${sha256Hex(text)}  ${SCRIPTS[name]}`);
    }
    writeFileSync(join(this.pkg, "SHA256SUMS"), `${sums.sort((a, b) => a.slice(66).localeCompare(b.slice(66))).join("\n")}\n`);
    writeFileSync(join(this.ctl, "state"), [
      "user hub", `home hub ${this.hubHome}`, "group com.apple.access_ssh", ...state, "",
    ].join("\n"));
  }

  run(args: string[], env: Record<string, string> = {}) {
    const r = Bun.spawnSync({
      cmd: [this.shell, join(this.pkg, "bin/ferry-setup"), ...args],
      env: { PATH: "/usr/bin:/bin", HOME: this.hubHome, SUDO_USER: "hub", FERRY_TEST_CTL: this.ctl, FERRY_TEST_FERRY_HOME: this.ferryHome, ...env },
      stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: 60_000,
    });
    return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
  }

  calls(): string[] {
    const p = join(this.ctl, "calls");
    return existsSync(p) ? readFileSync(p, "utf8").split("\n").filter((l) => l !== "") : [];
  }

  mutating(): string[] {
    return this.calls()
      .filter((l) => MUTATING.test(l))
      .map((l) => l.replace(/ferry-site\.[A-Za-z0-9]{8}/, "ferry-site.TMP").replace(/ferry-keys\.[A-Za-z0-9]{8}/, "ferry-keys.TMP")
        .replace(/ferry-pkg\.[A-Za-z0-9]{8}/g, "ferry-pkg.TMP"));
  }

  resetCalls(): void {
    rmSync(join(this.ctl, "calls"), { force: true });
  }

  cleanup(): void {
    rmSync(this.root, { recursive: true, force: true });
  }
}

describe.skipIf(DARWIN_ONLY)("ferry-setup (macOS only: BSD stat, install, date -v)", () => {
  describe.each(SHELLS)("under %s", (shell) => {
    let env: SetupEnv;
    beforeEach(() => {
      env = new SetupEnv(shell);
    });
    afterEach(() => env.cleanup());

    const dir = (p: string, group: string, mode: string) => [`mkdir ${p}`, `chown -h ${U}:${group} ${p}`, `chmod -h ${mode} ${p}`];
    const golden = () => {
      const FR = env.ferryRoot;
      const FH = env.ferryHome;
      const T = env.tmp;
      // Root installs from its own checked copy, never from the carried directory.
      const P = `${T}/ferry-pkg.TMP`;
      return [
        `dseditgroup -o create -r Ferry hand-off ${G}`,
        `sysadminctl -addUser ${U} -fullName Ferry post office -GID 701 -shell /bin/sh -home ${FH} -password -`,
        `dscl . -create /Users/${U} IsHidden 1`,
        `createhomedir -c -u ${U}`,
        `dseditgroup -o edit -a ${U} -t user ${G}`,
        `dseditgroup -o edit -a hub -t user ${G}`,
        `dseditgroup -o edit -a ${U} -t user com.apple.access_ssh`,
        `install -d -o ${U} -g ${G} -m 0755 ${FR} ${FR}/libexec ${FR}/bin`,
        `install -o ${U} -g ${G} -m 0755 ${P}/libexec/ferry-gate ${FR}/libexec/ferry-gate`,
        `install -o ${U} -g ${G} -m 0644 ${P}/libexec/ferry-spool.sh ${FR}/libexec/ferry-spool.sh`,
        `install -o ${U} -g ${G} -m 0755 ${P}/bin/ferry-admin ${FR}/bin/ferry-admin`,
        `install -o ${U} -g ${G} -m 0755 ${P}/bin/ferry-hub ${FR}/bin/ferry-hub`,
        `install -o ${U} -g ${G} -m 0644 ${P}/SHA256SUMS ${FR}/SHA256SUMS`,
        `install -o ${U} -g ${G} -m 0644 ${T}/ferry-site.TMP ${FR}/site.conf`,
        `chown -h ${U}:${G} ${FH}`,
        `chmod -h 0750 ${FH}`,
        ...dir(`${FH}/.ssh`, G, "0755"),
        `install -o ${U} -g ${G} -m 0644 ${T}/ferry-keys.TMP ${FH}/.ssh/authorized_keys`,
        ...["", "/lobby", "/lobby/in", "/lobby/out", "/files", "/files/lab"].flatMap((d) => dir(`${FH}/spool${d}`, G, "2770")),
        ...dir(`${FH}/stage`, G, "0700"),
        ...dir(`${FH}/log`, G, "2750"),
      ];
    };

    test("a dry run makes zero mutating calls and prints the plan", () => {
      const r = env.run(["--lan", "192.0.2.0/24"]);
      expect(r.code).toBe(0);
      expect(env.mutating()).toEqual([]);
      expect(existsSync(env.ferryRoot)).toBe(false);
      expect(existsSync(env.ferryHome)).toBe(false);
      expect(r.out).toContain(`would run: ${sharedFakes()}/rec-sysadminctl -addUser ${U} -fullName Ferry post office -GID <the PrimaryGroupID of ${G}> -shell /bin/sh -home ${env.ferryHome} -password -\n`);
      expect(r.out).toContain("Remote Login is limited to com.apple.access_ssh here");
      expect(r.out).toContain("dry run: nothing was changed.");
    });

    test("the first --apply issues the golden sequence, then checks and passes", () => {
      const r = env.run(["--apply", "--lan", "192.0.2.0/24"]);
      expect(r.err).toBe("");
      expect(r.code).toBe(0);
      expect(env.mutating()).toEqual(golden());
      const sys = env.calls().find((l) => l.startsWith("sysadminctl"))!;
      expect(sys.endsWith("-password -")).toBe(true);
      expect(/adminUser|adminPassword/.test(sys)).toBe(false);
      expect(readFileSync(join(env.ferryRoot, "site.conf"), "utf8")).toBe([
        "ferry-site/1", `ferry_user=${U}`, `ferry_group=${G}`, "hub_user=hub", `hub_home=${env.hubHome}`, "local_peer=lab",
        "lan_cidr=192.0.2.0/24", "lobby_queue=4", "file_queue_items=32", "file_queue_bytes=134217728",
        "spool_max_bytes=1073741824", "floor_kib=20971520", "retain_days=7", "",
      ].join("\n"));
      expect(readFileSync(join(env.ferryHome, ".ssh/authorized_keys"), "utf8")).toBe(
        "# ferry lanes. Written only by /Library/Ferry/bin/ferry-admin; do not edit by hand.\n",
      );
      expect(r.out).toContain("ok    the gate's self-check as");
      expect(r.out).toContain(`ok    ${U}'s primary group is ${G}\n`);
      expect(r.out).toContain("check: all paths, memberships and the gate self-check are in order");
      expect(readdirSync(env.tmp)).toEqual([]);
      expect(env.calls().some((l) => l.startsWith(`sudo -u ${U} -H ${env.ferryRoot}/libexec/ferry-gate --self-check`))).toBe(true);
      env.resetCalls();
      const check = env.run(["--check", "--lan", "192.0.2.0/24"]);
      expect(check.code).toBe(0);
      expect(env.mutating()).toEqual([]);
    });

    test("a second --apply creates nothing", () => {
      expect(env.run(["--apply", "--lan", "192.0.2.0/24"]).code).toBe(0);
      env.resetCalls();
      const again = env.run(["--apply", "--lan", "192.0.2.0/24"]);
      expect(again.code).toBe(0);
      const creates = env.mutating().filter((l) =>
        /^(sysadminctl|createhomedir|mkdir|dscl \. -create|dseditgroup -o (create|edit))/.test(l)
        || l.endsWith("/site.conf") || l.endsWith("/authorized_keys"));
      expect(creates).toEqual([]);
      expect(again.out).toContain("check: site.conf is already in place and identical");
      expect(again.out).toContain("check: authorized_keys exists; it is left as it is");
    });

    test("a link planted inside the spool stops a re-apply before root touches it", () => {
      expect(env.run(["--apply", "--lan", "192.0.2.0/24"]).code).toBe(0);
      const outside = join(env.root, "outside");
      mkdirSync(outside);
      chmodSync(outside, 0o755);
      const lab = join(env.ferryHome, "spool/files/lab");
      rmSync(lab, { recursive: true });
      symlinkSync(outside, lab);
      env.resetCalls();
      const r = env.run(["--apply", "--lan", "192.0.2.0/24"]);
      expect(r.code).toBe(1);
      expect(r.err).toContain("a link stands where a Ferry directory belongs");
      expect(env.mutating().some((l) => l.includes(outside) || l.endsWith("/files/lab"))).toBe(false);
      expect((statSync(outside).mode & 0o7777).toString(8)).toBe("755");
    });

    test("an existing authorized_keys is never truncated", () => {
      expect(env.run(["--apply", "--lan", "192.0.2.0/24"]).code).toBe(0);
      const ak = join(env.ferryHome, ".ssh/authorized_keys");
      writeFileSync(ak, "# ferry lanes. Written only by /Library/Ferry/bin/ferry-admin; do not edit by hand.\n# kept\n");
      expect(env.run(["--apply", "--lan", "192.0.2.0/24"]).code).toBe(0);
      expect(readFileSync(ak, "utf8")).toContain("# kept\n");
    });

    test("bad arguments are 2", () => {
      expect(env.run([]).code).toBe(2);
      expect(env.run(["--apply"]).code).toBe(2);
      expect(env.run(["--lan", "192.0.2.0/33"]).code).toBe(2);
      expect(env.run(["--lan", "192.0.2.0/24", "--hub-user", "root"]).code).toBe(2);
      expect(env.run(["--lan", "192.0.2.0/24"], { SUDO_USER: "" }).code).toBe(2);
      expect(env.run(["--apply", "--check", "--lan", "192.0.2.0/24"]).code).toBe(2);
      expect(env.calls()).toEqual([]);
    });

    test("an existing admin ferry account aborts before any change", () => {
      const admin = new SetupEnv(shell, [`user ${U}`, `home ${U} /nowhere`, `member admin ${U}`, `hidden ${U}`]);
      try {
        const r = admin.run(["--apply", "--lan", "192.0.2.0/24"]);
        expect(r.code).toBe(1);
        expect(r.err).toContain("is an admin; Ferry needs a standard account");
        expect(admin.mutating()).toEqual([]);
      } finally {
        admin.cleanup();
      }
    });

    test("an existing site.conf that differs aborts before any change", () => {
      mkdirSync(env.ferryRoot, { recursive: true });
      writeFileSync(join(env.ferryRoot, "site.conf"), "ferry-site/1\nsomething=else\n");
      const r = env.run(["--apply", "--lan", "192.0.2.0/24"]);
      expect(r.code).toBe(1);
      expect(r.err).toBe("ferry-setup: refused: site.conf differs; review and remove it by hand\n");
      expect(env.mutating()).toEqual([]);
    });

    test("a package that does not match SHA256SUMS aborts", () => {
      writeFileSync(join(env.pkg, "bin/ferry-hub"), `${readFileSync(join(env.pkg, "bin/ferry-hub"), "utf8")}# changed\n`);
      const r = env.run(["--apply", "--lan", "192.0.2.0/24"]);
      expect(r.code).toBe(1);
      expect(env.mutating()).toEqual([]);
    });

    test("sysadminctl exiting 0 without creating the account stops setup at once", () => {
      writeFileSync(join(env.ctl, "sysadminctl.fail"), "");
      const r = env.run(["--apply", "--lan", "192.0.2.0/24"]);
      expect(r.code).toBe(1);
      expect(r.err).toContain(`ferry-setup: failed: sysadminctl did not create the ${U} account (it exits 0 even then); stop here`);
      expect(env.mutating()).toEqual([
        `dseditgroup -o create -r Ferry hand-off ${G}`,
        `sysadminctl -addUser ${U} -fullName Ferry post office -GID 701 -shell /bin/sh -home ${env.ferryHome} -password -`,
      ]);
      expect(existsSync(env.ferryRoot)).toBe(false);
      expect(existsSync(env.ferryHome)).toBe(false);
    });

    test("an account that comes out in staff (or with another home) stops setup before anything else", () => {
      writeFileSync(join(env.ctl, "sysadminctl.staff"), "");
      const r = env.run(["--apply", "--lan", "192.0.2.0/24"]);
      expect(r.code).toBe(1);
      expect(r.err).toContain(`the ${U} account came out with another home or primary group; remove it`);
      expect(env.mutating().length).toBe(2);
      // A rerun refuses the half-made account instead of building on it,
      // even once it has been hidden by hand.
      env.resetCalls();
      rmSync(join(env.ctl, "sysadminctl.staff"));
      const again = env.run(["--apply", "--lan", "192.0.2.0/24"]);
      expect(again.code).toBe(1);
      expect(again.err).toBe(`ferry-setup: refused: the ${U} account exists but is not hidden\n`);
      writeFileSync(join(env.ctl, "state"), `${readFileSync(join(env.ctl, "state"), "utf8")}hidden ${U}\n`);
      const hidden = env.run(["--apply", "--lan", "192.0.2.0/24"]);
      expect(hidden.code).toBe(1);
      expect(hidden.err).toBe(`ferry-setup: refused: the ${U} account exists with a primary group other than ${G}\n`);
      expect(env.mutating()).toEqual([]);
    });

    test("the precheck prints the sha256 of SHA256SUMS, computed on root's own copy", () => {
      const r = env.run(["--lan", "192.0.2.0/24"]);
      expect(r.code).toBe(0);
      const want = sha256Hex(readFileSync(join(env.pkg, "SHA256SUMS")));
      expect(r.out).toContain(`check: SHA256SUMS sha256 ${want}\n`);
      expect(r.out).toContain("compare it with shasum -a 256 SHA256SUMS on the reviewed Mac's own screen");
      expect(readdirSync(env.tmp)).toEqual([]);
    });

    test("a package file that is a link is refused, never followed", () => {
      const real = join(env.root, "elsewhere-gate");
      writeFileSync(real, readFileSync(join(env.pkg, "libexec/ferry-gate")));
      rmSync(join(env.pkg, "libexec/ferry-gate"));
      symlinkSync(real, join(env.pkg, "libexec/ferry-gate"));
      const r = env.run(["--apply", "--lan", "192.0.2.0/24"]);
      expect(r.code).toBe(1);
      expect(r.err).toBe("ferry-setup: refused: the package holds something other than plain files; carry it again\n");
      expect(env.mutating()).toEqual([]);
    });

    test("--undo prints the undo text and makes zero calls", () => {
      const r = env.run(["--undo", "--lan", "192.0.2.0/24"]);
      expect(r.code).toBe(0);
      expect(env.calls()).toEqual([]);
      expect(r.out).toContain(`sudo sysadminctl -deleteUser ${U}`);
      expect(r.out).toContain(`  id ${U}  `);
      expect(r.out).toContain(`sudo dseditgroup -o edit -d hub -t user ${G}`);
      expect(r.out).toContain(`sudo rm -rf ${env.ferryRoot}`);
    });

    test("--check on an empty lab fails with 6 and changes nothing", () => {
      const r = env.run(["--check", "--lan", "192.0.2.0/24"]);
      expect(r.code).toBe(6);
      expect(env.mutating()).toEqual([]);
    });
  });
});
