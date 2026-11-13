import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const script = new URL('./send-handoff.mjs', import.meta.url);
// The fake replaces only the external Orca process, never the routing or stdin reader.
function run(target, payload, extra = [], response = { ok: true, result: { send: { accepted: true } } }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'orca-transport-'));
  try {
    const cli = path.join(dir, 'orca custom');
    writeFileSync(cli, `#!${process.execPath}\nconsole.log(JSON.stringify({...${JSON.stringify(response)}, argv:process.argv.slice(2)}));\n`, { mode: 0o700 });
    return spawnSync(process.execPath, [script.pathname, '--to', target, ...extra], {
      input: payload, encoding: 'utf8', env: { ...process.env, ORCA_CLI_COMMAND: cli },
    });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('terminal handoff preserves multiline text and uses the session CLI, without shell expansion', () => {
  const payload = 'Task: "quoted"\n$HOME $(touch /do-not-create) `whoami`\n\n';
  const result = run('term_abc-123', payload);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).argv, ['terminal', 'send', '--terminal', 'term_abc-123', '--text', payload, '--enter', '--wait-submit', '5', '--json']);
});

test('chat handoff uses the mailbox, retaining an explicit host and replay ID', () => {
  const result = run('orca_session_id:codex_abc_123', 'context\n', ['--environment', 'local', '--retry-request', 'req_123'], { ok: true, result: { messageId: 'msg_123' } });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).argv, ['orchestration', 'send', '--to', 'orca_session_id:codex_abc_123', '--subject', 'orca-pod handoff', '--body', 'context\n', '--type', 'handoff', '--environment', 'local', '--retry-request', 'req_123', '--json']);
});

test('chat handoff relays to a paired server with --on, and rejects ambiguous host options', () => {
  const result = run('orca_session_id:codex_test', 'task', ['--on', 'remote'], { ok: true, result: { messageId: 'msg_123' } });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).argv.slice(-3), ['--on', 'remote', '--json']);
  assert.equal(run('orca_session_id:codex_test', 'task', ['--on', 'remote', '--environment', 'local']).status, 2);
  assert.equal(run('term_test', 'task', ['--on', 'remote']).status, 2);
});

test('refuses ambiguous destinations and empty payloads before sending', () => {
  for (const target of ['Planner', 'active', 'codex_abc_123', 'orca_session_id:', 'term_']) {
    assert.equal(run(target, 'task').status, 2, target);
  }
  assert.equal(run('term_abc', ' \n').status, 2);
});

test('Orca rejection is preserved and is not retried or reported as success', () => {
  const result = run('term_abc', 'task', [], { ok: false, error: { code: 'terminal_handle_stale', message: 'Re-list' } });
  assert.equal(result.status, 2);
  assert.equal(JSON.parse(result.stdout).error.code, 'terminal_handle_stale');
});

test('Planner uses ORCA_CLI_COMMAND even when bare orca targets a different build', async () => {
  const { orcaTerminal } = await import('./codex-planner-mode.mjs');
  const dir = mkdtempSync(path.join(tmpdir(), 'orca-planner-cli-'));
  const previous = process.env.ORCA_CLI_COMMAND;
  try {
    const cli = path.join(dir, 'selected orca');
    writeFileSync(cli, `#!${process.execPath}\nconsole.log(JSON.stringify({ok:true,result:{terminal:{incarnationId:'expected-runtime',writable:true}}}));\n`, { mode: 0o700 });
    process.env.ORCA_CLI_COMMAND = cli;
    assert.equal((await orcaTerminal('term_test').identify()).incarnationId, 'expected-runtime');
  } finally {
    if (previous === undefined) delete process.env.ORCA_CLI_COMMAND;
    else process.env.ORCA_CLI_COMMAND = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('missing acceptance or mailbox message ID never counts as delivery', () => {
  for (const target of ['term_test', 'orca_session_id:codex_test']) {
    assert.equal(run(target, 'task', [], { ok: true, result: {} }).status, 2);
  }
});
