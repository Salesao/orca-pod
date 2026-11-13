import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const launcher = new URL('./launch-provider.mjs', import.meta.url).pathname;
function run(args, outcome = { kind: 'structured', sessionId: 'codex_test', handle: 'structured-agent-session-codex_test' }, promptOutcome = 'journaled') {
  const root = mkdtempSync(path.join(tmpdir(), 'orca-chat-launch-'));
  try {
    mkdirSync(path.join(root, '.orca-pod'));
    writeFileSync(path.join(root, '.orca-pod/orca-pod.yaml'), `active_profile: test\nprofiles:\n  test:\n    default_provider: codex\n    default_surface: chat\n    roles:\n      planner:\n        model: selected-model\n        thinking: high\n      implementer:\n        model: selected-model\n        thinking: high\n`);
    const cli = path.join(root, 'orca');
    writeFileSync(cli, `#!${process.execPath}\nconsole.log(JSON.stringify({ok:true,result:{outcome:${JSON.stringify(outcome)},prompt:{outcome:${JSON.stringify(promptOutcome)}},operationId:'operation_test'},argv:process.argv.slice(2)}));\n`, { mode: 0o700 });
    return spawnSync(process.execPath, [launcher, '--role', 'planner', '--coordinator', ...args], { cwd: root, env: { ...process.env, ORCA_CLI_COMMAND: cli, ORCA_POD_BIN_DIRS: '', PATH: '/usr/bin:/bin' }, encoding: 'utf8' });
  } finally { rmSync(root, { recursive: true, force: true }); }
}
test('chat preflight needs no local provider CLI or terminal Plan hook and reports actual enforcement', () => {
  const result = run(['--resolve']);
  assert.equal(result.status, 0, result.stderr);
  const settings = JSON.parse(result.stdout);
  assert.equal(settings.surface, 'chat');
  assert.equal(settings.requiredPlannerMode, null);
  assert.equal(settings.effectiveAccess, 'host-default');
  assert.equal(settings.delegationEnforcement, 'instruction-only');
});
test('chat launch preserves model, effort, workspace, replay ID and the self-contained bootstrap policy', () => {
  const result = run(['--worktree', 'identity:test', '--environment', 'local', '--retry-launch', 'op_test']);
  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  const args = receipt.argv;
  assert.deepEqual(args.slice(0, 9), ['agent', 'launch', '--agent', 'codex', '--surface', 'chat', '--model', 'selected-model', '--effort']);
  assert.equal(args[9], 'high');
  assert.equal(args[args.indexOf('--worktree') + 1], 'identity:test');
  assert.equal(args[args.indexOf('--environment') + 1], 'local');
  assert.equal(args[args.indexOf('--retry-launch') + 1], 'op_test');
  const prompt = args[args.indexOf('--prompt') + 1];
  assert.match(prompt, /ROLE: Planner/);
  assert.match(prompt, /Delegation is disabled/);
  assert.match(prompt, /SURFACE: chat/);
  assert.match(prompt, /LANGUAGE: auto/);
  assert.match(prompt, /selected-model/);
  assert.equal(receipt.pod.address, 'orca_session_id:codex_test');
});

test('chat fallback and missing bootstrap delivery stop with the original receipt intact', () => {
  const fallback = run([], { kind: 'terminal', handle: 'term_fallback' });
  assert.equal(fallback.status, 2);
  assert.equal(JSON.parse(fallback.stdout).result.outcome.handle, 'term_fallback');
  assert.match(fallback.stderr, /did not confirm a structured chat/);
  const undelivered = run([], undefined, 'failed');
  assert.equal(undelivered.status, 2);
  assert.equal(JSON.parse(undelivered.stdout).result.operationId, 'operation_test');
  const inconsistent = run([], undefined, 'handed-to-terminal');
  assert.equal(inconsistent.status, 2);
  assert.match(inconsistent.stderr, /did not confirm the bootstrap prompt/);
});
