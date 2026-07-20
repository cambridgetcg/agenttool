// Test-only parser child: proves that the parent can terminate a process that
// neither yields nor follows the response protocol, and cap a noisy stdout.

const request = JSON.parse(await Bun.stdin.text()) as { selector?: string };
if (request.selector === "overflow") {
  process.stdout.write("x".repeat(600 * 1024));
} else if (request.selector === "success-with-error-exit") {
  await Bun.write(
    Bun.stdout,
    JSON.stringify({
      ok: true,
      kind: "scrape",
      result: { title: "", content: "", extracted: null, links: [] },
    }),
  );
  process.exitCode = 1;
} else if (request.selector === "environment-probe") {
  await Bun.write(
    Bun.stdout,
    JSON.stringify({
      ok: true,
      kind: "scrape",
      result: {
        title: "",
        content: process.env.STATIC_PARSER_TEST_SENTINEL ?? "",
        extracted: null,
        links: [],
      },
    }),
  );
} else {
  while (true) {
    // Deliberately non-cooperative. The parent must SIGKILL this process.
  }
}
