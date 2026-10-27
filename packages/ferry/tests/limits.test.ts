/** Quotas, the spool cap, the disk floor, the in-flight limit, retention,
 * the log generations and the lock. A full spool refuses with 5 and leaves
 * nothing staged. */
import { afterEach, describe, expect, test } from "bun:test";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DARWIN_ONLY, idAt, Lab, SHELLS, sha256Hex } from "./helpers.ts";
import { enrollPacket } from "./packets.ts";

function stageLeftovers(lab: Lab): string[] {
  return readdirSync(lab.stage).filter((n) => n !== ".pruned");
}

describe.skipIf(DARWIN_ONLY)("limits (macOS only: BSD stat, date -v, xattr)", () => {
  describe.each(SHELLS)("under %s", (shell) => {
    let lab: Lab;
    afterEach(() => lab?.cleanup());

    test("the 5th lobby packet on a lane is 5", () => {
      lab = new Lab(shell);
      for (let i = 0; i < 4; i++) expect(lab.putLobby("air", enrollPacket().text).code).toBe(0);
      const r = lab.putLobby("air", enrollPacket().text);
      expect(r.code).toBe(5);
      expect(lab.ids("lobby/in/air").length).toBe(4);
      expect(stageLeftovers(lab)).toEqual([]);
      expect(lab.putLobby("studio", enrollPacket().text).code).toBe(0);
    });

    test("the 33rd file from one sender is 5", () => {
      lab = new Lab(shell);
      const now = new Date();
      for (let i = 0; i < 32; i++) {
        lab.plant("files/studio", { id: idAt(now, (0x10000000 + i).toString(16)), kind: "file", from: "air", to: "studio", body: `f${i}\n` });
      }
      const r = lab.putFile("air", "studio", "one-more.txt", "x\n");
      expect(r.code).toBe(5);
      expect(lab.ids("files/studio").length).toBe(32);
      expect(lab.putFile("air", "lab", "other.txt", "x\n").code).toBe(5);
      expect(lab.putFile("studio", "air", "fine.txt", "x\n").code).toBe(0);
      expect(stageLeftovers(lab)).toEqual([]);
    });

    test("the per-sender byte quota is 5", () => {
      lab = new Lab(shell, { site: { file_queue_bytes: 100 } });
      expect(lab.putFile("air", "studio", "a.txt", "a".repeat(60)).code).toBe(0);
      expect(lab.putFile("air", "studio", "b.txt", "b".repeat(60)).code).toBe(5);
      expect(lab.putFile("air", "studio", "c.txt", "c".repeat(40)).code).toBe(0);
    });

    test("the spool cap is 5", () => {
      lab = new Lab(shell, { site: { spool_max_bytes: 100 } });
      expect(lab.putFile("air", "studio", "a.txt", "a".repeat(60)).code).toBe(0);
      expect(lab.putFile("studio", "air", "b.txt", "b".repeat(60)).code).toBe(5);
      expect(lab.putLobby("air", enrollPacket().text).code).toBe(5);
    });

    test("the disk floor is 5 for puts and gets and leaves nothing in the stage; ack still drains", () => {
      lab = new Lab(shell, { site: { floor_kib: 999999999999 } });
      const r = lab.putFile("air", "studio", "a.txt", "data\n");
      expect(r.code).toBe(5);
      expect(r.err).toBe("ferry-gate: full: the post office disk is nearly full\n");
      expect(stageLeftovers(lab)).toEqual([]);
      expect(lab.putLobby("air", enrollPacket().text).code).toBe(5);
      expect(lab.ids("files/studio")).toEqual([]);
      const id = idAt(new Date(), "0000f100");
      lab.plant("files/air", { id, kind: "file", from: "studio", to: "air", body: "waiting\n" });
      const get = lab.gate("air", `get ${id}`);
      expect(get.code).toBe(5);
      expect(get.stdout.length).toBe(0);
      expect(stageLeftovers(lab)).toEqual([]);
      expect(lab.gate("air", "list").out).toContain(`item ${id} file studio 8 `);
      expect(lab.gate("air", `ack ${id}`).code).toBe(0);
      expect(lab.ids("files/air")).toEqual([]);
    });

    test("gets share the in-flight limit with uploads; list copies nothing", () => {
      lab = new Lab(shell);
      const id = idAt(new Date(), "0000f200");
      lab.plant("files/air", { id, kind: "file", from: "studio", to: "air", body: "for the air\n" });
      for (const s of ["AAAA1111", "BBBB2222"]) writeFileSync(join(lab.stage, `.take.air.${s}`), "copy");
      const get = lab.gate("air", `get ${id}`);
      expect(get.code).toBe(5);
      expect(get.err).toBe("ferry-gate: full: too many transfers in flight on this lane\n");
      expect(get.stdout.length).toBe(0);
      expect(lab.putFile("air", "studio", "a.txt", "data\n").code).toBe(5);
      expect(lab.gate("air", "list").out).toBe(`ferry-list/1\nitem ${id} file studio 12 ${sha256Hex("for the air\n")} x.txt\nend 1\n`);
      expect(stageLeftovers(lab).sort()).toEqual([".take.air.AAAA1111", ".take.air.BBBB2222"]);
      // Another lane is unaffected; once the copies go, the get is served.
      expect(lab.putFile("studio", "air", "b.txt", "data\n").code).toBe(0);
      for (const s of ["AAAA1111", "BBBB2222"]) rmSync(join(lab.stage, `.take.air.${s}`));
      expect(lab.gate("air", `get ${id}`).out).toBe("for the air\n");
      expect(stageLeftovers(lab)).toEqual([]);
    });

    test("readers that never read hold at most two copies per lane", async () => {
      lab = new Lab(shell);
      const body = Buffer.alloc(1024 * 1024, 0x63);
      const put = lab.putFile("studio", "air", "big.bin", body);
      expect(put.code).toBe(0);
      const id = put.out.split(" ")[2]!;
      const env = `env -i PATH=/usr/bin:/bin HOME=${lab.ferryHome} LC_ALL=C SSH_ORIGINAL_COMMAND='get ${id}'`;
      // A reader that never reads: the body is larger than a pipe holds, so
      // the gate blocks in cat with its copy staged until sleep exits.
      const stalled = (secs: number) => Bun.spawn({
        cmd: ["/bin/sh", "-c", `${env} ${shell} ${lab.gatePath} --peer air | sleep ${secs}`],
        stdout: "ignore",
        stderr: "pipe",
      });
      const takes = () => readdirSync(lab.stage).filter((n) => n.startsWith(".take."));
      const holders = [stalled(5), stalled(5)];
      for (let i = 0; i < 100 && takes().length < 2; i++) await Bun.sleep(50);
      expect(takes().length).toBe(2);
      expect(takes().every((n) => n.startsWith(".take.air."))).toBe(true);
      const late = [stalled(0), stalled(0)];
      const lateErrs = await Promise.all(late.map(async (p) => {
        await p.exited;
        return new Response(p.stderr).text();
      }));
      expect(lateErrs).toEqual(Array(2).fill("ferry-gate: full: too many transfers in flight on this lane\n"));
      expect(takes().length).toBe(2);
      await Promise.all(holders.map((p) => p.exited));
      for (let i = 0; i < 100 && stageLeftovers(lab).length > 0; i++) await Bun.sleep(50);
      expect(stageLeftovers(lab)).toEqual([]);
    }, 30_000);

    test("three uploads already in flight on a lane is 5", () => {
      lab = new Lab(shell);
      for (const s of ["AAAA1111", "BBBB2222", "CCCC3333"]) writeFileSync(join(lab.stage, `.part.air.${s}`), "partial");
      const r = lab.putFile("air", "studio", "a.txt", "data\n");
      expect(r.code).toBe(5);
      expect(stageLeftovers(lab).sort()).toEqual([".part.air.AAAA1111", ".part.air.BBBB2222", ".part.air.CCCC3333"]);
      expect(lab.putFile("studio", "air", "a.txt", "data\n").code).toBe(0);
    });

    test("prune: 8-day items go, 6-day items stay; stale strays and stage leftovers go; stray dirs stay", () => {
      lab = new Lab(shell);
      const day = 24 * 3600_000;
      const oldId = idAt(new Date(Date.now() - 8 * day), "00000008");
      const keepId = idAt(new Date(Date.now() - 6 * day), "00000006");
      lab.plant("files/air", { id: oldId, kind: "file", from: "studio", to: "air", body: "old\n" });
      lab.plant("files/air", { id: keepId, kind: "file", from: "studio", to: "air", body: "keep\n" });
      const hourAgo = new Date(Date.now() - 2 * 3600_000);
      const strayOld = join(lab.spool, "files/air", "junk.txt");
      writeFileSync(strayOld, "junk");
      utimesSync(strayOld, hourAgo, hourAgo);
      const strayNew = join(lab.spool, "files/air", "fresh.txt");
      writeFileSync(strayNew, "fresh");
      const orphanId = idAt(new Date(), "0000000f");
      const orphan = join(lab.spool, "files/air", `${orphanId}.body`);
      writeFileSync(orphan, "orphan");
      utimesSync(orphan, hourAgo, hourAgo);
      const leftover = join(lab.stage, ".part.air.OLDOLDOL");
      writeFileSync(leftover, "partial");
      utimesSync(leftover, hourAgo, hourAgo);
      const freshLeftover = join(lab.stage, ".part.air.NEWNEWNE");
      writeFileSync(freshLeftover, "partial");
      mkdirSync(join(lab.spool, "files/air", "stray-dir"));
      const r = lab.gate("air", "ping");
      expect(r.code).toBe(0);
      expect(lab.ids("files/air")).toEqual([keepId]);
      expect(existsSync(join(lab.spool, "files/air", `${oldId}.body`))).toBe(false);
      expect(existsSync(strayOld)).toBe(false);
      expect(existsSync(strayNew)).toBe(true);
      expect(existsSync(orphan)).toBe(false);
      expect(existsSync(leftover)).toBe(false);
      expect(existsSync(freshLeftover)).toBe(true);
      expect(existsSync(join(lab.spool, "files/air", "stray-dir"))).toBe(true);
      const log = lab.gateLog();
      expect(log).toMatch(/ op=prune code=0 id=- to=- bytes=- items=5\n/);
      expect(log).toMatch(/ op=prune code=6 id=- to=- bytes=- items=1\n/);
      // Rate-limited: a second call within ten minutes does not prune again.
      writeFileSync(strayOld, "junk");
      utimesSync(strayOld, hourAgo, hourAgo);
      lab.gate("air", "ping");
      expect(existsSync(strayOld)).toBe(true);
    });

    test("gate.log keeps four older generations", () => {
      lab = new Lab(shell);
      const dir = join(lab.ferryHome, "log");
      const log = join(dir, "gate.log");
      lab.gate("air", "ping");
      appendFileSync(log, "2026-10-27T00:00:00Z gate peer=air op=ack code=0 id=20261027T000000Z-deadbeef to=- bytes=- items=-\n");
      const holding = () => readdirSync(dir).filter((n) => readFileSync(join(dir, n), "utf8").includes("deadbeef")).sort();
      for (let roll = 1; roll <= 4; roll++) {
        appendFileSync(log, `${"x".repeat(1024 * 1024)}\n`);
        expect(lab.gate("air", "x").code).toBe(2);
        expect(holding()).toEqual([`gate.log.${roll}`]);
      }
      expect(readdirSync(dir).sort()).toEqual(["gate.log", "gate.log.1", "gate.log.2", "gate.log.3", "gate.log.4"]);
      appendFileSync(log, `${"x".repeat(1024 * 1024)}\n`);
      lab.gate("air", "x");
      expect(holding()).toEqual([]);
      expect(readdirSync(dir).sort()).toEqual(["gate.log", "gate.log.1", "gate.log.2", "gate.log.3", "gate.log.4"]);
      expect(readFileSync(log, "utf8")).toMatch(/^\S+ gate peer=air op=refuse code=2 id=- to=- bytes=- items=-\n$/);
    });

    test("a stale lock is broken once; a fresh lock held elsewhere is 1 after the retries", () => {
      lab = new Lab(shell);
      const lock = join(lab.spool, ".lock");
      mkdirSync(lock);
      const twoMinAgo = new Date(Date.now() - 120_000);
      utimesSync(lock, twoMinAgo, twoMinAgo);
      expect(lab.putFile("air", "studio", "a.txt", "data\n").code).toBe(0);
      expect(existsSync(lock)).toBe(false);
      mkdirSync(lock);
      const r = lab.putFile("air", "studio", "b.txt", "data\n", { timeout: 20_000 });
      expect(r.code).toBe(1);
      expect(r.err).toBe("ferry-gate: busy: the spool is busy; try again\n");
      expect(existsSync(lock)).toBe(true);
      expect(lab.ids("files/studio").length).toBe(1);
      expect(stageLeftovers(lab)).toEqual([]);
    }, 30_000);
  });
});
