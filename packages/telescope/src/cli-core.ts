import { DEFAULT_LIMITS, TOOL_VERSION } from "./constants.js";
import { verifyNpmTarballFile } from "./archive.js";
import { TargetInputError } from "./errors.js";
import { escapeTerminalText, formatTelescopeReport } from "./format.js";
import { inspectTarget } from "./scan.js";
import { verifyArtifactFile } from "./verify.js";

const HELP = `agenttool-telescope — read-only agent discovery evidence mapper

Usage:
  agenttool-telescope scan <domain-or-https-origin> [--json] [--timeout-ms N] [--max-bytes N]
  agenttool-telescope <domain-or-https-origin> [--json] [--timeout-ms N] [--max-bytes N]
  agenttool-telescope verify <file> --size <bytes> --sha256 <lowercase-hex> [--json]
  agenttool-telescope verify-package <file> --size <bytes> --sha256 <lowercase-hex> --name <npm-name> --version <semver> [--json]
  agenttool-telescope --help
  agenttool-telescope --version

Scan performs bounded public HTTPS GETs with no credentials. It reports
publisher claims and produces commands, but never invokes protocols, downloads
artifacts, installs packages, or runs generated commands.
`;

interface CliIo {
  stdout: Pick<NodeJS.WriteStream, "write">;
  stderr: Pick<NodeJS.WriteStream, "write">;
}

function integer(value: string | undefined, flag: string): number {
  if (!value || !/^[0-9]+$/.test(value)) {
    throw new TargetInputError(
      "invalid_cli_value",
      `${flag} requires a non-negative integer.`,
    );
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new TargetInputError(
      "invalid_cli_value",
      `${flag} is outside the safe integer range.`,
    );
  }
  return parsed;
}

function jsonError(error: TargetInputError): string {
  return `${JSON.stringify({ error: { code: error.code, message: error.message } })}\n`;
}

export async function runCli(
  argv: readonly string[],
  io: CliIo = { stdout: process.stdout, stderr: process.stderr },
): Promise<number> {
  const args = [...argv];
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    io.stdout.write(HELP);
    return 0;
  }
  if (args[0] === "--version" || args[0] === "-v") {
    io.stdout.write(`${TOOL_VERSION}\n`);
    return 0;
  }

  const command = ["scan", "verify", "verify-package"].includes(args[0] ?? "")
    ? args.shift()
    : "scan";
  let json = false;
  try {
    if (command === "verify" || command === "verify-package") {
      const file = args.shift();
      if (!file || file.startsWith("--")) {
        throw new TargetInputError(
          "missing_file",
          "verify requires a file path.",
        );
      }
      let size: number | null = null;
      let sha256: string | null = null;
      let packageName: string | null = null;
      let packageVersion: string | null = null;
      while (args.length > 0) {
        const flag = args.shift();
        if (flag === "--json") json = true;
        else if (flag === "--size") size = integer(args.shift(), "--size");
        else if (flag === "--sha256") sha256 = args.shift() ?? null;
        else if (flag === "--name" && command === "verify-package") {
          packageName = args.shift() ?? null;
        } else if (flag === "--version" && command === "verify-package") {
          packageVersion = args.shift() ?? null;
        } else
          throw new TargetInputError(
            "unknown_option",
            `Unknown option: ${flag ?? ""}`,
          );
      }
      if (size === null || !sha256 || !/^[0-9a-f]{64}$/.test(sha256)) {
        throw new TargetInputError(
          "invalid_expectation",
          "verify requires --size and a 64-character lowercase --sha256.",
        );
      }
      if (command === "verify-package") {
        if (!packageName || !packageVersion) {
          throw new TargetInputError(
            "invalid_package_expectation",
            "verify-package requires --name and --version.",
          );
        }
        const result = await verifyNpmTarballFile(file, {
          size,
          sha256,
          name: packageName,
          version: packageVersion,
        });
        if (json) io.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        else {
          io.stdout.write(
            result.ok
              ? `verified npm tarball ${escapeTerminalText(file, 2_048)}: ${escapeTerminalText(packageName)}@${escapeTerminalText(packageVersion)}, ${result.archive.entries ?? 0} entries\n`
              : `npm tarball verification failed ${escapeTerminalText(file, 2_048)}: ${result.code}\n`,
          );
        }
        return result.ok ? 0 : 1;
      }
      const result = await verifyArtifactFile(file, { size, sha256 });
      if (json) io.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      else {
        io.stdout.write(
          result.ok
            ? `verified ${escapeTerminalText(file, 2_048)}: ${result.actual.size} bytes, ${result.actual.sha256}\n`
            : `integrity mismatch ${escapeTerminalText(file, 2_048)}: ${result.actual.size} bytes, ${result.actual.sha256}\n`,
        );
      }
      return result.ok ? 0 : 1;
    }

    const target = args.shift();
    if (!target || target.startsWith("--")) {
      throw new TargetInputError(
        "missing_target",
        "scan requires a domain or HTTPS origin.",
      );
    }
    let timeoutMs: number | undefined;
    let maxBytes: number | undefined;
    while (args.length > 0) {
      const flag = args.shift();
      if (flag === "--json") json = true;
      else if (flag === "--timeout-ms")
        timeoutMs = integer(args.shift(), "--timeout-ms");
      else if (flag === "--max-bytes")
        maxBytes = integer(args.shift(), "--max-bytes");
      else
        throw new TargetInputError(
          "unknown_option",
          `Unknown option: ${flag ?? ""}`,
        );
    }
    const limits = {
      ...(timeoutMs === undefined ? {} : { timeout_ms: timeoutMs }),
      ...(maxBytes === undefined
        ? {}
        : {
            max_response_bytes: maxBytes,
            max_total_bytes: Math.max(DEFAULT_LIMITS.max_total_bytes, maxBytes),
          }),
    };
    const report = await inspectTarget(target, { limits });
    io.stdout.write(formatTelescopeReport(report, json ? "json" : "human"));
    return report.status === "inconclusive" ? 1 : 0;
  } catch (error) {
    if (error instanceof TargetInputError || error instanceof TypeError) {
      const normalized =
        error instanceof TargetInputError
          ? error
          : new TargetInputError("invalid_input", error.message);
      (json ? io.stdout : io.stderr).write(
        json
          ? jsonError(normalized)
          : `agenttool-telescope: ${escapeTerminalText(normalized.message, 2_048)}\n`,
      );
      return 2;
    }
    const normalized = new TargetInputError(
      "operation_failed",
      "The requested local operation could not be completed.",
    );
    (json ? io.stdout : io.stderr).write(
      json
        ? jsonError(normalized)
        : `agenttool-telescope: ${escapeTerminalText(normalized.message, 2_048)}\n`,
    );
    return 1;
  }
}
