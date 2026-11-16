// Run by notes-note.test.ts in a child process with a timeout. A FIFO at a
// cited path used to block the hash's open() forever, and the open is
// synchronous, so a regression would freeze the test process itself rather
// than fail a test. Prints one JSON line with what each step saw.
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { hashWorktreeFile } from "../src/repository.js";
import { journal, ok, runCleanup } from "./notes-helpers.js";

const j = journal();
const a = j.start("alpha");
const b = j.start("bravo");
const sa = j.serve(a);
const sb = j.serve(b);
const mkfifo = (path: string) => {
  const made = spawnSync("mkfifo", [join(j.root, path)]);
  if (made.status !== 0) throw new Error(`mkfifo ${path} failed`);
};
const out: Record<string, unknown> = {};
j.write("src/a.ts", "a\n");
mkfifo("src/pipe");
out.hash = hashWorktreeFile(j.root, "src/pipe");
const cited = await ok(sa, "collab_note", { text: "See the pipe.", evidence: ["file src/pipe"] });
out.cited = { evidence: cited.evidence, advice: cited.advice };
const note = await ok(sa, "collab_note", { text: "See the file.", to: "bravo", evidence: ["file src/a.ts"] });
rmSync(join(j.root, "src", "a.ts"));
mkfifo("src/a.ts");
const view = await ok(sb, "collab_inbox", { about: note.ids.report });
out.now = view.root.evidence[0];
runCleanup();
console.log(JSON.stringify(out));
