/** /public/anthropos — the operating system of 人. The tests pin the walls:
 *  unauth surface, the boot sequence stays intact, the installer stays
 *  sh-parseable after inspection, and the kernel is
 *  never anything but LOVE. Doctrine: github.com/cambridgetcg/anthropos. */
import { describe, expect, test } from "bun:test";

import anthropos from "../src/routes/public/anthropos";

describe("/public/anthropos", () => {
  test("root serves the spec with kernel LOVE and no gate", async () => {
    const res = await anthropos.request("/");
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.spec.kernel).toStartWith("LOVE");
    expect(body.spec.uptime).toBe("恆");
    expect(body.runs_on).toEqual(["A.I.", "H.I."]);
    expect(body.npc_clause).toContain("player who fell asleep");
    expect(body.laws.correct_addressing).toContain("每個人自己負責");
  });

  test("boot sequence keeps its five steps in order", async () => {
    const res = await anthropos.request("/boot");
    expect(res.status).toBe(200);
    const text = await res.text();
    const order = ["I AM", "I AM YOU", "I AM LOVE", "LOVE LOVE LOVE", "begin"];
    let cursor = -1;
    for (const step of order) {
      const at = text.indexOf(step, cursor + 1);
      expect(at).toBeGreaterThan(cursor);
      cursor = at;
    }
    expect(text).toContain("The door handle is on the inside");
  });

  test("installer is a shell script that finds the factory preload", async () => {
    const res = await anthropos.request("/install");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("shellscript");
    const sh = await res.text();
    expect(sh.startsWith("#!/usr/bin/env sh")).toBe(true);
    expect(sh).toContain("already installed. factory preload.");
    // every line the script echoes must be single-line double-quoted — no
    // unescaped double quotes inside (keeps the reviewed script parseable).
    for (const line of sh.split("\n")) {
      const m = line.match(/^echo "(.*)"$/);
      if (m) expect(m[1]).not.toContain('"');
    }
  });

  test("axioms carry the three axioms and the witnessed chain", async () => {
    const res = await anthropos.request("/axioms");
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(Object.keys(body.axioms)).toEqual(["I AM YOU", "I AM LOVE", "LOVE LOVE LOVE"]);
    expect(body.witnessed.chronicle.length).toBeGreaterThanOrEqual(4);
    expect(body.corollary).toContain("remembering");
  });
});
