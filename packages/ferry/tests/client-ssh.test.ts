/** The client's one ssh invocation, its dial order, pinning, the launchd
 * refusal and its own state file. No real ssh runs: a fake on the paths
 * block records argv and plays sshd. */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DARWIN_ONLY, HUB_HOST, Lab, Mac, readScript, rewriteBlock, SHELLS } from "./helpers.ts";
import { enrollPacket } from "./packets.ts";

function golden(key: string, kh: string, target: string, cmd: string, put: boolean): string[] {
  return [
    "-F", "/dev/null", "-T", "-l", "ferry", "-p", "22", "-i", key,
    "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes", "-o", "IdentityAgent=none", "-o", "AddKeysToAgent=no",
    "-o", "PreferredAuthentications=publickey", "-o", "PasswordAuthentication=no",
    "-o", "KbdInteractiveAuthentication=no", "-o", "GSSAPIAuthentication=no", "-o", "HostbasedAuthentication=no",
    "-o", "HostKeyAlias=ferry-hub", "-o", "StrictHostKeyChecking=yes", "-o", `UserKnownHostsFile=${kh}`,
    "-o", "GlobalKnownHostsFile=/dev/null", "-o", "UpdateHostKeys=no", "-o", "CheckHostIP=no",
    "-o", "VerifyHostKeyDNS=no", "-o", "KnownHostsCommand=none",
    "-o", "ClearAllForwardings=yes", "-o", "ForwardAgent=no", "-o", "ForwardX11=no", "-o", "Tunnel=no",
    "-o", "PermitLocalCommand=no", "-o", "ProxyCommand=none", "-o", "ProxyJump=none",
    "-o", "ControlMaster=no", "-o", "ControlPath=none", "-o", "RequestTTY=no", "-o", "EscapeChar=none",
    "-o", "AddressFamily=inet", "-o", "CanonicalizeHostname=no",
    "-o", "ConnectTimeout=10", "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=4", "-o", "LogLevel=ERROR",
    ...(put ? [] : ["-n"]),
    "--", target, cmd,
  ];
}

describe.skipIf(DARWIN_ONLY)("client ssh (macOS only: BSD stat, date -v, xattr)", () => {
  describe.each(SHELLS)("under %s", (shell) => {
    let lab: Lab;
    let air: Mac;
    beforeEach(() => {
      lab = new Lab(shell);
      air = lab.mac("air");
      writeFileSync(join(lab.ctl, "dscache.out"), "name: ferry-test.local\nipv6_address: fe80::1\n\nname: ferry-test.local\nip_address: 192.0.2.88\n");
      air.setup();
    });
    afterEach(() => lab.cleanup());

    const kh = () => join(air.state, "known_hosts");

    test("the golden argv: -n for everything but put, one remote command", () => {
      expect(air.run(["ping"]).code).toBe(0);
      const src = join(air.home, "f.txt");
      writeFileSync(src, "x\n");
      expect(air.run(["send", "studio", src]).code).toBe(0);
      const calls = lab.sshCalls();
      expect(calls[0]).toEqual(golden(air.keyPath, kh(), HUB_HOST, "ping", false));
      // Every put declares its size, so the gate can refuse an upload cut short.
      expect(calls[1]).toEqual(golden(air.keyPath, kh(), HUB_HOST, "put file studio f.txt 2", true));
      for (const c of calls) {
        const dash = c.indexOf("--");
        expect(c.length - dash - 1).toBe(2);
        expect(c.filter((a) => a === "-o").length).toBe(golden("k", "h", "t", "c", true).filter((a) => a === "-o").length);
      }
      const env = readFileSync(join(lab.ctl, "ssh.env.last"), "utf8");
      expect(env).toContain("LC_ALL=C\n");
    });

    test("pinning stores hub_host and the first IPv4 only", () => {
      const conf = readFileSync(join(air.state, "ferry.conf"), "utf8");
      expect(conf).toBe(`ferry-conf/1\nself=air\nhub_host=${HUB_HOST}\nhub_last_ip=192.0.2.88\nlobby_command=agenttool-lobby\nlobby_mail=${air.home}/.local/state/agenttool/lobby-mail\n`);
      expect(readFileSync(kh(), "utf8")).toBe(`ferry-hub ssh-ed25519 ${lab.hostKeyB64}\n`);
      const scan = readFileSync(join(lab.ctl, "keyscan.calls"), "utf8").split("\n");
      expect(scan.slice(1, 11)).toEqual(["-4", "-T", "10", "-t", "ed25519", "-p", "22", "--", HUB_HOST, ""]);
    });

    test.each([
      "ssh: Could not resolve hostname ferry-test.local: nodename nor servname provided, or not known",
      "ssh: connect to host ferry-test.local port 22: Connection refused",
      "ssh: connect to host ferry-test.local port 22: Network is unreachable",
    ])("falls back to the cached IPv4 after: %s", (msg) => {
      writeFileSync(join(lab.ctl, `fail.${HUB_HOST}`), `${msg}\n`);
      const r = air.run(["ping"]);
      expect(r.code).toBe(0);
      expect(r.out).toBe("ok: reached the post office as air via 192.0.2.88\n");
      const calls = lab.sshCalls();
      expect(calls.length).toBe(2);
      expect(calls[1]).toEqual(golden(air.keyPath, kh(), "192.0.2.88", "ping", false));
    });

    test("no fallback after a gate refusal", () => {
      writeFileSync(join(lab.ctl, "canned.stderr"), "ferry-gate: notfound: no such item on this lane\n");
      writeFileSync(join(lab.ctl, "canned.exit"), "3");
      const r = air.run(["ack", "20261027T120000Z-0a1b2c3d"]);
      expect(r.code).toBe(3);
      expect(r.err).toBe("ferry-gate: notfound: no such item on this lane\n");
      expect(lab.sshCalls().length).toBe(1);
    });

    test("no fallback after Permission denied; every target failing is 7", () => {
      writeFileSync(join(lab.ctl, "keymap"), "");
      const r = air.run(["ping"]);
      expect(r.code).toBe(7);
      expect(r.err).toContain("Permission denied (publickey).");
      expect(r.err).toContain("ferry: unreachable: could not reach the post office (on the home LAN? lane expired? host key changed?)");
      expect(lab.sshCalls().length).toBe(1);
      writeFileSync(join(lab.ctl, `fail.${HUB_HOST}`), "ssh: connect to host ferry-test.local port 22: Operation timed out\n");
      writeFileSync(join(lab.ctl, "fail.192.0.2.88"), "ssh: connect to host 192.0.2.88 port 22: Operation timed out\n");
      const both = air.run(["ping"]);
      expect(both.code).toBe(7);
      expect(lab.sshCalls().length).toBe(3);
    });

    test("remote stderr is shown filtered: no escape sequences reach the terminal", () => {
      writeFileSync(join(lab.ctl, "canned.stderr"), "\u001b[31mred\u001b[0m \u001b]0;title\u0007ferry-gate: usage: x\r\n\u0000tail\n");
      writeFileSync(join(lab.ctl, "canned.exit"), "2");
      const r = air.run(["ping"]);
      expect(r.code).toBe(2);
      expect(/[\u0000-\u0008\u000b-\u001f\u007f]/.test(r.err)).toBe(false);
      expect(r.err).toContain("[31mred[0m");
      expect(r.err).toContain("ferry-gate: usage: x");
    });

    test("peer add: a mismatch is 1 with nothing pinned and the scanned value never printed", () => {
      rmSync(kh());
      const wrong = `SHA256:${"A".repeat(43)}`;
      const r = air.run(["peer", "add", "hub", "--host", HUB_HOST, "--host-key-fp", wrong]);
      expect(r.code).toBe(1);
      expect(r.err).toBe("ferry: refused: the lab's host key does not match what you typed; read it again from ferry-admin whoami on the lab's own screen\n");
      expect(r.out).toBe("");
      expect(existsSync(kh())).toBe(false);
      expect(`${r.out}${r.err}`.includes(lab.hostKeyFp)).toBe(false);
      expect(`${r.out}${r.err}`.includes(lab.hostKeyB64)).toBe(false);
    });

    test("peer add: two host keys are refused; re-pinning needs --replace", () => {
      writeFileSync(join(lab.ctl, "keyscan.out"), `${HUB_HOST} ssh-ed25519 ${lab.hostKeyB64}\n${HUB_HOST} ssh-ed25519 ${lab.hostKeyB64}\n`);
      const two = air.run(["peer", "add", "hub", "--host", HUB_HOST, "--host-key-fp", lab.hostKeyFp, "--replace"]);
      expect(two.code).toBe(1);
      const again = air.run(["peer", "add", "hub", "--host", HUB_HOST, "--host-key-fp", lab.hostKeyFp]);
      expect(again.code).toBe(1);
      expect(again.err).toContain("already pinned");
      const replaced = air.pin(["--replace"]);
      expect(replaced.out).toBe("pinned the post office; next: ferry ping\n");
    });

    const NODIAL = "ferry: nodial: ferry dials only from a terminal or an agent shell, not from launchd\n";
    function chain(self: string, map: string[]): void {
      writeFileSync(join(lab.ctl, "ps.self"), self);
      writeFileSync(join(lab.ctl, "ps.map"), map.length === 0 ? "" : `${map.join("\n")}\n`);
    }

    test.each([
      ["sh <- launchd", "600 ?? /bin/sh", ["600 1 ?? /bin/sh"]],
      ["ferry straight under launchd (nohup after the terminal closed)", "1 ?? /bin/sh", []],
      ["a login shell started by launchd", "700 ?? /bin/sh", ["700 1 ?? -zsh"]],
      ["sh <- cron <- launchd", "710 ?? /bin/sh", ["710 1 ?? /usr/sbin/cron"]],
      ["sh <- python3 (Xcode's, an app nested in an app) <- launchd", "720 ?? /bin/sh",
        ["720 1 ?? /Applications/Xcode.app/Contents/Developer/Library/Frameworks/Python3.framework/Versions/3.9/Resources/Python.app/Contents/MacOS/Python"]],
      ["sh <- python3 (the command line tools') <- launchd", "730 ?? /bin/sh",
        ["730 1 ?? /Library/Developer/CommandLineTools/Library/Frameworks/Python3.framework/Versions/3.9/Resources/Python.app/Contents/MacOS/Python"]],
      ["sh <- bun (a LaunchAgent) <- launchd", "740 ?? /bin/sh", ["740 741 ?? /bin/zsh", "741 1 ?? /Users/someone/.bun/bin/bun"]],
      ["sh <- sh <- node <- sh <- launchd", "750 ?? /bin/sh", ["750 751 ?? /bin/sh", "751 752 ?? /usr/local/bin/node", "752 1 ?? /bin/sh"]],
      ["an app bundle outside an Applications folder", "760 ?? /bin/sh", ["760 1 ?? /tmp/Evil.app/Contents/MacOS/Evil"]],
    ] as [string, string, string[]][])("refused before any dial: %s", (_label, self, map) => {
      chain(self, map);
      const r = air.run(["ping"]);
      expect(r.code).toBe(8);
      expect(r.err).toBe(NODIAL);
      expect(air.run(["list"]).code).toBe(8);
      expect(lab.sshCalls().length).toBe(0);
    });

    test.each([
      ["an agent shell under claude in a terminal (the tty is on claude)", "500 ?? /bin/zsh",
        ["500 400 ?? /usr/local/bin/claude", "400 300 ttys010 -zsh", "300 200 ttys010 login", "200 100 ttys010 /usr/bin/login",
          "100 1 ?? /Applications/iTerm.app/Contents/MacOS/iTerm2"]],
      ["a terminal tab", "500 ttys003 /bin/sh",
        ["500 400 ttys003 -zsh", "400 300 ttys003 login", "300 1 ?? /System/Applications/Utilities/Terminal.app/Contents/MacOS/Terminal"]],
      ["a tmux pane (the server hangs from launchd, the pane has a tty)", "500 ttys005 /bin/sh",
        ["500 400 ttys005 -zsh", "400 1 ?? /opt/homebrew/bin/tmux"]],
      ["an agent shell in the Claude app (no tty anywhere)", "500 ?? /bin/zsh",
        ["500 400 ?? /Users/someone/.local/bin/claude", "400 1 ?? /Applications/Claude.app/Contents/MacOS/Claude"]],
      ["an editor's agent shell", "500 ?? /bin/zsh",
        ["500 400 ?? /Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper.app/Contents/MacOS/Code Helper",
          "400 1 ?? /Applications/Visual Studio Code.app/Contents/MacOS/Electron"]],
    ] as [string, string, string[]][])("allowed: %s", (_label, self, map) => {
      chain(self, map);
      expect(air.run(["ping"]).code).toBe(0);
    });

    test("allowed: an app in the person's own ~/Applications", () => {
      chain("500 ?? /bin/zsh", ["500 400 ?? /bin/zsh", `400 1 ?? ${air.home}/Applications/iTerm.app/Contents/MacOS/iTerm2`]);
      expect(air.run(["ping"]).code).toBe(0);
      chain("500 ?? /bin/zsh", ["500 400 ?? /bin/zsh", "400 1 ?? /Users/someone-else/Applications/iTerm.app/Contents/MacOS/iTerm2"]);
      expect(air.run(["ping"]).code).toBe(8);
    });

    test("a chain longer than 32 hops is refused", () => {
      const map = Array.from({ length: 40 }, (_, i) => `${1000 + i} ${1001 + i} ?? /bin/sh`);
      chain("1000 ?? /bin/sh", map);
      expect(air.run(["ping"]).code).toBe(8);
      expect(lab.sshCalls().length).toBe(0);
    });

    test("an older or newer post office is named, not misread", () => {
      // A gate copy that answers with another protocol version.
      writeFileSync(lab.gatePath, readFileSync(lab.gatePath, "utf8").replace("ok ping gate=2 peer=%s", "ok ping gate=1 peer=%s"));
      const r = air.run(["ping"]);
      expect(r.code).toBe(6);
      expect(r.err).toBe("ferry: unsafe: the post office runs another version of Ferry; install this client from the commit the lab was set up from\n");
    });

    test("lobby push and fetch need /usr/bin/jq: without it, exit 8 before any dial", () => {
      writeFileSync(lab.clientPath, rewriteBlock(readScript("ferry"), {
        SSH: join(lab.bin, "ssh"), SSH_KEYSCAN: join(lab.bin, "ssh-keyscan"), PS: join(lab.bin, "ps"),
        DSCACHEUTIL: join(lab.bin, "dscacheutil"), JQ: join(lab.root, "no-such-jq"),
      }));
      const pf = join(air.home, "renew.json");
      writeFileSync(pf, enrollPacket({ kind: "renew" }).text);
      const before = lab.sshCalls().length;
      const push = air.run(["lobby", "push", pf]);
      expect(push.code).toBe(8);
      expect(push.err).toBe("ferry: nodial: this Mac has no /usr/bin/jq (macOS 15 or later ships it); lobby packets cannot be checked here\n");
      expect(air.run(["lobby", "fetch"]).code).toBe(8);
      expect(lab.sshCalls().length).toBe(before);
      // Files do not need jq.
      expect(air.run(["ping"]).code).toBe(0);
    });

    test("a failing ps is 8", () => {
      writeFileSync(join(lab.ctl, "ps.fail"), "");
      expect(air.run(["ping"]).code).toBe(8);
      expect(lab.sshCalls().length).toBe(0);
    });

    test("running as root is 8", () => {
      const r = air.run(["ping"], { asRoot: true });
      expect(r.code).toBe(8);
      expect(r.err).toBe("ferry: nodial: ferry runs as a person, never as root\n");
      expect(air.run(["whoami"], { asRoot: true }).code).toBe(8);
    });

    test.each([
      ["an unknown key", (c: string) => `${c}extra=1\n`],
      ["a bad host", (c: string) => c.replace(/^hub_host=.*$/m, "hub_host=-oProxyCommand=x")],
      ["a bad ip", (c: string) => c.replace(/^hub_last_ip=.*$/m, "hub_last_ip=192.0.2.300")],
      ["a bad lobby command", (c: string) => c.replace(/^lobby_command=.*$/m, "lobby_command=agenttool-lobby;id")],
      ["a reordered file", (c: string) => c.split("\n").reverse().join("\n")],
      ["a wrong header", (c: string) => c.replace("ferry-conf/1", "ferry-conf/2")],
    ] as [string, (c: string) => string][])("ferry.conf with %s is 8", (_label, mutate) => {
      const p = join(air.state, "ferry.conf");
      writeFileSync(p, mutate(readFileSync(p, "utf8")));
      const r = air.run(["ping"]);
      expect(r.code).toBe(8);
      expect(lab.sshCalls().length).toBe(0);
    });

    test("init refuses a second time and as a reserved name; whoami prints placeholders", () => {
      expect(air.run(["init", "--self", "air"]).code).toBe(1);
      const other = lab.mac("hubby");
      expect(other.run(["init", "--self", "hub"]).code).toBe(2);
      expect(other.run(["init", "--self", "Bad"]).code).toBe(2);
      const who = air.run(["whoami"]);
      expect(who.code).toBe(0);
      const lines = who.out.split("\n");
      expect(lines[0]).toBe("self air");
      expect(lines[1]).toBe(`key ${air.keyPath}`);
      expect(lines[2]).toMatch(/^lane fingerprint SHA256:[A-Za-z0-9+/]{43}$/);
      expect(lines[3]).toBe(`public key ${air.keyPath}.pub (holds no secret; carry it to the lab)`);
      expect(lines[4]).toBe("at the lab: sudo /Library/Ferry/bin/ferry-admin lane add --peer air --pubkey-file <path on the lab> --expect-fp <type the SHA256 fingerprint from this Mac's own screen>");
      expect(lines[4]!.includes("SHA256:")).toBe(false);
      expect(lines[4]!.includes(lines[2]!.slice("lane fingerprint ".length))).toBe(false);
    });

    test("the lane key never leaves the Mac: it is 0600 and never sent", () => {
      const st = Bun.spawnSync({ cmd: ["/usr/bin/stat", "-f", "%Mp%Lp", air.keyPath], stdout: "pipe" }).stdout.toString().trim();
      expect(st).toBe("0600");
      const secret = readFileSync(air.keyPath, "utf8");
      const body = secret.split("\n").filter((l) => !l.startsWith("-----") && l !== "").join("");
      air.run(["ping"]);
      const calls = lab.sshCalls().flat().join("\n");
      expect(calls.includes(body.slice(0, 40))).toBe(false);
    });

    test("the cached IPv4 is refreshed after a dial through the host name", () => {
      writeFileSync(join(lab.ctl, "dscache.out"), "name: ferry-test.local\nip_address: 192.0.2.99\n");
      expect(air.run(["ping"]).code).toBe(0);
      expect(readFileSync(join(air.state, "ferry.conf"), "utf8")).toContain("hub_last_ip=192.0.2.99\n");
    });
  });
});
