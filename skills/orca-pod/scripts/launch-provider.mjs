#!/usr/bin/env node

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { configLocation, projectLocation } from "./config-location.mjs";
import { displayPath, envFor, findExecutable } from "./find-executable.mjs";
import { assertCodexRole, listProfiles, parsePipelineYaml, PipelineConfigError, resolveProfile, ROLE_KEYS } from "./pipeline-config.mjs";
import { readCodexCatalog } from "./codex-models.mjs";
import { providerCommand } from "./provider-command.mjs";
import { getProviderCapabilities, MODEL_CATALOG_ARGS, parseModelCatalog, PROVIDER_EXECUTABLES } from "./provider-capabilities.mjs";
import { resolveRolePolicy } from "./role-policy.mjs";
import { roleLaunchFingerprint, verifyLauncherTerminal } from './role-terminal.mjs';
import { launchChat } from './chat-launch.mjs';
import { prepareNativeHelpers } from "./native-helpers.mjs";

const USAGE = "usage: launch-provider.mjs --role planner|implementer|reviewer|chief_reviewer [--profile name] [--resolve | --validate] [--worktree selector] [--environment selector] [--retry-launch id] | --roles [--resolve] [--profile name] | --profiles";

function fail(message) {
  throw new PipelineConfigError(message);
}

const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATE_SCRIPT = path.join(SKILL_DIR, "scripts", "config-location.mjs");

function locate() {
  try {
    return configLocation(projectLocation(process.cwd()));
  } catch (error) {
    fail(error.message);
  }
}

// The launcher only reads the config; migrating old layouts is config-location.mjs migrate (Coordinator, setup).
function loadPipeline() {
  const location = locate();
  const configPath = location.activePath;
  let source;
  try {
    source = readFileSync(configPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      // Old layouts: .orca-pipeline/ (v2, in the worktree and the main checkout) and orca-pipeline.yaml in the root (v1).
      const legacy = [...location.legacyDirs, location.legacyPath].filter((entry) => existsSync(entry));
      const hint = legacy.length ? `; old ${legacy.join(", ")} found — move it: node ${MIGRATE_SCRIPT} migrate` : "";
      fail(`missing required file ${configPath}${hint}`);
    }
    fail(`cannot read ${configPath}: ${error.message}`);
  }
  return { config: parsePipelineYaml(source), configPath };
}

// A config tracked by git came with the repository: the Coordinator confirms its full_access with the user.
function isTrackedByGit(file) {
  const result = spawnSync("git", ["-C", path.dirname(file), "ls-files", "--error-unmatch", "--", file], { stdio: "ignore" });
  return !result.error && result.status === 0;
}

function resolveRole(role, requestedProfileName = null, coordinator = false, pipeline = loadPipeline()) {
  if (!ROLE_KEYS.includes(role)) fail(`role must be one of: ${ROLE_KEYS.join(", ")}`);
  const { config, configPath } = pipeline;
  const resolved = resolveProfile(config, requestedProfileName);
  const { resolvedRoles, profile, reviewMode, maxSubagents, fullAccess, language } = resolved;
  if (!resolvedRoles[role]) {
    fail(`role ${role} is not configured in profile ${JSON.stringify(profile)}; reviewer and chief_reviewer are optional — add them with orca-pod-setup`);
  }
  const settings = resolvedRoles[role];
  const policy = resolveRolePolicy(resolved, role);
  return { ...settings, configPath, profile, role, reviewMode, maxSubagents, fullAccess: coordinator || fullAccess, language,
    policy, settingsFingerprint: roleLaunchFingerprint(settings, policy, fullAccess), requiredPlannerMode: role === 'planner' && settings.provider === 'codex' && settings.surface === 'terminal' ? 'plan' : null,
    runtimeVerified: false };
}

function listRoles(requestedProfileName = null, coordinator = false, pipeline = loadPipeline()) {
  const { config, configPath } = pipeline;
  const resolved = resolveProfile(config, requestedProfileName);
  const { resolvedRoles, profile, reviewMode, maxSubagents, fullAccess, language } = resolved;
  return {
    configPath, profile, language,
    roles: ROLE_KEYS.filter((name) => resolvedRoles[name]),
    reviewMode, maxSubagents, fullAccess: coordinator || fullAccess, accessNote: 'fullAccess is requested; use --roles --resolve for effectiveAccess per role',
    settings: Object.fromEntries(Object.entries(resolvedRoles).map(([role, settings]) => [role, {
      ...settings, policy: resolveRolePolicy(resolved, role), requiredPlannerMode: role === 'planner' && settings.provider === 'codex' && settings.surface === 'terminal' ? 'plan' : null,
    }])),
  };
}

function optionsFrom(argv) {
  const options = { resolve: false, shouldValidate: false, listRoles: false, listProfiles: false, role: null, profileName: null, coordinator: false, terminalHandle: null, worktree: null, environment: null, retryLaunch: null };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--coordinator") options.coordinator = true;
    else if (argv[index] === "--terminal" && /^term_[a-z0-9-]+$/i.test(argv[index + 1] ?? "")) options.terminalHandle = argv[++index];
    else if (argv[index] === "--worktree" && argv[index + 1]?.trim() && !argv[index + 1].startsWith("--")) options.worktree = argv[++index];
    else if (argv[index] === "--environment" && argv[index + 1]?.trim() && !argv[index + 1].startsWith("--")) options.environment = argv[++index];
    else if (argv[index] === "--retry-launch" && argv[index + 1]?.trim() && !argv[index + 1].startsWith("--")) options.retryLaunch = argv[++index];
    else if (argv[index] === "--resolve") options.resolve = true;
    else if (argv[index] === "--validate") options.shouldValidate = true;
    else if (argv[index] === "--roles") options.listRoles = true;
    else if (argv[index] === "--profiles") options.listProfiles = true;
    else if (argv[index] === "--profile" && index + 1 < argv.length) options.profileName = argv[++index];
    else if (argv[index] === "--role" && index + 1 < argv.length) options.role = argv[++index];
    else fail(USAGE);
  }
  if (options.profileName !== null && options.profileName.trim() === "") fail("--profile requires a non-empty profile name");
  if (options.listProfiles) {
    if (options.listRoles || options.role || options.resolve || options.shouldValidate || options.profileName !== null || options.coordinator || options.terminalHandle || options.worktree || options.environment || options.retryLaunch) {
      fail("--profiles cannot be combined with --roles, --role, --profile, --resolve or --validate");
    }
    return options;
  }
  if (options.listRoles) {
    if (options.role || options.shouldValidate || options.terminalHandle || options.worktree || options.environment || options.retryLaunch) fail("--roles cannot be combined with --role or --validate");
    return options;
  }
  if (!options.role) fail(USAGE);
  if (options.resolve && options.shouldValidate) fail("choose either --resolve or --validate");
  return options;
}

async function processRole(settings, options, probeCache = new Map()) {
  const helpersRequested = settings.policy.useSubagents;
  settings.helperPreflight = { requested: helpersRequested, configuration: helpersRequested ? 'unchecked' : 'disabled',
    adapter: null, runtime: 'unverified' };
  if (settings.surface === 'chat') {
    if (options.terminalHandle) fail('A chat role cannot use --terminal');
    settings.effectiveAccess = 'host-default';
    settings.delegationEnforcement = 'instruction-only';
    settings.warnings = ['Chat permissions are controlled by Orca; terminal YOLO flags and native helper configuration are not applied. Helpers run only when native chat tools can honor the policy, otherwise inline.'];
    if (options.resolve || options.shouldValidate) return settings;
    process.exitCode = launchChat(settings, { ...options, skillDir: SKILL_DIR });
    return;
  }
  if (options.worktree || options.environment || options.retryLaunch) fail('--worktree, --environment and --retry-launch apply only to chat roles; launch terminal roles in their prepared terminal');
  if (settings.requiredPlannerMode && options.coordinator && !options.resolve && !options.shouldValidate && !options.terminalHandle) {
    fail('A Coordinator-launched Codex Planner requires --terminal <handle> for its session-local save hook');
  }
  const recordStarted = options.terminalHandle && !options.resolve && !options.shouldValidate
    ? verifyLauncherTerminal(settings, options.terminalHandle) : null;
  settings.warnings = [];
  const command = PROVIDER_EXECUTABLES[settings.provider];
  const executable = options.shouldValidate ? null : findExecutable(command) ?? (settings.provider === 'qoder' ? findExecutable('qoder') : null);
  if (!options.shouldValidate && !executable) fail(`provider executable ${JSON.stringify(command)} is not available on PATH or in the usual install folders`);
  if (executable && !executable.onPath) settings.warnings.push(`${command} is not on PATH; using ${displayPath(executable.file)}`);
  const env = envFor(executable);
  const boundedProbe = (args) => {
    const key = JSON.stringify([executable.file, ...args]);
    if (!probeCache.has(key)) {
      const probe = spawnSync(executable.file, args, { env, encoding: 'utf8', timeout: 4000, maxBuffer: 4 * 1024 * 1024 });
      probeCache.set(key, probe.status === 0 ? probe.stdout : '');
    }
    return probeCache.get(key);
  };
  const probes = executable && ['pi', 'omp', 'qoder'].includes(settings.provider);
  const help = probes ? boundedProbe(['--help']) : '';
  const version = probes ? boundedProbe(['--version']).match(/[0-9]+\.[0-9]+\.[0-9]+/)?.[0] : null;
  const capabilities = getProviderCapabilities(settings.provider, { help, version,
    questions: settings.provider === 'omp' && /^\s+ask\s+-.+interactive/m.test(help) ? 'ask'
      : settings.provider === 'qoder' && version && /^1\.1\.(?:8[1-9]|9[0-9])$/.test(version) ? 'AskUserQuestion' : undefined });
  const wantsYolo = settings.fullAccess || settings.provider === 'qoder';
  settings.effectiveAccess = options.shouldValidate ? 'unchecked' : wantsYolo ? capabilities.access.kind : 'profile-default';
  settings.delegationEnforcement = capabilities.delegation.kind;
  settings.capabilities = capabilities;
  if (executable && wantsYolo && capabilities.access.kind !== 'yolo') {
    settings.warnings.push(`${settings.provider}: requested YOLO; effective access is ${capabilities.access.kind}`);
  }
  if (executable && !capabilities.rolePrompt) settings.warnings.push(`${settings.provider}: no verified session prompt option; include the complete role policy in the first task`);
  if (executable && settings.provider === 'codex') {
    const catalog = readCodexCatalog({ command: executable.file, env });
    const checked = { ...settings, resolvedSubagentSettings: Object.fromEntries(settings.policy.helpers.map(({ name, model, thinking }) => [name, { model, thinking }])) };
    if (catalog.models.length) settings.warnings.push(...assertCodexRole(settings.role, checked, catalog.models, { isAuthoritative: catalog.authoritative, source: catalog.source }));
    else settings.warnings.push(`Codex: catalog unavailable — model and effort are not checked (${catalog.source})`);
  }
  if (executable && MODEL_CATALOG_ARGS[settings.provider]) {
    const catalog = parseModelCatalog(settings.provider, boundedProbe(MODEL_CATALOG_ARGS[settings.provider]));
    for (const { name, model, thinking } of [{ name: settings.role, ...settings }, ...settings.policy.helpers]) {
      const entry = catalog.models.find(({ id, label }) => id === model || label === model);
      if (!entry) settings.warnings.push(`${settings.provider}: ${name} model ${model} is not verified by the local catalog`);
      if (thinking !== 'default' && !entry?.levels.includes(thinking)) fail(`${settings.provider}: ${name} thinking ${thinking} is not verified for model ${model}; use default or a listed level`);
    }
  }
  let temporary;
  const makeDirectory = () => temporary ??= mkdtempSync(path.join(tmpdir(), 'orca-pod-role-'));
  try {
    const launch = executable ? prepareNativeHelpers(settings, settings.policy, capabilities, {
      skillDir: SKILL_DIR, executable, env, cwd: process.cwd(), makeDirectory, materialize: !options.resolve,
    }) : { native: {}, effective: settings.policy, env, warnings: [] };
    settings.policy = launch.effective;
    settings.warnings.push(...launch.warnings);
    if (executable && helpersRequested) {
      settings.helperPreflight.configuration = launch.effective.useSubagents ? 'configured' : 'unavailable';
      if (settings.provider === 'pi' && launch.effective.useSubagents) {
        const listed = boundedProbe(['list']);
        if (/(?:^|[/:\s])pi-subagents(?:[@/\s]|$)/m.test(listed)) settings.helperPreflight.adapter = 'pi-subagents listed';
        else settings.warnings.push('Pi: pi-subagents installation unverified by pi list; verify native helper readiness in the launched session before dispatch');
      }
      if (launch.effective.useSubagents) settings.warnings.push('Native helper availability in the running session still requires pre-dispatch verification');
    }
    if (settings.provider === 'pi' && executable) {
      const lensFlags = ['--no-lens-context', '--no-autoformat', '--no-autofix', '--no-tests', '--no-knip', '--no-jscpd', '--no-madge',
        '--no-gitleaks', '--no-govulncheck', '--no-dead-code', '--no-complexity', '--no-opengrep'];
      launch.native.lensFlags = lensFlags.filter((flag) => new RegExp(`^\\s*${flag}\\s`, 'm').test(help));
      if (!launch.native.lensFlags.includes('--no-lens-context')) settings.warnings.push('Pi: session flags for Lens automatic diagnostics were not detected');
    }
    if (options.resolve || options.shouldValidate) {
      return settings;
    } else {
      const [, ...args] = providerCommand(settings, { ...settings, skillDir: SKILL_DIR, capabilities, native: launch.native, terminalHandle: options.terminalHandle });
      for (const warning of settings.warnings) console.error(`PIPELINE CONFIG WARNING: ${warning}`);
      const roleEnv = { ...launch.env,
        ...(options.terminalHandle ? { ORCA_POD_RUNTIME_PARENT: String(process.pid), ORCA_ENVIRONMENT: 'local' } : {}),
        ...(settings.requiredPlannerMode && options.terminalHandle ? { ORCA_POD_PLANNER_TERMINAL: options.terminalHandle } : {}) };
      if (options.terminalHandle) delete roleEnv.ORCA_PAIRING_CODE;
      const child = spawn(executable.file, args, { stdio: 'inherit', env: roleEnv });
      process.exitCode = await new Promise((resolve, reject) => {
        child.once('error', reject);
        if (recordStarted) child.once('spawn', () => recordStarted(child.pid));
        child.once('exit', code => resolve(code ?? 1));
      });
    }
  } finally {
    if (temporary) rmSync(temporary, { recursive: true, force: true });
  }
}

try {
  const options = optionsFrom(process.argv.slice(2));
  if (options.listProfiles) {
    const { config, configPath } = loadPipeline();
    console.log(JSON.stringify({ configPath, configTracked: isTrackedByGit(configPath), ...listProfiles(config) }));
  } else if (options.listRoles) {
    const pipeline = loadPipeline();
    const listing = listRoles(options.profileName, options.coordinator, pipeline);
    if (options.resolve) {
      const probeCache = new Map();
      for (const role of listing.roles) {
        listing.settings[role] = await processRole(resolveRole(role, listing.profile, options.coordinator, pipeline), options, probeCache);
      }
    }
    console.log(JSON.stringify(listing));
  } else {
    const settings = await processRole(resolveRole(options.role, options.profileName, options.coordinator), options);
    if (settings) console.log(JSON.stringify(settings));
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`PIPELINE CONFIG ERROR: ${message}`);
  process.exit(2);
}
