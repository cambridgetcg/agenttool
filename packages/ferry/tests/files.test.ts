/** Files between any two Macs through the star: send, list, fetch, ack,
 * lane isolation, the size bounds, integrity and the lab's own peer. */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DARWIN_ONLY, Lab, Mac, SHELLS, sha256Hex } from "./helpers.ts";

const MiB = 1024 * 1024;

function quarantineOf(path: string): string {
  const r = Bun.spawnSync({ cmd: ["/usr/bin/xattr", "-p", "com.apple.quarantine", path], stdout: "pipe", stderr: "pipe" });
  return r.stdout.toString().trim();
}

function modeOf(path: string): string {
  return (statSync(path).mode & 0o7777).toString(8).padStart(4, "0");
}

describe.skipIf(DARWIN_ONLY)("files (macOS only: BSD stat, date -v, xattr)", () => {
  describe.each(SHELLS)("under %s", (shell) => {
    let lab: Lab;
    let air: Mac;
    let studio: Mac;
    beforeEach(() => {
      lab = new Lab(shell);
      air = lab.mac("air");
      air.setup();
      studio = lab.mac("studio");
      studio.setup();
    });
    afterEach(() => lab.cleanup());

    test("send, list, fetch: lands 0600 with quarantine, bytes identical, acked", () => {
      const src = join(air.home, "My Report (1).pdf");
      const bytes = Buffer.from("%PDF-1.7 synthetic\n\u0000ÿ binary tail");
      writeFileSync(src, bytes);
      const sent = air.run(["send", "studio", src]);
      expect(sent.code).toBe(0);
      const id = lab.ids("files/studio")[0]!;
      expect(sent.out).toBe(`sent ${id} to studio as My_Report__1_.pdf (${bytes.length} bytes, sha256 ${sha256Hex(bytes).slice(0, 12)})\n`);
      const meta = readFileSync(join(lab.spool, "files/studio", `${id}.meta`), "utf8");
      expect(meta).toBe(`ferry-meta/1\nkind=file\nfrom=air\nto=studio\nsize=${bytes.length}\nsha256=${sha256Hex(bytes)}\nname=My_Report__1_.pdf\n`);
      const list = studio.run(["list"]);
      expect(list.code).toBe(0);
      expect(list.out).toBe(`file   ${id}  from air  My_Report__1_.pdf  ${bytes.length} bytes  (just now)\n1 waiting\n`);
      const fetch = studio.run(["fetch"]);
      expect(fetch.code).toBe(0);
      const landed = join(studio.home, "Ferry/inbox/air", `${id}--My_Report__1_.pdf`);
      expect(fetch.out).toBe(`received ${id} from air: ${landed} (${bytes.length} bytes, sha256 ok)\n`);
      expect(readFileSync(landed).equals(bytes)).toBe(true);
      expect(modeOf(landed)).toBe("0600");
      expect(modeOf(join(studio.home, "Ferry/inbox/air"))).toBe("0700");
      expect(quarantineOf(landed)).toMatch(/^0081;[0-9a-f]{8};ferry;$/);
      expect(lab.ids("files/studio")).toEqual([]);
      expect(studio.run(["list"]).out).toBe("0 waiting\n");
    });

    test("unknown recipient is 3, an empty file 4, a reserved or own name 2", () => {
      const src = join(air.home, "a.txt");
      writeFileSync(src, "x");
      expect(air.run(["send", "mini", src]).code).toBe(3);
      const empty = join(air.home, "empty.txt");
      writeFileSync(empty, "");
      expect(air.run(["send", "studio", empty]).code).toBe(4);
      expect(lab.putFile("air", "studio", "empty.txt", "").code).toBe(4);
      expect(air.run(["send", "hub", src]).code).toBe(2);
      expect(air.run(["send", "air", src]).code).toBe(2);
      expect(lab.ids("files/studio")).toEqual([]);
    });

    test("16 MiB + 1 is refused with 4; exactly 16 MiB is carried", () => {
      const big = join(air.home, "big.bin");
      writeFileSync(big, Buffer.alloc(16 * MiB + 1, 0x61));
      expect(air.run(["send", "studio", big]).code).toBe(4);
      expect(lab.putFile("air", "studio", "big.bin", Bun.file(big)).code).toBe(4);
      expect(lab.ids("files/studio")).toEqual([]);
      writeFileSync(big, Buffer.alloc(16 * MiB, 0x62));
      const ok = air.run(["send", "studio", big]);
      expect(ok.code).toBe(0);
      expect(ok.out).toContain(`(${16 * MiB} bytes, sha256 `);
      const fetched = studio.run(["fetch"]);
      expect(fetched.code).toBe(0);
      const landedDir = join(studio.home, "Ferry/inbox/air");
      const name = readdirSync(landedDir)[0]!;
      expect(statSync(join(landedDir, name)).size).toBe(16 * MiB);
    }, 60_000);

    test("an upload cut short of its declared size is 4 and publishes nothing", () => {
      // A Ctrl-C or a dropped connection closes the gate's stdin early; the
      // declared size is how the gate knows the stream is not the whole file.
      const full = Buffer.alloc(MiB, 0x5a);
      const before = lab.spoolDigest();
      const r = lab.gate("air", `put file studio report.bin ${full.length}`, full.subarray(0, 100 * 1024));
      expect(r.code).toBe(4);
      expect(r.err).toBe("ferry-gate: invalid: the upload ended before its declared size; nothing was kept\n");
      expect(r.stdout.length).toBe(0);
      expect(lab.spoolDigest()).toBe(before);
      expect(readdirSync(lab.stage).filter((n) => n !== ".pruned")).toEqual([]);
      const long = lab.gate("air", "put file studio report.bin 10", "x".repeat(11));
      expect(long.code).toBe(4);
      expect(long.err).toBe("ferry-gate: invalid: the upload is longer than its declared size\n");
      expect(lab.spoolDigest()).toBe(before);
      expect(studio.run(["list"]).out).toBe("0 waiting\n");
      // The whole file, declared, is carried.
      expect(lab.putFile("air", "studio", "report.bin", full).code).toBe(0);
      expect(studio.run(["fetch"]).code).toBe(0);
    });

    test("a lane sees, gets and acks only its own items", () => {
      const src = join(studio.home, "note.txt");
      writeFileSync(src, "for the air only\n");
      expect(studio.run(["send", "air", src]).code).toBe(0);
      const id = lab.ids("files/air")[0]!;
      const studioList = lab.gate("studio", "list");
      expect(studioList.out).toBe("ferry-list/1\nend 0\n");
      expect(lab.gate("studio", `get ${id}`).code).toBe(3);
      expect(lab.gate("studio", `ack ${id}`).code).toBe(3);
      expect(studio.run(["ack", id]).code).toBe(3);
      expect(lab.ids("files/air")).toEqual([id]);
      const airList = lab.gate("air", "list");
      expect(airList.out).toContain(`item ${id} file studio 17 `);
    });

    test("ack then get is 3", () => {
      const src = join(studio.home, "note.txt");
      writeFileSync(src, "gone soon\n");
      studio.run(["send", "air", src]);
      const id = lab.ids("files/air")[0]!;
      const ack = air.run(["ack", id]);
      expect(ack.code).toBe(0);
      expect(ack.out).toBe(`ok: discarded ${id}\n`);
      expect(lab.gate("air", `get ${id}`).code).toBe(3);
      expect(air.run(["fetch", id]).code).toBe(3);
    });

    test("a flipped byte in transit is exit 9: nothing lands, nothing is acked", () => {
      const src = join(studio.home, "note.txt");
      writeFileSync(src, "integrity matters\n");
      studio.run(["send", "air", src]);
      const id = lab.ids("files/air")[0]!;
      writeFileSync(join(lab.ctl, "flip"), "");
      const r = air.run(["fetch"]);
      expect(r.code).toBe(9);
      expect(r.err).toContain("did not arrive intact");
      expect(existsSync(join(air.home, "Ferry/inbox/studio")) ? readdirSync(join(air.home, "Ferry/inbox/studio")) : []).toEqual([]);
      expect(lab.ids("files/air")).toEqual([id]);
      expect(lab.sshCalls().some((c) => c[c.length - 1] === `ack ${id}`)).toBe(false);
    });

    test("the lab's own user sends and fetches as the local peer, both ways", () => {
      const src = join(air.home, "to-lab.txt");
      writeFileSync(src, "air to lab\n");
      expect(air.run(["send", "lab", src]).code).toBe(0);
      const id = lab.ids("files/lab")[0]!;
      const list = lab.hub(["list"]);
      expect(list.out).toBe(`file   ${id}  from air  to-lab.txt  11 bytes  (just now)\n1 waiting\n`);
      const fetch = lab.hub(["fetch"]);
      expect(fetch.code).toBe(0);
      const landed = join(lab.hubHome, "Ferry/inbox/air", `${id}--to-lab.txt`);
      expect(readFileSync(landed, "utf8")).toBe("air to lab\n");
      expect(modeOf(landed)).toBe("0600");
      expect(quarantineOf(landed)).toMatch(/^0081;/);
      expect(lab.ids("files/lab")).toEqual([]);

      const back = join(lab.hubHome, "to air.txt");
      writeFileSync(back, "lab to air\n");
      const sent = lab.hub(["send", "air", back]);
      expect(sent.code).toBe(0);
      expect(sent.out).toMatch(/^sent \S+ to air as to_air\.txt \(11 bytes, sha256 [0-9a-f]{12}\)\n$/);
      const got = air.run(["fetch"]);
      expect(got.code).toBe(0);
      const backId = got.out.split(" ")[1]!;
      expect(readFileSync(join(air.home, "Ferry/inbox/lab", `${backId}--to_air.txt`), "utf8")).toBe("lab to air\n");
      expect(lab.hub(["send", "lab", back]).code).toBe(2);
      expect(lab.hub(["send", "mini", back]).code).toBe(3);
    });

    test("the hub acks a file without fetching it", () => {
      const src = join(air.home, "x.txt");
      writeFileSync(src, "x\n");
      air.run(["send", "lab", src]);
      const id = lab.ids("files/lab")[0]!;
      expect(lab.hub(["ack", id]).out).toBe(`ok: discarded ${id}\n`);
      expect(lab.hub(["ack", id]).code).toBe(3);
      expect(lab.hub(["fetch", id]).code).toBe(3);
    });
  });
});
