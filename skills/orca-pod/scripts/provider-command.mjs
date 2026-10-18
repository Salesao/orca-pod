// Launch command of a pipeline role in its provider (Pi, Claude Code, Codex, OMP).
// Codex: effort, the limit of concurrent subagents and the orca_* agents from agents/codex/ — only in the role's session.
// The role guard is the session's system instruction: a role that has read SKILL.md does not execute the Coordinator steps.
// fullAccess (the profile's full_access) removes confirmation prompts and the sandbox for Codex and Claude Code.
// A Codex Planner asks the plan-blitz questions through request_user_input, available in the default mode only behind a feature.

import path from "node:path";
import { CODEX_AGENT_KEYS, codexAgentName, ROLE_AGENTS, ROLE_LABELS } from "./pipeline-config.mjs";

export const CODEX_ASK_FEATURE = "default_mode_request_user_input";

export function tomlString(value) {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

/** A single line: argv is printed line by line, and Codex takes it as a TOML string. */
export function roleGuard(role) {
  return `You are the ${ROLE_LABELS[role]} role of the orca-pod Orca pipeline, not the Coordinator. `
    + "The Coordinator has already prepared the config, the sandbox and the role terminals: do not run orca terminal create, launch-provider.mjs or test-sandbox.mjs, "
    + 'and do not execute the Coordinator steps or the Test mode steps of SKILL.md (see "Role, not Coordinator" and "Test mode" there). '
    + "Wait for the first prompt and work only from the section of your own role.";
}

function codexAgentFlags(settings, role, skillDir) {
  if (!settings.shouldUseSubagents) return ["--config", "agents.enabled=false"];
  const wanted = new Set([...(ROLE_AGENTS[role] ?? []), ...Object.keys(settings.subagentSettings ?? {})]);
  return CODEX_AGENT_KEYS.filter((key) => wanted.has(key)).flatMap((key) => [
    "--config", `agents.${codexAgentName(key)}.config_file=${tomlString(path.join(skillDir, "agents", "codex", `${key}.toml`))}`,
  ]);
}

/** Role launch argv: [executable, ...args]. */
export function providerCommand(settings, { role, maxSubagents, skillDir, fullAccess = false }) {
  const guard = roleGuard(role);
  switch (settings.provider) {
    case "pi": return ["pi", "-a", "--model", settings.model, "--thinking", settings.thinking, "--append-system-prompt", guard];
    case "codex": return [
      "codex", "--model", settings.model,
      "--config", `model_reasoning_effort=${tomlString(settings.thinking)}`,
      "--config", `agents.max_concurrent_threads_per_session=${maxSubagents}`,
      ...codexAgentFlags(settings, role, skillDir),
      ...(role === "planner" ? ["--enable", CODEX_ASK_FEATURE] : []),
      "--config", `developer_instructions=${tomlString(guard)}`,
      ...(fullAccess ? ["--dangerously-bypass-approvals-and-sandbox"] : []),
    ];
    case "claude-code": return [
      "claude", "--model", settings.model, "--effort", settings.thinking, "--append-system-prompt", guard,
      ...(fullAccess ? ["--dangerously-skip-permissions"] : []),
    ];
    // omp has no system-instruction flag; the role guard is only the ROLE: line in the first prompt.
    case "omp": return ["omp", "--model", settings.model, "--thinking", settings.thinking];
    default: throw new Error(`internal error: unsupported provider ${JSON.stringify(settings.provider)}`);
  }
}
