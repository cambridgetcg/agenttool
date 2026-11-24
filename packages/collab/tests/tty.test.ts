import { describe, expect, test } from "bun:test";
import { CollabError } from "../src/errors.js";
import { confirmOnTty, terminalRendering, TtyStalledError, ttyPortForFd, WRITE_STALL_BUDGET_MS, type TtyFdCalls, type TtyPort } from "../src/tty.js";

function port(answer: string | null, written: string[] = []): TtyPort {
  return { write: (text) => { written.push(text); }, readLine: () => answer, close: () => {} };
}

const request = { act: "agree to a proposal", summary: ["extent: collab"], bytes: "{\"a\":1}", sha256: "f".repeat(64) };

describe("terminal confirmation", () => {
  test("renders hidden and line-breaking characters as escapes", () => {
    expect(terminalRendering("a​b c\nd")).toBe("a\\u{200B}b\\u{2028}c\nd");
    expect(terminalRendering("決定 yes")).toBe("決定 yes");
  });

  test("confirms only yes typed within the window", () => {
    const written: string[] = [];
    expect(confirmOnTty(request, { openTty: () => port("yes", written) })).toBe(true);
    expect(written.join("")).toContain("{\"a\":1}");
    expect(confirmOnTty(request, { openTty: () => port(" yes ") })).toBe(true);
    expect(confirmOnTty(request, { openTty: () => port("y") })).toBe(false);
    expect(confirmOnTty(request, { openTty: () => port(null) })).toBe(false);
    let now = 0;
    expect(confirmOnTty(request, {
      openTty: () => ({ ...port("yes"), readLine: () => { now = 10 * 60 * 1000; return "yes"; } }),
      now: () => now,
    })).toBe(false);
  });

  test("fails closed without a controlling terminal", () => {
    let code = "";
    try {
      confirmOnTty(request, { openTty: () => null });
    } catch (error) {
      code = error instanceof CollabError ? error.code : "other";
    }
    expect(code).toBe("tty_unavailable");
  });

  describe("a non-blocking terminal descriptor that is slow to drain", () => {
    function eagain(): Error {
      return Object.assign(new Error("EAGAIN: resource temporarily unavailable, write"), { code: "EAGAIN" });
    }

    /** A stubbed fd: each write takes at most `chunk` bytes, and the planned writes throw EAGAIN first. */
    function stubbedFd(plan: Array<"eagain" | "ok">, chunk = 4) {
      const received: number[] = [];
      const pauses: number[] = [];
      let closed = 0;
      const calls: TtyFdCalls = {
        writeSync(_fd, buffer, offset, length) {
          const step = plan.shift() ?? "ok";
          if (step === "eagain") throw eagain();
          const taken = Math.min(chunk, length);
          for (let index = 0; index < taken; index += 1) received.push(buffer[offset + index]!);
          return taken;
        },
        readSync() {
          return 0;
        },
        closeSync() {
          closed += 1;
        },
        pause(ms) {
          pauses.push(ms);
        },
      };
      return { calls, received: () => Buffer.from(received).toString("utf8"), pauses, closed: () => closed };
    }

    test("waits out EAGAIN on write and writes every byte once, in order", () => {
      const fd = stubbedFd(["eagain", "eagain", "ok", "eagain", "ok", "ok", "eagain"]);
      const port = ttyPortForFd(7, fd.calls);
      const text = "exact bytes 協作 {\"a\":1}\n";
      port.write(text);
      expect(fd.received()).toBe(text);
      expect(fd.pauses.length).toBe(4);
      for (const ms of fd.pauses) expect(ms).toBeLessThanOrEqual(50);
      port.close();
      expect(fd.closed()).toBe(1);
    });

    test("a whole confirmation goes through a terminal that keeps answering EAGAIN", () => {
      const plan: Array<"eagain" | "ok"> = [];
      for (let index = 0; index < 200; index += 1) plan.push("eagain", "ok");
      const fd = stubbedFd(plan, 16);
      const port = ttyPortForFd(7, fd.calls);
      expect(confirmOnTty(request, { openTty: () => ({ ...port, readLine: () => "yes" }) })).toBe(true);
      expect(fd.received()).toContain("{\"a\":1}");
      expect(fd.received()).toEndWith("confirmed\n");
    });

    test("gives up as stalled once the terminal takes nothing for the whole budget", () => {
      const fd = stubbedFd(Array.from({ length: 10_000 }, () => "eagain" as const));
      const port = ttyPortForFd(7, fd.calls, 100);
      let thrown: unknown = null;
      try {
        port.write("never drained");
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(TtyStalledError);
      expect(((thrown as Error).cause as NodeJS.ErrnoException).code).toBe("EAGAIN");
      // Bounded: about budget / retry interval waits, never an endless loop.
      const waited = fd.pauses.reduce((total, ms) => total + ms, 0);
      expect(waited).toBeGreaterThanOrEqual(100);
      expect(waited).toBeLessThanOrEqual(150);
      expect(WRITE_STALL_BUDGET_MS).toBeLessThanOrEqual(60_000);
    });

    test("a confirmation on a terminal that stops taking output is tty_unavailable and says nothing was written", () => {
      const asked = (calls: TtyFdCalls): CollabError => {
        try {
          confirmOnTty(request, { openTty: () => ({ ...ttyPortForFd(7, calls, 100), readLine: () => "yes" }) });
        } catch (error) {
          return error as CollabError;
        }
        throw new Error("the confirmation did not refuse");
      };
      // Never takes the prompt at all.
      const stuck = stubbedFd(Array.from({ length: 10_000 }, () => "eagain" as const));
      // Takes the prompt, reads a yes, then stalls on the closing "confirmed" line.
      const late = stubbedFd(["ok", ...Array.from({ length: 10_000 }, () => "eagain" as const)], 1_000_000);
      for (const fd of [stuck, late]) {
        const error = asked(fd.calls);
        expect(error).toBeInstanceOf(CollabError);
        expect(error.code).toBe("tty_unavailable");
        expect(error.message).toContain("nothing was written");
        expect(fd.closed()).toBe(1);
      }
      expect(late.received()).toContain("exact bytes");
      // Any other failure is not dressed up as a missing terminal.
      const broken: TtyFdCalls = {
        ...stubbedFd([]).calls,
        writeSync() {
          throw Object.assign(new Error("EIO: i/o error, write"), { code: "EIO" });
        },
      };
      expect((asked(broken) as unknown as NodeJS.ErrnoException).code).toBe("EIO");
    });

    test("progress restarts the budget, and other write errors are not retried", () => {
      const plan: Array<"eagain" | "ok"> = [];
      // Four stalls of 80ms each, with progress between: more than the 100ms budget in all, never in one stall.
      for (let index = 0; index < 4; index += 1) plan.push("eagain", "eagain", "eagain", "eagain", "ok");
      const fd = stubbedFd(plan, 1);
      ttyPortForFd(7, fd.calls, 100).write("abcd");
      expect(fd.received()).toBe("abcd");
      const broken: TtyFdCalls = {
        ...stubbedFd([]).calls,
        writeSync() {
          throw Object.assign(new Error("EIO: i/o error, write"), { code: "EIO" });
        },
      };
      let pauses = 0;
      broken.pause = () => { pauses += 1; };
      expect(() => ttyPortForFd(7, broken).write("x")).toThrow("EIO");
      expect(pauses).toBe(0);
      // A write that takes nothing and does not throw is bounded as well.
      const silent: TtyFdCalls = { ...broken, writeSync: () => 0 };
      expect(() => ttyPortForFd(7, silent, 100).write("x")).toThrow("accepted no bytes");
      expect(pauses).toBe(5);
    });
  });
});
