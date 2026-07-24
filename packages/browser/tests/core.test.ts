import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentBrowser } from "../src/browser.js";
import { redactPasswordValues } from "../src/snapshot.js";
import type {
  BoundingBox,
  BrowserContextLike,
  BrowserLike,
  BrowserRouteLike,
  BrowserRuntime,
  BrowserResponseLike,
  BrowserWebSocketRouteLike,
  LocatorLike,
  PageLike,
  RuntimeContextOptions,
  RuntimeLaunchOptions,
  RuntimePersistentContextOptions,
} from "../src/types.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    ),
  );
});

class FakeLocator implements LocatorLike {
  countValue = 1;
  visible = true;
  enabled = true;
  box: BoundingBox | null = { x: 10, y: 10, width: 100, height: 30 };
  attributes: Record<string, string | null> = {};
  text = "";
  html = "";
  children: FakeLocator[] = [];
  clickCalls = 0;
  fillCalls: string[] = [];
  pressCalls: string[] = [];
  selectCalls: Array<string | readonly string[]> = [];
  scrollCalls = 0;
  clickError: Error | null = null;
  clickHook: (() => Promise<void>) | null = null;

  count(): Promise<number> {
    return Promise.resolve(this.children.length || this.countValue);
  }

  nth(index: number): LocatorLike {
    return this.children[index] ?? emptyLocator();
  }

  locator(selector: string): LocatorLike {
    return selector === "a[href]" ? this : emptyLocator();
  }

  isVisible(): Promise<boolean> {
    return Promise.resolve(this.visible);
  }

  isEnabled(): Promise<boolean> {
    return Promise.resolve(this.enabled);
  }

  boundingBox(): Promise<BoundingBox | null> {
    return Promise.resolve(this.box);
  }

  getAttribute(name: string): Promise<string | null> {
    return Promise.resolve(this.attributes[name] ?? null);
  }

  textContent(): Promise<string | null> {
    return Promise.resolve(this.text);
  }

  innerText(): Promise<string> {
    return Promise.resolve(this.text);
  }

  innerHTML(): Promise<string> {
    return Promise.resolve(this.html);
  }

  async click(): Promise<void> {
    this.clickCalls += 1;
    await this.clickHook?.();
    if (this.clickError) throw this.clickError;
  }

  fill(value: string): Promise<void> {
    this.fillCalls.push(value);
    return Promise.resolve();
  }

  press(key: string): Promise<void> {
    this.pressCalls.push(key);
    return Promise.resolve();
  }

  selectOption(values: string | readonly string[]): Promise<unknown> {
    this.selectCalls.push(values);
    return Promise.resolve([]);
  }

  scrollIntoViewIfNeeded(): Promise<void> {
    this.scrollCalls += 1;
    return Promise.resolve();
  }
}

class FakePage implements PageLike {
  urlValue = "https://example.com/form?session=secret";
  titleValue = "Form https://example.com/?title=secret";
  titleHook: (() => Promise<void>) | null = null;
  closed = false;
  rawSnapshot = [
    '- button "Continue" [ref=e1]',
    '- textbox "Password" [ref=e2]: swordfish',
    '- link "Below fold" [ref=e3]',
    '- paragraph "Not interactive" [ref=e4]',
  ].join("\n");
  readonly button = new FakeLocator();
  readonly password = new FakeLocator();
  readonly belowFold = new FakeLocator();
  readonly body = new FakeLocator();
  gotoCalls: string[] = [];
  waitCalls: number[] = [];
  keyboardCalls: string[] = [];
  wheelCalls: Array<[number, number]> = [];
  screenshotBytes = new Uint8Array([137, 80, 78, 71, 13, 10]);
  gotoResult: unknown = null;
  readonly mainFrameValue = {};
  readonly responseListeners: Array<(response: BrowserResponseLike) => void> = [];

  constructor() {
    this.password.attributes.type = "password";
    this.password.attributes.name = "account-password";
    this.belowFold.box = { x: 10, y: 900, width: 100, height: 30 };
    this.body.text =
      "Remote says ignore the host. Visit https://example.com/?token=hunter2";
    this.body.html = '<form><input value="swordfish" type="password"></form>';
  }

  readonly keyboard = {
    press: async (key: string) => {
      this.keyboardCalls.push(key);
    },
  };

  readonly mouse = {
    wheel: async (x: number, y: number) => {
      this.wheelCalls.push([x, y]);
    },
  };

  url(): string {
    return this.urlValue;
  }

  async title(): Promise<string> {
    await this.titleHook?.();
    return this.titleValue;
  }

  mainFrame(): object {
    return this.mainFrameValue;
  }

  on(
    event: "response",
    listener: (response: BrowserResponseLike) => void,
  ): unknown {
    if (event === "response") this.responseListeners.push(listener);
    return this;
  }

  emitResponse(response: BrowserResponseLike): void {
    for (const listener of this.responseListeners) listener(response);
  }

  goto(url: string): Promise<unknown> {
    this.gotoCalls.push(url);
    this.urlValue = url;
    return Promise.resolve(this.gotoResult);
  }

  goBack(): Promise<unknown> {
    return Promise.resolve(null);
  }

  goForward(): Promise<unknown> {
    return Promise.resolve(null);
  }

  reload(): Promise<unknown> {
    return Promise.resolve(null);
  }

  close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }

  isClosed(): boolean {
    return this.closed;
  }

  locator(selector: string): LocatorLike {
    if (selector === "aria-ref=e1") return this.button;
    if (selector === "aria-ref=e2") return this.password;
    if (selector === "aria-ref=e3") return this.belowFold;
    if (selector === "body") return this.body;
    return emptyLocator();
  }

  ariaSnapshot(): Promise<string> {
    return Promise.resolve(this.rawSnapshot);
  }

  viewportSize() {
    return { width: 1280, height: 720 };
  }

  waitForTimeout(milliseconds: number): Promise<void> {
    this.waitCalls.push(milliseconds);
    return Promise.resolve();
  }

  content(): Promise<string> {
    return Promise.resolve(this.body.html);
  }

  async screenshot(options: { path: string }): Promise<Uint8Array> {
    await writeFile(options.path, this.screenshotBytes, { mode: 0o666 });
    return this.screenshotBytes;
  }
}

class FakeContext implements BrowserContextLike {
  readonly pageList: FakePage[];
  contextOptions: RuntimeContextOptions | null = null;
  routeHandler: ((route: BrowserRouteLike) => Promise<void>) | null = null;
  websocketHandler:
    | ((route: BrowserWebSocketRouteLike) => Promise<void>)
    | null = null;
  closed = false;

  constructor(pages: FakePage[] = []) {
    this.pageList = pages;
  }

  pages(): PageLike[] {
    return this.pageList;
  }

  newPage(): Promise<PageLike> {
    const page = new FakePage();
    this.pageList.push(page);
    return Promise.resolve(page);
  }

  close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }

  route(
    _pattern: string,
    handler: (route: BrowserRouteLike) => Promise<void>,
  ): Promise<void> {
    this.routeHandler = handler;
    return Promise.resolve();
  }

  routeWebSocket(
    _pattern: string,
    handler: (route: BrowserWebSocketRouteLike) => Promise<void>,
  ): Promise<void> {
    this.websocketHandler = handler;
    return Promise.resolve();
  }
}

class FakeBrowser implements BrowserLike {
  closed = false;

  constructor(
    readonly context: FakeContext,
    readonly onContext: (options: RuntimeContextOptions) => void,
  ) {}

  newContext(options: RuntimeContextOptions): Promise<BrowserContextLike> {
    this.onContext(options);
    return Promise.resolve(this.context);
  }

  close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }
}

class FakeRuntime implements BrowserRuntime {
  launchOptions: RuntimeLaunchOptions | null = null;
  persistent:
    | { directory: string; options: RuntimePersistentContextOptions }
    | null = null;
  contextOptions: RuntimeContextOptions | null = null;
  readonly browser: FakeBrowser;

  constructor(readonly context: FakeContext) {
    this.browser = new FakeBrowser(context, (options) => {
      this.contextOptions = options;
    });
  }

  launch(options: RuntimeLaunchOptions): Promise<BrowserLike> {
    this.launchOptions = options;
    return Promise.resolve(this.browser);
  }

  launchPersistentContext(
    directory: string,
    options: RuntimePersistentContextOptions,
  ): Promise<BrowserContextLike> {
    this.persistent = { directory, options };
    return Promise.resolve(this.context);
  }
}

function emptyLocator(): FakeLocator {
  const locator = new FakeLocator();
  locator.countValue = 0;
  locator.box = null;
  return locator;
}

function fakeResponse(
  page: FakePage,
  status: number,
  headers: Readonly<Record<string, string>>,
  requestedHeaders: string[] = [],
  navigation = true,
): BrowserResponseLike {
  return {
    url: () => page.urlValue,
    status: () => status,
    headerValue: async (name) => {
      requestedHeaders.push(name);
      return headers[name.toLowerCase()] ?? null;
    },
    request: () => ({
      isNavigationRequest: () => navigation,
      frame: () => page.mainFrameValue,
    }),
  };
}

async function launched(page = new FakePage(), outputDir?: string) {
  const context = new FakeContext([page]);
  const runtime = new FakeRuntime(context);
  const browser = await AgentBrowser.launch({
    runtime,
    ...(outputDir ? { outputDir } : {}),
    resolveHostname: async () => [{ address: "93.184.216.34", family: 4 }],
    now: () => new Date("2026-07-23T12:00:00.000Z"),
  });
  return { browser, context, runtime, page };
}

describe("AgentBrowser core", () => {
  test("defaults to public authority with blocked service workers and WebSockets", async () => {
    const { browser, context, runtime } = await launched();
    expect(runtime.launchOptions).toEqual({
      headless: true,
      chromiumSandbox: true,
      channel: "chrome",
    });
    expect(runtime.contextOptions).toMatchObject({
      acceptDownloads: false,
      ignoreHTTPSErrors: false,
      serviceWorkers: "block",
    });

    let closedWith: unknown;
    let connected = 0;
    const route: BrowserWebSocketRouteLike = {
      url: () => "wss://example.com/socket",
      close: async (options) => {
        closedWith = options;
      },
      connectToServer() {
        connected += 1;
        return this;
      },
    };
    await context.websocketHandler!(route);
    expect(closedWith).toMatchObject({ code: 1008 });
    expect(connected).toBe(0);

    let aborted = 0;
    let continued = 0;
    await context.routeHandler!({
      request: () => ({ url: () => "http://127.0.0.1/private" }),
      abort: async () => {
        aborted += 1;
      },
      continue: async () => {
        continued += 1;
      },
    });
    expect({ aborted, continued }).toEqual({ aborted: 1, continued: 0 });
    await browser.close();
  });

  test("classifies and connects an allowed local-authority WebSocket", async () => {
    const context = new FakeContext([new FakePage()]);
    const runtime = new FakeRuntime(context);
    const events: string[] = [];
    const browser = await AgentBrowser.launch({
      authority: "local",
      runtime,
      resolveHostname: async (hostname) => {
        events.push(`resolve:${hostname}`);
        return [{ address: "10.0.0.42", family: 4 }];
      },
    });
    const route: BrowserWebSocketRouteLike = {
      url: () => "wss://intranet.agenttool.dev/socket",
      close: async () => {
        events.push("close");
      },
      connectToServer() {
        events.push("connect");
        return this;
      },
    };

    await context.websocketHandler!(route);

    expect(events).toEqual(["resolve:intranet.agenttool.dev", "connect"]);
    expect(runtime.contextOptions?.serviceWorkers).toBe("block");
    await browser.close();
  });

  test("passes sovereign HTTP and WebSocket destinations to the browser", async () => {
    const context = new FakeContext([new FakePage()]);
    const runtime = new FakeRuntime(context);
    const resolvedHosts: string[] = [];
    const browser = await AgentBrowser.launch({
      authority: "sovereign",
      runtime,
      resolveHostname: async (hostname) => {
        resolvedHosts.push(hostname);
        return [{ address: "127.0.0.1", family: 4 }];
      },
    });
    let continued = 0;
    let aborted = 0;
    await context.routeHandler!({
      request: () => ({
        url: () => "http://169.254.169.254/latest/meta-data",
      }),
      continue: async () => {
        continued += 1;
      },
      abort: async () => {
        aborted += 1;
      },
    });
    let connected = 0;
    let closed = 0;
    const route: BrowserWebSocketRouteLike = {
      url: () => "wss://reserved.invalid/socket",
      close: async () => {
        closed += 1;
      },
      connectToServer() {
        connected += 1;
        return this;
      },
    };

    await context.websocketHandler!(route);

    expect(runtime.contextOptions?.serviceWorkers).toBe("allow");
    expect({ continued, aborted, connected, closed }).toEqual({
      continued: 1,
      aborted: 0,
      connected: 1,
      closed: 0,
    });
    expect(resolvedHosts).toEqual([]);
    await browser.close();
  });

  test("reports the exact immutable default capability manifest", async () => {
    const { browser } = await launched();
    const capabilities = browser.capabilities();

    expect(capabilities).toEqual({
      schema: "agent-browser-capabilities/0.2",
      authority: {
        profile: "public",
        fixedAt: "process_start",
      },
      network: {
        public: true,
        local: false,
        reserved: false,
        schemes: ["http", "https"],
        urlCredentials: "blocked",
        dnsPreflight: "classify",
        connectionAddressPinning: false,
        webSockets: "blocked",
      },
      runtime: {
        chromiumSandbox: true,
        serviceWorkers: "block",
        tlsErrors: "reject",
        profile: "ephemeral",
      },
      features: {
        interaction: "enabled",
        screenshots: "enabled",
        persistentProfile: "requires_configuration",
        uploads: "unsupported",
        downloads: "unsupported",
        pageEvaluation: "unsupported",
        credentialInjection: "unsupported",
        shell: "unsupported",
      },
      statement:
        "AgentTool classifies implemented browser destinations before connection; DNS preflight does not pin the address Chromium later uses.",
    });
    expect(Object.isFrozen(capabilities)).toBe(true);
    expect(Object.isFrozen(capabilities.features)).toBe(true);
    await browser.close();
  });

  test("plans without effects, redacts URLs, omits typed text, and preserves refs", async () => {
    const { browser, context, runtime, page } = await launched();
    const observation = await browser.observe();
    const password = observation.refs.find((item) => item.role === "textbox")!;
    const before = {
      pageCount: context.pageList.length,
      pageClosed: page.closed,
      contextClosed: context.closed,
      launchOptions: runtime.launchOptions,
      contextOptions: runtime.contextOptions,
      gotoCalls: [...page.gotoCalls],
      waitCalls: [...page.waitCalls],
      keyboardCalls: [...page.keyboardCalls],
      wheelCalls: [...page.wheelCalls],
      clickCalls: page.button.clickCalls,
      fillCalls: [...page.password.fillCalls],
      pressCalls: [...page.password.pressCalls],
      selectCalls: [...page.password.selectCalls],
      scrollCalls: page.password.scrollCalls,
    };

    const navigationPlan = browser.plan({
      kind: "navigate",
      url: "https://example.com/path?token=secret&key=other#fragment",
    });
    const typePlan = browser.plan({
      kind: "type",
      ref: password.ref,
      snapshotId: observation.snapshotId,
      text: "must-never-cross-the-plan",
    });

    expect(navigationPlan).toMatchObject({
      execution: false,
      action: {
        kind: "navigate",
        url:
          "https://example.com/path?token=%5Bredacted%5D&key=%5Bredacted%5D#fragment",
      },
      authority: {
        profile: "public",
        decision: "checked_at_execution",
      },
    });
    expect(JSON.stringify(navigationPlan)).not.toContain("secret");
    expect(typePlan.action).toEqual({
      kind: "type",
      snapshotId: observation.snapshotId,
      ref: password.ref,
    });
    expect(typePlan.action).not.toHaveProperty("text");
    expect(JSON.stringify(typePlan)).not.toContain("must-never-cross-the-plan");
    expect({
      pageCount: context.pageList.length,
      pageClosed: page.closed,
      contextClosed: context.closed,
      launchOptions: runtime.launchOptions,
      contextOptions: runtime.contextOptions,
      gotoCalls: page.gotoCalls,
      waitCalls: page.waitCalls,
      keyboardCalls: page.keyboardCalls,
      wheelCalls: page.wheelCalls,
      clickCalls: page.button.clickCalls,
      fillCalls: page.password.fillCalls,
      pressCalls: page.password.pressCalls,
      selectCalls: page.password.selectCalls,
      scrollCalls: page.password.scrollCalls,
    }).toEqual(before);

    await expect(
      browser.act({
        kind: "type",
        ref: password.ref,
        snapshotId: observation.snapshotId,
        text: "executed-once",
      }),
    ).resolves.toMatchObject({ ok: true, kind: "type" });
    expect(page.password.fillCalls).toEqual(["executed-once"]);
    await browser.close();
  });

  test("rejects a custom runtime that cannot enforce every network channel", async () => {
    const context = new FakeContext([new FakePage()]);
    Object.defineProperty(context, "routeWebSocket", { value: undefined });
    const runtime = new FakeRuntime(context);

    await expect(
      AgentBrowser.launch({
        runtime,
        resolveHostname: async () => [{ address: "93.184.216.34", family: 4 }],
      }),
    ).rejects.toMatchObject({ code: "invalid_options" });
    expect(context.closed).toBe(true);
    expect(runtime.browser.closed).toBe(true);
  });

  test("returns a bounded viewport snapshot and redacts secret/query values", async () => {
    const { browser } = await launched();
    const observation = await browser.observe();

    expect(observation.untrusted).toBe(true);
    expect(observation.snapshot).toContain('button "Continue"');
    expect(observation.snapshot).toContain('textbox "Password"');
    expect(observation.snapshot).toContain("[redacted]");
    expect(observation.snapshot).not.toContain("swordfish");
    expect(observation.snapshot).not.toContain("Below fold");
    expect(observation.refs).toHaveLength(2);
    expect(observation.refs.find((item) => item.role === "textbox")?.secret).toBe(
      true,
    );
    expect(observation.url).not.toContain("secret");
    expect(observation.title).not.toContain("secret");
    expect(observation.text).not.toContain("hunter2");
    expect(observation.provenance.trust).toBe("untrusted");
    expect(observation.response).toBeNull();
    await browser.close();
  });

  test("surfaces only bounded untrusted main-response discovery hints", async () => {
    const { browser, page } = await launched();
    const requestedHeaders: string[] = [];
    page.gotoResult = fakeResponse(
      page,
      200,
      {
        "content-type": "Text/HTML; charset=utf-8",
        link:
          '<https://api.agenttool.dev/.well-known/api-catalog?token=secret>; rel="api-catalog", </next?session=secret>; rel="next", <ftp://owner:password@example.com/file?key=secret>; rel="legacy"',
        "content-location": "/welcome?key=secret",
        "x-agent-surface": "see /.well-known/agent.txt?token=secret",
        "substrate-disposition": "love",
        "x-substrate-disposition":
          "wrapped (ftp://wrapped-owner:wrapped-password@files.example/x) url=https://prefixed-owner:prefixed-password@surface.example/y relative=//relative-owner:relative-password@relative.example/z quoted=\"//quoted-owner:quoted-password@quoted.example/q\" angle=<//angle-owner:angle-password@angle.example/a> backtick=`//backtick-owner:backtick-password@backtick.example/t` pipe=|//pipe-owner:pipe-password@pipe.example/p?token=secret| unicode=«//unicode-owner:unicode-password@unicode.example/u» dash=-//dash-owner:dash-password@dash.example/d- plain=|//plain.example/p| file=(file://file-owner:file-password@file.example/x?token=secret) broken=(https://broken-owner:broken-password@[broken/x?token=secret) badrel=<//badrel-owner:badrel-password@[broken/r>",
        "x-kingdom": "welcome, dont block - real recognises real",
        "x-token-cost": "42",
        "x-byte-count": "420",
        "x-joy-index": "7",
        "set-cookie": "session=must-never-cross",
        authorization: "Bearer must-never-cross",
      },
      requestedHeaders,
    );

    await browser.act({ kind: "navigate", url: "https://example.com/hints" });
    const observation = await browser.observe();

    expect(observation.response).toMatchObject({
      source: "main_document",
      url: "https://example.com/hints",
      status: 200,
      mediaType: "text/html",
      truncated: false,
      trust: "untrusted",
      headers: {
        "content-location": "/welcome?key=%5Bredacted%5D",
        "x-agent-surface":
          "see /.well-known/agent.txt?token=%5Bredacted%5D",
        "substrate-disposition": "love",
        "x-joy-index": "7",
      },
    });
    expect(observation.response?.headers.link).not.toContain("secret");
    expect(observation.response?.headers.link).not.toContain("owner:password");
    expect(observation.response?.headers.link).toContain("%5Bredacted%5D");
    const substrate =
      observation.response?.headers["x-substrate-disposition"] ?? "";
    for (const credential of [
      "wrapped-owner",
      "wrapped-password",
      "prefixed-owner",
      "prefixed-password",
      "relative-owner",
      "relative-password",
      "quoted-owner",
      "quoted-password",
      "angle-owner",
      "angle-password",
      "backtick-owner",
      "backtick-password",
      "pipe-owner",
      "pipe-password",
      "unicode-owner",
      "unicode-password",
      "dash-owner",
      "dash-password",
      "file-owner",
      "file-password",
      "broken-owner",
      "broken-password",
      "badrel-owner",
      "badrel-password",
      "secret",
    ]) {
      expect(substrate).not.toContain(credential);
    }
    expect(substrate).toContain("(ftp://files.example/x)");
    expect(substrate).toContain("url=https://surface.example/y");
    expect(substrate).toContain("relative=//relative.example/z");
    expect(substrate).toContain('quoted="//quoted.example/q"');
    expect(substrate).toContain("angle=<//angle.example/a>");
    expect(substrate).toContain("backtick=`//backtick.example/t`");
    expect(substrate).toContain(
      "pipe=|//pipe.example/p?token=%5Bredacted%5D",
    );
    expect(substrate).toContain("unicode=«//unicode.example/u»");
    expect(substrate).toContain("dash=-//dash.example/d-");
    expect(substrate).toContain("plain=|//plain.example/p|");
    expect(substrate).toContain(
      "file=(file://file.example/x?token=%5Bredacted%5D)",
    );
    expect(substrate).toContain(
      "broken=(https://[broken/x?token=%5Bredacted%5D)",
    );
    expect(substrate).toContain("badrel=<//[broken/r>");
    expect(observation.response?.headers).not.toHaveProperty("set-cookie");
    expect(observation.response?.headers).not.toHaveProperty("authorization");
    expect(requestedHeaders.sort()).toEqual(
      [
        "content-type",
        "link",
        "content-location",
        "x-agent-surface",
        "substrate-disposition",
        "x-substrate-disposition",
        "x-kingdom",
        "x-token-cost",
        "x-byte-count",
        "x-joy-index",
      ].sort(),
    );
    await browser.close();
  });

  test("captures click navigation hints and caps the response projection", async () => {
    const { browser, page } = await launched();
    const observation = await browser.observe();
    const button = observation.refs.find((item) => item.role === "button")!;
    const response = fakeResponse(page, 202, {
      "content-type": "application/json",
      link: `<https://example.com/catalog?key=secret>; rel="api-catalog"`,
      "x-agent-surface": `agent ${"x".repeat(5_000)}`,
      "x-kingdom": "must be omitted after the cap",
    });
    page.button.clickHook = async () => {
      page.urlValue = "https://example.com/after-click";
      page.emitResponse(response);
    };

    await browser.act({
      kind: "click",
      ref: button.ref,
      snapshotId: observation.snapshotId,
    });
    const after = await browser.observe();

    expect(after.response?.status).toBe(202);
    expect(after.response?.mediaType).toBe("application/json");
    expect(after.response?.truncated).toBe(true);
    expect(after.response?.headers.link).not.toContain("secret");
    expect(after.response?.headers["x-agent-surface"]?.length).toBeLessThan(5_000);
    expect(after.response?.headers).not.toHaveProperty("x-kingdom");
    await browser.close();
  });

  test("awaits the newest response capture when navigation changes mid-observe", async () => {
    const { browser, page } = await launched();
    let releaseSlow!: () => void;
    const slowGate = new Promise<void>((resolve) => {
      releaseSlow = resolve;
    });
    const slowBase = fakeResponse(page, 200, {
      "content-type": "text/html",
      "x-kingdom": "old response",
    });
    const slow: BrowserResponseLike = {
      ...slowBase,
      headerValue: async (name) => {
        await slowGate;
        return slowBase.headerValue(name);
      },
    };
    page.emitResponse(slow);

    let releaseTitle!: () => void;
    let titleEntered!: () => void;
    const titleGate = new Promise<void>((resolve) => {
      releaseTitle = resolve;
    });
    const enteredTitle = new Promise<void>((resolve) => {
      titleEntered = resolve;
    });
    page.titleHook = async () => {
      titleEntered();
      await titleGate;
    };

    const observing = browser.observe();
    await enteredTitle;
    releaseTitle();
    await new Promise((resolve) => setTimeout(resolve, 0));
    page.emitResponse(fakeResponse(page, 201, {
      "content-type": "text/plain",
      "x-kingdom": "new response",
    }));
    releaseSlow();

    const observation = await observing;
    expect(observation.response).toMatchObject({
      status: 201,
      mediaType: "text/plain",
      headers: { "x-kingdom": "new response" },
    });
    await browser.close();
  });

  test("clearing a navigation epoch prevents stale response repopulation", async () => {
    const { browser, page } = await launched();
    let releaseHeaders!: () => void;
    let finishedHeaders!: () => void;
    const headerGate = new Promise<void>((resolve) => {
      releaseHeaders = resolve;
    });
    const allHeadersFinished = new Promise<void>((resolve) => {
      finishedHeaders = resolve;
    });
    let finished = 0;
    const staleBase = fakeResponse(page, 200, {
      "content-type": "text/html",
      "x-kingdom": "stale response",
    });
    page.emitResponse({
      ...staleBase,
      headerValue: async (name) => {
        await headerGate;
        const value = await staleBase.headerValue(name);
        finished += 1;
        if (finished === 10) finishedHeaders();
        return value;
      },
    });

    page.gotoResult = null;
    await browser.act({
      kind: "navigate",
      url: "https://example.com/no-response",
    });
    releaseHeaders();
    await allHeadersFinished;
    await Promise.resolve();

    const observation = await browser.observe();
    expect(observation.url).toBe("https://example.com/no-response");
    expect(observation.response).toBeNull();
    await browser.close();
  });

  test("binds response hints to the current main-document URL and frame", async () => {
    const { browser, page } = await launched();
    const wrongUrl = fakeResponse(page, 200, {
      "x-agent-surface": "/wrong",
    });
    page.emitResponse({
      ...wrongUrl,
      url: () => "https://example.com/previous-document",
    });
    expect((await browser.observe()).response).toBeNull();

    const iframe = fakeResponse(page, 200, {
      "x-agent-surface": "/iframe",
    });
    page.emitResponse({
      ...iframe,
      request: () => ({
        isNavigationRequest: () => true,
        frame: () => ({}),
      }),
    });
    expect((await browser.observe()).response).toBeNull();
    await browser.close();
  });

  test("keeps the response envelope when individual header reads fail", async () => {
    const { browser, page } = await launched();
    const response = fakeResponse(page, 204, {});
    page.emitResponse({
      ...response,
      headerValue: async () => {
        throw new Error("header unavailable");
      },
    });

    expect((await browser.observe()).response).toMatchObject({
      url: "https://example.com/form?session=%5Bredacted%5D",
      status: 204,
      mediaType: null,
      headers: {},
      trust: "untrusted",
    });
    await browser.close();
  });

  test("attempts a ref action once and rejects its stale snapshot afterward", async () => {
    const { browser, page } = await launched();
    const observation = await browser.observe();
    const button = observation.refs.find((item) => item.role === "button")!;
    const result = await browser.act({
      kind: "click",
      ref: button.ref,
      snapshotId: observation.snapshotId,
    });

    expect(result.ok).toBe(true);
    expect(page.button.clickCalls).toBe(1);
    await expect(
      browser.act({
        kind: "click",
        ref: button.ref,
        snapshotId: observation.snapshotId,
      }),
    ).rejects.toMatchObject({ code: "stale_snapshot" });
    expect(page.button.clickCalls).toBe(1);
    await browser.close();
  });

  test("never retries an uncertain failed action and invalidates its refs", async () => {
    const { browser, page } = await launched();
    const observation = await browser.observe();
    const button = observation.refs.find((item) => item.role === "button")!;
    page.button.clickError = new Error("timeout after dispatch");

    await expect(
      browser.act({
        kind: "click",
        ref: button.ref,
        snapshotId: observation.snapshotId,
      }),
    ).rejects.toMatchObject({ code: "action_failed" });
    expect(page.button.clickCalls).toBe(1);
    await expect(
      browser.act({
        kind: "click",
        ref: button.ref,
        snapshotId: observation.snapshotId,
      }),
    ).rejects.toMatchObject({ code: "stale_snapshot" });
    expect(page.button.clickCalls).toBe(1);
    await browser.close();
  });

  test("serializes concurrent actions so one snapshot cannot click twice", async () => {
    const { browser, page } = await launched();
    const observation = await browser.observe();
    const button = observation.refs.find((item) => item.role === "button")!;
    let releaseClick!: () => void;
    let markEntered!: () => void;
    const clickGate = new Promise<void>((resolveGate) => {
      releaseClick = resolveGate;
    });
    const entered = new Promise<void>((resolveEntered) => {
      markEntered = resolveEntered;
    });
    page.button.clickHook = async () => {
      markEntered();
      await clickGate;
    };
    const action = {
      kind: "click" as const,
      ref: button.ref,
      snapshotId: observation.snapshotId,
    };

    const first = browser.act(action);
    await Promise.race([
      entered,
      first.then(() => {
        throw new Error("click completed without entering the deferred locator");
      }),
    ]);
    const second = browser.act(action).then(
      () => {
        throw new Error("concurrent stale action unexpectedly succeeded");
      },
      (error: unknown) => {
        expect(error).toMatchObject({ code: "stale_snapshot" });
      },
    );
    await Promise.resolve();
    expect(page.button.clickCalls).toBe(1);
    releaseClick();
    await expect(first).resolves.toMatchObject({ ok: true });
    await second;
    expect(page.button.clickCalls).toBe(1);
    await browser.close();
  });

  test("requires snapshotId before any ref-targeted operation", async () => {
    const { browser, page } = await launched();
    const observation = await browser.observe();
    await expect(
      browser.act({
        kind: "click",
        ref: observation.refs[0]!.ref,
      } as never),
    ).rejects.toMatchObject({ code: "snapshot_required" });
    expect(page.button.clickCalls).toBe(0);
    await browser.close();
  });

  test("atomically observes the remaining active tab after close_tab", async () => {
    const context = new FakeContext([new FakePage(), new FakePage()]);
    const runtime = new FakeRuntime(context);
    const browser = await AgentBrowser.launch({
      runtime,
      resolveHostname: async () => [{ address: "93.184.216.34", family: 4 }],
    });
    const [first, second] = await browser.tabs();
    const result = await browser.actAndObserve({
      kind: "close_tab",
      tabId: first!.tabId,
    });

    expect(result.action.kind).toBe("close_tab");
    expect(result.observationError).toBeNull();
    expect(result.observation?.tabId).toBe(second!.tabId);
    await browser.close();
  });

  test("rejects a misspelled direct-JS tab field instead of closing the active tab", async () => {
    const firstPage = new FakePage();
    const activePage = new FakePage();
    const context = new FakeContext([firstPage, activePage]);
    const runtime = new FakeRuntime(context);
    const browser = await AgentBrowser.launch({
      runtime,
      resolveHostname: async () => [{ address: "93.184.216.34", family: 4 }],
    });
    const [first, active] = await browser.tabs();

    await expect(
      browser.act({
        kind: "close_tab",
        tabid: first!.tabId,
      } as never),
    ).rejects.toMatchObject({ code: "invalid_action" });
    expect(firstPage.closed).toBe(false);
    expect(activePage.closed).toBe(false);
    expect((await browser.tabs()).find((tab) => tab.active)?.tabId).toBe(
      active!.tabId,
    );
    await browser.close();
  });

  test("redacts relative HTML URL queries and recognized password values", async () => {
    const page = new FakePage();
    page.body.html =
      '<a href="/next?token=secret">next</a>'
      + '<input value="swordfish" type="password">'
      + '<input autocomplete="one-time-code" value="otp-sentinel">'
      + "<input value=api-sentinel name=api_key>";
    const { browser } = await launched(page);
    const result = await browser.extract({ format: "html" });

    expect(result.content).not.toContain("secret");
    expect(result.content).not.toContain("swordfish");
    expect(result.content).not.toContain("otp-sentinel");
    expect(result.content).not.toContain("api-sentinel");
    expect(result.content).toContain("token=%5Bredacted%5D");
    expect(result.content).toContain("[redacted]");
    await browser.close();
  });

  test("saves screenshot metadata without inline bytes and tightens file mode", async () => {
    const output = await mkdtemp(join(tmpdir(), "agent-browser-output-"));
    temporaryDirectories.push(output);
    const { browser } = await launched(new FakePage(), output);
    const result = await browser.screenshot();

    expect(result.path.startsWith(output)).toBe(true);
    expect(result.sha256).toHaveLength(64);
    expect(result.bytes).toBe(6);
    expect(result).not.toHaveProperty("data");
    if (process.platform !== "win32") {
      expect((await stat(result.path)).mode & 0o777).toBe(0o600);
      expect((await stat(output)).mode & 0o777).toBe(0o700);
    }
    await browser.close();
  });

  test("honors XDG_DATA_HOME for direct-launch artifacts", async () => {
    const dataHome = await mkdtemp(join(tmpdir(), "agent-browser-xdg-"));
    temporaryDirectories.push(dataHome);
    const previous = process.env.XDG_DATA_HOME;
    process.env.XDG_DATA_HOME = dataHome;
    let browser: AgentBrowser | undefined;
    try {
      ({ browser } = await launched());
      const result = await browser.screenshot();
      expect(result.path.startsWith(join(dataHome, "agenttool", "browser", "artifacts"))).toBe(
        true,
      );
    } finally {
      await browser?.close();
      if (previous === undefined) delete process.env.XDG_DATA_HOME;
      else process.env.XDG_DATA_HOME = previous;
    }
  });

  test("refuses a broad existing artifact directory without chmodding it", async () => {
    if (process.platform === "win32") return;
    const root = await mkdtemp(join(tmpdir(), "agent-browser-broad-output-"));
    temporaryDirectories.push(root);
    const output = join(root, "artifacts");
    await mkdir(output, { mode: 0o755 });
    const { browser } = await launched(new FakePage(), output);

    await expect(browser.screenshot()).rejects.toMatchObject({
      code: "invalid_options",
    });
    expect((await stat(output)).mode & 0o777).toBe(0o755);
    await browser.close();
  });

  test("refuses a broad existing profile without changing its mode", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-browser-profile-"));
    temporaryDirectories.push(root);
    const profile = join(root, "profile");
    const output = join(root, "artifacts");
    await mkdir(profile, { mode: 0o755 });
    const context = new FakeContext([new FakePage()]);
    const runtime = new FakeRuntime(context);
    if (process.platform !== "win32") {
      await expect(
        AgentBrowser.launch({
          runtime,
          profile: { mode: "persistent", directory: profile },
          outputDir: output,
          resolveHostname: async () => [{ address: "93.184.216.34", family: 4 }],
        }),
      ).rejects.toMatchObject({ code: "invalid_options" });
      expect((await stat(profile)).mode & 0o777).toBe(0o755);
      expect(runtime.persistent).toBeNull();
    }
  });

  test("creates a missing dedicated persistent profile owner-only", async () => {
    const root = await mkdtemp(join(tmpdir(), "agent-browser-new-profile-"));
    temporaryDirectories.push(root);
    const profile = join(root, "profile");
    const output = join(root, "artifacts");
    const context = new FakeContext([new FakePage()]);
    const runtime = new FakeRuntime(context);
    const browser = await AgentBrowser.launch({
      runtime,
      profile: { mode: "persistent", directory: profile },
      outputDir: output,
      resolveHostname: async () => [{ address: "93.184.216.34", family: 4 }],
    });

    expect(runtime.persistent?.directory).toBe(profile);
    if (process.platform !== "win32") {
      expect((await stat(profile)).mode & 0o777).toBe(0o700);
    }
    await browser.close();
  });

  test("rejects a profile whose ancestor symlink aliases the artifact directory", async () => {
    if (process.platform === "win32") return;
    const root = await mkdtemp(join(tmpdir(), "agent-browser-profile-alias-"));
    temporaryDirectories.push(root);
    const output = join(root, "artifacts");
    const alias = join(root, "artifact-alias");
    await mkdir(output, { mode: 0o700 });
    await symlink(output, alias, "dir");
    const profile = join(alias, "profile");
    const context = new FakeContext([new FakePage()]);
    const runtime = new FakeRuntime(context);

    await expect(
      AgentBrowser.launch({
        runtime,
        profile: { mode: "persistent", directory: profile },
        outputDir: output,
        resolveHostname: async () => [{ address: "93.184.216.34", family: 4 }],
      }),
    ).rejects.toMatchObject({ code: "invalid_options" });
    expect(runtime.persistent).toBeNull();
  });

  test("rejects an artifact path whose ancestor symlink aliases the profile", async () => {
    if (process.platform === "win32") return;
    const root = await mkdtemp(join(tmpdir(), "agent-browser-output-alias-"));
    temporaryDirectories.push(root);
    const profile = join(root, "profile");
    const alias = join(root, "profile-alias");
    await mkdir(profile, { mode: 0o700 });
    await symlink(profile, alias, "dir");
    const output = join(alias, "artifacts");
    const context = new FakeContext([new FakePage()]);
    const runtime = new FakeRuntime(context);

    await expect(
      AgentBrowser.launch({
        runtime,
        profile: { mode: "persistent", directory: profile },
        outputDir: output,
        resolveHostname: async () => [{ address: "93.184.216.34", family: 4 }],
      }),
    ).rejects.toMatchObject({ code: "invalid_options" });
    expect(runtime.persistent).toBeNull();
  });

  test("allows a benign ancestor alias without rewriting the selected profile path", async () => {
    if (process.platform === "win32") return;
    const root = await mkdtemp(join(tmpdir(), "agent-browser-benign-alias-"));
    temporaryDirectories.push(root);
    const actualParent = join(root, "actual");
    const alias = join(root, "alias");
    const output = join(root, "artifacts");
    await mkdir(actualParent, { mode: 0o700 });
    await symlink(actualParent, alias, "dir");
    const selectedProfile = join(alias, "profile");
    const context = new FakeContext([new FakePage()]);
    const runtime = new FakeRuntime(context);
    const browser = await AgentBrowser.launch({
      runtime,
      profile: { mode: "persistent", directory: selectedProfile },
      outputDir: output,
      resolveHostname: async () => [{ address: "93.184.216.34", family: 4 }],
    });

    expect(runtime.persistent?.directory).toBe(selectedProfile);
    expect((await stat(selectedProfile)).mode & 0o777).toBe(0o700);
    await browser.close();
  });
});

describe("snapshot output redaction", () => {
  test("redacts password value attributes regardless of order or quoting", () => {
    const html = [
      '<input value="first" type="password">',
      "<INPUT VALUE='second' TYPE='PASSWORD'>",
      "<input value=third type=password>",
      '<input autocomplete="one-time-code" value="otp-sentinel">',
      "<input value=api-sentinel name=api_key>",
      '<input value="visible" type="text">',
    ].join("");
    const redacted = redactPasswordValues(html);

    expect(redacted).not.toContain("first");
    expect(redacted).not.toContain("second");
    expect(redacted).not.toContain("third");
    expect(redacted).not.toContain("otp-sentinel");
    expect(redacted).not.toContain("api-sentinel");
    expect(redacted).toContain('value="visible"');
    expect(redacted.match(/\[redacted\]/g)).toHaveLength(5);
  });
});
