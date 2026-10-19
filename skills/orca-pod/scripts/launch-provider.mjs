#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { configLocation, projectLocation } from "./config-location.mjs";
import { displayPath, envFor, findExecutable } from "./find-executable.mjs";
import { assertCodexRole, listProfiles, parsePipelineYaml, PipelineConfigError, resolveProfile, ROLE_KEYS } from "./pipeline-config.mjs";
import { readCodexCatalog } from "./codex-models.mjs";
import { providerCommand } from "./provider-command.mjs";

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

function resolveRole(role, requestedProfileName = null) {
  if (!ROLE_KEYS.includes(role)) fail(`role must be one of: ${ROLE_KEYS.join(", ")}`);
  const { config, configPath } = loadPipeline();
  const { resolvedRoles, profile, reviewMode, maxSubagents, fullAccess, language } = resolveProfile(config, requestedProfileName);
  if (!resolvedRoles[role]) {
    fail(`role ${role} is not configured in profile ${JSON.stringify(profile)}; reviewer and chief_reviewer are optional — add them with orca-pod-setup`);
  }
  return { ...resolvedRoles[role], configPath, profile, role, reviewMode, maxSubagents, fullAccess, language, runtimeVerified: false };
}

function listRoles(requestedProfileName = null) {
  const { config, configPath } = loadPipeline();
  const { resolvedRoles, profile, reviewMode, maxSubagents, fullAccess, language } = resolveProfile(config, requestedProfileName);
  return {
    configPath, profile, language,
    roles: ROLE_KEYS.filter((name) => resolvedRoles[name]),
    reviewMode, maxSubagents, fullAccess,
    settings: resolvedRoles,
  };
}

function optionsFrom(argv) {
  const options = { resolve: false, shouldValidate: false, listRoles: false, listProfiles: false, role: null, profileName: null };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--resolve") options.resolve = true;
    else if (argv[index] === "--validate") options.shouldValidate = true;
    else if (argv[index] === "--roles") options.listRoles = true;
    else if (argv[index] === "--profiles") options.listProfiles = true;
    else if (argv[index] === "--profile" && index + 1 < argv.length) options.profileName = argv[++index];
    else if (argv[index] === "--role" && index + 1 < argv.length) options.role = argv[++index];
    else fail(USAGE);
  }
  if (options.profileName !== null && options.profileName.trim() === "") fail("--profile requires a non-empty profile name");
  if (options.listProfiles) {
    if (options.listRoles || options.role || options.resolve || options.shouldValidate || options.profileName !== null) {
      fail("--profiles cannot be combined with --roles, --role, --profile, --resolve or --validate");
    }
    return options;
  }
  if (options.listRoles) {
    if (options.role || options.resolve || options.shouldValidate) fail("--roles cannot be combined with --role, --resolve or --validate");
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
    console.log(JSON.stringify(listRoles(options.profileName)));
    process.exit(0);
  }
  const settings = resolveRole(options.role, options.profileName);
  const [command, ...args] = providerCommand(settings, { role: settings.role, maxSubagents: settings.maxSubagents, skillDir: SKILL_DIR, fullAccess: settings.fullAccess });
  settings.warnings = [];
  // PATH first, then the usual install folders; a CLI found only there is started by its absolute path.
  const executable = options.shouldValidate ? null : findExecutable(command);
  if (!options.shouldValidate && !executable) fail(`provider executable ${JSON.stringify(command)} is not available on PATH or in the usual install folders`);
  if (executable && !executable.onPath) settings.warnings.push(`${command} is not on PATH; using ${displayPath(executable.file)}`);
  // The model and effort of a Codex role are checked against the Codex catalog; --validate stays a schema check without the CLI.
  if (!options.shouldValidate && settings.provider === "codex") {
    const catalog = readCodexCatalog({ command: executable.file, env: envFor(executable) });
    if (catalog.models.length) settings.warnings.push(...assertCodexRole(settings.role, settings, catalog.models, { isAuthoritative: catalog.authoritative, source: catalog.source }));
    else settings.warnings.push(`Codex: catalog unavailable — model and effort are not checked (${catalog.source})`);
  }

  if (options.resolve || options.shouldValidate) {
    console.log(JSON.stringify(settings));
  } else {
    for (const warning of settings.warnings) console.error(`PIPELINE CONFIG WARNING: ${warning}`);
    const result = spawnSync(executable.file, args, { stdio: "inherit", env: envFor(executable) });
    if (result.error) throw result.error;
    process.exit(result.status ?? 1);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`PIPELINE CONFIG ERROR: ${message}`);
  process.exit(2);
}
