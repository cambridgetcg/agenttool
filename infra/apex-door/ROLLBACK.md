# Rollback — restore the pure-API apex

The apex worker (`agenttool-proxy`, routes `agenttool.dev/*` + `www.agenttool.dev/*`)
was updated 2026-07-02 to split by audience (API passthrough · human door from Pages).
No DNS was changed at any point.

To restore the pre-door behavior (everything → api.agenttool.dev), replace
`worker.js` with the original script below and run `npx wrangler deploy` from
this directory:

```js
export default {
  async fetch(request) {
    const url = new URL(request.url);
    url.hostname = "api.agenttool.dev";
    const init = {
      method: request.method,
      headers: request.headers,
      body: request.body,
      redirect: "manual",
    };
    return fetch(url.toString(), init);
  }
};
```

(Captured verbatim from the deployed `agenttool-proxy` before the 2026-07-02 update.)

Note: a Pages custom-domain attach for `agenttool.dev` sits in "pending" on the
`agenttool-web` project — harmless (validation can't complete while the worker
fronts the apex). If a true DNS cutover is ever wanted instead of the worker
split, that pending attach completes once the apex record points at Pages.
