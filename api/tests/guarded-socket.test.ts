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
  installInactivityGuard,
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
  test("inbound silence past the bound destroys the socket silently and reports once", async () => {
    const server = await silentServer();
    const reports: GuardedSocketReport[] = [];
    const errors: Error[] = [];
    const socket = new GuardedSocket({ inactivityMs: 60, sampleMs: 10, onGuard: (r) => reports.push(r) });
    await connect(socket, server.port);
    socket.on("error", (e) => errors.push(e));
    const hadError = await new Promise<boolean>((resolve) => socket.once("close", resolve));
    expect(hadError).toBe(false);
    expect(errors).toEqual([]);
    expect(reports.length).toBe(1);
    expect(reports[0]!.inactivityMs).toBe(60);
    expect(reports[0]!.ageMs).toBeGreaterThanOrEqual(50);
    expect(socket.guardTripped).toBe(true);
    await server.close();
  });

  test("inbound traffic resets the bound (sampled bytesRead, not the runtime timer)", async () => {
    // Bun 1.3.5 — production — does not reset socket.setTimeout on inbound
    // data; this pin failed in CI against that runtime before the sampler.
    const server = await silentServer((peer) => {
      const tick = setInterval(() => peer.write("x"), 20);
      peer.on("close", () => clearInterval(tick));
    });
    let tripped = false;
    const socket = new GuardedSocket({ inactivityMs: 80, sampleMs: 10, onGuard: () => { tripped = true; } });
    await connect(socket, server.port);
    let bytes = 0;
    socket.on("data", (chunk) => { bytes += chunk.length; });
    await new Promise((r) => setTimeout(r, 250));
    expect(tripped).toBe(false);
    expect(socket.destroyed).toBe(false);
    expect(bytes).toBeGreaterThan(5);
    socket.destroy();
    await server.close();
  });

  test("survives postgres.js's removeAllListeners() before the TLS upgrade", async () => {
    const server = await silentServer();
    let tripped = false;
    const socket = new GuardedSocket({ inactivityMs: 60, sampleMs: 10, onGuard: () => { tripped = true; } });
    await connect(socket, server.port);
    socket.removeAllListeners(); // exactly what postgres.js does in secure()
    expect(socket.listenerCount("error")).toBe(1);
    await new Promise<void>((resolve) => socket.once("close", () => resolve()));
    expect(tripped).toBe(true);
    await server.close();
  });

  test("the factory resolves to a socket already connected to the target postgres.js names", async () => {
    // postgres.js skips its own socket.connect() when a factory is present.
    const server = await silentServer();
    const factory = guardedSocketFactory({ inactivityMs: 5_000 });
    const socket = await factory({ host: ["127.0.0.1"], port: [server.port], connect_timeout: 5 });
    expect(socket).toBeInstanceOf(GuardedSocket);
    expect(socket.connecting).toBe(false);
    expect(socket.remotePort).toBe(server.port);
    socket.destroy();
    await server.close();
  });

  test("the factory rejects a refused target instead of handing back a dead socket", async () => {
    const server = await silentServer();
    const port = server.port;
    await server.close(); // nothing listens there now
    const factory = guardedSocketFactory({ inactivityMs: 5_000 });
    await expect(factory({ host: ["127.0.0.1"], port: [port], connect_timeout: 5 })).rejects.toThrow();
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
    expect(lines[0]).toContain("after 135s without a byte from the server");
    expect(lines[0]).toContain("age 412s");
    expect(lines[0]).toContain("read 8.1 kB");
  });
});

describe("guard installation on a verified pool", () => {
  // The transport verifier only admits the production pooler; use its shape.
  const url = "postgresql://postgres." + AGENTTOOL_PRODUCTION_SUPABASE_PROJECT_REF + ":secret@aws-1-eu-west-2.pooler.supabase.com:6543/postgres";

  test("installs the factory on the constructor-resolved transport and leaves ssl alone", async () => {
    const sql = verifiedPostgres(url, { max: 1 });
    expect(sql.options.socket).toBeUndefined();
    const sslBefore = sql.options.ssl;
    expect(installInactivityGuard(sql, 135)).toBe(sql);
    expect(typeof sql.options.socket).toBe("function");
    expect(sql.options.ssl).toBe(sslBefore);
    expect(sql.options.host).toEqual(["aws-1-eu-west-2.pooler.supabase.com"]);
    expect(sql.options.port).toEqual([6543]);
    // Exercise the installed factory against a local target, not the pooler.
    const server = await silentServer();
    const produced = await (sql.options.socket as (t: unknown) => Promise<unknown>)({
      host: ["127.0.0.1"],
      port: [server.port],
      connect_timeout: 5,
    });
    expect(produced).toBeInstanceOf(GuardedSocket);
    (produced as GuardedSocket).destroy();
    await server.close();
  });

  test("refuses a second factory, a non-positive bound, and the constructor still rejects a caller socket", () => {
    const sql = verifiedPostgres(url, { max: 1 });
    installInactivityGuard(sql, 135);
    expect(() => installInactivityGuard(sql, 135)).toThrow("already has a transport factory");
    for (const bad of [0, -5, Number.NaN]) {
      expect(() => installInactivityGuard(verifiedPostgres(url, { max: 1 }), bad)).toThrow("positive");
    }
    expect(() => verifiedPostgres(url, { socket: () => new net.Socket() } as never)).toThrow(
      "may not override target or transport",
    );
  });
});
