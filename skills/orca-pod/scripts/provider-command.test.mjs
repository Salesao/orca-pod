import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { CODEX_ASK_FEATURE, providerCommand, roleGuard } from "./provider-command.mjs";
import { codexAgentName, ROLE_AGENTS } from "./pipeline-config.mjs";

const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CODEX_AGENTS_DIR = path.join(SKILL_DIR, "agents", "codex");

const codexRole = (overrides = {}) => ({
  provider: "codex", model: "gpt-6-luna", thinking: "high", shouldUseSubagents: true, subagentSettings: null, ...overrides,
});
const flagValues = (command) => command.flatMap((arg, index) => (command[index - 1] === "--config" ? [arg] : []));

test("codex: effort and the limit N in the command", () => {
  const command = providerCommand(codexRole(), { role: "planner", maxSubagents: 12, skillDir: SKILL_DIR });
  assert.deepEqual(command.slice(0, 3), ["codex", "--model", "gpt-6-luna"]);
  assert.ok(flagValues(command).includes('model_reasoning_effort="high"'));
  assert.ok(flagValues(command).includes("agents.max_concurrent_threads_per_session=12"));
});

test("codex: use_subagents false → agents.enabled=false and no config_file", () => {
  const values = flagValues(providerCommand(codexRole({ shouldUseSubagents: false }), { role: "implementer", maxSubagents: 6, skillDir: SKILL_DIR }));
  assert.ok(values.includes("agents.enabled=false"));
  assert.equal(values.some((value) => value.includes(".config_file=")), false);
});

test("codex: a self-mode implementer registers orca_worker, orca_scout, orca_researcher, orca_verifier and does not register lens-checker", () => {
  const values = flagValues(providerCommand(codexRole(), { role: "implementer", maxSubagents: 6, skillDir: SKILL_DIR, reviewMode: "self" }));
  const registered = values.filter((value) => value.includes(".config_file=")).map((value) => value.split(".")[1]);
  assert.deepEqual(registered, ["orca_worker", "orca_scout", "orca_researcher", "orca_verifier"]);
  assert.ok(values.includes(`agents.orca_worker.config_file=${JSON.stringify(path.join(CODEX_AGENTS_DIR, "worker.toml"))}`));
  const chief = flagValues(providerCommand(codexRole(), { role: "chief_reviewer", maxSubagents: 6, skillDir: SKILL_DIR }));
  assert.equal(chief.some((value) => value.includes("lens")), false);
  assert.ok(chief.some((value) => value.startsWith("agents.orca_evidence_auditor.config_file=")));
});

// A full-mode Implementer audited its own stage with six verifiers before REVIEW_REQUEST (2026-10-21);
// with reviewers the code is theirs to check, so a Codex Implementer does not get orca_verifier at all.
test("codex: with reviewers the implementer gets no orca_verifier, even one listed in the config", () => {
  const configured = codexRole({ subagentSettings: { verifier: { model: "inherit", thinking: "inherit" } } });
  for (const reviewMode of ["full", "reviewer", "chief"]) {
    for (const settings of [codexRole(), configured]) {
      const values = flagValues(providerCommand(settings, { role: "implementer", maxSubagents: 6, skillDir: SKILL_DIR, reviewMode }));
      const registered = values.filter((value) => value.includes(".config_file=")).map((value) => value.split(".")[1]);
      assert.deepEqual(registered, ["orca_worker", "orca_scout", "orca_researcher"], reviewMode);
    }
  }
});

test("codex: a helper from the config outside ROLE_AGENTS is registered too", () => {
  const settings = codexRole({ subagentSettings: { oracle: { model: "inherit", thinking: "inherit" } } });
  const values = flagValues(providerCommand(settings, { role: "implementer", maxSubagents: 6, skillDir: SKILL_DIR }));
  assert.ok(values.some((value) => value.startsWith("agents.orca_oracle.config_file=")));
});

test("codex: a path with a space and a quote is escaped as a TOML string", () => {
  const skillDir = '/tmp/a b/"q"\\x';
  const values = flagValues(providerCommand(codexRole(), { role: "planner", maxSubagents: 6, skillDir }));
  const value = values.find((item) => item.startsWith("agents.orca_scout.config_file="));
  assert.equal(value, 'agents.orca_scout.config_file="/tmp/a b/\\"q\\"\\\\x/agents/codex/scout.toml"');
});

test("pi/claude-code/omp: v1 arguments and the role guard via --append-system-prompt (omp has none)", () => {
  const base = { model: "zai/glm-5.3-flash", thinking: "high", shouldUseSubagents: true, subagentSettings: null };
  const options = { role: "implementer", maxSubagents: 6, skillDir: SKILL_DIR };
  const guard = roleGuard("implementer");
  assert.deepEqual(providerCommand({ ...base, provider: "pi" }, options), ["pi", "-a", "--model", "zai/glm-5.3-flash", "--thinking", "high", "--append-system-prompt", guard]);
  assert.deepEqual(providerCommand({ ...base, provider: "claude-code" }, options), ["claude", "--model", "zai/glm-5.3-flash", "--effort", "high", "--append-system-prompt", guard]);
  assert.deepEqual(providerCommand({ ...base, provider: "omp" }, options), ["omp", "--model", "zai/glm-5.3-flash", "--thinking", "high"]);
});

test("roleGuard: names the role, says \"not the Coordinator\", what not to run and which SKILL.md sections apply; one line", () => {
  for (const [role, label] of [["planner", "Planner"], ["implementer", "Implementer"], ["reviewer", "Reviewer"], ["chief_reviewer", "Chief Reviewer"]]) {
    const guard = roleGuard(role);
    assert.ok(guard.includes(`${label} role`), guard);
    assert.match(guard, /not the Coordinator/);
    for (const forbidden of ["terminal create", "launch-provider.mjs", "test-sandbox.mjs"]) assert.ok(guard.includes(forbidden), forbidden);
    for (const section of ["Role, not Coordinator", "Test mode"]) assert.ok(guard.includes(`"${section}"`), section);
    assert.doesNotMatch(guard, /\n/);
  }
});

test("roleGuard: the SKILL.md sections it points at exist", () => {
  const skill = readFileSync(path.join(SKILL_DIR, "SKILL.md"), "utf8");
  assert.ok(skill.includes("**Role, not Coordinator.**"));
  assert.match(skill, /^## Test mode\b/m);
});

test("codex: the role guard is developer_instructions as a TOML string", () => {
  const values = flagValues(providerCommand(codexRole(), { role: "planner", maxSubagents: 6, skillDir: SKILL_DIR }));
  assert.ok(values.includes(`developer_instructions=${JSON.stringify(roleGuard("planner"))}`), values.join("\n"));
});

test("fullAccess: codex — --dangerously-bypass-approvals-and-sandbox, claude-code — --dangerously-skip-permissions", () => {
  const options = { role: "implementer", maxSubagents: 6, skillDir: SKILL_DIR };
  const claude = { provider: "claude-code", model: "sonnet", thinking: "high", shouldUseSubagents: true, subagentSettings: null };
  assert.ok(providerCommand(codexRole(), { ...options, fullAccess: true }).includes("--dangerously-bypass-approvals-and-sandbox"));
  assert.ok(providerCommand(claude, { ...options, fullAccess: true }).includes("--dangerously-skip-permissions"));
  for (const settings of [codexRole(), claude]) {
    const command = providerCommand(settings, options).join(" ");
    assert.doesNotMatch(command, /dangerously/, "no flag without fullAccess");
  }
});

// The Planner asks the plan-blitz questions through request_user_input, which Codex's default mode has only behind this feature.
const enabledFeatures = (command) => command.flatMap((arg, index) => (command[index - 1] === "--enable" ? [arg] : []));

test("codex planner: --enable default_mode_request_user_input", () => {
  assert.equal(CODEX_ASK_FEATURE, "default_mode_request_user_input");
  const command = providerCommand(codexRole(), { role: "planner", maxSubagents: 6, skillDir: SKILL_DIR });
  assert.deepEqual(enabledFeatures(command), ["default_mode_request_user_input"]);
});

test("codex implementer, reviewer, chief_reviewer: no --enable (they ask the user nothing)", () => {
  for (const role of ["implementer", "reviewer", "chief_reviewer"]) {
    assert.ok(!providerCommand(codexRole(), { role, maxSubagents: 6, skillDir: SKILL_DIR }).includes("--enable"), role);
  }
});

test("codex planner with fullAccess: the feature and the bypass flag are both present", () => {
  const command = providerCommand(codexRole(), { role: "planner", maxSubagents: 6, skillDir: SKILL_DIR, fullAccess: true });
  assert.deepEqual(enabledFeatures(command), ["default_mode_request_user_input"]);
  assert.ok(command.includes("--dangerously-bypass-approvals-and-sandbox"));
});

test("pi and claude-code planners: no --enable (their question tools need no flag)", () => {
  const base = { model: "sonnet", thinking: "high", shouldUseSubagents: true, subagentSettings: null };
  for (const provider of ["pi", "claude-code"]) {
    assert.ok(!providerCommand({ ...base, provider }, { role: "planner", maxSubagents: 6, skillDir: SKILL_DIR }).includes("--enable"), provider);
  }
});

test("fullAccess: pi and omp are unchanged (they have no permission prompts)", () => {
  const base = { model: "zai/glm-5.3-flash", thinking: "high", shouldUseSubagents: true, subagentSettings: null };
  const options = { role: "implementer", maxSubagents: 6, skillDir: SKILL_DIR };
  for (const provider of ["pi", "omp"]) {
    assert.deepEqual(providerCommand({ ...base, provider }, { ...options, fullAccess: true }), providerCommand({ ...base, provider }, options));
  }
});

test("agents/codex: 7 files, name = codexAgentName(file), description and developer_instructions present, no model or model_reasoning_effort", () => {
  const files = readdirSync(CODEX_AGENTS_DIR).filter((file) => file.endsWith(".toml")).sort();
  assert.deepEqual(files, ["evidence-auditor.toml", "oracle.toml", "researcher.toml", "reviewer.toml", "scout.toml", "verifier.toml", "worker.toml"]);
  for (const file of files) {
    const text = readFileSync(path.join(CODEX_AGENTS_DIR, file), "utf8");
    assert.match(text, new RegExp(`^name = "${codexAgentName(path.basename(file, ".toml"))}"$`, "m"), file);
    assert.match(text, /^description = ".+"$/m, file);
    assert.match(text, /^developer_instructions = '''$/m, file);
    assert.doesNotMatch(text, /^(model|model_reasoning_effort)\s*=/m, file);
    assert.match(text, /Do not spawn subagents/, file);
  }
  for (const agents of Object.values(ROLE_AGENTS)) {
    for (const key of agents.filter((name) => name !== "lens-checker")) assert.ok(files.includes(`${key}.toml`), key);
  }
});
