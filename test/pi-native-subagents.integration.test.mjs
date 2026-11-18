import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const repo = fileURLToPath(new URL('..', import.meta.url));
const pi = process.env.ORCA_TEST_PI_BIN ?? 'pi';
const bundle = process.env.ORCA_TEST_PI_SUBAGENTS_BUNDLE ??
  path.join(homedir(), '.pi', 'agent', 'npm', 'node_modules', 'pi-subagents', 'bundle', 'index.js');
const version = spawnSync(pi, ['--version'], { encoding: 'utf8', timeout: 5000 });
const skip = version.status !== 0 ? 'Pi CLI is unavailable' :
  !existsSync(bundle) ? `pi-subagents bundle is unavailable: ${bundle}` : false;

function text(message) {
  return Array.isArray(message?.content)
    ? message.content.filter((block) => block.type === 'text').map((block) => block.text).join('\n')
    : typeof message?.content === 'string' ? message.content : '';
}

async function scenario(mode) {
  const root = await mkdtemp(path.join(tmpdir(), 'orca-pi-integration-'));
  const agentDir = path.join(root, '.pi', 'agent');
  await mkdir(agentDir, { recursive: true });
  const results = new Map();
  const terminal = new Set();
  const requests = [];
  const errors = [];
  let notifications = 0;
  let parentContinuedAt;
  let parentReadAt;
  let childCompletedAt;
  let independentRequested = false;
  let launchIndex = 0;
  let proc;
  let onTerminal = () => {};
  let resolveDone;
  const done = new Promise((resolve) => { resolveDone = resolve; });
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (part) => { body += part; });
    req.on('end', () => {
      try {
        const request = JSON.parse(body);
        const subagent = (request.tools ?? []).find((tool) => tool.function?.name === 'subagent');
        const parent = Boolean(subagent);
        const messages = request.messages ?? [];
        const second = messages.some((message) => message.role === 'user' && JSON.stringify(message.content).includes('SECOND_PROBE'));
        const third = messages.some((message) => message.role === 'user' && JSON.stringify(message.content).includes('THIRD_PROBE'));
        requests.push({ parent, at: Date.now(), parameters: subagent?.function.parameters });
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
        const chunk = (delta, finishReason = null) => res.write(`data: ${JSON.stringify({
          id: 'chatcmpl-test', object: 'chat.completion.chunk', created: 1, model: 'fake-model',
          choices: [{ index: 0, delta, finish_reason: finishReason }],
        })}\n\n`);
        const finish = () => { res.write('data: [DONE]\n\n'); res.end(); };
        const launch = parent && (launchIndex === 0 || (mode === 'limit' && launchIndex === 1) ||
          (mode === 'flow' && launchIndex === 1 && second) || (mode === 'flow' && launchIndex === 2 && third));
        if (launch) {
          launchIndex++;
          let input;
          if (mode === 'foreground') {
            input = { agent: 'orca-pod-scout', task: 'Return CHILD_DONE.', async: false };
          } else if (mode === 'flow' && launchIndex === 2) {
            input = { workflow: 'parallel', args: { tasks: [
              { agent: 'orca-pod-scout', task: 'Return CHILD_DONE.' },
              { agent: 'orca-pod-reviewer', task: 'Return CHILD_DONE.' },
            ] }, async: true, options: { timeoutMs: 15000 } };
          } else {
            input = { agent: mode === 'unknown' ? 'unselected-helper' : 'orca-pod-scout',
              task: 'Return CHILD_DONE.', async: true, options: { timeoutMs: 15000 } };
          }
          chunk({ role: 'assistant', tool_calls: [{ index: 0, id: `call_${launchIndex}`,
            type: 'function', function: { name: 'subagent', arguments: JSON.stringify(input) } }] });
          chunk({}, 'tool_calls');
          finish();
          return;
        }
        if (parent && mode === 'flow' && launchIndex === 1 && !independentRequested) {
          independentRequested = true;
          chunk({ role: 'assistant', tool_calls: [{ index: 0, id: 'parent_read', type: 'function', function: {
            name: 'read', arguments: JSON.stringify({ path: path.join(root, 'parent-work.txt') }),
          } }] });
          chunk({}, 'tool_calls');
          finish();
          return;
        }
        const respond = () => {
          if (!parent) childCompletedAt ??= Date.now();
          chunk({ role: 'assistant', content: parent ? 'PARENT_CONTINUES' : 'CHILD_DONE' });
          chunk({}, 'stop');
          finish();
        };
        if (parent) respond();
        else setTimeout(respond, mode === 'limit' ? 2000 : 1500);
      } catch (error) {
        errors.push(String(error));
        res.destroy();
        resolveDone();
      }
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const timeout = setTimeout(() => { errors.push('Timed out waiting for native Pi completion'); resolveDone(); }, 40000);
  let stderr = '';
  try {
    const port = server.address().port;
    await writeFile(path.join(root, 'parent-work.txt'), 'PARENT_OWN_WORK\n');
    await writeFile(path.join(agentDir, 'models.json'), JSON.stringify({ providers: { fake: {
      baseUrl: `http://127.0.0.1:${port}/v1`, api: 'openai-completions', apiKey: 'dummy',
      models: [{ id: 'fake-model', name: 'Fake model', reasoning: false, input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 1000 }],
    } } }));
    const helper = (name) => ({ name, model: 'fake/fake-model', thinking: 'off',
      description: 'Read-only integration helper', systemPrompt: 'Return CHILD_DONE.', tools: ['read'] });
    const policy = { helpers: [helper('orca-pod-scout'), helper('orca-pod-reviewer')],
      maxSubagents: mode === 'limit' ? 1 : 2 };
    const env = { HOME: root, USERPROFILE: root, PATH: process.env.PATH, TMPDIR: root,
      PI_CODING_AGENT_DIR: agentDir, ORCA_POD_PI_POLICY: JSON.stringify(policy), PI_SUBAGENT_MAX_DEPTH: '1',
      NO_COLOR: '1', DO_NOT_TRACK: '1', TERM: 'dumb' };
    proc = spawn(pi, ['--mode', 'rpc', '--no-mcp', '--no-extensions', '--no-skills', '--no-prompt-templates',
      '--no-themes', '--no-context-files', '-e', bundle, '-e', path.join(repo, 'test/fixtures/pi-native-observer.mjs'),
      '-e', path.join(repo, 'skills/orca-pod/pi-extension/role-policy.js'), '--provider', 'fake', '--model', 'fake-model'],
    { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'] });
    const checkDone = () => {
      const first = results.get('call_1');
      if (mode === 'unknown' && first?.isError && parentContinuedAt) resolveDone();
      if (mode === 'foreground' && first && parentContinuedAt) resolveDone();
      if (mode === 'limit' && first?.runId && results.get('call_2')?.isError && notifications >= 1 && terminal.has(first.runId)) resolveDone();
      const third = results.get('call_3');
      if (mode === 'flow' && first?.runId && third?.runId && notifications >= 3 && terminal.has(first.runId) && terminal.has(third.runId)) resolveDone();
    };
    let out = '';
    proc.stdout.on('data', (part) => {
      out += part;
      while (out.includes('\n')) {
        const end = out.indexOf('\n');
        const line = out.slice(0, end); out = out.slice(end + 1);
        let event;
        try { event = JSON.parse(line); } catch { continue; }
        if (event.type === 'tool_execution_end' && event.toolName === 'read' && event.toolCallId === 'parent_read') {
          if (event.isError || !text(event.result).includes('PARENT_OWN_WORK')) errors.push('Independent parent read failed');
          else parentReadAt = Date.now();
        }
        if (event.type === 'tool_execution_end' && event.toolName === 'subagent') {
          const rows = event.result?.details?.results;
          const foregroundComplete = mode === 'foreground' && !event.isError && rows?.length === 1 &&
            rows[0]?.exitCode === 0 && !rows[0].detached;
          results.set(event.toolCallId, { isError: event.isError, runId: event.result?.details?.runId,
            mode: event.result?.details?.mode, message: text(event.result), foregroundComplete });
          if (event.isError && mode === 'flow') { errors.push(text(event.result)); resolveDone(); }
        }
        if (event.type === 'message_end' && event.message?.role === 'assistant' && text(event.message).includes('PARENT_CONTINUES')) {
          parentContinuedAt ??= Date.now();
        }
        if (event.type === 'message_end' && event.message?.customType === 'subagent-notify') {
          if (!text(event.message).includes('CHILD_DONE')) { errors.push(text(event.message)); resolveDone(); }
          else {
            notifications++;
            if (mode === 'flow' && notifications < 3) {
              const next = notifications === 1 ? 'SECOND_PROBE' : 'THIRD_PROBE';
              proc.stdin.write(`${JSON.stringify({ type: 'prompt', message: next, streamingBehavior: 'followUp' })}\n`);
            }
          }
        }
        checkDone();
      }
    });
    let stderrBuffer = '';
    proc.stderr.on('data', (part) => {
      stderr += part;
      stderrBuffer += part;
      while (stderrBuffer.includes('\n')) {
        const end = stderrBuffer.indexOf('\n');
        const line = stderrBuffer.slice(0, end); stderrBuffer = stderrBuffer.slice(end + 1);
        if (line.startsWith('ORCA_TEST_TERMINAL ')) terminal.add(line.slice('ORCA_TEST_TERMINAL '.length));
        onTerminal();
        checkDone();
      }
    });
    proc.on('error', (error) => { errors.push(String(error)); resolveDone(); });
    proc.on('exit', (code, signal) => { errors.push(`Pi exited early: ${code ?? signal}`); resolveDone(); });
    proc.stdin.write(`${JSON.stringify({ type: 'prompt', message: 'Launch a selected helper.' })}\n`);
    await done;
    assert.deepEqual(errors, [], `Pi integration errors; stderr: ${stderr.slice(-3000)}`);
    return { results, terminal, requests, notifications, parentContinuedAt, parentReadAt, childCompletedAt };
  } finally {
    clearTimeout(timeout);
    const pendingChildren = () => [...results.values()].filter((result) => result.mode === 'single' &&
      result.runId && !result.foregroundComplete && !terminal.has(result.runId));
    if (pendingChildren().length && proc && proc.exitCode === null && proc.signalCode === null) {
      await new Promise((resolve) => {
        const deadline = setTimeout(resolve, 17000);
        onTerminal = () => { if (!pendingChildren().length) { clearTimeout(deadline); resolve(); } };
        onTerminal();
      });
    }
    const safeToRemove = pendingChildren().length === 0;
    if (proc && proc.exitCode === null && proc.signalCode === null) {
      const exited = once(proc, 'exit');
      proc.kill('SIGTERM');
      await exited;
    }
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
    if (safeToRemove) await rm(root, { recursive: true, force: true });
    else console.error(`Pi integration retained ${root}: child termination was not proven.`);
  }
}

test('real Pi runs native background and parallel helpers while the parent continues', { skip, timeout: 75000 }, async () => {
  const run = await scenario('flow');
  assert.equal(run.results.size, 3);
  for (const result of run.results.values()) assert.equal(result.isError, false);
  assert.equal(run.notifications, 3);
  assert.ok(run.parentContinuedAt && run.childCompletedAt && run.parentContinuedAt < run.childCompletedAt);
  assert.ok(run.parentReadAt && run.parentReadAt < run.childCompletedAt, 'parent completes a real independent read before the child');
  assert.equal(run.requests.filter((request) => !request.parent).length, 4);
});

test('real Pi blocks an unselected helper', { skip, timeout: 75000 }, async () => {
  const run = await scenario('unknown');
  assert.equal(run.results.get('call_1')?.isError, true);
  assert.match(run.results.get('call_1')?.message ?? '', /outside this role policy/i);
  assert.equal(run.requests.filter((request) => !request.parent).length, 0);
});

test('real Pi advertises the role schema and completes the first foreground call', { skip, timeout: 75000 }, async () => {
  const run = await scenario('foreground');
  const schema = run.requests[0].parameters;
  assert.deepEqual(Object.keys(schema.properties).sort(),
    ['action', 'agent', 'args', 'async', 'id', 'model', 'options', 'task', 'workflow']);
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.properties.agent.enum, ['orca-pod-scout', 'orca-pod-reviewer']);
  assert.equal(run.results.size, 1);
  const result = run.results.get('call_1');
  assert.equal(result.isError, false, result.message);
  assert.match(result.message, /CHILD_DONE/);
  assert.equal(run.requests.filter((request) => !request.parent).length, 1);
});

test('real Pi enforces the configured concurrent-child limit', { skip, timeout: 75000 }, async () => {
  const run = await scenario('limit');
  assert.equal(run.results.get('call_1')?.isError, false);
  assert.equal(run.results.get('call_2')?.isError, true);
  assert.match(run.results.get('call_2')?.message ?? '', /concurrency limit/i);
  assert.equal(run.requests.filter((request) => !request.parent).length, 1);
});
