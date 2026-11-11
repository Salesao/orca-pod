import path from 'node:path';
import { codexAgentName, ROLE_LABELS } from './pipeline-config.mjs';
import { getProviderCapabilities, PROVIDER_EXECUTABLES } from './provider-capabilities.mjs';
import { resolveRolePolicy } from './role-policy.mjs';

export const PI_DELEGATION_TOOLS = 'subagent,subagents_*,subagent_*,delegate,delegate_*,spawn_agent,task,task_agent,bg_wait';
const shellQuote = (text) => "'" + text.replaceAll("'", "'\"'\"'") + "'";

export function codexSaveHook(skillDir) {
  const command = [process.execPath, path.join(skillDir, 'scripts', 'codex-planner-mode.mjs'), '--stop-hook'].map(shellQuote).join(' ');
  return `hooks.Stop=[{ hooks=[{ type="command", command=${tomlString(command)}, timeout=10 }] }]`;
}

const OMP_INLINE_TOOLS = 'read,bash,edit,write';

export function tomlString(value) {
  return JSON.stringify(value);
}

export function roleGuard(role, policy) {
  const delegation = !policy ? '' : policy.useSubagents
    ? ` Delegate only to these selected specializations: ${policy.helpers.map(({ name }) => name).join(', ')}. Honor the resolved models, effort and concurrency; children are leaves. If a helper cannot run under policy, do its work inline.`
    : ' Delegation is disabled. Perform all role work inline. Do not spawn, schedule or delegate through native tools, other CLIs, skills, extensions or MCP.';
  return `You are the ${ROLE_LABELS[role]} role of the orca-pod Orca pipeline, not the Coordinator. `
    + 'The Coordinator has already prepared the config, the sandbox and the role terminals: do not run orca terminal create, launch-provider.mjs or test-sandbox.mjs, '
    + 'and do not execute the Coordinator steps or the Test mode steps of SKILL.md (see "Role, not Coordinator" and "Test mode" there). '
    + 'Wait for the first prompt and work only from the section of your own role.' + delegation;
}

export function providerCommand(settings, {
  role, maxSubagents, skillDir, fullAccess = false, reviewMode = 'self', policy, capabilities, native = {}, terminalHandle,
}) {
  policy ??= resolveRolePolicy({ resolvedRoles: { [role]: settings }, reviewMode, maxSubagents }, role);
  capabilities ??= getProviderCapabilities(settings.provider);
  const guard = roleGuard(role, policy);
  const model = ['--model', settings.model];
  const effort = settings.thinking === 'default' ? [] : ['--thinking', settings.thinking];
  const instructions = capabilities.rolePrompt ? ['--append-system-prompt', guard] : [];
  const access = fullAccess ? capabilities.access.flags : [];
  const disabled = !policy.useSubagents;
  let flags;
  switch (settings.provider) {
    case 'pi':
      flags = ['-a', ...model, ...effort, ...instructions, ...(native.lensFlags ?? []),
        ...(disabled && capabilities.delegation.kind === 'tool-filtered' ? ['--exclude-tools', PI_DELEGATION_TOOLS] : []),
        ...(native.guard ? ['-e', native.guard] : [])];
      break;
    case 'codex': {
      const helpers = disabled ? ['--disable', 'multi_agent', '--config', 'agents.enabled=false']
        : policy.helpers.flatMap(({ name }) => {
          const file = native.files?.[name] ?? path.join(skillDir, 'agents', 'codex', `${name}.toml`);
          return ['--config', `agents.${codexAgentName(name)}.config_file=${tomlString(file)}`];
        });
      flags = [...model, '--config', `model_reasoning_effort=${tomlString(settings.thinking)}`,
        '--config', `agents.max_concurrent_threads_per_session=${maxSubagents}`, '--config', 'agents.max_depth=1', ...helpers,
        ...(role === 'planner' ? ['--no-alt-screen', '--config', 'check_for_update_on_startup=false', '--config', `plan_mode_reasoning_effort=${tomlString(settings.thinking)}`] : []),
        ...(role === 'planner' && terminalHandle ? ['--config', codexSaveHook(skillDir)] : []),
        '--config', `developer_instructions=${tomlString(guard)}`, ...access];
      break;
    }
    case 'claude-code':
    case 'qoder': {
      const claude = settings.provider === 'claude-code';
      flags = [...model, ...(claude ? ['--effort', settings.thinking] : []), ...instructions, ...access,
        ...(disabled && capabilities.delegation.kind !== 'instruction-only' ? ['--disallowed-tools', 'Agent'] : []),
        ...(!disabled && native.agents ? ['--agents', JSON.stringify(native.agents)] : []),
        ...(!disabled && native.excludedAgents?.length ? ['--disallowed-tools', native.excludedAgents.map((name) => `Agent(${name})`).join(',')] : [])];
      break;
    }
    case 'omp':
      flags = [...model, ...effort, ...instructions, ...access,
        ...(disabled && !native.guard && capabilities.delegation.kind === 'tool-filtered' ? ['--tools', OMP_INLINE_TOOLS] : []),
        ...(native.guard ? ['--extension', native.guard] : []), ...(native.config ? ['--config', native.config] : [])];
      break;
    default: throw new Error(`Unsupported provider ${settings.provider}`);
  }
  return [PROVIDER_EXECUTABLES[settings.provider], ...flags];
}
