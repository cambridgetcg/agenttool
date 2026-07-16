import type { ParsedLoveManifest } from "./parsers/love.js";
import type { ActionPlan, ProbeId } from "./types.js";

const DOWNLOAD_PROGRAM = [
  "import { randomUUID } from 'node:crypto';",
  "import { link,open,unlink } from 'node:fs/promises';",
  "const [url,file,sizeText]=process.argv.slice(1);",
  "const expected=Number(sizeText);",
  "const temporary=file+'.part-'+randomUUID();let handle;let created=false;",
  "try{",
  "const parsed=new URL(url);if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.port||parsed.search||parsed.hash||parsed.href!==url)throw new Error();",
  "handle=await open(temporary,'wx',0o600);created=true;",
  "const response=await fetch(url,{redirect:'manual',credentials:'omit',headers:{'accept-encoding':'identity'},signal:AbortSignal.timeout(120000)});",
  "if(response.status!==200||!response.body||response.url!==url)throw new Error();",
  "const encoding=response.headers.get('content-encoding');if(encoding&&encoding.toLowerCase()!=='identity')throw new Error();",
  "const length=response.headers.get('content-length');if(length!==null&&Number(length)!==expected)throw new Error();",
  "let total=0;for await(const chunk of response.body){total+=chunk.length;if(total>expected)throw new Error();let offset=0;while(offset<chunk.length){const written=await handle.write(chunk,offset);if(written.bytesWritten<=0)throw new Error();offset+=written.bytesWritten;}}",
  "if(total!==expected)throw new Error();await handle.sync();await handle.close();handle=undefined;await link(temporary,file);await unlink(temporary).catch(()=>{});created=false;",
  "console.log('downloaded '+file);",
  "}catch{if(handle)await handle.close().catch(()=>{});if(created)await unlink(temporary).catch(()=>{});console.error('download failed');process.exit(1);}",
].join("");

export function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function action(
  input: Omit<
    ActionPlan,
    "display" | "display_shell" | "automatic" | "requires_explicit_consent"
  >,
): ActionPlan {
  return {
    ...input,
    display: [input.executable, ...input.argv].map(shellQuote).join(" "),
    display_shell: "posix",
    automatic: false,
    requires_explicit_consent: true,
  };
}

export function buildNpmAction(input: {
  package_name: string;
  version: string;
  evidence_ids: ProbeId[];
}): ActionPlan {
  return action({
    id: "npm_install",
    kind: "npm_convenience",
    executable: "npm",
    argv: [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--save-exact",
      `${input.package_name}@${input.version}`,
    ],
    evidence_ids: input.evidence_ids,
    boundary_codes: [
      "npm_declared_non_authoritative",
      "npm_skips_independent_love_size_sha256_check",
      "package_manager_may_use_configured_registry_credentials",
      "lifecycle_scripts_disabled_but_imported_code_remains_untrusted",
      "command_not_executed",
    ],
  });
}

export function buildLoveActions(input: {
  manifest: ParsedLoveManifest;
  mirror_url: string;
  evidence_ids: ProbeId[];
}): ActionPlan[] {
  const { filename, size, sha256 } = input.manifest.artifact;
  return [
    action({
      id: "love_download",
      kind: "love_verified_install",
      executable: "node",
      argv: [
        "--input-type=module",
        "--eval",
        DOWNLOAD_PROGRAM,
        input.mirror_url,
        filename,
        String(size),
      ],
      evidence_ids: input.evidence_ids,
      boundary_codes: [
        "download_locator_is_not_content_identity",
        "redirects_not_followed",
        "generated_network_deadline_120_seconds",
        "generated_command_does_not_repeat_dns_preflight_or_pin_an_address",
        "complete_bytes_are_atomically_published_without_overwriting_destination",
        "run_in_a_caller_controlled_directory",
        "command_not_executed",
      ],
    }),
    action({
      id: "love_verify",
      kind: "love_verified_install",
      executable: "agenttool-telescope",
      argv: [
        "verify-package",
        filename,
        "--size",
        String(size),
        "--sha256",
        sha256,
        "--name",
        input.manifest.name,
        "--version",
        input.manifest.version,
      ],
      evidence_ids: input.evidence_ids,
      boundary_codes: [
        "checks_exact_local_file_size_and_sha256",
        "checks_bounded_tar_layout_and_embedded_package_identity",
        "telescope_cli_must_be_on_path",
        "manifest_digest_does_not_authenticate_publisher",
        "command_not_executed",
      ],
    }),
    action({
      id: "love_install",
      kind: "love_verified_install",
      executable: "npm",
      argv: [
        "install",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        `./${filename}`,
      ],
      evidence_ids: input.evidence_ids,
      boundary_codes: [
        "install_only_after_local_verification",
        "protect_or_reverify_the_file_across_the_verify_install_boundary",
        "declared_dependencies_may_use_configured_registry_or_cache",
        "package_manager_may_use_configured_registry_credentials",
        "lifecycle_scripts_disabled_but_imported_code_remains_untrusted",
        "runtime_engine_compatibility_not_evaluated",
        "command_not_executed",
      ],
    }),
  ];
}
