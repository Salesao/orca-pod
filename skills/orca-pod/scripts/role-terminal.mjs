#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { configLocation, projectLocation } from './config-location.mjs';
import { orcaCommand } from './orca-command.mjs';
import { parsePipelineYaml, resolveProfile, ROLE_LABELS } from './pipeline-config.mjs';
import { resolveRolePolicy } from './role-policy.mjs';
import { terminalExcerpt } from './terminal-excerpt.mjs';
import { roleRecords } from './terminal-records.mjs';

const script = fileURLToPath(import.meta.url);
const launcher = path.join(path.dirname(script), 'launch-provider.mjs');
const isHandle = (value) => typeof value === 'string' && /^term_[a-z0-9-]+$/i.test(value);
const nonempty = (s) => typeof s === 'string' && s.length > 0;
const now = () => new Date().toISOString();

function host(...args) {
  const p = spawnSync(orcaCommand(), [...args, '--environment', 'local', '--json'],
    { encoding: 'utf8', timeout: args[1] === 'create' ? 65000 : 5000, maxBuffer: 2 * 1024 * 1024 });
  let response;
  try { response = JSON.parse(p.stdout); } catch { /* only return bounded error codes */ }
  if (p.status !== 0 || response?.ok !== true) {
    const raw = response?.error?.code ?? p.error?.code;
    const code = /^[a-zA-Z0-9_-]{1,80}$/.test(raw ?? '') ? raw : 'unconfirmed';
    throw Object.assign(new Error(`Orca ${args[0]} ${args[1]}: ${code}`), { code, runtimeId: response?._meta?.runtimeId });
  }
  return response;
}

function workspace(root, selector = 'current') {
  if (selector !== 'current' && !/^(identity:|folder:|id:)/.test(selector)) throw new Error('Use an exact Orca workspace selector');
  const response = host('worktree', 'show', '--worktree', selector);
  const w = response.result.worktree ?? response.result.folder;
  const { worktree, environment } = w?.address ?? {};
  if (!nonempty(worktree) || !nonempty(w?.id) || !nonempty(response._meta?.runtimeId) ||
      environment !== 'local' || realpathSync(w.path) !== root ||
      (w.identity?.executionHostId ?? w.hostId ?? w.executionHostId) !== 'local') {
    throw new Error('Run from the target project on its execution host; Orca must confirm its exact local workspace address');
  }
  return { environment, worktree, worktreeId: w.id, root, runtimeId: response._meta.runtimeId };
}

function assertWorkspace(expected, actual) {
  for (const key of ['environment', 'worktree', 'worktreeId', 'root', 'runtimeId']) {
    if (expected[key] !== actual[key]) throw new Error('Orca workspace or runtime changed');
  }
}

function identify(claim, address, expected = null) {
  if (!isHandle(address)) throw new Error('Expected an Orca terminal handle');
  const response = host('terminal', 'show', '--terminal', address);
  const t = response.result?.terminal;
  if (response._meta?.runtimeId !== claim.workspace.runtimeId || t?.handle !== address ||
      t.worktreeId !== claim.workspace.worktreeId || realpathSync(t.worktreePath) !== claim.workspace.root ||
      (t.executionHostId && t.executionHostId !== 'local') || !nonempty(t.incarnationId) || !nonempty(t.ptyId)) {
    throw new Error('Orca terminal identity or workspace mismatch');
  }
  if (expected && (expected.processIncarnation !== t.incarnationId || expected.ptyId !== t.ptyId)) {
    throw new Error('Role terminal incarnation changed');
  }
  return t;
}

// Hash the resolved settings used by this role. Object key order in YAML and
// unrelated profile edits do not change the fingerprint. Helper bodies stay private.
export function roleLaunchFingerprint(settings, policy, configuredAccess) {
  const helpers = policy.helpers.map(h => [h.name, h.model, h.thinking, h.description ?? null, h.instructions ?? null])
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  const values = [settings.provider, settings.surface, settings.model, settings.thinking, settings.shouldUseSubagents,
    configuredAccess, policy.role, policy.maxSubagents, policy.reviewMode, policy.language, policy.diagnosticOwner, helpers];
  return createHash('sha256').update(JSON.stringify(values)).digest('hex');
}

function requestedSettings(location, role, profile) {
  const config = parsePipelineYaml(readFileSync(configLocation(location).activePath, 'utf8'));
  const selected = resolveProfile(config, profile);
  const s = selected.resolvedRoles[role];
  if (s?.surface !== 'terminal') throw new Error('The selected role requires a configured terminal surface');
  const policy = resolveRolePolicy(selected, role);
  const roleFingerprints = Object.keys(selected.resolvedRoles).sort().map(name => [
    name, roleLaunchFingerprint(selected.resolvedRoles[name], resolveRolePolicy(selected, name), selected.fullAccess),
  ]);
  const profileFingerprint = createHash('sha256').update(JSON.stringify(roleFingerprints)).digest('hex');
  return { profileFingerprint, profile: selected.profile, provider: s.provider, helpersRequested: policy.useSubagents,
    settingsFingerprint: roleLaunchFingerprint(s, policy, selected.fullAccess), requested: { model: s.model, thinking: s.thinking } };
}

export function startupCommand(args, platform = process.platform) {
  if (platform === 'win32') return `& ${args.map(s => "'" + s.replaceAll("'", "''") + "'").join(' ')}; exit $LASTEXITCODE`;
  return 'exec ' + args.map(s => "'" + s.replaceAll("'", "'\"'\"'") + "'").join(' ');
}

function readTerminal(claim, binding, limit) {
  identify(claim, binding.address, binding);
  function read(screen) {
    const response = host('terminal', 'read', '--terminal', binding.address, '--limit', String(limit), ...(screen ? ['--screen'] : []));
    const t = response.result.terminal;
    if (response._meta?.runtimeId !== claim.workspace.runtimeId || t?.handle !== binding.address || !Array.isArray(t.tail)) throw new Error('Unexpected Orca read identity');
    return { source: ['screen', 'stream', 'screen-unavailable'].includes(t.source) ? t.source : 'unknown',
      status: ['running', 'exited'].includes(t.status) ? t.status : 'unknown',
      tail: t.tail.filter(s => typeof s === 'string').slice(-limit) };
  }
  let view = read(binding.provider === 'qoder');
  if (binding.provider !== 'qoder' && view.source !== 'screen' && !view.tail.some(line => /[\p{L}\p{N}]{2}/u.test(line))) {
    const screen = read(true);
    if (screen.tail.length || !view.tail.length) view = screen;
  }
  identify(claim, binding.address, binding);
  return view;
}

// Keep a fixed vocabulary of diagnostic markers alongside the readable excerpt.
const diagnostics = [
  [/\b(?:EVIDENCE_GAP|PLAN_REVISION_REQUIRED|CHANGES_REQUESTED|FINAL_APPROVED|FINAL_READY|REVIEW_REQUEST|BLOCKED|APPROVED)\b/g, null],
  [/native subagent status cannot be reconciled|could not prepare the selected helpers/i, 'native helpers unavailable'],
  [/timed?\s*out|deadline exceeded/i, 'timeout'],
  [/permission denied|forbidden|access denied/i, 'permission denied'],
  [/out of memory|heap limit/i, 'out of memory'],
  [/connection refused|connection reset|connection lost/i, 'connection lost'],
  [/command not found|executable .*not available/i, 'executable unavailable'],
  [/trust.*workspace|trust.*folder/i, 'workspace trust prompt'],
  [/rate.?limit|too many requests/i, 'rate limited'],
  [/no space left on device|\bENOSPC\b/i, 'disk full'],
  [/authentication failed|invalid credentials|unauthorized/i, 'authentication failed'],
  [/unhandled rejection|uncaught exception|segmentation fault/i, 'process exception'],
  [/trust.*hook/i, 'hook trust prompt'],
];

function capture(records, generation, view) {
  const previous = records.read(generation, 'diagnostic');
  const excerpt = Buffer.from(view.tail.join('\n')).subarray(-8192).toString('utf8');
  const events = new Set();
  for (const [pattern, label] of diagnostics) {
    if (label) {
      if (pattern.test(excerpt)) events.add(label);
    } else {
      for (const match of excerpt.matchAll(pattern)) events.add(match[0]);
    }
  }
  // Repeated samples often contain identical frames. Keep the latest observation per marker.
  const at = now();
  const recent = (previous?.recent ?? []).filter(entry => !events.has(entry.event));
  for (const event of events) recent.push({ event, lastSeen: at });
  const text = terminalExcerpt(view.tail);
  const lastReadable = text ? { text, sampledAt: at, source: view.source, status: view.status } : previous?.excerpt ?? null;
  records.write(generation, 'diagnostic', { sampledAt: at, source: view.source, status: view.status,
    excerpt: lastReadable, recent: recent.slice(-32) });
}

function state(records, generation) {
  const claim = records.read(generation, 'claim');
  const bound = records.read(generation, 'bound');
  const rejected = records.read(generation, 'rejected');
  if (rejected) throw new Error(`Create rejected before allocation (${rejected.code}); retry create on this run and role`);
  if (!claim || !bound) throw new Error('Launch outcome pending or unknown. Inspect the workspace without resending or creating another terminal');
  return { claim, bound };
}

function sameSettings(previous, next) {
  return (!previous.settingsFingerprint || previous.settingsFingerprint === next.settingsFingerprint) &&
    previous.provider === next.provider && previous.requested.model === next.requested.model &&
    previous.requested.thinking === next.requested.thinking && (previous.helpersRequested === undefined || previous.helpersRequested === next.helpersRequested);
}

function receipt(records, generation, bound) {
  const runtime = records.read(generation, 'runtime');
  const process = records.read(generation, 'process');
  const exit = records.read(generation, 'exit');
  return { ...bound, stage: exit ? 'exited' : process ? 'provider_spawned' : 'terminal_bound', process,
    observed: { model: runtime?.model ?? null, thinking: runtime?.thinking ?? null, source: runtime?.source ?? null,
      observedAt: runtime?.observedAt ?? null },
    helpers: runtime?.helpers ?? 'unverified', helperReason: runtime?.helperReason ?? null,
    turnStarted: null, exit };
}

function requireClosed(claim, bound) {
  try {
    const view = readTerminal(claim, bound, 1);
    if (view.status === 'exited') return 'exited';
    throw new Error('Previous terminal exit is unconfirmed; settle or stop the old role before replacement');
  } catch (error) {
    if (error.code !== 'terminal_handle_stale' || error.runtimeId !== claim.workspace.runtimeId) throw error;
    // Host/runtime identity already matched. The operator separately reconciles any surviving writers.
    return 'stale';
  }
}

function requireProviderSettled(records, generation, bound) {
  // The wrapper observes the launcher exit after it has waited for the provider.
  const exit = records.read(generation, 'exit');
  if (exit && exit.code !== null && !exit.signal) return;
  const pid = records.read(generation, 'process')?.pid ?? bound.bootstrapPid;
  if (!Number.isSafeInteger(pid) || pid < 1) return;
  try { process.kill(pid, 0); }
  catch (error) { if (error.code === 'ESRCH') return; throw new Error('Cannot verify whether the old role process still runs'); }
  throw new Error('The recorded old role process is still present on the execution host');
}

async function create(o, location, records, address) {
  const latest = records.latest();
  let previous = latest;
  // Definitive pre-create rejections never bound a terminal. Preserve the
  // failed generation and re-check the previous logical binding, if any.
  while (previous && records.read(previous, 'rejected')) previous--;
  const settings = requestedSettings(location, o.role, o.profile);
  let replaces = null;
  if (previous) {
    const { claim, bound } = state(records, previous);
    assertWorkspace(claim.workspace, address);
    if (o.replace !== bound.address || !o['children-settled'] || bound.profile !== settings.profile) {
      throw new Error('Role already claimed: replacement needs its exact old handle, same profile and --children-settled');
    }
    if (!sameSettings(bound, settings)) throw new Error('The role’s configured launch policy changed since launch');
    const terminalState = requireClosed(claim, bound);
    requireProviderSettled(records, previous, bound);
    replaces = { address: bound.address, processIncarnation: bound.processIncarnation, terminalState, childrenSettled: true };
  } else if (o.replace || o['children-settled']) throw new Error('No original role to replace');
  records.bindRun({ profile: settings.profile, profileFingerprint: settings.profileFingerprint,
    environment: address.environment, worktree: address.worktree, runtimeId: address.runtimeId });
  const generation = latest + 1;
  const nonce = randomUUID();
  const claim = { run: o.run, role: o.role, generation, ...settings, workspace: address, replaces, nonce };
  records.write(generation, 'claim', claim, true);
  const command = startupCommand([process.execPath, script, 'bootstrap', '--run', o.run, '--role', o.role, '--generation', String(generation), '--nonce', nonce]);
  let response;
  try {
    response = host('terminal', 'create', '--worktree', address.worktree, '--title', ROLE_LABELS[o.role],
      ...(process.platform === 'win32' ? ['--shell', 'powershell.exe'] : []), '--command', command);
  } catch (error) {
    if (error.runtimeId === address.runtimeId && ['invalid_argument', 'selector_not_found', 'selector_ambiguous'].includes(error.code)) {
      records.write(generation, 'rejected', { code: error.code, at: now() }, true);
      throw new Error(`Create rejected before terminal allocation (${error.code}); correct the selector or arguments and retry this run and role`);
    }
    throw new Error(`${error.message}; launch outcome unknown. Resolve this run and role without repeating create`);
  }
  const issued = response.result?.terminal?.handle;
  if (!isHandle(issued) || response._meta?.runtimeId !== address.runtimeId) throw new Error('Create receipt is ambiguous; use resolve with the same run and role');
  for (let i = 0; i < 100; i++) {
    const bound = records.read(generation, 'bound');
    if (bound) {
      if (bound.address !== issued) throw new Error('Created handle differs from the terminal reporting its own identity');
      identify(claim, issued, bound);
      return receipt(records, generation, bound);
    }
    await delay(150);
  }
  throw new Error(`Created ${issued}; bootstrap has not verified its own identity. Inspect this exact handle and resolve the same run and role`);
}

async function bootstrap(o, location, records, address) {
  const generation = Number(o.generation);
  const claim = records.read(generation, 'claim');
  if (!claim || claim.nonce !== o.nonce || records.latest() !== generation) throw new Error('Unexpected role launch generation');
  assertWorkspace(claim.workspace, address);
  const settings = requestedSettings(location, o.role, claim.profile);
  if ((claim.profileFingerprint && claim.profileFingerprint !== settings.profileFingerprint) || !sameSettings(claim, settings)) throw new Error('Provider configuration changed since terminal create');
  const t = identify(claim, process.env.ORCA_TERMINAL_HANDLE);
  if (t.writable !== true || (process.env.ORCA_PANE_KEY && process.env.ORCA_PANE_KEY !== t.tabId + ':' + t.leafId)) throw new Error('Bootstrap cannot verify its own writable terminal pane');
  const bound = { run: o.run, role: o.role, generation, ...settings, workspace: address, replaces: claim.replaces,
    address: t.handle, processIncarnation: t.incarnationId, ptyId: t.ptyId, bootstrapPid: process.pid, boundAt: now() };
  records.write(generation, 'bound', bound, true);
  const sample = () => {
    try { capture(records, generation, readTerminal(claim, bound, 60)); }
    catch { /* Last successful diagnostics remain available after a terminal disappears. */ }
  };
  const sampler = setInterval(sample, 30000);
  sampler.unref();
  const child = spawn(process.execPath, [launcher, '--role', o.role, '--profile', claim.profile, '--coordinator', '--terminal', t.handle],
    { cwd: location.worktreeRoot, stdio: 'inherit', env: { ...process.env, ORCA_POD_RUN: o.run, ORCA_POD_ROLE: o.role, ORCA_POD_GENERATION: String(generation) } });
  try {
    const [code, signal] = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (...args) => resolve(args)); });
    records.write(generation, 'exit', { at: now(), code, signal });
    sample();
    process.exitCode = code ?? 1;
  } finally { clearInterval(sampler); }
}

// Verify even direct --terminal invocations before installing a Planner hook or starting a provider.
export function verifyLauncherTerminal(settings, handle) {
  const { role, profile } = settings;
  const env = process.env;
  if (handle !== env.ORCA_TERMINAL_HANDLE || role !== env.ORCA_POD_ROLE) throw new Error('Use role-terminal.mjs create to launch in the role’s own terminal');
  const location = projectLocation(process.cwd());
  const records = roleRecords(realpathSync(location.worktreeRoot), env.ORCA_POD_RUN, role);
  const generation = Number(env.ORCA_POD_GENERATION);
  const { claim, bound } = state(records, generation);
  if (records.latest() !== generation || bound.address !== handle || profile !== claim.profile ||
      bound.bootstrapPid !== process.ppid || !sameSettings(bound, { provider: settings.provider,
        requested: settings, helpersRequested: settings.policy.useSubagents, settingsFingerprint: settings.settingsFingerprint }) || !identify(claim, handle, bound).writable) {
    throw new Error('Role launch identity or requested settings mismatch');
  }
  return pid => {
    try { records.write(generation, 'process', { pid, spawnedAt: now() }, true); }
    catch { /* If disk is unavailable, the receipt retains its last verified stage. */ }
  };
}

async function main([operation, ...args]) {
  const flags = {
    workspace: ['worktree', 'environment'], create: ['run', 'role', 'profile', 'worktree', 'environment', 'replace', 'children-settled'],
    resolve: ['run', 'role'], read: ['run', 'role', 'limit', 'lines', 'saved', 'generation'],
    bootstrap: ['run', 'role', 'generation', 'nonce'],
  };
  if (!Object.hasOwn(flags, operation)) throw new Error('usage: role-terminal.mjs workspace|create|resolve|read ...');
  const { values: o } = parseArgs({ args, options: Object.fromEntries(flags[operation].map(k => [k, { type: ['children-settled', 'saved'].includes(k) ? 'boolean' : 'string' }])) });
  if (o.environment && o.environment !== 'local') throw new Error('Run the terminal helper on the target execution host using its local Orca');
  const location = projectLocation(process.cwd());
  const root = realpathSync(location.worktreeRoot);
  if (operation === 'workspace') return workspace(root, o.worktree);
  const records = roleRecords(root, o.run, o.role, operation === 'create');
  if (operation === 'create') {
    if (!o.profile) throw new Error('Provide the selected --profile');
    return create(o, location, records, workspace(root, o.worktree));
  }
  if (operation === 'bootstrap') return bootstrap(o, location, records, workspace(root));
  const generation = o.generation === undefined ? records.latest() : Number(o.generation);
  const { claim, bound } = state(records, generation);
  const current = receipt(records, generation, bound);
  if (o.saved) return { ...current, diagnostic: records.read(generation, 'diagnostic'), liveChecked: false };
  if (o.generation !== undefined) throw new Error('--generation applies to --saved diagnostics');
  assertWorkspace(claim.workspace, workspace(root, claim.workspace.worktree));
  if (operation === 'resolve') {
    if (current.exit || !identify(claim, bound.address, bound).writable) throw new Error('Role terminal is no longer writable');
    return { ...current, liveChecked: true };
  }
  const limit = Number(o.limit ?? o.lines ?? 60);
  if ((o.limit && o.lines) || !Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error('Use --limit or --lines from 1 to 500');
  const view = readTerminal(claim, bound, limit);
  capture(records, generation, view);
  return { ...current, ...view, liveChecked: true };
}

if (process.argv[1] && realpathSync(process.argv[1]) === script) {
  main(process.argv.slice(2)).then(value => { if (value) console.log(JSON.stringify(value)); })
    .catch(error => { console.error(error.message); process.exitCode = 2; });
}
