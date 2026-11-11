#!/usr/bin/env node

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { configLocation, projectLocation } from "./config-location.mjs";
import { displayPath, envFor, findExecutable } from "./find-executable.mjs";
import { assertCodexRole, listProfiles, parsePipelineYaml, PipelineConfigError, resolveProfile, ROLE_KEYS } from "./pipeline-config.mjs";
import { readCodexCatalog } from "./codex-models.mjs";
import { providerCommand } from "./provider-command.mjs";
import { getProviderCapabilities, MODEL_CATALOG_ARGS, parseModelCatalog, PROVIDER_EXECUTABLES } from "./provider-capabilities.mjs";
import { resolveRolePolicy } from "./role-policy.mjs";
import { prepareNativeHelpers } from "./native-helpers.mjs";

const USAGE = "usage: launch-provider.mjs --role planner|implementer|reviewer|chief_reviewer [--profile name] [--resolve | --validate] | --roles [--profile name] | --profiles";

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

function resolveRole(role, requestedProfileName = null, coordinator = false) {
  if (!ROLE_KEYS.includes(role)) fail(`role must be one of: ${ROLE_KEYS.join(", ")}`);
  const { config, configPath } = loadPipeline();
  const resolved = resolveProfile(config, requestedProfileName);
  const { resolvedRoles, profile, reviewMode, maxSubagents, fullAccess, language } = resolved;
  if (!resolvedRoles[role]) {
    fail(`role ${role} is not configured in profile ${JSON.stringify(profile)}; reviewer and chief_reviewer are optional — add them with orca-pod-setup`);
  }
  const settings = resolvedRoles[role];
  return { ...settings, configPath, profile, role, reviewMode, maxSubagents, fullAccess: coordinator || fullAccess, language,
    policy: resolveRolePolicy(resolved, role), requiredPlannerMode: role === 'planner' && settings.provider === 'codex' ? 'plan' : null,
    runtimeVerified: false };
}

function listRoles(requestedProfileName = null, coordinator = false) {
  const { config, configPath } = loadPipeline();
  const resolved = resolveProfile(config, requestedProfileName);
  const { resolvedRoles, profile, reviewMode, maxSubagents, fullAccess, language } = resolved;
  return {
    configPath, profile, language,
    roles: ROLE_KEYS.filter((name) => resolvedRoles[name]),
    reviewMode, maxSubagents, fullAccess: coordinator || fullAccess,
    settings: Object.fromEntries(Object.entries(resolvedRoles).map(([role, settings]) => [role, {
      ...settings, policy: resolveRolePolicy(resolved, role), requiredPlannerMode: role === 'planner' && settings.provider === 'codex' ? 'plan' : null,
    }])),
  };
}

function optionsFrom(argv) {
  const options = { resolve: false, shouldValidate: false, listRoles: false, listProfiles: false, role: null, profileName: null, coordinator: false, terminalHandle: null };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--coordinator") options.coordinator = true;
    else if (argv[index] === "--terminal" && /^term_[a-z0-9-]+$/i.test(argv[index + 1] ?? "")) options.terminalHandle = argv[++index];
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
    if (options.listRoles || options.role || options.resolve || options.shouldValidate || options.profileName !== null || options.coordinator || options.terminalHandle) {
      fail("--profiles cannot be combined with --roles, --role, --profile, --resolve or --validate");
    }
    return options;
  }
  if (options.listRoles) {
    if (options.role || options.resolve || options.shouldValidate || options.terminalHandle) fail("--roles cannot be combined with --role, --resolve or --validate");
    return options;
  }
  if (!options.role) fail(USAGE);
  if (options.resolve && options.shouldValidate) fail("choose either --resolve or --validate");
  return options;
}

try {
  const options = optionsFrom(process.argv.slice(2));
  if (options.listProfiles) {
    const { config, configPath } = loadPipeline();
    console.log(JSON.stringify({ configPath, configTracked: isTrackedByGit(configPath), ...listProfiles(config) }));
    process.exit(0);
  }
  if (options.listRoles) {
    console.log(JSON.stringify(listRoles(options.profileName, options.coordinator)));
    process.exit(0);
  }
  const settings = resolveRole(options.role, options.profileName, options.coordinator);
  if (settings.requiredPlannerMode && options.coordinator && !options.resolve && !options.shouldValidate && !options.terminalHandle) {
    fail('A Coordinator-launched Codex Planner requires --terminal <handle> for its session-local save hook');
  }
  settings.warnings = [];
  const command = PROVIDER_EXECUTABLES[settings.provider];
  const executable = options.shouldValidate ? null : findExecutable(command) ?? (settings.provider === 'qoder' ? findExecutable('qoder') : null);
  if (!options.shouldValidate && !executable) fail(`provider executable ${JSON.stringify(command)} is not available on PATH or in the usual install folders`);
  if (executable && !executable.onPath) settings.warnings.push(`${command} is not on PATH; using ${displayPath(executable.file)}`);
  const env = envFor(executable);
  const boundedProbe = (args) => {
    const probe = spawnSync(executable.file, args, { env, encoding: 'utf8', timeout: 4000, maxBuffer: 4 * 1024 * 1024 });
    return probe.status === 0 ? probe.stdout : '';
  };
  const probes = executable && ['pi', 'omp', 'qoder'].includes(settings.provider);
  const help = probes ? boundedProbe(['--help']) : '';
  const version = probes ? boundedProbe(['--version']).match(/[0-9]+\.[0-9]+\.[0-9]+/)?.[0] : null;
  const capabilities = getProviderCapabilities(settings.provider, { help, version,
    questions: settings.provider === 'omp' && /^\s+ask\s+-.+interactive/m.test(help) ? 'ask'
      : settings.provider === 'qoder' && version && /^1\.1\.(?:8[1-9]|9[0-9])$/.test(version) ? 'AskUserQuestion' : undefined });
  settings.effectiveAccess = options.shouldValidate ? 'unchecked' : settings.fullAccess ? capabilities.access.kind : 'profile-default';
  settings.delegationEnforcement = capabilities.delegation.kind;
  settings.capabilities = capabilities;
  if (executable && settings.fullAccess && capabilities.access.kind !== 'yolo') {
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
    if (settings.provider === 'pi' && executable) {
      const lensFlags = ['--no-lens-context', '--no-autoformat', '--no-autofix', '--no-tests', '--no-knip', '--no-jscpd', '--no-madge',
        '--no-gitleaks', '--no-govulncheck', '--no-dead-code', '--no-complexity', '--no-opengrep'];
      launch.native.lensFlags = lensFlags.filter((flag) => new RegExp(`^\\s*${flag}\\s`, 'm').test(help));
      if (!launch.native.lensFlags.includes('--no-lens-context')) settings.warnings.push('Pi: session flags for Lens automatic diagnostics were not detected');
    }
    if (options.resolve || options.shouldValidate) {
      console.log(JSON.stringify(settings));
    } else {
      const [, ...args] = providerCommand(settings, { ...settings, skillDir: SKILL_DIR, capabilities, native: launch.native, terminalHandle: options.terminalHandle });
      for (const warning of settings.warnings) console.error(`PIPELINE CONFIG WARNING: ${warning}`);
      const roleEnv = settings.requiredPlannerMode && options.terminalHandle
        ? { ...launch.env, ORCA_POD_PLANNER_TERMINAL: options.terminalHandle }
        : launch.env;
      const result = spawnSync(executable.file, args, { stdio: 'inherit', env: roleEnv });
      if (result.error) throw result.error;
      process.exitCode = result.status ?? 1;
    }
  } finally {
    if (temporary) rmSync(temporary, { recursive: true, force: true });
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`PIPELINE CONFIG ERROR: ${message}`);
  process.exit(2);
}
