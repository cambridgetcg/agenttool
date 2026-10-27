/** The lobby lane: enrollment and renewal packets device -> hub, join
 * packets hub -> device, byte-identical, with every refusal leaving the
 * spool as it was. Ferry never relays, joins or answers a prompt. */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DARWIN_ONLY, ID_RE, Lab, PKG_DIR, SHELLS, sha256Hex } from "./helpers.ts";
import { badEnrollCorpus, enrollPacket, joinPacket, paddedPacket } from "./packets.ts";

function quarantineOf(path: string): string {
  const r = Bun.spawnSync({ cmd: ["/usr/bin/xattr", "-p", "com.apple.quarantine", path], stdout: "pipe", stderr: "pipe" });
  return r.stdout.toString().trim();
}

function modeOf(path: string): string {
  return (statSync(path).mode & 0o7777).toString(8).padStart(4, "0");
}

/** The lobby's own sources, when this checkout has them (a sparse checkout
 * of packages/ferry alone does not). */
const LOBBY_SRC = join(PKG_DIR, "../lobby/src");
const HAVE_LOBBY = existsSync(join(LOBBY_SRC, "packets.ts")) && existsSync(join(LOBBY_SRC, "wire.ts"));

describe.skipIf(DARWIN_ONLY)("lobby lane (macOS only: BSD stat, date -v, xattr)", () => {
  describe.each(SHELLS)("under %s", (shell) => {
    let lab: Lab;
    beforeEach(() => {
      lab = new Lab(shell);
    });
    afterEach(() => lab.cleanup());

    test.each(["enroll", "renew"] as const)("put lobby keeps a %s packet byte-identical with an exact meta", (kind) => {
      const pkt = enrollPacket({ kind });
      const r = lab.putLobby("air", pkt.text);
      expect(r.code).toBe(0);
      const m = /^ok put (\S+) (\d+) ([0-9a-f]{64})\n$/.exec(r.out);
      expect(m).not.toBeNull();
      const [, id, size, sha] = m!;
      expect(id).toMatch(ID_RE);
      expect(Number(size)).toBe(Buffer.byteLength(pkt.text));
      expect(sha).toBe(sha256Hex(pkt.text));
      const dir = join(lab.spool, "lobby/in/air");
      expect(readFileSync(join(dir, `${id}.body`), "utf8")).toBe(pkt.text);
      expect(readFileSync(join(dir, `${id}.meta`), "utf8")).toBe(
        `ferry-meta/1\nkind=lobby-enroll\nfrom=air\nto=hub\nsize=${size}\nsha256=${sha}\n`,
      );
      expect(modeOf(join(dir, `${id}.body`))).toBe("0640");
      expect(readdirSync(dir).some((n) => n.includes(".part"))).toBe(false);
    });

    test("every malformed packet is refused with 4 and changes nothing", () => {
      for (const bad of badEnrollCorpus()) {
        const before = lab.spoolDigest();
        const r = lab.putLobby("air", bad.bytes);
        expect({ name: bad.name, code: r.code }).toEqual({ name: bad.name, code: 4 });
        expect(r.stdout.length).toBe(0);
        expect(lab.spoolDigest()).toBe(before);
      }
    });

    test("a packet cut short of its declared size is 4, even where the packet filter alone would pass it", () => {
      const pkt = enrollPacket().text;
      // Cut just before the final newline: still "{" ... "}" with the right keys.
      const r = lab.gate("air", `put lobby ${Buffer.byteLength(pkt)}`, pkt.slice(0, -1));
      expect(r.code).toBe(4);
      expect(r.err).toBe("ferry-gate: invalid: the upload ended before its declared size; nothing was kept\n");
      expect(lab.ids("lobby/in/air")).toEqual([]);
    });

    test("a valid packet of exactly 65,536 bytes is accepted", () => {
      const text = paddedPacket(65_536);
      const r = lab.putLobby("air", text);
      expect(r.code).toBe(0);
      expect(r.out).toContain(" 65536 ");
    });

    test("inbox moves a live packet into lobby-mail at 0600 with quarantine and prints the relay line", () => {
      const pkt = enrollPacket({ kind: "renew" });
      const put = lab.putLobby("air", pkt.text);
      const id = put.out.split(" ")[2]!;
      const r = lab.hub(["inbox"]);
      expect(r.code).toBe(0);
      const mail = join(lab.hubHome, "agenttool/state/lobby-mail");
      const saved = join(mail, "in/air", `${id}.json`);
      const out = join(mail, "out/air", `${id}.join.json`);
      expect(readFileSync(saved, "utf8")).toBe(pkt.text);
      expect(modeOf(saved)).toBe("0600");
      expect(modeOf(join(mail, "in/air"))).toBe("0700");
      expect(modeOf(join(mail, "out/air"))).toBe("0700");
      expect(quarantineOf(saved)).toMatch(/^0081;[0-9a-f]{8};ferry;$/);
      expect(lab.ids("lobby/in/air")).toEqual([]);
      const lines = r.out.split("\n");
      expect(lines[0]).toMatch(new RegExp(`^air  ${id}  renew  ${Buffer.byteLength(pkt.text)} bytes  valid until \\d\\d:\\d\\dZ \\((29|30) min left\\)$`));
      expect(lines[1]).toBe(`saved: ${saved}`);
      expect(lines[2]).toBe("next, at this terminal (the prompt shows the desk fingerprint: compare it with air's own screen):");
      expect(lines[3]).toBe(
        `  ${lab.hubHome}/agenttool/bin/agenttool-lobby-fleet hub relay --packet-file ${saved} > ${out} && ${lab.ferryRoot}/bin/ferry-hub reply air ${out}`,
      );
      // Until the relay has written its join packet, every inbox prints the
      // line again: an agent may have run the first one, and the person at
      // the lab terminal needs it. (The minutes left may tick down between runs.)
      const block = (text: string) => text.replace(/\(\d+ min left\)/g, "(n min left)");
      expect(block(lab.hub(["inbox"]).out)).toBe(block(r.out));
      writeFileSync(out, "");
      expect(block(lab.hub(["inbox"]).out)).toBe(block(r.out));
      writeFileSync(out, joinPacket().text);
      expect(lab.hub(["inbox"]).out).toBe("no lobby packets waiting\n");
    });

    test("inbox does not print the relay line for a waiting packet that has expired, or a file that is not one", () => {
      const pkt = enrollPacket({ kind: "renew" });
      const id = lab.putLobby("air", pkt.text).out.split(" ")[2]!;
      expect(lab.hub(["inbox"]).out).toContain(`air  ${id}  renew  `);
      const mail = join(lab.hubHome, "agenttool/state/lobby-mail");
      const saved = join(mail, "in/air", `${id}.json`);
      rmSync(saved);
      writeFileSync(saved, enrollPacket({ kind: "renew", now: new Date(Date.now() - 3600_000) }).text);
      expect(lab.hub(["inbox"]).out).toBe("no lobby packets waiting\n");
      rmSync(saved);
      writeFileSync(saved, "not a packet\n");
      expect(lab.hub(["inbox"]).out).toBe("no lobby packets waiting\n");
      rmSync(saved);
      symlinkSync(join(lab.root, "elsewhere.json"), saved);
      writeFileSync(join(lab.root, "elsewhere.json"), pkt.text);
      expect(lab.hub(["inbox"]).out).toBe("no lobby packets waiting\n");
      expect(existsSync(saved)).toBe(true);
    });

    test("an expired packet is dropped with the fixed line", () => {
      const pkt = enrollPacket({ kind: "renew", now: new Date(Date.now() - 3600_000) });
      const put = lab.putLobby("air", pkt.text);
      expect(put.code).toBe(0);
      const id = put.out.split(" ")[2]!;
      const r = lab.hub(["inbox"]);
      expect(r.code).toBe(0);
      expect(r.out).toMatch(new RegExp(`^air ${id} expired at \\d\\d:\\d\\dZ \u2014 ask air for a fresh packet\\nno lobby packets waiting\\n$`));
      expect(lab.ids("lobby/in/air")).toEqual([]);
      expect(existsSync(join(lab.hubHome, "agenttool/state/lobby-mail/in/air", `${id}.json`))).toBe(false);
    });

    test("reply refuses an empty file, an enroll packet and a symlink", () => {
      const empty = join(lab.hubHome, "empty.join.json");
      writeFileSync(empty, "");
      const r1 = lab.hub(["reply", "air", empty]);
      expect(r1.code).toBe(4);
      expect(r1.err).toContain("this file is not a join packet (was the relay declined?)");
      const enroll = join(lab.hubHome, "enroll.json");
      writeFileSync(enroll, enrollPacket().text);
      expect(lab.hub(["reply", "air", enroll]).code).toBe(4);
      const real = join(lab.hubHome, "real.join.json");
      writeFileSync(real, joinPacket().text);
      const link = join(lab.hubHome, "link.join.json");
      symlinkSync(real, link);
      expect(lab.hub(["reply", "air", link]).code).toBe(6);
      expect(lab.hub(["reply", "air", "relative.json"]).code).toBe(2);
      expect(lab.hub(["reply", "ghost", real]).code).toBe(1);
      expect(lab.ids("lobby/out/air")).toEqual([]);
    });

    test("reply refuses a join file owned by another account", () => {
      const other = new Lab(shell, { fakeStat: true });
      try {
        const f = join(other.hubHome, "theirs.join.json");
        writeFileSync(f, joinPacket().text);
        writeFileSync(join(other.ctl, "stat.owner"), `${f}\n`);
        const r = other.hub(["reply", "air", f]);
        expect(r.code).toBe(6);
        expect(other.ids("lobby/out/air")).toEqual([]);
      } finally {
        other.cleanup();
      }
    });

    test("reply places a valid join packet", () => {
      const j = joinPacket();
      const f = join(lab.hubHome, "j.json");
      writeFileSync(f, j.text);
      const r = lab.hub(["reply", "air", f]);
      expect(r.code).toBe(0);
      const ids = lab.ids("lobby/out/air");
      expect(ids.length).toBe(1);
      expect(r.out).toBe(`placed join packet ${ids[0]} for air (${Buffer.byteLength(j.text)} bytes). On air: ferry lobby fetch\n`);
      expect(readFileSync(join(lab.spool, "lobby/out/air", `${ids[0]}.body`), "utf8")).toBe(j.text);
      expect(readFileSync(join(lab.spool, "lobby/out/air", `${ids[0]}.meta`), "utf8")).toBe(
        `ferry-meta/1\nkind=lobby-join\nfrom=hub\nto=air\nsize=${Buffer.byteLength(j.text)}\nsha256=${sha256Hex(j.text)}\n`,
      );
    });

    test("full loop: push, inbox, relay (simulated), reply, fetch", () => {
      const mac = lab.mac("air");
      mac.setup();
      const pkt = enrollPacket({ kind: "enroll" });
      const pf = join(mac.home, "pkt.json");
      writeFileSync(pf, pkt.text);
      const push = mac.run(["lobby", "push", pf]);
      expect(push.code).toBe(0);
      expect(push.out).toMatch(/^sent lobby packet \S+ \(enroll, \d+ bytes, valid until \d\d:\d\dZ, [45] min left\)\nnext, at the lab: ferry-hub inbox\n$/);
      const inbox = lab.hub(["inbox"]);
      expect(inbox.code).toBe(0);
      const relayLine = inbox.out.split("\n")[3]!;
      const outPath = relayLine.split(" > ")[1]!.split(" && ")[0]!;
      // The person's relay at the lab writes the join packet here.
      const join1 = joinPacket({ desk: pkt.desk });
      writeFileSync(outPath, join1.text);
      const replyCmd = relayLine.split(" && ")[1]!.split(" ");
      expect(replyCmd[0]).toBe(lab.hubPath);
      const reply = lab.hub(replyCmd.slice(1));
      expect(reply.code).toBe(0);
      const fetch = mac.run(["lobby", "fetch"]);
      expect(fetch.code).toBe(0);
      const id = lab.sshCalls().flatMap((c) => c).find((a) => a.startsWith("ack "))!.slice(4);
      const landed = join(mac.home, ".local/state/agenttool/lobby-mail/from-hub", `${id}.join.json`);
      expect(fetch.out).toBe([
        `received join packet ${id} (${Buffer.byteLength(join1.text)} bytes, sha256 ok)`,
        `saved: ${landed}`,
        "next, at this terminal (type the door fingerprint yourself, reading it off the hub's own screen):",
        `  agenttool-lobby fleet join --packet-file ${landed} --door-fingerprint <type the 16 hex from the hub's own screen>`,
        "",
      ].join("\n"));
      expect(readFileSync(landed, "utf8")).toBe(join1.text);
      expect(modeOf(landed)).toBe("0600");
      expect(quarantineOf(landed)).toMatch(/^0081;/);
      expect(lab.ids("lobby/out/air")).toEqual([]);
      expect(mac.run(["lobby", "fetch"]).out).toBe("no join packet waiting\n");
    });

    test("the client refuses an expired packet before dialling", () => {
      const mac = lab.mac("air");
      mac.setup();
      const pf = join(mac.home, "old.json");
      writeFileSync(pf, enrollPacket({ kind: "renew", now: new Date(Date.now() - 3600_000) }).text);
      const before = lab.sshCalls().length;
      const r = mac.run(["lobby", "push", pf]);
      expect(r.code).toBe(4);
      expect(r.err).toContain("this packet has expired; run enroll-device again");
      expect(lab.sshCalls().length).toBe(before);
    });

    test.skipIf(!HAVE_LOBBY)("packets from the lobby's own builder, in its CLI's layout, ride the lane byte-identical", async () => {
      // packages/lobby builds the packet; enroll-device writes it as
      // JSON.stringify(packet, null, 2) + "\n" (static.test.ts pins that line).
      const packets = await import(join(LOBBY_SRC, "packets.ts"));
      const wire = await import(join(LOBBY_SRC, "wire.ts"));
      const mac = lab.mac("air");
      mac.setup();
      const { privateKey } = generateKeyPairSync("ed25519");
      const publicKey: string = wire.publicKeyBase64(privateKey);
      const desk = {
        project_id: randomUUID(), identity_id: randomUUID(), signing_key_id: randomUUID(),
        public_key: publicKey, fingerprint: wire.publicKeyFingerprint(publicKey), display_name: "test desk",
      };
      for (const kind of ["enroll", "renew"] as const) {
        const now = new Date();
        const packet = packets.buildEnrollmentPacket({ kind, desk, key: privateKey, directoryTokenSha256: randomBytes(32).toString("hex"), now });
        const text = `${JSON.stringify(packet, null, 2)}\n`;
        packets.parseEnrollmentPacket(text, now);
        const pf = join(mac.home, `${kind}.json`);
        writeFileSync(pf, text);
        const push = mac.run(["lobby", "push", pf]);
        expect({ kind, code: push.code, err: push.err }).toEqual({ kind, code: 0, err: "" });
        const id = push.out.split(" ")[3]!;
        expect(id).toMatch(ID_RE);
        const inbox = lab.hub(["inbox"]);
        expect(inbox.code).toBe(0);
        const saved = join(lab.hubHome, "agenttool/state/lobby-mail/in/air", `${id}.json`);
        expect(readFileSync(saved, "utf8")).toBe(text);
        expect(packets.parseEnrollmentPacket(readFileSync(saved, "utf8"), new Date()).kind).toBe(kind);
        expect(inbox.out.includes(desk.fingerprint)).toBe(false);
        expect(inbox.out.includes(publicKey)).toBe(false);
      }
    });

    test("the client and the gate agree on the refusal corpus", () => {
      const mac = lab.mac("air");
      mac.setup();
      for (const bad of badEnrollCorpus()) {
        const pf = join(mac.home, "bad.json");
        writeFileSync(pf, bad.bytes);
        const r = mac.run(["lobby", "push", pf]);
        expect({ name: bad.name, code: r.code }).toEqual({ name: bad.name, code: 4 });
      }
      expect(lab.ids("lobby/in/air")).toEqual([]);
    });
  });
});
