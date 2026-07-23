#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import { loadProjectProfile } from "../src/project-profile.js";
import {
  RELAY_CREDENTIAL_FILE_ENV,
  RELAY_TOKEN_ENV,
} from "../src/relay-credential.js";
import {
  DEVICE_ID_ENV,
  DEVICE_LABEL_ENV,
  enrollRelay,
  PROJECT_BEARER_ENV,
} from "../src/relay-enrollment.js";
import { RELAY_URL_ENV } from "../src/relay-runtime.js";

interface CliOptions {
  help: boolean;
  project?: string;
  relay_url?: string;
  credential_file?: string;
  device_id?: string;
  device_label?: string;
  project_bearer_stdin: boolean;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(helpText());
    return;
  }
  const relayUrl = options.relay_url ?? process.env[RELAY_URL_ENV];
  if (!relayUrl) fail(`${RELAY_URL_ENV} is required`);
  const deviceLabel = options.device_label ?? process.env[DEVICE_LABEL_ENV];
  if (!deviceLabel) fail(`--device-label or ${DEVICE_LABEL_ENV} is required`);
  const projectBearer = options.project_bearer_stdin
    ? readProjectBearerFromStdin()
    : process.env[PROJECT_BEARER_ENV];
  if (!projectBearer) {
    fail(
      `Provide the existing project bearer through ${PROJECT_BEARER_ENV} or --project-bearer-stdin`,
    );
  }
  const loaded = loadProjectProfile({
    path: options.project,
    env: process.env,
  });
  const result = await enrollRelay({
    profile: loaded.profile,
    relay_url: relayUrl,
    project_bearer: projectBearer,
    device_id: options.device_id ?? process.env[DEVICE_ID_ENV],
    device_label: deviceLabel,
    credential_path:
      options.credential_file ?? process.env[RELAY_CREDENTIAL_FILE_ENV],
  });
  process.stdout.write(`${JSON.stringify({
    enrolled: true,
    created: result.enrolment.created,
    repository_id: result.enrolment.repository.id,
    repository_key: result.enrolment.repository.key,
    device_id: result.enrolment.device.id,
    device_version: result.enrolment.device.version,
    replayed: result.enrolment.replayed,
    credential_file: result.credential_file,
    token_storage: result.token_storage,
    token_prefix: result.token_prefix,
    relay_environment_variable: RELAY_URL_ENV,
    credential_environment_variable: RELAY_CREDENTIAL_FILE_ENV,
    project_environment_variable: "AGENTOOL_COLLAB_PROJECT_FILE",
    secret_boundary: result.secret_boundary,
  }, null, 2)}\n`);
}

function parseArgs(args: string[]): CliOptions {
  const parsed: CliOptions = {
    help: false,
    project_bearer_stdin: false,
  };
  const valueFlags: Record<string, keyof Pick<
    CliOptions,
    "project" | "relay_url" | "credential_file" | "device_id" | "device_label"
  >> = {
    "--project": "project",
    "--relay-url": "relay_url",
    "--credential-file": "credential_file",
    "--device-id": "device_id",
    "--device-label": "device_label",
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    if (argument === "--help" || argument === "-h") {
      parsed.help = true;
      continue;
    }
    if (argument === "--project-bearer-stdin") {
      parsed.project_bearer_stdin = true;
      continue;
    }
    const field = valueFlags[argument];
    if (field) {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) fail(`${argument} requires a value`);
      parsed[field] = value;
      index += 1;
      continue;
    }
    fail(`Unknown argument: ${redactArgument(argument)}`);
  }
  return parsed;
}

function readProjectBearerFromStdin(): string {
  const bytes = readFileSync(0);
  if (bytes.byteLength > 4096) fail("Project bearer on stdin exceeds 4096 bytes");
  const value = bytes.toString("utf8").trim();
  if (!value || /\s/.test(value)) fail("Project bearer on stdin is malformed");
  return value;
}

function redactArgument(argument: string): string {
  if (
    /bearer|token|secret|password|credential/i.test(argument)
    || /(?:^|[^A-Za-z0-9])(?:atc?_[A-Za-z0-9_-]{20,}|npm_[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})(?:$|[^A-Za-z0-9_-])/i
      .test(argument)
  ) {
    return "[redacted secret-like argument]";
  }
  return argument.slice(0, 200);
}

function helpText(): string {
  return `agenttool-collab-enroll

Explicitly enroll one device in a configured collaboration release room.

Usage:
  agenttool-collab-enroll [options]

Options:
  --project <path>              Explicit agenttool.project/1 file
  --relay-url <https-origin>    Relay origin (or ${RELAY_URL_ENV})
  --credential-file <path>      Scoped metadata path (or ${RELAY_CREDENTIAL_FILE_ENV})
  --device-id <uuid>            Stable device UUID (or ${DEVICE_ID_ENV}; generated if absent)
  --device-label <label>        Explicit non-secret label (or ${DEVICE_LABEL_ENV})
  --project-bearer-stdin        Read the existing project bearer from stdin
  -h, --help                    Show this help

Without --project-bearer-stdin, the project bearer is read only from
${PROJECT_BEARER_ENV}. The relay bearer defaults to macOS Keychain. For a
scoped CI/non-macOS process, inject a pre-generated token through
${RELAY_TOKEN_ENV}. Re-enrollment may update the device label but deliberately
reuses the existing device token; this command does not rotate tokens. No
bearer is accepted on argv or printed.
`;
}

function fail(message: string): never {
  throw new Error(message);
}

main().catch((error) => {
  process.stderr.write(
    `✖ ${error instanceof Error ? error.message : "Enrollment failed"}\n`,
  );
  process.exit(1);
});
