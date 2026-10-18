// Schema of orca-pod.yaml: parsing the file, validating profiles and short summaries for profile selection.
// Shared module of the launcher (scripts/launch-provider.mjs) and the orca-pod-setup form (prefill).

const PROVIDER_ALIASES = new Map([
  ["pi", "pi"],
  ["codex", "codex"],
  ["claude", "claude-code"],
  ["claude-code", "claude-code"],
  ["omp", "omp"],
]);
export const PROVIDER_LABELS = { pi: "Pi", "claude-code": "Claude Code", codex: "Codex", omp: "OMP" };

const ALLOWED_ROOT_KEYS = ["active_profile", "default_provider", "language", "profiles"];
const ALLOWED_PROFILE_KEYS = ["roles", "default_provider", "max_subagents", "full_access"];
const ALLOWED_ROLE_KEYS = ["provider", "model", "thinking"];
const ALLOWED_TERMINAL_ROLE_KEYS = [...ALLOWED_ROLE_KEYS, "use_subagents", "subagents"];
const SUBAGENT_ROLE_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
const ALLOWED_SUBAGENT_KEYS = ["model", "thinking"];
export const ROLE_KEYS = ["planner", "implementer", "reviewer", "chief_reviewer"];
// Helpers a role uses (the form shows them per role, the Codex launcher registers them in the role's session).
export const ROLE_AGENTS = {
  planner: ["scout", "researcher", "oracle"],
  implementer: ["worker", "scout", "researcher", "verifier"],
  reviewer: ["reviewer", "lens-checker", "scout"],
  chief_reviewer: ["reviewer", "evidence-auditor", "lens-checker", "scout"],
};
// Helpers with an agents/codex/<key>.toml file (lens-checker is Pi-only).
export const CODEX_AGENT_KEYS = ["worker", "scout", "researcher", "reviewer", "verifier", "oracle", "evidence-auditor"];
/** Codex agent name: prefixed so as not to shadow the built-in Codex roles (default, worker, explorer). */
export const codexAgentName = (key) => "orca_" + key.replaceAll("-", "_");
export const ROLE_LABELS = { planner: "Planner", implementer: "Implementer", reviewer: "Reviewer", chief_reviewer: "Chief Reviewer" };
// Reviewers are optional: without them the Implementer checks itself (self mode, see SKILL.md).
const REQUIRED_ROLES = ["planner", "implementer"];
// How many subagents one role runs at once (policy — SKILL.md, "Subagents: policy and limits").
export const MAX_SUBAGENTS_DEFAULT = 6;
export const MAX_SUBAGENTS_LIMIT = 100;
// The profile name ends up in the terminal launch command (--profile <name>), so no spaces or quotes.
export const PROFILE_NAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N}._-]{0,63}$/u;
// The roles' language is a root field: "auto" (the language of the user's message) or a language tag: en, ru, pt-BR.
// 2–3 lowercase letters, then optional hyphen-separated parts of 2–8 letters or digits.
export const LANGUAGE_PATTERN = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
export const LANGUAGE_DEFAULT = "auto";
export const isValidLanguage = (value) => typeof value === "string" && (value === LANGUAGE_DEFAULT || LANGUAGE_PATTERN.test(value));
// Claude Code: --effort and the Agent tool's per-call effort accept only these levels;
// the Agent tool's per-call model accepts only aliases, so children use an alias or inherit.
const CLAUDE_CODE_EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"];
const CLAUDE_CODE_CHILD_MODELS = ["inherit", "opus", "sonnet", "haiku", "fable"];

export class PipelineConfigError extends Error {}

function fail(message) {
  throw new PipelineConfigError(message);
}

function mapping(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be a YAML mapping`);
  }
  return value;
}

function scalar(value, label) {
  if (value === null || typeof value === "object" || String(value).trim() === "") {
    fail(`${label} must be a non-empty scalar`);
  }
  return String(value);
}

function roleSetting(value, label) {
  if (typeof value !== "string" || value.trim() === "" || ["null", "~", "inherit"].includes(value.trim())) {
    fail(`${label} must be a non-empty explicit string; inherit is only allowed for subagents`);
  }
  return value.trim();
}

function assertOnlyKeys(value, allowed, label) {
  const invalid = Object.keys(value).filter((key) => !allowed.includes(key));
  if (invalid.length > 0) {
    fail(`${label} has unsupported keys: ${invalid.map((key) => JSON.stringify(key)).join(", ")}`);
  }
}

function has(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function canonicalProvider(value, label) {
  const provider = scalar(value, label).toLowerCase();
  const canonical = PROVIDER_ALIASES.get(provider);
  if (!canonical) {
    fail(`${label} must be one of: ${[...new Set(PROVIDER_ALIASES.values())].join(", ")}`);
  }
  return canonical;
}

function stripComment(line) {
  let quote = null;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quote === '"') {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
    } else if (quote === "'") {
      if (character === quote) quote = null;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === "#" && (index === 0 || /\s/.test(line[index - 1]))) {
      return line.slice(0, index).trimEnd();
    }
  }
  if (quote) fail("unterminated quoted scalar");
  return line.trimEnd();
}

function parseScalar(raw, lineNumber) {
  const value = raw.trim();
  if (value === "") return "";
  if (/^[\[{|>&*!]/.test(value)) {
    fail(`line ${lineNumber}: lists, flow values, anchors, aliases, tags, and block scalars are not supported`);
  }
  if (value.startsWith('"')) {
    if (!value.endsWith('"')) fail(`line ${lineNumber}: malformed double-quoted scalar`);
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed !== "string") fail(`line ${lineNumber}: scalar must be a string`);
      return parsed;
    } catch {
      fail(`line ${lineNumber}: malformed double-quoted scalar`);
    }
  }
  if (value.startsWith("'")) {
    if (!value.endsWith("'")) fail(`line ${lineNumber}: malformed single-quoted scalar`);
    return value.slice(1, -1).replaceAll("''", "'");
  }
  return value;
}

export function parsePipelineYaml(source) {
  const root = Object.create(null);
  const stack = [{ indent: -1, value: root }];
  const lines = source.replace(/^﻿/, "").split(/\r?\n/);

  lines.forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const withoutComment = stripComment(rawLine);
    if (withoutComment.trim() === "") return;

    const indentation = withoutComment.match(/^[ \t]*/)[0];
    if (indentation.includes("\t")) fail(`line ${lineNumber}: tabs are not allowed for indentation`);
    const indent = indentation.length;
    if (stack.length === 1 && indent !== 0) fail(`line ${lineNumber}: document root must not be indented`);

    const content = withoutComment.slice(indent);
    const match = content.match(/^(.+?):(?:[ \t]*(.*))?$/);
    if (!match) fail(`line ${lineNumber}: expected mapping entry in the form key: value`);

    const key = parseScalar(match[1], lineNumber).trim();
    if (key === "") fail(`line ${lineNumber}: mapping key must be non-empty`);
    const rawValue = match[2] ?? "";

    while (indent <= stack.at(-1).indent) stack.pop();
    const parent = stack.at(-1).value;
    if (has(parent, key)) fail(`line ${lineNumber}: duplicate key ${JSON.stringify(key)}`);

    if (rawValue.trim() === "") {
      const child = Object.create(null);
      parent[key] = child;
      stack.push({ indent, value: child });
    } else {
      const normalizedScalar = rawValue.trim();
      parent[key] = normalizedScalar === "true" || normalizedScalar === "false"
        ? normalizedScalar === "true"
        : parseScalar(rawValue, lineNumber);
    }
  });

  return root;
}

function parseSubagentSettings(rawSubagentSettings, parentRole) {
  const parentPath = `roles.${parentRole}.subagents`;
  const configuredSubagents = mapping(rawSubagentSettings, parentPath);
  const invalidRoles = Object.keys(configuredSubagents).filter(role => !SUBAGENT_ROLE_PATTERN.test(role));
  if (invalidRoles.length > 0) fail(`${parentPath} has invalid agent names: ${invalidRoles.map(role => JSON.stringify(role)).join(", ")}`);
  if (Object.keys(configuredSubagents).length === 0) {
    fail(`${parentPath} must declare at least one native-agent name; omit the block for provider defaults`);
  }
  const subagentSettings = Object.create(null);
  for (const [subagentRole, rawRoleSettings] of Object.entries(configuredSubagents)) {
    const settingPath = `${parentPath}.${subagentRole}`;
    const configuredRole = mapping(rawRoleSettings, settingPath);
    assertOnlyKeys(configuredRole, ALLOWED_SUBAGENT_KEYS, settingPath);
    const validatedRole = Object.create(null);
    for (const settingName of ALLOWED_SUBAGENT_KEYS) {
      const rawSetting = has(configuredRole, settingName) ? configuredRole[settingName] : null;
      if (typeof rawSetting !== "string" || rawSetting.trim() === "" || ["null", "~"].includes(rawSetting.trim())) {
        fail(`${settingPath}.${settingName} must be a non-empty string or inherit`);
      }
      validatedRole[settingName] = rawSetting.trim();
    }
    subagentSettings[subagentRole] = validatedRole;
  }
  return subagentSettings;
}

function assertClaudeCodeRole(roleName, roleSettings) {
  if (!CLAUDE_CODE_EFFORT_LEVELS.includes(roleSettings.thinking)) {
    fail(`roles.${roleName}.thinking must be one of ${CLAUDE_CODE_EFFORT_LEVELS.join(", ")} for provider claude-code`);
  }
  for (const [agent, child] of Object.entries(roleSettings.subagentSettings ?? {})) {
    const settingPath = `roles.${roleName}.subagents.${agent}`;
    if (!CLAUDE_CODE_CHILD_MODELS.includes(child.model)) {
      fail(`${settingPath}.model must be one of ${CLAUDE_CODE_CHILD_MODELS.join(", ")} for provider claude-code`);
    }
    if (child.thinking !== "inherit" && !CLAUDE_CODE_EFFORT_LEVELS.includes(child.thinking)) {
      fail(`${settingPath}.thinking must be inherit or one of ${CLAUDE_CODE_EFFORT_LEVELS.join(", ")} for provider claude-code`);
    }
  }
}

// lens-checker is the pi-lens helper, available only in Pi.
function assertCodexSchema(roleName, roleSettings) {
  if (roleSettings.subagentSettings && has(roleSettings.subagentSettings, "lens-checker")) {
    fail(`roles.${roleName}.subagents.lens-checker: lens-checker is Pi-only`);
  }
}

/**
 * A Codex role against the Codex catalog (codex-models.mjs): the model is visible in the Codex picker, the effort is among its levels;
 * the same for helpers after inherit is expanded. The multi-agent generation is not checked: helpers are launched
 * with agent_type, and then Codex takes the given model of any generation.
 */
// Checks a Codex role against the catalog; returns warnings. For a non-authoritative catalog (the Codex cache
// may be incomplete) a missing model is a warning; the effort of a found model is checked strictly.
export function assertCodexRole(roleName, roleSettings, catalog, { isAuthoritative = true, source = "" } = {}) {
  const visible = new Map(catalog.filter((model) => model.visible).map((model) => [model.id, model]));
  const warnings = [];
  const check = (model, thinking, settingPath) => {
    const known = visible.get(model);
    if (!known) {
      if (isAuthoritative) fail(`${settingPath}.model ${model} is not in the Codex catalog`);
      warnings.push(`${settingPath}.model ${model} is not in the Codex catalog cache — model and effort are not checked (${source})`);
      return;
    }
    if (!known.levels.includes(thinking)) {
      fail(`${settingPath}.thinking ${thinking} is not supported by Codex model ${model} (supported: ${known.levels.join(", ")})`);
    }
  };
  check(roleSettings.model, roleSettings.thinking, `roles.${roleName}`);
  for (const [agent, child] of Object.entries(roleSettings.resolvedSubagentSettings ?? {})) {
    check(child.model, child.thinking, `roles.${roleName}.subagents.${agent}`);
  }
  return warnings;
}

function maxSubagentsOf(profile, profileName) {
  if (!has(profile, "max_subagents")) return MAX_SUBAGENTS_DEFAULT;
  const raw = profile.max_subagents;
  const value = typeof raw === "string" && /^[1-9][0-9]*$/.test(raw.trim()) ? Number(raw.trim()) : NaN;
  if (!(value >= 1 && value <= MAX_SUBAGENTS_LIMIT)) {
    fail(`profiles.${profileName}.max_subagents must be an integer from 1 to ${MAX_SUBAGENTS_LIMIT} (default ${MAX_SUBAGENTS_DEFAULT})`);
  }
  return value;
}

// full_access: true — Codex and Claude Code roles start without confirmations and sandbox (yolo, see provider-command.mjs).
function fullAccessOf(profile, profileName) {
  if (!has(profile, "full_access")) return false;
  if (typeof profile.full_access !== "boolean") fail(`profiles.${profileName}.full_access must be an unquoted boolean: true or false`);
  return profile.full_access;
}

// No field — auto. The YAML parser does not tell a quoted "en" from en: both are the string en.
function languageOf(config) {
  if (!has(config, "language")) return LANGUAGE_DEFAULT;
  if (!isValidLanguage(config.language)) fail('language must be "auto" or a language tag like en, ru, pt-BR');
  return config.language;
}

// Document root: errors here make all profiles unavailable at once.
function rootOf(config) {
  assertOnlyKeys(config, ALLOWED_ROOT_KEYS, "document root");
  const language = languageOf(config);
  const activeProfile = scalar(has(config, "active_profile") ? config.active_profile : null, "active_profile");
  const profiles = mapping(has(config, "profiles") ? config.profiles : null, "profiles");
  if (Object.keys(profiles).some((name) => name.trim() === "")) fail("profile names must be non-empty strings");
  if (!has(profiles, activeProfile)) fail(`active_profile ${JSON.stringify(activeProfile)} is not declared`);
  const rootDefaultProvider = has(config, "default_provider") ? canonicalProvider(config.default_provider, "default_provider") : "pi";
  return { activeProfile, profiles, rootDefaultProvider, language };
}

// full — Reviewer + Chief Reviewer; reviewer/chief — the single reviewer runs the batch review
// and issues the final verdict; self — no reviewers, the Implementer checks itself with static analysis.
export function reviewModeOf(roles) {
  const reviewer = Boolean(roles.reviewer);
  const chief = Boolean(roles.chief_reviewer);
  if (reviewer && chief) return "full";
  if (reviewer) return "reviewer";
  if (chief) return "chief";
  return "self";
}

/** Validates one profile (active_profile by default) and expands the settings of its roles. */
export function resolveProfile(config, requestedProfileName = null) {
  const { activeProfile, profiles, rootDefaultProvider, language } = rootOf(config);
  const profileName = requestedProfileName ?? activeProfile;
  if (!PROFILE_NAME_PATTERN.test(profileName)) {
    fail(`profile name ${JSON.stringify(profileName)} must start with a letter or digit and contain only letters, digits, ".", "_" or "-" (up to 64 characters)`);
  }
  const label = `profile ${JSON.stringify(profileName)}`;
  const profile = mapping(has(profiles, profileName) ? profiles[profileName] : null, label);
  assertOnlyKeys(profile, ALLOWED_PROFILE_KEYS, label);
  const roles = mapping(has(profile, "roles") ? profile.roles : null, "roles");
  assertOnlyKeys(roles, ROLE_KEYS, "roles");

  const missing = REQUIRED_ROLES.filter((name) => !has(roles, name));
  if (missing.length > 0) fail(`${label} is missing required roles: ${missing.join(", ")}; old values will not be overwritten`);

  const defaultProvider = has(profile, "default_provider")
    ? canonicalProvider(profile.default_provider, `profiles.${profileName}.default_provider`)
    : rootDefaultProvider;
  const maxSubagents = maxSubagentsOf(profile, profileName);
  const fullAccess = fullAccessOf(profile, profileName);
  const resolvedRoles = Object.create(null);
  for (const [name, settings] of Object.entries(roles)) {
    const roleSettings = mapping(settings, `roles.${name}`);
    assertOnlyKeys(roleSettings, ALLOWED_TERMINAL_ROLE_KEYS, `roles.${name}`);
    resolvedRoles[name] = {
      provider: has(roleSettings, "provider") ? canonicalProvider(roleSettings.provider, `roles.${name}.provider`) : defaultProvider,
      model: roleSetting(has(roleSettings, "model") ? roleSettings.model : null, `roles.${name}.model`),
      thinking: roleSetting(has(roleSettings, "thinking") ? roleSettings.thinking : null, `roles.${name}.thinking`),
    };
    const shouldUseSubagents = has(roleSettings, "use_subagents") ? roleSettings.use_subagents : false;
    if (typeof shouldUseSubagents !== "boolean") {
      fail(`roles.${name}.use_subagents must be an unquoted boolean: true or false`);
    }
    resolvedRoles[name].shouldUseSubagents = shouldUseSubagents;
    resolvedRoles[name].subagentSettings = has(roleSettings, "subagents")
      ? parseSubagentSettings(roleSettings.subagents, name)
      : null;
    if (resolvedRoles[name].provider === "claude-code") assertClaudeCodeRole(name, resolvedRoles[name]);
    if (resolvedRoles[name].provider === "codex") assertCodexSchema(name, resolvedRoles[name]);
    // These are resolved requests, not observed runtime model/effort values.
    // Native-tool compatibility and role capabilities need session preflight.
    resolvedRoles[name].resolvedSubagentSettings = resolvedRoles[name].subagentSettings === null ? null : Object.fromEntries(
      Object.entries(resolvedRoles[name].subagentSettings).map(([agent, requested]) => [agent, {
        model: requested.model === "inherit" ? resolvedRoles[name].model : requested.model,
        thinking: requested.thinking === "inherit" ? resolvedRoles[name].thinking : requested.thinking,
      }]),
    );
  }

  return { profile: profileName, language, defaultProvider, maxSubagents, fullAccess, reviewMode: reviewModeOf(resolvedRoles), resolvedRoles };
}

/** One line for the Coordinator's question: roles by full names, agent · model · thinking, review mode and limit. */
export function profileSummary(resolved) {
  const roles = ROLE_KEYS.map((role) => {
    const settings = resolved.resolvedRoles[role];
    return `${ROLE_LABELS[role]}: ${settings ? `${PROVIDER_LABELS[settings.provider]} · ${settings.model} · ${settings.thinking}` : "not configured"}`;
  });
  return [...roles, `review mode ${resolved.reviewMode}`, `subagents up to ${resolved.maxSubagents}`, ...(resolved.fullAccess ? ["full access (yolo)"] : [])].join("; ");
}

/** All profiles of the file: the active one first, then in file order. A profile's error does not hide the others. */
export function listProfiles(config) {
  const { activeProfile, profiles, language } = rootOf(config);
  const names = [activeProfile, ...Object.keys(profiles).filter((name) => name !== activeProfile)];
  return {
    activeProfile,
    language,
    profiles: names.map((name) => {
      const isActive = name === activeProfile;
      try {
        const resolved = resolveProfile(config, name);
        return {
          name, isActive, valid: true,
          defaultProvider: resolved.defaultProvider,
          maxSubagents: resolved.maxSubagents,
          fullAccess: resolved.fullAccess,
          reviewMode: resolved.reviewMode,
          roles: Object.fromEntries(Object.entries(resolved.resolvedRoles).map(([role, settings]) => [role, {
            provider: settings.provider, model: settings.model, thinking: settings.thinking, useSubagents: settings.shouldUseSubagents,
          }])),
          summary: profileSummary(resolved),
        };
      } catch (error) {
        if (!(error instanceof PipelineConfigError)) throw error;
        return { name, isActive, valid: false, error: error.message };
      }
    }),
  };
}
