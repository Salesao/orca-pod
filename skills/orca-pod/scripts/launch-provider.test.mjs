import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { roleGuard } from "./provider-command.mjs";

const LAUNCHER_PATH = fileURLToPath(new URL("./launch-provider.mjs", import.meta.url));
const TEMPLATE_PATH = fileURLToPath(new URL("../assets/orca-pod.yaml", import.meta.url));
const CODEX_FIXTURE_PATH = fileURLToPath(new URL("./fixtures/codex-debug-models.json", import.meta.url));
const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function runLauncher(templateYaml, { role = "implementer", shouldResolve = true, shouldValidate = false, hasProviderExecutables = true, profileName = null, shouldListRoles = false, shouldListProfiles = false, isLegacyLocation = false, env = {}, codexCache = null } = {}) {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), "orca-launcher-test-"));
  try {
    const executableDirectory = path.join(fixtureRoot, "bin");
    mkdirSync(executableDirectory);
    // The config is at .orca-pod/orca-pod.yaml; isLegacyLocation: "v1" — an old orca-pipeline.yaml in the project root,
    // "v2" — an old .orca-pipeline/orca-pipeline.yaml, "none" — no config anywhere.
    const configFile = isLegacyLocation === "v1" || isLegacyLocation === true ? path.join(fixtureRoot, "orca-pipeline.yaml")
      : isLegacyLocation === "v2" ? path.join(fixtureRoot, ".orca-pipeline", "orca-pipeline.yaml")
        : path.join(fixtureRoot, ".orca-pod", "orca-pod.yaml");
    if (isLegacyLocation !== "none") {
      mkdirSync(path.dirname(configFile), { recursive: true });
      writeFileSync(configFile, templateYaml);
    }
    // Isolate Git discovery and provider launches: the real CLIs are not called.
    // ls-files: FAKE_GIT_TRACKED — the config file is tracked by git (it came with the repository).
    writeFileSync(path.join(executableDirectory, "git"), '#!/bin/sh\nif [ "$3" = ls-files ]; then [ -n "$FAKE_GIT_TRACKED" ] && exit 0; exit 1; fi\npwd -P\n', { mode: 0o755 });
    for (const providerCommand of hasProviderExecutables ? ["pi", "codex", "claude", "omp"] : []) {
      writeFileSync(path.join(executableDirectory, providerCommand), '#!/bin/sh\nprintf "%s\\n" "$@"\n', { mode: 0o755 });
    }
    // The fake codex serves the model catalog on `codex debug models`; FAKE_CODEX_* control the failure and the call marker.
    if (hasProviderExecutables) {
      writeFileSync(path.join(executableDirectory, "codex"), [
        "#!/bin/sh",
        'if [ "$1" = debug ]; then',
        '  [ -n "$FAKE_CODEX_MARKER" ] && : > "$FAKE_CODEX_MARKER"',
        '  [ -n "$FAKE_CODEX_DEBUG_FAIL" ] && exit 1',
        `  /bin/cat ${JSON.stringify(CODEX_FIXTURE_PATH)}`, // the test's PATH holds only the fakes directory
        "  exit 0",
        "fi",
        'printf "%s\\n" "$@"',
        "",
      ].join("\n"), { mode: 0o755 });
    }
    const codexHome = path.join(fixtureRoot, "codex-home");
    mkdirSync(codexHome);
    if (codexCache !== null) writeFileSync(path.join(codexHome, "models_cache.json"), codexCache);
    const modeArguments = shouldListProfiles ? ["--profiles"]
      : shouldListRoles ? ["--roles"]
        : ["--role", role, ...(shouldResolve ? ["--resolve"] : []), ...(shouldValidate ? ["--validate"] : [])];
    return spawnSync(process.execPath, [LAUNCHER_PATH, ...modeArguments, ...(profileName === null ? [] : ["--profile", profileName])], {
      cwd: fixtureRoot,
      env: { ...process.env, PATH: executableDirectory, CODEX_HOME: codexHome, ...env },
      encoding: "utf8",
    });
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

const TEMPLATE_YAML = readFileSync(TEMPLATE_PATH, "utf8");
const COMPLETE_YAML = `active_profile: sol-quality
default_provider: pi
profiles:
  sol-quality:
    roles:
      planner:
        model: openai-codex/gpt-5.6-sol
        thinking: xhigh
      implementer:
        model: zai/glm-5.3-flash
        thinking: high
      reviewer:
        model: openai-codex/gpt-5.6-sol
        thinking: xhigh
`;
const LEGACY_YAML = COMPLETE_YAML
  .replace(/^        subagents:\n(?:[ ]{10,}.*\n)*/gm, "")
  .replace(/^.*use_subagents:.*\n/gm, "");
function withSubagentSetting(rawSetting, role = "implementer") {
  return LEGACY_YAML.replace(`      ${role}:\n`, `      ${role}:\n        use_subagents: ${rawSetting}\n`);
}

for (const [settingName, configurationYaml, shouldUseSubagents] of [
  ["absent", LEGACY_YAML, false],
  ["template", TEMPLATE_YAML, true],
  ["enabled", withSubagentSetting("true"), true],
  ["disabled", withSubagentSetting("false"), false],
  ["with a comment", withSubagentSetting("true # delegate"), true],
]) {
  test(`Subagent mode: ${settingName}`, () => {
    const launcherResult = runLauncher(configurationYaml);
    assert.equal(launcherResult.status, 0, launcherResult.stderr);
    const resolvedImplementer = JSON.parse(launcherResult.stdout);
    assert.equal(resolvedImplementer.shouldUseSubagents, shouldUseSubagents);
    assert.equal(resolvedImplementer.model, "zai/glm-5.3-flash");
    assert.equal(resolvedImplementer.thinking, "high");
    assert.equal(resolvedImplementer.provider, "pi");
  });
}

for (const invalidSetting of ['"true"', "'false'", "yes", "1", "null", "", "True", "[]"]) {
  test(`Invalid value rejected: ${JSON.stringify(invalidSetting)}`, () => {
    const launcherResult = runLauncher(withSubagentSetting(invalidSetting));
    assert.equal(launcherResult.status, 2);
    assert.match(launcherResult.stderr, /use_subagents|not supported/);
    assert.equal(launcherResult.stdout, "");
  });
}

for (const otherRole of ["planner", "reviewer"]) {
  test(`The setting is allowed for role ${otherRole}`, () => {
    const launcherResult = runLauncher(withSubagentSetting("true", otherRole));
    assert.equal(launcherResult.status, 0, launcherResult.stderr);
  });
  test(`Role ${otherRole} gets its own subagent mode`, () => {
    const launcherResult = runLauncher(withSubagentSetting("true"), { role: otherRole });
    assert.equal(launcherResult.status, 0, launcherResult.stderr);
    assert.equal(JSON.parse(launcherResult.stdout).shouldUseSubagents, false);
  });
}

test("The setting is taken only from the active profile", () => {
  const configurationYaml = withSubagentSetting("false") + '\n  inactive:\n    roles:\n      implementer:\n        use_subagents: true\n';
  const launcherResult = runLauncher(configurationYaml);
  assert.equal(launcherResult.status, 0, launcherResult.stderr);
  assert.equal(JSON.parse(launcherResult.stdout).shouldUseSubagents, false);
});

test("Typos remain a configuration error", () => {
  const launcherResult = runLauncher(withSubagentSetting("true").replace("use_subagents", "use_subagent"));
  assert.equal(launcherResult.status, 2);
  assert.match(launcherResult.stderr, /unsupported keys/);
});

test("A repeated setting is rejected", () => {
  const launcherResult = runLauncher(withSubagentSetting("true\n        use_subagents: false"));
  assert.equal(launcherResult.status, 2);
  assert.match(launcherResult.stderr, /duplicate key/);
});

const IMPLEMENTER_GUARD = roleGuard("implementer");
for (const [providerName, expectedArguments] of [
  ["pi", ["-a", "--model", "zai/glm-5.3-flash", "--thinking", "high", "--append-system-prompt", IMPLEMENTER_GUARD]],
  // Codex: effort, the profile's limit of concurrent subagents, the implementer role's orca_* agents and the role guard.
  ["codex", ["--model", "zai/glm-5.3-flash", "--config", 'model_reasoning_effort="high"', "--config", "agents.max_concurrent_threads_per_session=6",
    ...["worker", "scout", "researcher", "verifier"].flatMap((key) => ["--config",
      `agents.orca_${key}.config_file=${JSON.stringify(path.join(SKILL_DIR, "agents", "codex", `${key}.toml`))}`]),
    "--config", `developer_instructions=${JSON.stringify(IMPLEMENTER_GUARD)}`]],
  ["claude-code", ["--model", "zai/glm-5.3-flash", "--effort", "high", "--append-system-prompt", IMPLEMENTER_GUARD]],
  ["claude", ["--model", "zai/glm-5.3-flash", "--effort", "high", "--append-system-prompt", IMPLEMENTER_GUARD]],
  ["omp", ["--model", "zai/glm-5.3-flash", "--thinking", "high"]],
]) {
  test(`The setting does not change the ${providerName} CLI`, () => {
    const configurationYaml = withSubagentSetting("true").replace("default_provider: pi", `default_provider: ${providerName}`);
    // A Pi model in a Codex role would not pass the catalog; only the CLI arguments are checked here — the catalog is unavailable.
    const launcherResult = runLauncher(configurationYaml, { shouldResolve: false, env: { FAKE_CODEX_DEBUG_FAIL: "1" } });
    assert.equal(launcherResult.status, 0, launcherResult.stderr);
    assert.deepEqual(launcherResult.stdout.trimEnd().split("\n"), expectedArguments);
  });
}

function withSubagentModels(subagentYaml, { role = "implementer", shouldUseSubagents = true } = {}) {
  const configurationYaml = withSubagentSetting(String(shouldUseSubagents));
  return configurationYaml.replace(`      ${role}:\n`, `      ${role}:\n        subagents:\n${subagentYaml}`);
}

test("An old file keeps the provider settings for subagents", () => {
  const launcherResult = runLauncher(LEGACY_YAML);
  assert.equal(launcherResult.status, 0, launcherResult.stderr);
  assert.equal(JSON.parse(launcherResult.stdout).subagentSettings, null);
});

test("The template contains explicit inheritance of model and thinking", () => {
  const launcherResult = runLauncher(TEMPLATE_YAML);
  assert.equal(launcherResult.status, 0, launcherResult.stderr);
  assert.deepEqual(JSON.parse(launcherResult.stdout).subagentSettings, {
    worker: { model: "inherit", thinking: "inherit" },
    scout: { model: "inherit", thinking: "low" },
    researcher: { model: "openai-codex/gpt-5.6-sol", thinking: "medium" },
  });
});

for (const shouldUseSubagents of [true, false]) {
  test(`Models and thinking of two roles are kept with use_subagents=${shouldUseSubagents}`, () => {
    const configurationYaml = withSubagentModels(
      "          worker:\n            model: zai/glm-5.3-flash\n            thinking: high\n          scout:\n            model: inherit\n            thinking: low\n",
      { shouldUseSubagents },
    );
    const launcherResult = runLauncher(configurationYaml);
    assert.equal(launcherResult.status, 0, launcherResult.stderr);
    assert.deepEqual(JSON.parse(launcherResult.stdout).subagentSettings, {
      worker: { model: "zai/glm-5.3-flash", thinking: "high" },
      scout: { model: "inherit", thinking: "low" },
    });
    assert.equal(JSON.parse(launcherResult.stdout).shouldUseSubagents, shouldUseSubagents);
  });
}

test("Only worker can be configured without scout", () => {
  const launcherResult = runLauncher(withSubagentModels("          worker:\n            model: inherit\n            thinking: high\n"));
  assert.equal(launcherResult.status, 0, launcherResult.stderr);
  assert.deepEqual(JSON.parse(launcherResult.stdout).subagentSettings, { worker: { model: "inherit", thinking: "high" } });
});

for (const invalidSubagentYaml of [
  "",
  "          worker: false\n",
  "          worker:\n            model: inherit\n",
  "          worker:\n            thinking: high\n",
  "          worker:\n            model: true\n            thinking: high\n",
  "          worker:\n            model: inherit\n            thinking: false\n",
  "          worker:\n            model: null\n            thinking: high\n",
  "          worker:\n            model: inherit\n            thinking: null\n",
  '          worker:\n            model: " "\n            thinking: high\n',
  "          worker:\n            model: inherit\n            thinking: high\n            provider: pi\n",
]) {
  test(`Invalid subagents block rejected: ${JSON.stringify(invalidSubagentYaml)}`, () => {
    const launcherResult = runLauncher(withSubagentModels(invalidSubagentYaml));
    assert.equal(launcherResult.status, 2);
    assert.match(launcherResult.stderr, /roles.implementer.subagents/);
  });
}

// A helper and its thinking from the template: scout for Planner, lens-checker for Reviewer.
for (const [otherRole, helperName, expectedThinking] of [["planner", "scout", "low"], ["reviewer", "lens-checker", "low"]]) {
  test(`The subagents block is allowed for role ${otherRole}`, () => {
    const launcherResult = runLauncher(withSubagentModels("          worker:\n            model: inherit\n            thinking: high\n", { role: otherRole }));
    assert.equal(launcherResult.status, 0, launcherResult.stderr);
  });
  test(`Subagent settings are given to role ${otherRole}`, () => {
    const launcherResult = runLauncher(TEMPLATE_YAML, { role: otherRole });
    assert.equal(launcherResult.status, 0, launcherResult.stderr);
    assert.equal(JSON.parse(launcherResult.stdout).subagentSettings[helperName].thinking, expectedThinking);
  });
}

test("Another profile does not override the active profile's subagent models", () => {
  const configurationYaml = TEMPLATE_YAML + '\n  inactive:\n    roles:\n      implementer:\n        subagents:\n          worker:\n            model: different-model\n            thinking: max\n';
  const launcherResult = runLauncher(configurationYaml);
  assert.equal(launcherResult.status, 0, launcherResult.stderr);
  assert.equal(JSON.parse(launcherResult.stdout).subagentSettings.worker.model, "inherit");
});

test("File validation works without installed providers and does not start a CLI", () => {
  const launcherResult = runLauncher(TEMPLATE_YAML, { shouldResolve: false, shouldValidate: true, hasProviderExecutables: false });
  assert.equal(launcherResult.status, 0, launcherResult.stderr);
  assert.equal(JSON.parse(launcherResult.stdout).subagentSettings.worker.model, "inherit");
});

test("Resolve still requires an installed provider CLI", () => {
  const launcherResult = runLauncher(TEMPLATE_YAML, { hasProviderExecutables: false });
  assert.equal(launcherResult.status, 2);
  assert.match(launcherResult.stderr, /not available on PATH/);
});

test("Validate rejects invalid settings", () => {
  const launcherResult = runLauncher(withSubagentModels(""), { shouldResolve: false, shouldValidate: true, hasProviderExecutables: false });
  assert.equal(launcherResult.status, 2);
  assert.match(launcherResult.stderr, /subagents/);
});

test("validate and resolve cannot be combined", () => {
  const launcherResult = runLauncher(TEMPLATE_YAML, { shouldValidate: true });
  assert.equal(launcherResult.status, 2);
  assert.match(launcherResult.stderr, /either --resolve or --validate/);
});


// Two profiles: the active one on Pi with a Reviewer and a second one on Claude Code with its own default_provider and limit.
const TWO_PROFILES_YAML = `active_profile: sol-quality
default_provider: pi
profiles:
  sol-quality:
    roles:
      planner:
        model: openai-codex/gpt-5.6-sol
        thinking: xhigh
      implementer:
        model: zai/glm-5.3-flash
        thinking: high
      reviewer:
        model: openai-codex/gpt-5.6-sol
        thinking: xhigh
  claude-quality:
    default_provider: claude-code
    max_subagents: 12
    roles:
      planner:
        model: opus
        thinking: max
      implementer:
        model: sonnet
        thinking: high
`;

test("An inactive profile is validated without switching active_profile", () => {
  const launcherResult = runLauncher(TWO_PROFILES_YAML, { shouldResolve: false, shouldValidate: true, profileName: "claude-quality" });
  assert.equal(launcherResult.status, 0, launcherResult.stderr);
  assert.equal(JSON.parse(launcherResult.stdout).profile, "claude-quality");
  assert.equal(JSON.parse(launcherResult.stdout).model, "sonnet");
  const activeResult = runLauncher(TWO_PROFILES_YAML);
  assert.equal(activeResult.status, 0, activeResult.stderr);
  assert.equal(JSON.parse(activeResult.stdout).profile, "sol-quality");
  assert.equal(JSON.parse(activeResult.stdout).model, "zai/glm-5.3-flash");
});

test("A profile is selected for launch and resolve", () => {
  const launched = runLauncher(TWO_PROFILES_YAML, { shouldResolve: false, profileName: "claude-quality" });
  assert.equal(launched.status, 0, launched.stderr);
  assert.deepEqual(launched.stdout.trimEnd().split("\n"), ["--model", "sonnet", "--effort", "high", "--append-system-prompt", IMPLEMENTER_GUARD]);
  const resolved = runLauncher(TWO_PROFILES_YAML, { profileName: "claude-quality" });
  assert.equal(resolved.status, 0, resolved.stderr);
  assert.equal(JSON.parse(resolved.stdout).profile, "claude-quality");
  assert.equal(JSON.parse(resolved.stdout).provider, "claude-code");
});

test("--profiles: the active profile first, summary with full role names", () => {
  const result = runLauncher(TWO_PROFILES_YAML.replace("active_profile: sol-quality", "active_profile: claude-quality"), { shouldListProfiles: true });
  assert.equal(result.status, 0, result.stderr);
  const listing = JSON.parse(result.stdout);
  assert.equal(listing.activeProfile, "claude-quality");
  assert.deepEqual(listing.profiles.map((profile) => [profile.name, profile.isActive, profile.valid]), [
    ["claude-quality", true, true],
    ["sol-quality", false, true],
  ]);
  const [claude, sol] = listing.profiles;
  assert.equal(sol.summary, "Planner: Pi · openai-codex/gpt-5.6-sol · xhigh; Implementer: Pi · zai/glm-5.3-flash · high; Reviewer: Pi · openai-codex/gpt-5.6-sol · xhigh; Chief Reviewer: not configured; review mode reviewer; subagents up to 6");
  assert.equal(claude.summary, "Planner: Claude Code · opus · max; Implementer: Claude Code · sonnet · high; Reviewer: not configured; Chief Reviewer: not configured; review mode self; subagents up to 12");
  assert.deepEqual([claude.defaultProvider, claude.maxSubagents, claude.reviewMode], ["claude-code", 12, "self"]);
  for (const profile of listing.profiles) assert.doesNotMatch(profile.summary, /\bImpl\b|\bRev\b/);
});

for (const [brokenName, brokenYaml, expectedError] of [
  ["without implementer", TWO_PROFILES_YAML.replace(/      implementer:\n        model: sonnet\n        thinking: high\n/, ""), /missing required roles: implementer/],
  ["with max_subagents: 0", TWO_PROFILES_YAML.replace("max_subagents: 12", "max_subagents: 0"), /max_subagents must be an integer from 1 to 100/],
]) {
  test(`--profiles: broken profile ${brokenName} is marked, the others stay available`, () => {
    const result = runLauncher(brokenYaml, { shouldListProfiles: true });
    assert.equal(result.status, 0, result.stderr);
    const [sol, claude] = JSON.parse(result.stdout).profiles;
    assert.equal(sol.valid, true);
    assert.equal(claude.valid, false);
    assert.match(claude.error, expectedError);
    assert.equal(claude.summary, undefined);
  });
}

test("--profiles: the template contains two valid profiles", () => {
  const result = runLauncher(TEMPLATE_YAML, { shouldListProfiles: true });
  assert.equal(result.status, 0, result.stderr);
  const listing = JSON.parse(result.stdout);
  assert.deepEqual(listing.profiles.map((profile) => [profile.name, profile.valid]), [["sol-quality", true], ["claude-quality", true]]);
  assert.equal(listing.profiles[1].defaultProvider, "claude-code");
});

test("--profiles cannot be combined with other modes", () => {
  for (const extra of [["--roles"], ["--role", "planner"], ["--profile", "sol-quality"]]) {
    const result = spawnSync(process.execPath, [LAUNCHER_PATH, "--profiles", ...extra], { encoding: "utf8" });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /--profiles cannot be combined/);
  }
});

function withProfileSetting(line, yaml = COMPLETE_YAML) {
  return yaml.replace("  sol-quality:\n", `  sol-quality:\n    ${line}\n`);
}

for (const [label, configurationYaml, expected] of [
  ["absent", COMPLETE_YAML, 6],
  ["1", withProfileSetting("max_subagents: 1"), 1],
  ["100", withProfileSetting("max_subagents: 100"), 100],
  ["with a comment", withProfileSetting("max_subagents: 20 # large project"), 20],
]) {
  test(`max_subagents ${label} → ${expected}`, () => {
    const listing = runLauncher(configurationYaml, { shouldListRoles: true });
    assert.equal(listing.status, 0, listing.stderr);
    assert.equal(JSON.parse(listing.stdout).maxSubagents, expected);
    const role = runLauncher(configurationYaml, { shouldResolve: false, shouldValidate: true });
    assert.equal(role.status, 0, role.stderr);
    assert.equal(JSON.parse(role.stdout).maxSubagents, expected);
  });
}

for (const invalidLimit of ["0", "101", "6.5", "abc", "-1", "true", "06"]) {
  test(`max_subagents rejected: ${invalidLimit}`, () => {
    const result = runLauncher(withProfileSetting(`max_subagents: ${invalidLimit}`), { shouldListRoles: true });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /max_subagents must be an integer from 1 to 100/);
    assert.equal(result.stdout, "");
  });
}

for (const [label, configurationYaml, expected] of [
  ["absent", COMPLETE_YAML, false],
  ["true", withProfileSetting("full_access: true"), true],
  ["false", withProfileSetting("full_access: false"), false],
]) {
  test(`full_access ${label} → ${expected}`, () => {
    const listing = runLauncher(configurationYaml, { shouldListRoles: true });
    assert.equal(listing.status, 0, listing.stderr);
    assert.equal(JSON.parse(listing.stdout).fullAccess, expected);
    const role = runLauncher(configurationYaml, { shouldResolve: false, shouldValidate: true });
    assert.equal(role.status, 0, role.stderr);
    assert.equal(JSON.parse(role.stdout).fullAccess, expected);
  });
}

for (const invalidValue of ['"true"', "yes", "1", "on"]) {
  test(`full_access rejected: ${invalidValue}`, () => {
    const result = runLauncher(withProfileSetting(`full_access: ${invalidValue}`), { shouldListRoles: true });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /profiles\.sol-quality\.full_access must be an unquoted boolean: true or false/);
  });
}

test("--profiles: configTracked — whether git tracks the config file", () => {
  const own = runLauncher(COMPLETE_YAML, { shouldListProfiles: true });
  assert.equal(own.status, 0, own.stderr);
  assert.equal(JSON.parse(own.stdout).configTracked, false);
  const tracked = runLauncher(COMPLETE_YAML, { shouldListProfiles: true, env: { FAKE_GIT_TRACKED: "1" } });
  assert.equal(tracked.status, 0, tracked.stderr);
  assert.equal(JSON.parse(tracked.stdout).configTracked, true);
});

test("full_access: the profile summary marks full access, without the field it does not", () => {
  const listing = JSON.parse(runLauncher(withProfileSetting("full_access: true"), { shouldListProfiles: true }).stdout);
  assert.match(listing.profiles[0].summary, /; subagents up to 6; full access \(yolo\)$/);
  assert.equal(listing.profiles[0].fullAccess, true);
  const plain = JSON.parse(runLauncher(COMPLETE_YAML, { shouldListProfiles: true }).stdout);
  assert.doesNotMatch(plain.profiles[0].summary, /full access/);
  assert.equal(plain.profiles[0].fullAccess, false);
});

for (const [providerName, flag] of [["codex", "--dangerously-bypass-approvals-and-sandbox"], ["claude-code", "--dangerously-skip-permissions"]]) {
  test(`full_access: true → launching ${providerName} with ${flag}; without the field there is no flag`, () => {
    const yaml = COMPLETE_YAML.replace("default_provider: pi", `default_provider: ${providerName}`).replace("model: zai/glm-5.3-flash", "model: sonnet");
    const launched = runLauncher(withProfileSetting("full_access: true", yaml), { shouldResolve: false, env: { FAKE_CODEX_DEBUG_FAIL: "1" } });
    assert.equal(launched.status, 0, launched.stderr);
    assert.ok(launched.stdout.split("\n").includes(flag), launched.stdout);
    const plain = runLauncher(yaml, { shouldResolve: false, env: { FAKE_CODEX_DEBUG_FAIL: "1" } });
    assert.equal(plain.status, 0, plain.stderr);
    assert.doesNotMatch(plain.stdout, /dangerously/);
  });
}

// language is a root field (next to active_profile): auto or a language tag; in all launcher modes.
const LANGUAGE_ERROR = /language must be "auto" or a language tag like en, ru, pt-BR/;
function withLanguage(line, yaml = COMPLETE_YAML) {
  return yaml.replace("active_profile: sol-quality\n", `active_profile: sol-quality\n${line}\n`);
}

for (const [label, configurationYaml, expected] of [
  ["absent", COMPLETE_YAML, "auto"],
  ["auto", withLanguage("language: auto"), "auto"],
  ["ru", withLanguage("language: ru"), "ru"],
  ["en with a comment", withLanguage("language: en # language of the roles"), "en"],
  ["pt-BR", withLanguage("language: pt-BR"), "pt-BR"],
  ["three-letter language", withLanguage("language: fil"), "fil"],
  ["tag with several parts", withLanguage("language: zh-Hant-TW"), "zh-Hant-TW"],
  // The YAML parser does not remember quotes on strings: "en" and en are the same value to it.
  ["quoted reads the same as unquoted", withLanguage('language: "en"'), "en"],
]) {
  test(`language ${label} → ${expected}`, () => {
    const profiles = runLauncher(configurationYaml, { shouldListProfiles: true });
    assert.equal(profiles.status, 0, profiles.stderr);
    assert.equal(JSON.parse(profiles.stdout).language, expected);
    const roles = runLauncher(configurationYaml, { shouldListRoles: true });
    assert.equal(roles.status, 0, roles.stderr);
    assert.equal(JSON.parse(roles.stdout).language, expected);
    const validated = runLauncher(configurationYaml, { shouldResolve: false, shouldValidate: true });
    assert.equal(validated.status, 0, validated.stderr);
    assert.equal(JSON.parse(validated.stdout).language, expected);
    const resolved = runLauncher(configurationYaml);
    assert.equal(resolved.status, 0, resolved.stderr);
    assert.equal(JSON.parse(resolved.stdout).language, expected);
  });
}

// The \u-escaped value is a Cyrillic word, not a language tag; escapes keep the repository free of Cyrillic outside the Russian-prose fixtures.
for (const invalidLanguage of ["Russian", "EN", "e", "ru_RU", "ru-", "english", "\u0440\u0443\u0441\u0441\u043a\u0438\u0439", "true", "123", "auto-ru", "Auto", '""', ""]) {
  test(`language rejected: ${JSON.stringify(invalidLanguage)}`, () => {
    const yaml = withLanguage(`language: ${invalidLanguage}`);
    for (const mode of [{ shouldListProfiles: true }, { shouldListRoles: true }, { shouldResolve: false, shouldValidate: true }]) {
      const result = runLauncher(yaml, mode);
      assert.equal(result.status, 2, JSON.stringify(mode));
      assert.match(result.stderr, LANGUAGE_ERROR);
      assert.equal(result.stdout, "");
    }
  });
}

test("language: --profiles and --roles return it at the top level, --role as a settings field", () => {
  const yaml = withLanguage("language: pt-BR", TWO_PROFILES_YAML);
  const listing = JSON.parse(runLauncher(yaml, { shouldListProfiles: true }).stdout);
  assert.equal(listing.language, "pt-BR");
  assert.equal(listing.activeProfile, "sol-quality");
  assert.ok(listing.profiles.every((profile) => !("language" in profile)), "language is not a profile field");
  const roles = JSON.parse(runLauncher(yaml, { shouldListRoles: true, profileName: "claude-quality" }).stdout);
  assert.equal(roles.language, "pt-BR");
  assert.ok(Object.values(roles.settings).every((settings) => !("language" in settings)));
  const settings = JSON.parse(runLauncher(yaml, { shouldResolve: false, shouldValidate: true, profileName: "claude-quality" }).stdout);
  assert.equal(settings.language, "pt-BR");
});

test("language: a root error is not hidden behind --profile (it is common to all profiles)", () => {
  const result = runLauncher(withLanguage("language: Russian", TWO_PROFILES_YAML), { shouldResolve: false, shouldValidate: true, profileName: "claude-quality" });
  assert.equal(result.status, 2);
  assert.match(result.stderr, LANGUAGE_ERROR);
});

test("language: the template contains language: auto with a comment", () => {
  assert.match(TEMPLATE_YAML, /^# .*language.*\n(?:# .*\n)*language: auto$/m);
  const listing = JSON.parse(runLauncher(TEMPLATE_YAML, { shouldListProfiles: true }).stdout);
  assert.equal(listing.language, "auto");
});

test("The profile's default_provider overrides the root one", () => {
  const result = runLauncher(withProfileSetting("default_provider: claude-code"), { shouldResolve: false, shouldValidate: true });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).provider, "claude-code");
});

test("An invalid profile name is rejected", () => {
  const yaml = COMPLETE_YAML.replace("active_profile: sol-quality", "active_profile: my profile").replace("  sol-quality:", "  my profile:");
  const result = runLauncher(yaml, { shouldListRoles: true });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /profile name/);
});

test("A Cyrillic profile name is allowed", () => {
  // "cheap" in Russian, spelled with \u escapes so that the repository keeps no Cyrillic outside the Russian-prose fixtures.
  const name = "\u0434\u0435\u0448\u0451\u0432\u044b\u0439";
  const yaml = COMPLETE_YAML.replace("active_profile: sol-quality", `active_profile: ${name}`).replace("  sol-quality:", `  ${name}:`);
  const result = runLauncher(yaml, { shouldListRoles: true });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).profile, name);
});

test("A nonexistent profile is rejected by validate", () => {
  const launcherResult = runLauncher(TEMPLATE_YAML, { shouldResolve: false, shouldValidate: true, profileName: "missing" });
  assert.equal(launcherResult.status, 2);
  assert.match(launcherResult.stderr, /profile "missing"/);
});


for (const nativeAgentName of ["reviewer", "oracle", "delegate", "researcher", "evidence-auditor", "custom-fixer"]) {
  test(`A syntactically valid native agent name is kept: ${nativeAgentName}`, () => {
    const configurationYaml = withSubagentModels(
      `          ${nativeAgentName}:\n            model: inherit\n            thinking: inherit\n`,
    );
    const launcherResult = runLauncher(configurationYaml);
    assert.equal(launcherResult.status, 0, launcherResult.stderr);
    assert.deepEqual(JSON.parse(launcherResult.stdout).subagentSettings[nativeAgentName], {
      model: "inherit",
      thinking: "inherit",
    });
  });
}

for (const invalidAgentName of ["Reviewer", "read-only/reviewer", "2reviewer", "with space"]) {
  test(`An invalid native agent name is rejected: ${JSON.stringify(invalidAgentName)}`, () => {
    const configurationYaml = withSubagentModels(
      `          ${invalidAgentName}:\n            model: inherit\n            thinking: inherit\n`,
    );
    const launcherResult = runLauncher(configurationYaml);
    assert.equal(launcherResult.status, 2);
    assert.match(launcherResult.stderr, /invalid agent names/);
  });
}

// Reviewers are optional: only planner and implementer are required.
const WITHOUT_REVIEWER_YAML = COMPLETE_YAML.replace(/      reviewer:\n(?:[ ]{8,}.*\n)*/g, "");
const CHIEF_REVIEWER_BLOCK = "      chief_reviewer:\n        model: openai-codex/gpt-5.6-sol\n        thinking: xhigh\n";

test("A profile without a Reviewer is valid: the Implementer checks itself (self mode)", () => {
  const result = runLauncher(WITHOUT_REVIEWER_YAML, { shouldResolve: false, shouldValidate: true });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).reviewMode, "self");
});

test("Requesting the unconfigured reviewer role is rejected with a hint about orca-pod-setup", () => {
  const result = runLauncher(WITHOUT_REVIEWER_YAML, { role: "reviewer", shouldResolve: false, shouldValidate: true });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /reviewer and chief_reviewer are optional/);
  assert.match(result.stderr, /orca-pod-setup/);
});

for (const missingRole of ["planner", "implementer"]) {
  test(`A profile without the required role ${missingRole} is rejected`, () => {
    const yaml = COMPLETE_YAML.replace(new RegExp(`      ${missingRole}:\\n(?:[ ]{8,}.*\\n)*`), "");
    const result = runLauncher(yaml, { shouldResolve: false, shouldValidate: true });
    assert.equal(result.status, 2);
    assert.match(result.stderr, new RegExp(`missing required roles: ${missingRole}`));
  });
}

for (const [expectedMode, configurationYaml, expectedRoles] of [
  ["full", COMPLETE_YAML + CHIEF_REVIEWER_BLOCK, ["planner", "implementer", "reviewer", "chief_reviewer"]],
  ["reviewer", COMPLETE_YAML, ["planner", "implementer", "reviewer"]],
  ["chief", WITHOUT_REVIEWER_YAML + CHIEF_REVIEWER_BLOCK, ["planner", "implementer", "chief_reviewer"]],
  ["self", WITHOUT_REVIEWER_YAML, ["planner", "implementer"]],
]) {
  test(`--roles: review mode ${expectedMode}`, () => {
    const result = runLauncher(configurationYaml, { shouldListRoles: true });
    assert.equal(result.status, 0, result.stderr);
    const listing = JSON.parse(result.stdout);
    assert.equal(listing.reviewMode, expectedMode);
    assert.deepEqual(listing.roles, expectedRoles);
  });
}

for (const role of ["planner", "implementer", "reviewer"]) {
  test(`inherit resolves relative to role ${role}`, () => {
    const yaml = COMPLETE_YAML.replace(`      ${role}:\n`, `      ${role}:\n        use_subagents: true\n        subagents:\n          scout:\n            model: inherit\n            thinking: inherit\n`);
    const result = runLauncher(yaml, { role });
    assert.equal(result.status, 0, result.stderr);
    const settings = JSON.parse(result.stdout);
    assert.deepEqual(settings.resolvedSubagentSettings.scout, { model: settings.model, thinking: settings.thinking });
    assert.deepEqual(settings.subagentSettings.scout, { model: "inherit", thinking: "inherit" });
    assert.equal(settings.runtimeVerified, false);
  });
  for (const field of ["model", "thinking"]) {
    for (const value of ["false", "null", "~", "inherit"]) {
      test(`The main role ${role} rejects ${field}: ${value}`, () => {
        const yaml = COMPLETE_YAML.replace(new RegExp(`(${role}:\\n(?:[ ]{8}.*\\n)*?[ ]{8}${field}: )[^\\n]+`), `$1${value}`);
        const result = runLauncher(yaml);
        assert.equal(result.status, 2, result.stdout);
        assert.match(result.stderr, new RegExp(`roles\\.${role}\\.${field}`));
      });
    }
  }
}

test("A schema-only Reviewer is not passed off as a verified runtime Scout", () => {
  const result = runLauncher(COMPLETE_YAML, { role: "reviewer", shouldResolve: false, shouldValidate: true, hasProviderExecutables: false });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).runtimeVerified, false);
});

test("Old file in the root (v1): the launcher does not move it and suggests config-location.mjs migrate", () => {
  const result = runLauncher(TEMPLATE_YAML, { shouldValidate: true, shouldResolve: false, isLegacyLocation: "v1" });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /\.orca-pod\/orca-pod\.yaml/);
  assert.match(result.stderr, /old .*orca-pipeline\.yaml found/);
  assert.match(result.stderr, /config-location\.mjs migrate/);
});

test("Old .orca-pipeline/ directory (v2): the launcher does not move it and suggests config-location.mjs migrate", () => {
  const result = runLauncher(TEMPLATE_YAML, { shouldValidate: true, shouldResolve: false, isLegacyLocation: "v2" });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /\.orca-pod\/orca-pod\.yaml/);
  assert.match(result.stderr, /old .*\.orca-pipeline found/);
  assert.match(result.stderr, /config-location\.mjs migrate/);
});

test("No config anywhere: an error without a migrate hint", () => {
  const result = runLauncher(TEMPLATE_YAML, { shouldValidate: true, shouldResolve: false, isLegacyLocation: "none" });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /missing required file .*\.orca-pod\/orca-pod\.yaml/);
  assert.doesNotMatch(result.stderr, /migrate/);
});

const CODEX_YAML = `active_profile: cx
profiles:
  cx:
    default_provider: codex
    roles:
      planner:
        model: gpt-6-luna
        thinking: high
      implementer:
        model: gpt-6-luna
        thinking: high
        use_subagents: true
        subagents:
          worker:
            model: gpt-5.6-luna
            thinking: low
          scout:
            model: inherit
            thinking: inherit
`;

test("Codex: effort outside the model's levels is rejected at resolve", () => {
  const result = runLauncher(CODEX_YAML.replace("thinking: high\n      implementer", "thinking: ultra\n      implementer"), { role: "planner" });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /roles\.planner\.thinking ultra is not supported by Codex model gpt-6-luna/);
});

for (const [label, model] of [["unknown", "gpt-9"], ["hidden", "gpt-reserve"]]) {
  test(`Codex: a model outside the catalog is rejected (${label})`, () => {
    const result = runLauncher(CODEX_YAML.replace("model: gpt-6-luna\n        thinking: high\n      implementer", `model: ${model}\n        thinking: high\n      implementer`), { role: "planner" });
    assert.equal(result.status, 2);
    assert.match(result.stderr, new RegExp(`roles\\.planner\\.model ${model} is not in the Codex catalog`));
  });
}

test("Codex: a helper on a model of another generation is accepted (agent_type sets the model)", () => {
  const result = runLauncher(CODEX_YAML);
  assert.equal(result.status, 0, result.stderr);
  const settings = JSON.parse(result.stdout);
  assert.deepEqual(settings.resolvedSubagentSettings.worker, { model: "gpt-5.6-luna", thinking: "low" });
  assert.deepEqual(settings.resolvedSubagentSettings.scout, { model: "gpt-6-luna", thinking: "high" });
  assert.deepEqual(settings.warnings, []);
});

test("Codex: a helper's effort outside its model's levels is rejected", () => {
  const result = runLauncher(CODEX_YAML.replace("model: gpt-5.6-luna\n            thinking: low", "model: gpt-6-luna\n            thinking: ultra"));
  assert.equal(result.status, 2);
  assert.match(result.stderr, /roles\.implementer\.subagents\.worker\.thinking ultra is not supported by Codex model gpt-6-luna/);
});

test("Codex: lens-checker is rejected already at validate", () => {
  const result = runLauncher(CODEX_YAML.replace("          scout:", "          lens-checker:\n            model: inherit\n            thinking: inherit\n          scout:"), { shouldResolve: false, shouldValidate: true });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /lens-checker is Pi-only/);
});

test("Codex: catalog unavailable → resolve returns warnings, exit 0", () => {
  const result = runLauncher(CODEX_YAML, { env: { FAKE_CODEX_DEBUG_FAIL: "1" } });
  assert.equal(result.status, 0, result.stderr);
  assert.match(JSON.parse(result.stdout).warnings.join("\n"), /Codex: catalog unavailable — model and effort are not checked/);
});

// The fallback Codex cache may be incomplete: "model missing from the cache" is a warning, not a refusal.
const FIXTURE_CATALOG = JSON.parse(readFileSync(CODEX_FIXTURE_PATH, "utf8"));
const cacheOf = (models) => JSON.stringify({ fetched_at: "2026-10-17T00:00:00Z", ...FIXTURE_CATALOG, models });

test("Codex: debug models failed and the cache lacks the role's model → resolve passes with a warning", () => {
  const cache = cacheOf(FIXTURE_CATALOG.models.filter((model) => model.slug !== "gpt-6-luna"));
  const result = runLauncher(CODEX_YAML, { role: "planner", env: { FAKE_CODEX_DEBUG_FAIL: "1" }, codexCache: cache });
  assert.equal(result.status, 0, result.stderr);
  assert.match(JSON.parse(result.stdout).warnings.join("\n"), /roles\.planner\.model gpt-6-luna is not in the Codex catalog cache.*models_cache\.json/);
});

test("Codex: debug models failed, the model is in the cache, effort outside its levels → error", () => {
  const yaml = CODEX_YAML.replace("thinking: high\n      implementer", "thinking: ultra\n      implementer");
  const result = runLauncher(yaml, { role: "planner", env: { FAKE_CODEX_DEBUG_FAIL: "1" }, codexCache: cacheOf(FIXTURE_CATALOG.models) });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /roles\.planner\.thinking ultra is not supported by Codex model gpt-6-luna/);
});

test("validate does not call codex debug models", () => {
  const marker = path.join(tmpdir(), `orca-codex-marker-${process.pid}-${Date.now()}`);
  try {
    const result = runLauncher(CODEX_YAML, { shouldResolve: false, shouldValidate: true, env: { FAKE_CODEX_MARKER: marker } });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(marker), false);
    const resolved = runLauncher(CODEX_YAML, { env: { FAKE_CODEX_MARKER: marker } });
    assert.equal(resolved.status, 0, resolved.stderr);
    assert.equal(existsSync(marker), true);
  } finally {
    rmSync(marker, { force: true });
  }
});
