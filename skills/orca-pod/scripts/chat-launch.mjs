import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { roleGuard } from './provider-command.mjs';
import { ROLE_LABELS } from './pipeline-config.mjs';
import { orcaCommand } from './orca-command.mjs';

export function launchChat(settings, { worktree, environment, retryLaunch, skillDir }) {
  const guard = roleGuard(settings.role, settings.policy).replaceAll('role terminals', 'role sessions');
  const prompt = [
    `ROLE: ${ROLE_LABELS[settings.role]}`,
    'SURFACE: chat',
    `LANGUAGE: ${settings.language}`,
    guard,
    `Read ${path.join(skillDir, 'SKILL.md')} and its chat sections.`,
    `Resolved settings (do not re-read YAML): ${JSON.stringify(settings)}`,
    'This is bootstrap, not the task. Wait for the first complete assignment with role addresses and resolved LANGUAGE. Do not start planning, implementation, or send handoffs yet.',
    'Use the exact orca_session_id: mailbox assigned by Orca for replies. Shell exports are not shared with other sessions.',
    'Chat permissions come from Orca. Helper limits, selection and models are instruction-only: use native children only if the configured policy can be honored; otherwise work inline and report the limitation.',
    ...(settings.role === 'planner' ? ['Plan in this chat, write only specification/plan documents before approval, and get explicit user approval before handing off. Do not run terminal Plan helpers, slash commands, or emit ORCA_POD_PLANNING_SAVE. If the host mode forbids document writes, ask the user to enable a writable mode and wait; do not bypass it.'] : []),
  ].join('\n');
  const args = ['agent', 'launch', '--agent', settings.provider === 'claude-code' ? 'claude' : settings.provider,
    '--surface', 'chat', '--model', settings.model];
  if (settings.thinking !== 'default') args.push('--effort', settings.thinking);
  if (worktree) args.push('--worktree', worktree);
  if (environment) args.push('--environment', environment);
  args.push('--prompt', prompt);
  if (retryLaunch) args.push('--retry-launch', retryLaunch);
  args.push('--json');
  const result = spawnSync(orcaCommand(), args, { encoding: 'utf8', timeout: 65000, maxBuffer: 4 * 1024 * 1024 });

  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  let receipt;
  try { receipt = JSON.parse(result.stdout); } catch { if (result.stdout) process.stdout.write(result.stdout); throw new Error('Chat launch receipt missing: inspect the workspace; never retry as a fresh launch'); }
  const launch = receipt.result?.launch ?? receipt.result;
  const sessionId = launch?.outcome?.sessionId;
  const address = launch?.outcome?.kind === 'structured' && /^[a-z0-9_-]+$/i.test(sessionId ?? '') ? `orca_session_id:${sessionId}` : null;
  console.log(JSON.stringify({ ...receipt, ...(address ? { pod: { address, role: settings.role, surface: 'chat' } } : {}) }));
  if (result.status !== 0 || receipt.ok !== true) return 2;
  if (!address) {
    throw new Error('Orca did not confirm a structured chat address. Keep the returned receipt and workspace; do not send work or automatically relaunch');
  }
  if (launch.prompt?.outcome !== 'journaled') {
    throw new Error('Orca did not confirm the bootstrap prompt. Inspect the launch receipt before continuing');
  }
  return 0;
}
