import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AdapterError, createAdapter } from './adapters.mjs';

const SKILL = new URL('../skills/agenttool-local-context/SKILL.md', import.meta.url);
const WRITES = Object.freeze({
  none: [], handoff: ['handoff'], memory: ['memory'], both: ['handoff', 'memory'],
});

/** Reviewable project plan only: no installation, dependency download or launch. */
export function createDelivery({
  harness, dir, write = 'none', transport = 'mcp', platform = process.platform,
  nodePath = process.execPath,
  cliPath = fileURLToPath(new URL('./cli.mjs', import.meta.url)),
  mcpPath = fileURLToPath(new URL('../dist/agenttool-local-starter-mcp.js', import.meta.url)),
}) {
  if (!['codex', 'claude-code'].includes(harness)) throw new AdapterError('INVALID_HARNESS');
  if (!Object.hasOwn(WRITES, write)) throw new AdapterError('INVALID_WRITE_MODE');
  if (!['mcp', 'cli'].includes(transport)) throw new AdapterError('INVALID_TRANSPORT');
  const paths = platform === 'win32' ? path.win32 : path.posix;
  const checked = (value) => {
    if (typeof value !== 'string' || !value || value.length > 4096 || /[\x00-\x1f\x7f]/u.test(value))
      throw new AdapterError('INVALID_PATH');
    return paths.resolve(value);
  };
  const root = checked(dir), node = checked(nodePath), cli = checked(cliPath), mcp = checked(mcpPath);
  let hook;
  try { hook = createAdapter({ harness, dir: root, nodePath: node, cliPath: cli, platform }); }
  catch (error) {
    if (!(error instanceof AdapterError) || error.code !== 'UNSUPPORTED_HOOK_PLATFORM') throw error;
    hook = { ...createAdapter({ harness: 'generic', dir: root, nodePath: node, cliPath: cli, platform }),
      reason: error.code };
  }
  const args = [mcp, '--dir', root, '--write', write];
  const skillDirectory = harness === 'codex'
    ? '.agents/skills/agenttool-local-context' : '.claude/skills/agenttool-local-context';
  const binding = {
    format: 'agenttool-local-skill-binding/v1',
    transport,
    directory: root,
    read: [node, cli, 'render', '--dir', root, '--format', 'json'],
    status: [node, cli, 'status', '--dir', root],
    writes: Object.fromEntries(WRITES[write].map(id => [id, [node, cli, id, '--dir', root]])),
  };
  const mcpContent = harness === 'codex'
    ? '[mcp_servers.agenttool_local]\ncommand = ' + JSON.stringify(node) +
      '\nargs = [' + args.map(value => JSON.stringify(value)).join(', ') + ']\n'
    : JSON.stringify({ mcpServers: { agenttool_local: { type: 'stdio', command: node, args } } }, null, 2) + '\n';
  return {
    format: 'agenttool-local-delivery/v1', harness, platform, installed: false,
    host_delivery: 'unverified', write_mode: write, transport,
    files: [
      { path: skillDirectory + '/SKILL.md', operation: 'create-only', content: readFileSync(SKILL, 'utf8') },
      { path: skillDirectory + '/binding.json', operation: 'create-only', content: JSON.stringify(binding, null, 2) + '\n' },
      ...(transport === 'mcp' ? [{ path: harness === 'codex' ? '.codex/config.toml' : '.mcp.json', operation: 'merge', content: mcpContent }] : []),
      ...(hook.target ? [{ path: hook.target, operation: 'merge', content: JSON.stringify(hook.fragment, null, 2) + '\n' }] : []),
    ],
    hook,
    prerequisites: [
      'Node >=22 and the complete local-starter package must exist on the host that runs the commands. Keep retained notes outside the package and plugin cache.',
      transport === 'mcp' ? 'The release includes its MCP bundle and dependencies; no runtime dependency installation is needed. Source checkouts must build the bundle first.' : 'CLI transport requires no dependency installation or MCP connection.',
      'Review paths and merge selected entries into project settings; preserve existing entries and complete the host trust/reload steps. No files have been installed.',
      'The skill teaches the workflow; MCP enables explicit operations; the command hook loads selected files. Choose only the connections you want.',
    ],
    warnings: [
      'This plan contains absolute local paths. Keep it private and regenerate for a different execution host; no path translation or synchronization is provided.',
      'Read-only is the MCP/skill default; selecting writes exposes only the chosen fixed slots. This is an adapter boundary, not a sandbox against other host tools.',
      'Hooks read directly through the CLI, without waiting for MCP readiness. No Stop or pre-compaction save is installed.',
      'Stored text remains optional data. A successful fixture or installed configuration does not prove native hook delivery or model adoption.',
      'Disconnect the skill, MCP and hook separately; removing one does not disable the others or retract previously delivered context.',
    ],
  };
}
