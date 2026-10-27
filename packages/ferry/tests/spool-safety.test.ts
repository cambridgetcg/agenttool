/** The spool is hostile ground: nothing that fails a check is ever listed or
 * served, a planted link is never followed, a FIFO never hangs, and an
 * unsafe tree or site.conf stops everything with exit 6 and one fixed line.
 * A list checks metas and stats bodies but copies none; the content hash is
 * checked on the private copy a get takes, before any byte is served. */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, linkSync, mkdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chmodBin, DARWIN_ONLY, Lab, RUNNER, RUNNER_GROUP, SHELLS, sha256Hex } from "./helpers.ts";

const ID = "20261027T120000Z-0a1b2c3d";
const CANARY = "CANARY-outside-the-spool-7f3e";

function otherGroup(): string | null {
  const r = Bun.spawnSync({ cmd: ["/usr/bin/id", "-Gn"], stdout: "pipe" });
  return r.stdout.toString().trim().split(/\s+/).find((g) => g !== RUNNER_GROUP) ?? null;
}

describe.skipIf(DARWIN_ONLY)("spool safety (macOS only: BSD stat, date -v, xattr)", () => {
  describe.each(SHELLS)("under %s", (shell) => {
    let lab: Lab;
    let dir: string;
    beforeEach(() => {
      lab = new Lab(shell, { fakeStat: true });
      dir = join(lab.spool, "files/air");
    });
    afterEach(() => lab.cleanup());

    const body = "a body for the air\n";
    const goodMeta = (b: string, extra = "") =>
      `ferry-meta/1\nkind=file\nfrom=studio\nto=air\nsize=${Buffer.byteLength(b)}\nsha256=${sha256Hex(b)}\nname=x.txt\n${extra}`;

    function expectNeverServed(id = ID, listed = false): void {
      const list = lab.gate("air", "list", undefined, { timeout: 5000 });
      expect(list.timedOut).toBe(false);
      expect(list.code).toBe(0);
      if (listed) expect(list.out).toMatch(new RegExp(`^ferry-list/1\nitem ${id} file studio [^\n]+\nend 1\n$`));
      else expect(list.out).toBe("ferry-list/1\nend 0\n");
      const get = lab.gate("air", `get ${id}`, undefined, { timeout: 5000 });
      expect(get.timedOut).toBe(false);
      expect([3, 6]).toContain(get.code ?? -1);
      expect(get.stdout.length).toBe(0);
      expect(get.out.includes(CANARY)).toBe(false);
    }

    test("a valid planted item is served (the control case)", () => {
      lab.plant("files/air", { id: ID, kind: "file", from: "studio", to: "air", body });
      expect(lab.gate("air", "list").out).toContain(`item ${ID} file studio`);
      expect(lab.gate("air", `get ${ID}`).out).toBe(body);
    });

    test("a .part planted in the spool is never listed", () => {
      writeFileSync(join(dir, ".part.studio.AAAA"), body);
      chmodSync(join(dir, ".part.studio.AAAA"), 0o640);
      expectNeverServed();
    });

    test("a body without a meta, and a meta without a body", () => {
      writeFileSync(join(dir, `${ID}.body`), body);
      chmodSync(join(dir, `${ID}.body`), 0o640);
      expectNeverServed();
      rmSync(join(dir, `${ID}.body`));
      writeFileSync(join(dir, `${ID}.meta`), goodMeta(body));
      chmodSync(join(dir, `${ID}.meta`), 0o640);
      expectNeverServed();
    });

    test("a body whose sha256 differs from its meta is listed but never served", () => {
      const meta = `ferry-meta/1\nkind=file\nfrom=studio\nto=air\nsize=${body.length}\nsha256=${"0".repeat(64)}\nname=x.txt\n`;
      lab.plant("files/air", { id: ID, kind: "file", from: "studio", to: "air", body, meta });
      expectNeverServed(ID, true);
      const get = lab.gate("air", `get ${ID}`);
      expect(get.code).toBe(6);
      expect(get.err).toBe("ferry-gate: unsafe: this item failed its checks\n");
    });

    test.each([
      ["a wrong size", `ferry-meta/1\nkind=file\nfrom=studio\nto=air\nsize=3\nsha256=${sha256Hex(body)}\nname=x.txt\n`],
      ["a swapped key order", `ferry-meta/1\nkind=file\nto=air\nfrom=studio\nsize=${body.length}\nsha256=${sha256Hex(body)}\nname=x.txt\n`],
      ["an extra line", `${goodMeta(body)}note=hi\n`],
      ["no final newline", goodMeta(body).slice(0, -1)],
      ["the wrong recipient", `ferry-meta/1\nkind=file\nfrom=studio\nto=mini\nsize=${body.length}\nsha256=${sha256Hex(body)}\nname=x.txt\n`],
      ["a lobby kind in files", `ferry-meta/1\nkind=lobby-join\nfrom=hub\nto=air\nsize=${body.length}\nsha256=${sha256Hex(body)}\n`],
    ])("a meta with %s is never served", (_label, meta) => {
      lab.plant("files/air", { id: ID, kind: "file", from: "studio", to: "air", body, meta });
      expectNeverServed();
    });

    test("a body or meta that is a symlink to an outside file is never followed", () => {
      const outside = join(lab.root, "outside.txt");
      writeFileSync(outside, `${CANARY}\n`);
      chmodSync(outside, 0o640);
      symlinkSync(outside, join(dir, `${ID}.body`));
      writeFileSync(join(dir, `${ID}.meta`), goodMeta(`${CANARY}\n`));
      chmodSync(join(dir, `${ID}.meta`), 0o640);
      expectNeverServed();
      rmSync(join(dir, `${ID}.body`));
      rmSync(join(dir, `${ID}.meta`));
      const outsideMeta = join(lab.root, "outside.meta");
      writeFileSync(outsideMeta, goodMeta(body));
      chmodSync(outsideMeta, 0o640);
      writeFileSync(join(dir, `${ID}.body`), body);
      chmodSync(join(dir, `${ID}.body`), 0o640);
      symlinkSync(outsideMeta, join(dir, `${ID}.meta`));
      expectNeverServed();
    });

    test("a hard-linked body (link count 2) is never served", () => {
      const outside = join(lab.root, "outside.txt");
      writeFileSync(outside, `${CANARY}\n`);
      chmodSync(outside, 0o640);
      linkSync(outside, join(dir, `${ID}.body`));
      writeFileSync(join(dir, `${ID}.meta`), goodMeta(`${CANARY}\n`));
      chmodSync(join(dir, `${ID}.meta`), 0o640);
      expectNeverServed();
    });

    test.each([0o644, 0o660, 0o600])("a body at mode %o is never served", (mode) => {
      lab.plant("files/air", { id: ID, kind: "file", from: "studio", to: "air", body });
      chmodSync(join(dir, `${ID}.body`), mode);
      expectNeverServed();
    });

    test("a body with a foreign owner is never served", () => {
      lab.plant("files/air", { id: ID, kind: "file", from: "studio", to: "air", body });
      writeFileSync(join(lab.ctl, "stat.owner"), `${join(dir, `${ID}.body`)}\n`);
      expectNeverServed();
    });

    test("a FIFO body never hangs and is never served", () => {
      Bun.spawnSync({ cmd: ["/usr/bin/mkfifo", "-m", "0640", join(dir, `${ID}.body`)] });
      writeFileSync(join(dir, `${ID}.meta`), goodMeta(body));
      chmodSync(join(dir, `${ID}.meta`), 0o640);
      expectNeverServed();
    }, 15_000);

    function expectUnsafe(cmd = "ping"): void {
      const r = lab.gate("air", cmd);
      expect(r.code).toBe(6);
      expect(r.stdout.length).toBe(0);
      expect(r.err).toMatch(/^ferry-gate: unsafe: [^\n]+\n$/);
    }

    test("a spool directory that is a symlink stops the gate", () => {
      const real = join(lab.root, "elsewhere");
      renameSync(dir, real);
      symlinkSync(real, dir);
      expectUnsafe();
    });

    test.each(["2775", "0770", "2777"])("a spool directory at mode %s stops the gate", (mode) => {
      chmodBin(mode, dir);
      expectUnsafe();
    });

    test("a spool directory in the wrong group stops the gate", () => {
      const g = otherGroup();
      if (g === null) return;
      Bun.spawnSync({ cmd: ["/usr/bin/chgrp", g, dir] });
      chmodBin("2770", dir);
      expectUnsafe();
    });

    test("a top-level spool directory with the wrong mode stops the gate", () => {
      chmodBin("2775", join(lab.spool, "files"));
      expectUnsafe();
    });

    test("a stage on another device stops the gate", () => {
      writeFileSync(join(lab.ctl, "stat.dev"), `${lab.stage}\n`);
      expectUnsafe();
    });

    test("a stage at the wrong mode stops the gate", () => {
      chmodBin("0750", lab.stage);
      expectUnsafe();
    });

    const SITE = () => [
      "ferry-site/1", `ferry_user=${RUNNER}`, `ferry_group=${RUNNER_GROUP}`, `hub_user=${RUNNER}`, `hub_home=${lab.hubHome}`,
      "local_peer=lab", "lan_cidr=192.0.2.0/24", "lobby_queue=4", "file_queue_items=32", "file_queue_bytes=134217728",
      "spool_max_bytes=1073741824", "floor_kib=1024", "retain_days=7",
    ];

    test.each([
      ["a missing key", (l: string[]) => l.filter((x) => !x.startsWith("retain_days="))],
      ["an extra key", (l: string[]) => [...l, "extra=1"]],
      ["a bad cidr", (l: string[]) => l.map((x) => (x.startsWith("lan_cidr=") ? "lan_cidr=192.0.2.0/33" : x))],
      ["keys out of order", (l: string[]) => [l[0]!, l[2]!, l[1]!, ...l.slice(3)]],
      ["a wrong header", (l: string[]) => ["ferry-site/2", ...l.slice(1)]],
      ["a leading-zero number", (l: string[]) => l.map((x) => (x.startsWith("lobby_queue=") ? "lobby_queue=04" : x))],
      ["a relative hub home", (l: string[]) => l.map((x) => (x.startsWith("hub_home=") ? "hub_home=Users/hub" : x))],
      ["a reserved local peer", (l: string[]) => l.map((x) => (x.startsWith("local_peer=") ? "local_peer=hub" : x))],
    ] as [string, (l: string[]) => string[]][])("site.conf with %s stops every script", (_label, mutate) => {
      lab.writeSite(`${mutate(SITE()).join("\n")}\n`);
      expectUnsafe();
      const hub = lab.hub(["status"]);
      expect(hub.code).toBe(6);
      expect(hub.err).toMatch(/^ferry-hub: unsafe: [^\n]+\n$/);
    });

    test("site.conf that is a symlink, or group-writable, stops the gate", () => {
      const site = join(lab.ferryRoot, "site.conf");
      const real = join(lab.root, "site.real");
      renameSync(site, real);
      symlinkSync(real, site);
      expectUnsafe();
      rmSync(site);
      renameSync(real, site);
      chmodSync(site, 0o664);
      expectUnsafe();
    });

    test("the hub refuses when it is not the hub user", () => {
      const lines = SITE().map((x) => (x.startsWith("hub_user=") ? "hub_user=someoneelse" : x));
      lab.writeSite(`${lines.join("\n")}\n`);
      const r = lab.hub(["status"]);
      expect(r.code).toBe(1);
      expect(lab.gate("air", "ping").code).toBe(0);
    });

    test("the gate refuses when it is not the ferry account", () => {
      const lines = SITE().map((x) => (x.startsWith("ferry_user=") ? "ferry_user=someoneelse" : x));
      lab.writeSite(`${lines.join("\n")}\n`);
      expect(lab.gate("air", "ping").code).toBe(1);
    });

    test("a missing lane directory is 6, a stray directory in the spool is left alone", () => {
      mkdirSync(join(lab.spool, "files/air", "stray-dir"));
      expect(lab.gate("air", "list").out).toBe("ferry-list/1\nend 0\n");
      rmSync(join(lab.spool, "lobby/out/air"), { recursive: true });
      expectUnsafe();
    });
  });
});
