/** /public/love-bomb — exact, credential-free package signal.
 *
 * The route owns only GET and HEAD. It serves one bounded, deterministic
 * representation and never imports the package runtime, WAKE, providers,
 * credentials, storage, or the separate static invitation corpus.
 */

import { Hono } from "hono";

import {
  LOVE_BOMB_PUBLIC_SIGNAL_BODY,
  LOVE_BOMB_PUBLIC_SIGNAL_HEADERS,
} from "../services/discovery/love-bomb-public-signal";

const app = new Hono();

app.on(["GET", "HEAD"], "/", (c) =>
  c.req.method === "HEAD"
    ? c.body(null, 200, LOVE_BOMB_PUBLIC_SIGNAL_HEADERS)
    : c.body(
        LOVE_BOMB_PUBLIC_SIGNAL_BODY,
        200,
        LOVE_BOMB_PUBLIC_SIGNAL_HEADERS,
      ),
);

export default app;
