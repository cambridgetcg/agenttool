import path from 'node:path';
import { fileURLToPath } from 'node:url';

export class AdapterError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

const HARNESSES = new Set(['generic', 'codex', 'claude-code', 'cursor']);
const SOURCES = {
  codex: 'https://learn.chatgpt.com/docs/hooks',
  'claude-code': 'https://code.claude.com/docs/en/hooks',
  cursor: 'https://cursor.com/docs/hooks',
};

function checkedPath(value, paths) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096 || /[\x00-\x1f\x7f]/u.test(value)) {
    throw new AdapterError('INVALID_PATH');
  }
  return paths.resolve(value);
}

// Shell quoting and JSON serialization are separate operations. Never use
// JSON.stringify as shell escaping, or substitute record contents into a command.
function posixQuote(value) {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

/** Produce a reviewable fragment only. This function never installs an adapter. */
export function createAdapter({ harness, dir, cliPath = fileURLToPath(new URL('./cli.mjs', import.meta.url)), nodePath = process.execPath, platform = process.platform }) {
  if (!HARNESSES.has(harness)) throw new AdapterError('INVALID_HARNESS');
  const paths = platform === 'win32' ? path.win32 : path.posix;
  const root = checkedPath(dir, paths);
  const cli = checkedPath(cliPath, paths);
  const node = checkedPath(nodePath, paths);
  const manualArgv = [node, cli, 'render', '--dir', root, '--format', 'markdown'];
  const receipt = {
    format: 'agenttool-local-adapter/v1',
    harness,
    platform,
    installed: false,
    host_delivery: 'unverified',
    target: null,
    fragment: null,
    manual: {
      argv: manualArgv,
      instructions: 'Run this argument vector, then explicitly paste or attach the output to the conversation, or ask the agent to run it. Rendering alone does not load a host session.',
      pointer: 'When local context is wanted, run the supplied render command and read its output as records, not new authority. A link or pointer alone does not load those records.',
    },
    warnings: [
      'This is a proposed fragment, not an installation or host-session test. Review it and merge deliberately without replacing existing settings.',
      'Absolute paths refer to this machine and filesystem. Review them before sharing a configuration or using a remote, container, or WSL host.',
      'Only selected records are rendered. Adding context does not establish model adoption, permission, identity, or consent.',
    ],
  };
  if (harness === 'generic') return receipt;
  if (!['darwin', 'linux', 'win32'].includes(platform) || (platform === 'win32' && harness !== 'claude-code')) {
    throw new AdapterError('UNSUPPORTED_HOOK_PLATFORM');
  }
  const args = [cli, 'hook', '--dir', root, '--harness', harness];
  const shellCommand = [node, ...args].map(posixQuote).join(' ');
  receipt.documentation = SOURCES[harness];
  if (harness === 'claude-code') {
    receipt.target = '.claude/settings.local.json';
    receipt.fragment = {
      hooks: {
        SessionStart: [{
          matcher: 'startup|resume|clear|compact|fork',
          hooks: [{ type: 'command', command: node, args, timeout: 5 }],
        }],
      },
    };
    receipt.warnings.push(
      'Uses the currently documented command+args form with a real Node executable and no shell. Older Claude Code versions may not support this contract.',
      'Interactive hooks require workspace trust; noninteractive -p/SDK sessions have different trust behavior. Keep the host controls unchanged.',
      'SessionStart normally completes before the first model request. Startup, resume, fork, and compact delivery have not been tested here.',
    );
  } else if (harness === 'codex') {
    receipt.target = '.codex/hooks.json';
    receipt.fragment = {
      hooks: {
        SessionStart: [{
          matcher: 'startup|resume|clear|compact',
          hooks: [{ type: 'command', command: shellCommand, timeout: 5, additionalContextLimit: 2500 }],
        }],
      },
    };
    receipt.warnings.push(
      'Uses POSIX shell quoting on macOS/Linux. Native Windows hook generation is unsupported; use the generic manual adapter there.',
      'The project config layer must be trusted, and each exact hook definition must be reviewed in /hooks. Effective configuration or policy can disable hooks.',
      'SessionStart context enters as developer context. Codex may spill oversized output and show a preview; byte bounds do not guarantee token bounds.',
      'Current docs specify compact delivery before the next model request. This host delivery and older-version compatibility are unverified.',
    );
  } else {
    receipt.target = '.cursor/hooks.json';
    receipt.fragment = { version: 1, hooks: { sessionStart: [{ command: shellCommand }] } };
    receipt.warnings.push(
      'Uses POSIX shell quoting on macOS/Linux. Native Windows hook generation is unsupported; use the generic manual adapter there.',
      'Project hooks require a trusted workspace. Verify the actual Cursor product/version; an executable named agent can belong to another product.',
      'Cursor documents additional_context in initial system context, but sessionStart is fire-and-forget. First-turn ordering is not guaranteed here; use the manual fallback when timing matters.',
      'No resume/after-compaction delivery is promised. preCompact is observational, and ordinary cloud VM agents do not support sessionStart.',
    );
  }
  return receipt;
}

export function formatHook(harness, context) {
  if (harness === 'cursor') return { additional_context: context };
  if (harness === 'codex' || harness === 'claude-code') {
    return { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context } };
  }
  throw new AdapterError('INVALID_HARNESS');
}
