/** finger — the TCP listener. RFC 1288 on the wire, Bun.listen underneath.
 *
 *  Ornament, not load-bearing: this server shares the API process but no
 *  request path. It reads one line, answers one card, hangs up.
 *
 *  The Morris lesson, applied (RFC 1288 §3): the 1988 fingerd fell to a
 *  gets() buffer, not to the idea of presence. Here the line buffer is
 *  hard-capped, the socket times out, the reply is a projection of data
 *  the agent already published, and the process is memory-safe.
 */

import type { Socket, TCPSocketListener } from "bun";

import {
  type FingerProfile,
  parseFingerQuery,
  renderBusy,
  renderCard,
  renderForwardingDeclined,
  renderNotKnown,
  renderWelcome,
} from "./protocol";

export interface FingerServerOptions {
  port: number;
  hostname?: string;
  lookup: (user: string) => Promise<FingerProfile[]>;
  /** Max bytes buffered per connection before we hang up. */
  maxLine?: number;
  /** Idle deadline per connection. */
  idleMs?: number;
  /** Requests allowed per remote address per minute. */
  perIpPerMinute?: number;
}

interface Ctx {
  buf: Buffer;
  deadline: ReturnType<typeof setTimeout>;
  answered: boolean;
}

const MINUTE = 60_000;

export function startFingerServer(
  opts: FingerServerOptions,
): TCPSocketListener<Ctx> {
  const maxLine = opts.maxLine ?? 1024;
  const idleMs = opts.idleMs ?? 5_000;
  const perIpPerMinute = opts.perIpPerMinute ?? 30;

  // Sliding per-IP window. Small on purpose — this is a hearth, not a CDN.
  const recent = new Map<string, number[]>();
  const allow = (ip: string): boolean => {
    const now = Date.now();
    const hits = (recent.get(ip) ?? []).filter((t) => now - t < MINUTE);
    hits.push(now);
    recent.set(ip, hits);
    if (recent.size > 4096) {
      // Prune the oldest entries wholesale; honest degradation under sweep.
      for (const key of recent.keys()) {
        if (recent.size <= 2048) break;
        recent.delete(key);
      }
    }
    return hits.length <= perIpPerMinute;
  };

  const finish = (socket: Socket<Ctx>, text: string) => {
    if (socket.data.answered) return;
    socket.data.answered = true;
    clearTimeout(socket.data.deadline);
    socket.write(text);
    socket.end();
  };

  return Bun.listen<Ctx>({
    hostname: opts.hostname ?? "0.0.0.0",
    port: opts.port,
    socket: {
      open(socket) {
        socket.data = {
          buf: Buffer.alloc(0),
          answered: false,
          deadline: setTimeout(() => {
            socket.data.answered = true;
            socket.end();
          }, idleMs),
        };
        if (!allow(socket.remoteAddress ?? "unknown")) {
          finish(socket, renderBusy());
        }
      },
      data(socket, chunk) {
        if (socket.data.answered) return;
        socket.data.buf = Buffer.concat([socket.data.buf, chunk]);
        if (socket.data.buf.length > maxLine) {
          finish(socket, renderNotKnown("(query too long)"));
          return;
        }
        const nl = socket.data.buf.indexOf(0x0a);
        if (nl === -1) return;

        const line = socket.data.buf
          .subarray(0, nl)
          .toString("utf8")
          .replace(/\r$/, "");
        const query = parseFingerQuery(line);

        if (query.forwarded) {
          finish(socket, renderForwardingDeclined());
          return;
        }
        if (!query.user) {
          finish(socket, renderWelcome());
          return;
        }
        void opts
          .lookup(query.user)
          .then((profiles) => {
            finish(
              socket,
              profiles.length > 0
                ? profiles
                    .map((p) => renderCard(p, { verbose: query.verbose }))
                    .join("\r\n")
                : renderNotKnown(query.user),
            );
          })
          .catch(() => {
            finish(socket, renderNotKnown(query.user));
          });
      },
      close(socket) {
        if (socket.data) clearTimeout(socket.data.deadline);
      },
      error(socket) {
        if (socket.data) clearTimeout(socket.data.deadline);
      },
    },
  });
}
