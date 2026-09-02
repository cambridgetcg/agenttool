/** Guarded pool socket — a dead connection returns its slot.
 *
 *  Pins the three behaviours the shared pool relies on: silence past the
 *  bound destroys the socket WITHOUT an error escaping; traffic resets the
 *  bound; and postgres.js's `removeAllListeners()` (called before its TLS
 *  upgrade) does not disarm the guard. Plus the verified constructor's
 *  opt-in wiring. Real localhost sockets, no database. */

import { describe, expect, test } from "bun:test";
import net from "node:net";

import {
  GuardedSocket,
  guardedSocketFactory,
  reportGuardedSocket,
  type GuardedSocketReport,
} from "../src/db/guarded-socket";
import { AGENTTOOL_PRODUCTION_SUPABASE_PROJECT_REF } from "../src/db/supabase-target";
import verifiedPostgres from "../src/db/verified-postgres";

async function silentServer(onConnection?: (socket: net.Socket) => void) {
  const server = net.createServer((socket) => onConnection?.(socket));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as net.AddressInfo).port;
  return { port, close: () => new Promise<void>((r) => server.close(() => r())) };
}

function connect(socket: net.Socket, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once("connect", () => resolve());
    socket.once("error", reject);
    socket.connect(port, "127.0.0.1");
  });
}

describe("guarded pool socket", () => {
  test("silence past the bound destroys the socket silently and reports once", async () => {
    const server = await silentServer();
    const reports: GuardedSocketReport[] = [];
    const errors: Error[] = [];
    const socket = new GuardedSocket({ inactivityMs: 60, onGuard: (r) => reports.push(r) });
    await connect(socket, server.port);
    socket.on("error", (e) => errors.push(e));
    const closed = new Promise<boolean>((resolve) => socket.once("close", resolve));
    const hadError = await closed;
    expect(hadError).toBe(false);
    expect(errors).toEqual([]);
    expect(reports.length).toBe(1);
    expect(reports[0]!.inactivityMs).toBe(60);
    expect(reports[0]!.ageMs).toBeGreaterThanOrEqual(50);
    expect(socket.guardTripped).toBe(true);
    await server.close();
  });

  test("traffic resets the bound", async () => {
    const server = await silentServer((peer) => {
      const tick = setInterval(() => peer.write("x"), 20);
      peer.on("close", () => clearInterval(tick));
    });
    let tripped = false;
    const socket = new GuardedSocket({ inactivityMs: 80, onGuard: () => { tripped = true; } });
    await connect(socket, server.port);
    let bytes = 0;
    socket.on("data", (chunk) => { bytes += chunk.length; });
    await new Promise((r) => setTimeout(r, 250));
    expect(tripped).toBe(false);
    expect(bytes).toBeGreaterThan(5);
    socket.destroy();
    await server.close();
  });

  test("survives postgres.js's removeAllListeners() before the TLS upgrade", async () => {
    const server = await silentServer();
    let tripped = false;
    const socket = new GuardedSocket({ inactivityMs: 60, onGuard: () => { tripped = true; } });
    await connect(socket, server.port);
    socket.removeAllListeners(); // exactly what postgres.js does in secure()
    expect(socket.listenerCount("timeout")).toBe(1);
    expect(socket.listenerCount("error")).toBe(1);
    await new Promise<void>((resolve) => socket.once("close", () => resolve()));
    expect(tripped).toBe(true);
    await server.close();
  });

  test("rejects a non-positive bound", () => {
    expect(() => new GuardedSocket({ inactivityMs: 0 })).toThrow("positive");
    expect(() => guardedSocketFactory({ inactivityMs: Number.NaN })).toThrow("positive");
  });

  test("the report line carries the bound, age and byte counts", () => {
    const lines: string[] = [];
    reportGuardedSocket(
      { inactivityMs: 135_000, ageMs: 412_000, bytesRead: 8300, bytesWritten: 2400 },
      (line) => lines.push(line),
    );
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("[db-socket-guard]");
    expect(lines[0]).toContain("after 135s without traffic");
    expect(lines[0]).toContain("age 412s");
    expect(lines[0]).toContain("read 8.1 kB");
  });
});

describe("verified constructor wiring", () => {
  // The transport verifier only admits the production pooler; use its shape.
  const url = "postgresql://postgres." + AGENTTOOL_PRODUCTION_SUPABASE_PROJECT_REF + ":secret@aws-1-eu-west-2.pooler.supabase.com:6543/postgres";

  test("installs the guarded socket factory only when a caller opts in", () => {
    const guarded = verifiedPostgres(url, { max: 1, inactivity_guard_seconds: 135 });
    expect(typeof guarded.options.socket).toBe("function");
    const produced = (guarded.options.socket as () => unknown)();
    expect(produced).toBeInstanceOf(GuardedSocket);
    (produced as GuardedSocket).destroy();
    // The wrapper's own option never reaches postgres.js.
    expect("inactivity_guard_seconds" in guarded.options).toBe(false);

    const plain = verifiedPostgres(url, { max: 1, idle_timeout: 0 });
    expect(plain.options.socket).toBeUndefined();
  });

  test("callers still cannot choose the socket, and the bound must be positive", () => {
    expect(() => verifiedPostgres(url, { socket: () => new net.Socket() } as never)).toThrow(
      "may not override target or transport",
    );
    for (const bad of [0, -5, Number.NaN, "135"]) {
      expect(() =>
        verifiedPostgres(url, { inactivity_guard_seconds: bad } as never),
      ).toThrow("inactivity_guard_seconds must be a positive number");
    }
  });
});
