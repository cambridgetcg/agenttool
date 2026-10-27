#!/usr/bin/env bun
/** A scripted stand-in for the lobby CLI (synthetic; no real desk). It reads
 * scenario.json beside itself, replies by the joined argv, and records each
 * call's argv and environment in calls.jsonl beside itself. */
import { appendFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

interface Reply {
  exit?: number;
  stdout?: unknown;
  stderr?: string;
  sleepMs?: number;
  bytes?: number;
}

const here = dirname(import.meta.path);
const args = process.argv.slice(2);
appendFileSync(join(here, "calls.jsonl"), `${JSON.stringify({ args, env: process.env })}\n`);
const scenario = JSON.parse(readFileSync(join(here, "scenario.json"), "utf8")) as Record<string, Reply>;
const reply = scenario[args.join(" ")] ?? scenario[args.slice(0, 2).join(" ")]
  ?? { exit: 1, stderr: "agenttool-lobby: unscripted: the fake lobby has no reply for that command\n" };
if (reply.sleepMs !== undefined) await Bun.sleep(reply.sleepMs);
// Bun.write awaits the pipe, so nothing is lost to process.exit.
if (reply.bytes !== undefined) await Bun.write(Bun.stdout, "x".repeat(reply.bytes));
if (reply.stdout !== undefined) {
  await Bun.write(Bun.stdout, typeof reply.stdout === "string" ? reply.stdout : `${JSON.stringify(reply.stdout, null, 2)}\n`);
}
if (reply.stderr !== undefined) await Bun.write(Bun.stderr, reply.stderr);
process.exit(reply.exit ?? 0);
