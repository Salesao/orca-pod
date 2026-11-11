import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { providerCommand, roleGuard } from "./provider-command.mjs";
import { getProviderCapabilities } from "./provider-capabilities.mjs";
import { codexAgentName, ROLE_AGENTS } from "./pipeline-config.mjs";

const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CODEX_AGENTS_DIR = path.join(SKILL_DIR, "agents", "codex");
const role = (provider, overrides = {}) => ({
  provider, model: "example", thinking: "high", shouldUseSubagents: true, ...overrides,
});
const options = { role: "implementer", maxSubagents: 6, skillDir: SKILL_DIR };
const registrations = (argv) => argv.filter((value) => /^agents\.[^.]+\.config_file=/.test(value)).map((value) => value.split(".")[1]);
const evidence = {
  pi: "--exclude-tools",
  qoder: "--append-system-prompt --agents --disallowed-tools --dangerously-skip-permissions --list-models",
  omp: "--append-system-prompt --tools --config --approval-mode=yolo --thinking",
};
test("Codex registers precisely the explicit selection; verifier is only available in self", () => {
  const custom = role("codex", { subagentSettings: { "custom-ops": { model: "inherit", thinking: "inherit" } } });
  assert.deepEqual(registrations(providerCommand(custom, options)), ["orca_custom_ops"]);
  const explicitVerifier = role("codex", { subagentSettings: { verifier: { model: "inherit", thinking: "inherit" } } });
  for (const reviewMode of ["full", "reviewer", "chief"]) {
    assert.deepEqual(registrations(providerCommand(explicitVerifier, { ...options, reviewMode })), []);
    assert.deepEqual(registrations(providerCommand(role("codex"), { ...options, reviewMode })), ["orca_worker", "orca_scout"]);
  }
  assert.deepEqual(registrations(providerCommand(role("codex"), { ...options, reviewMode: "self" })), ["orca_worker", "orca_scout", "orca_verifier"]);
});

test("Codex Planner preserves effort in Plan and starts without a fake Plan or question flag", () => {
  const args = providerCommand(role("codex"), { ...options, role: "planner", maxSubagents: 12 });
  assert.ok(args.includes('plan_mode_reasoning_effort="high"'));
  assert.ok(args.includes("agents.max_concurrent_threads_per_session=12"));
  assert.ok(args.includes("agents.max_depth=1"));
  assert.ok(args.includes("--no-alt-screen"));
  assert.doesNotMatch(args.join(" "), /--plan|default_mode_request_user_input/);
  assert.ok(!providerCommand(role("codex"), options).some((arg) => arg.startsWith("plan_mode_reasoning_effort")));
});

test("full access and disabled delegation stay independent for all five providers", () => {
  for (const [provider, accessFlag, filter] of [
    ["codex", "--dangerously-bypass-approvals-and-sandbox", "--disable"],
    ["claude-code", "--dangerously-skip-permissions", "--disallowed-tools"],
    ["qoder", "--dangerously-skip-permissions", "--disallowed-tools"],
    ["omp", "--approval-mode=yolo", "--tools"],
    ["pi", null, "--exclude-tools"],
  ]) {
    const capabilities = getProviderCapabilities(provider, { help: evidence[provider] });
    const settings = role(provider, { shouldUseSubagents: false, thinking: ["qoder", "omp"].includes(provider) ? "default" : "high" });
    const args = providerCommand(settings, { ...options, capabilities, fullAccess: true });
    assert.ok(args.includes(filter), provider);
    assert.match(args.join(" "), /Delegation is disabled/);
    if (accessFlag) assert.ok(args.includes(accessFlag), provider);
    if (settings.thinking === "default") assert.ok(!args.includes("--thinking"), provider);
    assert.ok(!args.includes("--agents"), provider);
    assert.deepEqual(registrations(args), []);
  }
});

test("role guard is a single line and names both the role and the Coordinator boundary", () => {
  const guard = roleGuard("implementer", { useSubagents: false });
  assert.match(guard, /Implementer role.*not the Coordinator/);
  assert.match(guard, /Do not spawn.*other CLIs/);
  assert.doesNotMatch(guard, /\n/);
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
