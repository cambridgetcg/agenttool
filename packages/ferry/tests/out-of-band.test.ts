/** Out-of-band values stay out of band. Yu reads the desk fingerprint and
 * the door fingerprint off the source machine's own screen; if Ferry printed,
 * logged or pre-filled either one (or a public key they derive from), the
 * check would become theatre. This walks every command path that touches a
 * packet and searches everything Ferry wrote for those values. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DARWIN_ONLY, Lab, listTree, Mac, PKG_DIR, readScript, SCRIPTS, SHELLS } from "./helpers.ts";
import { containsNeedle, enrollPacket, joinPacket, needles, newKey } from "./packets.ts";

const ALLOWED_FILTERS = ['type=="object" and .format==$f and (keys==$k)', "[.kind, .valid_until] | @tsv"];
const FORBIDDEN_SELECTORS = [".fingerprint", ".door", ".public_key", ".packet_sig", ".invitation_template", ".enrollment_request"];

describe.skipIf(DARWIN_ONLY)("out-of-band values (macOS only: BSD stat, date -v, xattr)", () => {
  describe.each(SHELLS)("under %s", (shell) => {
    let lab: Lab;
    let air: Mac;
    const desk = newKey();
    const door = newKey();
    const list = needles(desk, door);
    const seen: { what: string; text: string }[] = [];
    let getBody = "";
    let joinText = "";
    let fetchOut = "";

    const keep = (what: string, r: { out: string; err: string }) => {
      seen.push({ what: `${what} stdout`, text: r.out }, { what: `${what} stderr`, text: r.err });
      return r;
    };
    const snapshotTrees = (label: string) => {
      const trees = [
        lab.spool,
        lab.stage,
        join(lab.hubHome, ".local/state/agenttool/ferry-hub"),
        join(lab.hubHome, "agenttool/state/lobby-mail"),
        join(lab.hubHome, "Ferry"),
        air.state,
        join(air.home, ".local/state/agenttool/lobby-mail"),
        join(air.home, "Ferry"),
      ];
      for (const t of trees) seen.push({ what: `${label} names under ${t}`, text: listTree(t).join("\n") });
      const metaDirs = ["lobby/in/air", "lobby/out/air", "files/air", "files/lab"].map((d) => join(lab.spool, d));
      for (const d of metaDirs) {
        if (!existsSync(d)) continue;
        for (const n of readdirSync(d).filter((x) => x.endsWith(".meta"))) {
          seen.push({ what: `${label} meta ${n}`, text: readFileSync(join(d, n), "utf8") });
        }
      }
    };

    beforeAll(() => {
      lab = new Lab(shell);
      air = lab.mac("air");
      keep("client init", air.run(["init", "--self", "air"]));
      writeFileSync(join(lab.ctl, "keymap"), `${air.keyPath} air\n`);
      keep("client peer add", air.pin());
      keep("client whoami", air.run(["whoami"]));
      keep("client ping", air.run(["ping"]));

      const pkt = enrollPacket({ kind: "enroll", desk });
      const pf = join(air.home, "pkt.json");
      writeFileSync(pf, pkt.text);
      keep("client lobby push", air.run(["lobby", "push", pf]));
      snapshotTrees("after push");
      keep("gate list (empty)", lab.gate("air", "list"));
      keep("hub status", lab.hub(["status"]));
      const inbox = keep("hub inbox", lab.hub(["inbox"]));
      snapshotTrees("after inbox");
      const relayLine = inbox.out.split("\n")[3]!;
      const outPath = relayLine.split(" > ")[1]!.split(" && ")[0]!;
      joinText = joinPacket({ desk, door }).text;
      writeFileSync(outPath, joinText);
      keep("hub reply", lab.hub(relayLine.split(" && ")[1]!.split(" ").slice(1)));
      snapshotTrees("after reply");
      keep("hub list", lab.hub(["list"]));
      keep("client list", air.run(["list"]));
      const gateList = keep("gate list", lab.gate("air", "list"));
      const joinId = gateList.out.split("\n")[1]!.split(" ")[1]!;
      const get = lab.gate("air", `get ${joinId}`);
      getBody = get.out;
      seen.push({ what: "gate get stderr", text: get.err });
      const fetch = keep("client lobby fetch", air.run(["lobby", "fetch"]));
      fetchOut = fetch.out;
      snapshotTrees("after fetch");

      const second = enrollPacket({ kind: "renew", desk });
      const put = keep("gate put", lab.putLobby("air", second.text));
      snapshotTrees("after gate put");
      const putId = put.out.split(" ")[2]!;
      const hubInbox2 = keep("hub inbox 2", lab.hub(["inbox"]));
      expect(hubInbox2.out).toContain(putId);
      const hubInbox3 = keep("hub inbox 3 (re-prints the packet still waiting for its relay)", lab.hub(["inbox"]));
      expect(hubInbox3.out).toContain(putId);
      lab.putLobby("air", enrollPacket({ kind: "renew", desk }).text);
      const putId3 = lab.ids("lobby/in/air")[0]!;
      keep("gate ack (refused: inbound items are not the lane's to ack)", lab.gate("air", `ack ${putId3}`));
      const note = join(lab.hubHome, "note.txt");
      writeFileSync(note, "a note\n");
      keep("hub send", lab.hub(["send", "air", note]));
      const noteId = lab.ids("files/air")[0]!;
      const acked = keep("gate ack", lab.gate("air", `ack ${noteId}`));
      expect(acked.out).toBe(`ok ack ${noteId}\n`);

      const pub = join(lab.root, "air.pub");
      writeFileSync(pub, readFileSync(`${air.keyPath}.pub`));
      const fp = air.run(["whoami"]).out.split("\n")[2]!.split(" ")[2]!;
      keep("admin lane add", lab.admin(["lane", "add", "--peer", "studio", "--pubkey-file", pub, "--expect-fp", fp], "yes\n"));
      seen.push({ what: "admin tty", text: readFileSync(join(lab.ctl, "tty"), "utf8") });
      keep("admin lane list", lab.admin(["lane", "list"]));
      keep("admin whoami", lab.admin(["whoami"]));

      seen.push({ what: "gate.log", text: lab.gateLog() });
      seen.push({ what: "hub.log", text: lab.hubLog() });
      seen.push({ what: "ferry.conf", text: readFileSync(join(air.state, "ferry.conf"), "utf8") });
    }, 120_000);
    afterAll(() => lab.cleanup());

    test("the flow ran end to end", () => {
      expect(fetchOut).toContain("received join packet ");
      expect(getBody).toBe(joinText);
      expect(seen.length).toBeGreaterThan(40);
    });

    test("no output, log, meta, name or conf holds a fingerprint or public key", () => {
      for (const s of seen) {
        expect({ what: s.what, needle: containsNeedle(s.text, list) }).toEqual({ what: s.what, needle: null });
      }
    });

    test("only a get's body carries the packet, and it carries it unchanged", () => {
      expect(containsNeedle(getBody, list)).not.toBeNull();
    });

    test("the printed join line carries the literal placeholder", () => {
      expect(fetchOut).toContain(" --door-fingerprint <type the 16 hex from the hub's own screen>\n");
    });
  });

  test("the scripts use only the two allowed jq filters and never name a key field", () => {
    for (const name of Object.keys(SCRIPTS) as (keyof typeof SCRIPTS)[]) {
      const text = readScript(name);
      for (const sel of FORBIDDEN_SELECTORS) expect({ name, sel, found: text.includes(sel) }).toEqual({ name, sel, found: false });
      for (const line of text.split("\n")) {
        if (!/"\$JQ" -/.test(line)) continue;
        expect({ name, line, ok: line.includes('"$SHAPE_FILTER"') || line.includes('"$DISPLAY_FILTER"') }).toEqual({ name, line, ok: true });
      }
      const defs = [...text.matchAll(/^(SHAPE_FILTER|DISPLAY_FILTER)='([^']*)'$/gm)].map((m) => m[2]);
      for (const d of defs) expect(ALLOWED_FILTERS).toContain(d!);
    }
    expect(existsSync(join(PKG_DIR, "bin/ferry"))).toBe(true);
  });
});
