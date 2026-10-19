// Model catalogs for the orca-pod-setup form, per role agent (provider).
// Only local read-only sources: CLI listings and caches. No AI requests,
// saved sessions or credential output.
//   pi          — `pi --list-models` (the list as Pi sees it, with the providers added by
//                 extensions), thinking levels — the RPC `get_available_models` + the pi-ai SDK
//   claude-code — aliases (opus/sonnet/haiku/fable — the latest version of the family) and specific
//                 versions from the synchronized Anthropic catalog in Pi (the same one claude-bridge uses);
//                 effort per model. Subagents get aliases only (the Agent tool).
//   codex       — `codex debug models` (the models visible in the Codex picker and their reasoning effort),
//                 the fallback source is ~/.codex/models_cache.json (a module shared with the pipeline skill).
// Each CLI is looked up in PATH and then in the usual install folders (find-executable.mjs of the pipeline skill).

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readCodexCatalog } from '../../orca-pod/scripts/codex-models.mjs';
import { displayPath, envFor, findExecutable } from '../../orca-pod/scripts/find-executable.mjs';

// Pi's npm scope: @earendil-works since Pi 0.74, @mariozechner before it.
const PI_SCOPES = ['@earendil-works', '@mariozechner'];
const PI_ALL_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
// The agents whose catalogs go into the form.
export const ENABLED_PROGRAMS = ['pi', 'claude-code', 'codex'];
export const KNOWN_PROGRAMS = ['pi', 'claude-code', 'codex'];
export const CLAUDE_CODE_EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];
const CLAUDE_CODE_ALIASES = ['opus', 'sonnet', 'haiku', 'fable'];
const CLAUDE_FAMILY_ORDER = ['fable', 'opus', 'sonnet', 'haiku'];

// A CLI not found anywhere is not in the form; one found outside PATH is run by its absolute path.
const NOT_FOUND = ' not found (neither in PATH nor in the usual install folders)';
const foundAt = (found) => found.onPath ? '' : ' [' + displayPath(found.file) + ', not in PATH]';

// The reason of a failed CLI for the CATALOG line. A crashed node prints its version last ("Node.js v24…"),
// so the line with the error code is taken instead. EPERM/EACCES is a sandbox that does not let the CLI write
// its own files (Pi takes lock files in ~/.pi/agent even to list the models).
export function failureReason(stderr) {
  const lines = String(stderr).split('\n').map((line) => line.trim()).filter((line) => line && !/^Node\.js v\d/.test(line));
  const line = lines.find((text) => /\b(EPERM|EACCES|operation not permitted|permission denied)\b/i.test(text))
    || lines.find((text) => /Error\b|\bE[A-Z]{3,}\b/.test(text)) || lines.at(-1) || '';
  const sandbox = /\b(EPERM|EACCES|operation not permitted)\b/i.test(line) ? ' — no write access (sandbox?): run the form with elevated permissions' : '';
  return line + sandbox;
}

function run(file, args, { cwd, env, timeoutMs, label }) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error(label + ' did not answer within ' + timeoutMs / 1000 + ' s')); }, timeoutMs);
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(label + ' exited with code ' + code + (stderr.trim() ? ': ' + failureReason(stderr) : '')));
    });
  });
}

// claude-<family>-<major>[-<minor>] → family and version; dated snapshots are not shown.
function claudeVersion(id) {
  const [, family, major, minor] = id.split('-');
  return { family, major: Number(major) || 0, minor: Number(minor) || 0 };
}
function normalizeAnthropicModels(models) {
  return models
    .filter((m) => /^claude-/.test(m.id) && !/-20\d{6}$/.test(m.id))
    .map((m) => ({ id: m.id, levels: m.levels.filter((level) => CLAUDE_CODE_EFFORT_LEVELS.includes(level)) }))
    .filter((m) => m.levels.length)
    .sort((a, b) => {
      const va = claudeVersion(a.id), vb = claudeVersion(b.id);
      const fa = CLAUDE_FAMILY_ORDER.indexOf(va.family), fb = CLAUDE_FAMILY_ORDER.indexOf(vb.family);
      if (fa !== fb) return (fa < 0 ? 99 : fa) - (fb < 0 ? 99 : fb);
      return vb.major - va.major || vb.minor - va.minor || a.id.localeCompare(b.id);
    });
}
// The Anthropic catalog from Pi outside a Pi session: local (synchronized) data, no network.
// ModelRuntime exists since Pi 0.80.8; before it the pi-ai root exports the built-in catalog (getModels).
async function piAnthropicModels() {
  const { ai, sdk } = await loadPiSdk();
  let models;
  if (sdk.ModelRuntime) {
    const runtime = await sdk.ModelRuntime.create({ allowModelNetwork: false });
    models = new sdk.ModelRegistry(runtime).getAll().filter((model) => model.provider === 'anthropic');
  } else if (ai.getModels) {
    models = ai.getModels('anthropic');
  } else {
    throw new Error('this Pi version exposes no model catalog');
  }
  return models.map((model) => ({ id: model.id, levels: ai.getSupportedThinkingLevels(model) }));
}

// anthropicModels — [{ id, levels }] from the registry of the current Pi session; otherwise the Pi catalog is read.
export async function claudeCodeCatalog({ anthropicModels = null } = {}) {
  const claude = findExecutable('claude');
  if (!claude) return { program: 'claude-code', models: [], source: 'Claude Code: claude' + NOT_FOUND };
  let versions = [];
  let problem = '';
  try { versions = normalizeAnthropicModels(anthropicModels || await piAnthropicModels()); }
  catch (error) { problem = error.message; }
  const aliases = CLAUDE_CODE_ALIASES.map((alias) => {
    const newest = versions.find((m) => claudeVersion(m.id).family === alias);
    return {
      program: 'claude-code', provider: 'claude-code', id: alias,
      group: 'Claude Code · alias — latest version',
      label: newest ? alias + ' → ' + newest.id : alias,
      levels: newest ? newest.levels : CLAUDE_CODE_EFFORT_LEVELS,
    };
  });
  // Specific versions are for the role only: `claude --model` accepts a full id, the Agent tool does not.
  const pinned = versions.map((m) => ({
    program: 'claude-code', provider: 'claude-code', id: m.id, levels: m.levels,
    group: 'Claude Code · specific version', roleOnly: true,
  }));
  const source = (versions.length
    ? 'Claude Code: aliases + ' + versions.length + ' versions from the Anthropic catalog in Pi (as in claude-bridge); effort per model'
    : 'Claude Code: aliases only, effort low..max' + (problem ? ' (Anthropic catalog from Pi unavailable: ' + problem + ')' : '')) + foundAt(claude);
  return { program: 'claude-code', models: [...aliases, ...pinned], source };
}

export function codexCatalog() {
  const codex = findExecutable('codex');
  if (!codex) return { program: 'codex', models: [], source: 'Codex: codex' + NOT_FOUND };
  const { models, source } = readCodexCatalog({ command: codex.file, env: envFor(codex) });
  return {
    program: 'codex',
    models: models.filter((model) => model.visible && model.levels.length)
      .map((model) => ({ program: 'codex', provider: 'codex', id: model.id, levels: model.levels })),
    source: source + foundAt(codex),
  };
}

/** { directory, scope } of the installed pi-coding-agent, or null. */
function piPackageDir() {
  const pi = findExecutable('pi');
  if (!pi) return null;
  let directory = path.dirname(realpathSync(pi.file));
  while (directory !== path.dirname(directory)) {
    const manifest = path.join(directory, 'package.json');
    const name = existsSync(manifest) ? JSON.parse(readFileSync(manifest, 'utf8')).name : null;
    const scope = PI_SCOPES.find((candidate) => name === candidate + '/pi-coding-agent');
    if (scope) return { directory, scope };
    directory = path.dirname(directory);
  }
  return null;
}

// The Pi SDK from the installed pi. pi-ai has only the import condition in exports, so
// createRequire().resolve() does not work — the entry files are taken from its exports directly.
let piSdkPromise = null;
function loadPiSdk() {
  piSdkPromise ??= (async () => {
    const found = piPackageDir();
    if (!found) throw new Error('package ' + PI_SCOPES.map((scope) => scope + '/pi-coding-agent').join(' or ') + ' not found');
    const { directory: packageDir, scope } = found;
    const aiDir = [path.join(packageDir, 'node_modules', scope, 'pi-ai'), path.join(packageDir, '../pi-ai')]
      .find((directory) => existsSync(path.join(directory, 'package.json')));
    if (!aiDir) throw new Error(scope + '/pi-ai not found next to ' + scope + '/pi-coding-agent');
    const entry = JSON.parse(readFileSync(path.join(aiDir, 'package.json'), 'utf8')).exports?.['.'];
    const aiFile = typeof entry === 'string' ? entry : entry?.import || entry?.default;
    if (!aiFile) throw new Error(scope + '/pi-ai has no entry point');
    const [ai, sdk] = await Promise.all([
      import(pathToFileURL(path.join(aiDir, aiFile)).href),
      import(pathToFileURL(path.join(packageDir, 'dist/index.js')).href),
    ]);
    return { ai, sdk };
  })();
  return piSdkPromise;
}

async function piThinkingLevelsFunction() {
  return (await loadPiSdk()).ai.getSupportedThinkingLevels;
}

// Pi before 0.74 prints the table to stderr, later versions to stdout.
async function piListModels(pi, cwd) {
  const { stdout, stderr } = await run(pi.file, ['--list-models'], { cwd, env: envFor(pi), timeoutMs: 30000, label: 'pi' });
  return (/^provider\s/m.test(stdout) ? stdout : stderr).split('\n')
    .map((line) => line.trim().split(/\s+/))
    .filter((columns) => columns.length >= 5 && columns[0] !== 'provider')
    .map(([provider, id, , , thinking]) => ({ provider, id, thinking: thinking === 'yes' }));
}

// A separate ephemeral Pi session only for the model metadata: no session saving,
// tools, MCP, skills or context files; extensions (providers) are loaded.
// An older Pi refuses a flag it does not know yet ("Unknown option: --no-mcp" before Pi had MCP): that flag is dropped
// and the session started again.
const PI_RPC_ARGS = ['--mode', 'rpc', '--no-session', '--no-tools', '--no-mcp', '--no-skills', '--no-prompt-templates', '--no-themes', '--no-context-files'];

async function piRpcModels(pi, cwd, args = PI_RPC_ARGS) {
  try {
    return await piRpcSession(pi, cwd, args);
  } catch (error) {
    const unknown = error.unknownOption;
    if (unknown && unknown !== '--mode' && args.includes(unknown)) return piRpcModels(pi, cwd, args.filter((arg) => arg !== unknown));
    throw error;
  }
}

function piRpcSession(pi, cwd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(pi.file, args, { cwd, env: envFor(pi), stdio: ['pipe', 'pipe', 'pipe'] });
    let buffer = '';
    let stderr = '';
    const finish = (error, models) => { clearTimeout(timer); child.kill('SIGTERM'); error ? reject(error) : resolve(models); };
    const timer = setTimeout(() => finish(new Error('pi RPC did not answer within 30 s')), 30000);
    child.on('error', (error) => finish(error));
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => {
      const error = new Error('pi RPC finished without an answer (code ' + code + ')' + (stderr.trim() ? ': ' + failureReason(stderr) : ''));
      error.unknownOption = /Unknown option: (--[\w-]+)/.exec(stderr)?.[1];
      finish(error);
    });
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        let message;
        try { message = JSON.parse(line); } catch { continue; }
        if (message.command === 'get_available_models') {
          if (message.success === false) finish(new Error(message.error || 'get_available_models rejected'));
          else finish(null, message.data?.models || []);
        }
      }
    });
    // pi may exit before it reads the request (EPIPE); the 'close' handler above reports that.
    child.stdin.on('error', () => {});
    child.stdin.write(JSON.stringify({ id: 'orca-setup-models', type: 'get_available_models' }) + '\n');
  });
}

export async function piCatalog({ cwd }) {
  const pi = findExecutable('pi');
  if (!pi) return { program: 'pi', models: [], source: 'Pi: pi' + NOT_FOUND };
  const [listed, rpc, levelsOf] = await Promise.allSettled([piListModels(pi, cwd), piRpcModels(pi, cwd), piThinkingLevelsFunction()]);
  const rpcByKey = new Map(rpc.status === 'fulfilled' ? rpc.value.map((model) => [model.provider + '/' + model.id, model]) : []);
  const exactLevels = (model) => {
    if (!model || levelsOf.status !== 'fulfilled') return null;
    try { return levelsOf.value(model); } catch { return null; }
  };
  let rows;
  if (listed.status === 'fulfilled' && listed.value.length) rows = listed.value;
  else if (rpcByKey.size) rows = [...rpcByKey.values()].map((model) => ({ provider: model.provider, id: model.id, thinking: !!model.reasoning }));
  else {
    const reason = listed.status === 'rejected' ? listed.reason.message : 'empty list';
    return { program: 'pi', models: [], source: 'Pi: pi --list-models unavailable (' + reason + ')' + foundAt(pi) };
  }
  let approximated = 0;
  const models = rows.map((row) => {
    let levels = exactLevels(rpcByKey.get(row.provider + '/' + row.id));
    if (!levels) { approximated += 1; levels = row.thinking ? PI_ALL_LEVELS : ['off']; }
    return { program: 'pi', provider: row.provider, id: row.id, levels };
  });
  const listSource = listed.status === 'fulfilled' ? 'pi --list-models' : 'RPC get_available_models';
  const levelSource = approximated
    ? 'thinking: ' + (models.length - approximated) + ' exact from RPC, ' + approximated + ' approximate (Pi itself limits an unsupported level)'
    : 'thinking: exact from RPC get_available_models';
  return { program: 'pi', models, source: 'Pi: ' + listSource + ' — ' + models.length + ' models; ' + levelSource + foundAt(pi) };
}

// piModels — an already known Pi catalog (for example the registry of the current Pi session); otherwise the CLI.
export async function discoverCatalogs({ cwd, piModels = null, anthropicModels = null, programs = ENABLED_PROGRAMS }) {
  const catalogs = [];
  if (programs.includes('pi')) {
    catalogs.push(piModels
      ? { program: 'pi', models: piModels, source: 'Pi: registry of the current Pi session — ' + piModels.length + ' models' }
      : await piCatalog({ cwd }));
  }
  if (programs.includes('claude-code')) catalogs.push(await claudeCodeCatalog({ anthropicModels }));
  if (programs.includes('codex')) catalogs.push(codexCatalog());
  return {
    models: catalogs.flatMap((catalog) => catalog.models),
    sources: catalogs.map((catalog) => catalog.source),
  };
}
