import assert from 'node:assert/strict';
import { test } from 'node:test';
import register from '../pi-extension/role-policy.js';

const selected = [
  { name: 'first', model: 'provider/first-model', thinking: 'off', tools: ['read'] },
  { name: 'second', model: 'provider/second-model', thinking: 'off', tools: ['read'] },
];

async function makeHarness(t, { helpers = selected, maxSubagents = 1, statusAvailable = true, deferStatus = false,
  failRegistrationAt = -1, throwRegistrationAt = -1, hasStartedEvent = true, rawPolicy,
  initialTools = ['read', 'subagent'], registeredTools = ['read', 'subagent'] } = {}) {
  let registrationCount = 0;
  let disposedCount = 0;
  let statusArrived;
  let releaseStatus;
  const statusRequested = new Promise((resolve) => { statusArrived = resolve; });
  const status = { fleet: { version: 1, entries: [], totalActive: 0, omitted: 0 },
    asyncSnapshot: { kind: 'pi-subagents.async-status-snapshot', version: 1,
      caps: { maxChildrenPerNode: 8 }, omitted: { runs: 0, children: 0, byteLimitExceeded: false }, runs: [] } };
  const proofs = new Map();
  const previous = process.env.ORCA_POD_PI_POLICY;
  process.env.ORCA_POD_PI_POLICY = rawPolicy ?? JSON.stringify({ helpers, maxSubagents });
  const hooks = new Map();
  const listeners = new Map();
  let active = [...initialTools];
  const events = {
    on(name, handler) {
      const handlers = listeners.get(name) ?? new Set();
      handlers.add(handler);
      listeners.set(name, handlers);
      return () => handlers.delete(handler);
    },
    emit(name, payload) {
      if (name === 'pi-subagents:runtime-agent-register:v1') {
        registrationCount++;
        if (registrationCount === throwRegistrationAt) throw new Error('Registration failed');
        payload.result = registrationCount === failRegistrationAt ? { ok: false } :
          { ok: true, registration: { dispose() { disposedCount++; } } };
      } else if (name === 'subagents:rpc:v1:request') {
        const response = statusAvailable
          ? { version: 1, requestId: payload.requestId, success: true,
            data: payload.method === 'ping'
              ? { version: 1, session: { cwd: '/tmp/project', sessionId: 'session-1', sessionFile: null },
                capabilities: { status: true, fleetStatus: { version: 1 },
                  asyncStatusSnapshot: { kind: 'pi-subagents.async-status-snapshot', version: 1 },
                  processTerminalProof: { version: 1, lifecycleArtifactVersion: 3 } },
                events: { ...(hasStartedEvent ? { asyncStarted: 'subagent:async-started' } : {}), asyncComplete: 'subagent:async-complete',
                  processTerminal: 'subagent:process-terminal' } }
              : payload.params?.id
                ? { details: { mode: 'single', results: [], ...(proofs.get(payload.params.id)?.kind === 'workflow'
                    ? { workflowTerminalProof: proofs.get(payload.params.id) }
                    : { lifecycleStatus: { processTerminal: proofs.get(payload.params.id) } }) } }
                : { text: `In-memory subagent status: ${status.fleet.totalActive} active children.`,
                  details: { mode: 'management', results: [] }, ...status } }
          : { version: 1, requestId: payload.requestId, success: false, error: { code: 'unavailable' } };
        const reply = () => events.emit(`subagents:rpc:v1:reply:${payload.requestId}`, response);
        if (deferStatus && payload.method === 'status' && !payload.params?.id) {
          releaseStatus = reply;
          statusArrived();
        } else reply();
      }
      for (const handler of listeners.get(name) ?? []) handler(payload);
    },
  };
  const pi = {
    on: (name, handler) => hooks.set(name, handler),
    getActiveTools: () => active,
    getAllTools: () => registeredTools.map((name) => ({ name })),
    setActiveTools: (tools) => { active = tools.filter((name) => registeredTools.includes(name)); },
    events,
  };
  const ctx = {
    hasUI: false,
    cwd: '/tmp/project',
    sessionManager: { getSessionId: () => 'session-1' },
    modelRegistry: { getAvailable: () => [
      { provider: 'provider', id: 'first-model' },
      { provider: 'provider', id: 'second-model' },
    ] },
  };
  try {
    register(pi);
  } finally {
    if (previous === undefined) delete process.env.ORCA_POD_PI_POLICY;
    else process.env.ORCA_POD_PI_POLICY = previous;
  }
  await hooks.get('session_start')({}, ctx);
  t.after(() => hooks.get('session_shutdown')?.());
  return {
    events, status, proofs, statusRequested, disposedCount: () => disposedCount, releaseStatus: () => releaseStatus(),
    shutdown: () => hooks.get('session_shutdown')?.(), active: () => [...active],
    call: (callId, input) => hooks.get('tool_call')({ toolName: 'subagent', toolCallId: callId, input }, ctx),
    nested: (parentToolCallId, toolCallId, input) => hooks.get('tool_call')({
      toolName: 'subagent_launch', parentToolCallId, toolCallId, input,
    }, ctx),
    result: (callId, details, isError = false) => hooks.get('tool_result')?.({
      toolName: 'subagent', toolCallId: callId, isError, details, content: [], input: {},
    }, ctx),
  };
}

const task = (agent, text = 'Inspect a separate file.') => ({ agent, task: text, async: true });

function started(harness, callId, runId) {
  harness.events.emit('subagent:async-started', { id: runId, runId, toolCallId: callId,
    sessionId: 'session-1', mode: 'single', agent: 'first' });
  return harness.result(callId, { mode: 'single', runId, asyncId: runId, results: [] });
}

function completed(harness, runId, success = true) {
  harness.events.emit('subagent:async-complete', { id: runId, runId, sessionId: 'session-1',
    state: success ? 'complete' : 'failed', success });
}

function processEnded(harness, runId) {
  harness.events.emit('subagent:process-terminal', { version: 1, runId,
    runnerProcessInstanceId: 'runner-1', state: 'observed', observedAt: 1,
    instances: [{ processInstanceId: 'runner-1', kind: 'runner', closeObservedAt: 1, exitCode: 0, signal: null }] });
}

test('the registered native tool is activated when it was initially inactive', async (t) => {
  const h = await makeHarness(t, { initialTools: ['read'] });
  assert.deepEqual(h.active(), ['read', 'subagent']);
});

test('concurrent native launches never reserve more than the configured limit', async (t) => {
  const h = await makeHarness(t);
  const results = await Promise.all([h.call('call-1', task('first')), h.call('call-2', task('second'))]);
  assert.equal(results.filter((result) => !result?.block).length, 1);
  assert.equal(results.filter((result) => result?.block).length, 1);
});

test('an asynchronous child retains its slot until completion and process termination are observed', async (t) => {
  const h = await makeHarness(t);
  assert.notEqual((await h.call('call-1', task('first')))?.block, true);
  await started(h, 'call-1', 'run-1');
  completed(h, 'run-1');
  assert.equal((await h.call('call-2', task('second')))?.block, true);
  processEnded(h, 'run-1');
  assert.notEqual((await h.call('call-3', task('second')))?.block, true);
});

test('a malformed process terminal event cannot release a child slot', async (t) => {
  const h = await makeHarness(t);
  assert.notEqual((await h.call('call-1', task('first')))?.block, true);
  await started(h, 'call-1', 'run-1');
  completed(h, 'run-1');
  h.events.emit('subagent:process-terminal', { version: 1, runId: 'run-1', state: 'observed' });
  assert.equal((await h.call('call-2', task('second')))?.block, true);
  h.events.emit('subagent:process-terminal', { version: 1, runId: 'run-1', runnerProcessInstanceId: 'runner-1',
    state: 'observed', observedAt: 1, instances: [{ kind: 'runner', processInstanceId: 'runner-1' }] });
  assert.equal((await h.call('call-2b', task('second')))?.block, true);
  processEnded(h, 'run-1');
  assert.notEqual((await h.call('call-3', task('second')))?.block, true);
});

test('completion and terminal proof arriving before the launch result are not lost', async (t) => {
  const h = await makeHarness(t);
  assert.notEqual((await h.call('call-1', task('first')))?.block, true);
  completed(h, 'run-1');
  processEnded(h, 'run-1');
  await started(h, 'call-1', 'run-1');
  assert.notEqual((await h.call('call-2', task('second')))?.block, true);
});

test('a completion from another session cannot release a selected child', async (t) => {
  const h = await makeHarness(t);
  assert.notEqual((await h.call('call-1', task('first')))?.block, true);
  await started(h, 'call-1', 'run-1');
  h.events.emit('subagent:async-complete', { id: 'run-1', runId: 'run-1', sessionId: 'other-session', state: 'complete', success: true });
  processEnded(h, 'run-1');
  assert.equal((await h.call('call-2', task('second')))?.block, true);
  completed(h, 'run-1');
  assert.notEqual((await h.call('call-3', task('second')))?.block, true);
});

test('a failed first child prevents further fan-out on its model route', async (t) => {
  const h = await makeHarness(t, { maxSubagents: 2 });
  assert.notEqual((await h.call('call-1', task('first')))?.block, true);
  await started(h, 'call-1', 'run-1');
  completed(h, 'run-1', false);
  processEnded(h, 'run-1');
  assert.equal((await h.call('call-2', task('first')))?.block, true);
  assert.notEqual((await h.call('call-3', task('second')))?.block, true);
});

test('a later task failure does not invalidate an already proven model route', async (t) => {
  const h = await makeHarness(t);
  assert.notEqual((await h.call('call-1', task('first')))?.block, true);
  await started(h, 'call-1', 'run-1');
  completed(h, 'run-1');
  processEnded(h, 'run-1');
  assert.notEqual((await h.call('call-2', task('first')))?.block, true);
  await started(h, 'call-2', 'run-2');
  completed(h, 'run-2', false);
  processEnded(h, 'run-2');
  assert.notEqual((await h.call('call-3', task('first')))?.block, true);
});

test('after reload an unknown live child blocks until its terminal proof can be recovered', async (t) => {
  const h = await makeHarness(t);
  h.status.fleet.totalActive = 1;
  h.status.asyncSnapshot.runs = [{ id: 'previous-run', kind: 'subagent', label: 'first', state: 'running' }];
  assert.equal((await h.call('call-1', task('second')))?.block, true);
  h.status.fleet.totalActive = 0;
  h.status.asyncSnapshot.runs[0].state = 'complete';
  h.proofs.set('previous-run', { version: 1, runId: 'previous-run', runnerProcessInstanceId: 'runner-old',
    state: 'observed', observedAt: 1,
    instances: [{ processInstanceId: 'runner-old', kind: 'runner', closeObservedAt: 1, exitCode: 0, signal: null }] });
  assert.notEqual((await h.call('call-2', task('second')))?.block, true);
});

test('native parallel workflow reserves one slot per child until workflow terminal proof', async (t) => {
  const h = await makeHarness(t, { maxSubagents: 2 });
  const parallel = { workflow: 'parallel', async: true, args: { tasks: [
    { agent: 'first', task: 'Inspect a.' }, { agent: 'second', task: 'Inspect b.' },
  ] } };
  assert.notEqual((await h.call('parallel-1', parallel))?.block, true);
  await h.result('parallel-1', { mode: 'workflow', runId: 'workflow-1', asyncId: 'workflow-1', results: [] });
  assert.equal((await h.call('call-2', task('first')))?.block, true);
  completed(h, 'workflow-1');
  h.status.asyncSnapshot.runs = [{ id: 'workflow-1', kind: 'workflow', label: 'workflow', state: 'complete' }];
  h.proofs.set('workflow-1', { version: 1, kind: 'workflow', runId: 'workflow-1',
    state: 'observed', dispatchClosed: true, observedAt: 1, children: [] });
  assert.notEqual((await h.call('call-3', task('first')))?.block, true);
});

test('only the matching nested launches of an admitted native parallel workflow are permitted', async (t) => {
  const h = await makeHarness(t, { maxSubagents: 2 });
  const parallel = { workflow: 'parallel', async: true, args: { tasks: [
    { agent: 'first', task: 'Inspect a.' }, { agent: 'second', task: 'Inspect b.' },
  ] } };
  assert.notEqual((await h.call('parallel-1', parallel))?.block, true);
  const nested = { workflowRunId: 'workflow-1', key: 'task-1', agent: 'first', task: 'Inspect a.', cwd: '/tmp/project' };
  assert.equal((await h.nested(undefined, 'direct-1', nested))?.block, true);
  assert.equal((await h.nested('parallel-1', 'parallel-1/1', { ...nested, agent: 'second' }))?.block, true);
  assert.notEqual((await h.nested('parallel-1', 'parallel-1/1', nested))?.block, true);
  assert.equal((await h.nested('parallel-1', 'parallel-1/2', nested))?.block, true);
  assert.equal((await h.nested('parallel-1', 'parallel-1/3', { ...nested, key: 'task-2', agent: 'second', task: 'Inspect b.', cwd: '/tmp/elsewhere' }))?.block, true);
  assert.notEqual((await h.nested('parallel-1', 'parallel-1/4', { ...nested, key: 'task-2', agent: 'second', task: 'Inspect b.' }))?.block, true);
});

test('truncated status snapshots block new launches instead of guessing', async (t) => {
  for (const [field, value] of [['runs', 1], ['children', 1], ['byteLimitExceeded', true]]) {
    const h = await makeHarness(t);
    h.status.asyncSnapshot.omitted[field] = value;
    const result = await h.call(`truncated-${field}`, task('first'));
    assert.equal(result?.block, true);
    assert.match(result.reason, /cannot be reconciled safely/i);
  }
});

test('a parallel workflow cannot exceed the native snapshot child limit', async (t) => {
  const h = await makeHarness(t, { maxSubagents: 9 });
  const tasks = Array.from({ length: 9 }, (_, index) => ({ agent: 'first', task: `Inspect ${index}.` }));
  const result = await h.call('too-wide', { workflow: 'parallel', async: true, args: { tasks } });
  assert.equal(result?.block, true);
  assert.match(result.reason, /snapshot.*limit/i);
});

test('native parallel workflow cannot fan out twice on an unverified model route', async (t) => {
  const h = await makeHarness(t, { maxSubagents: 2 });
  const parallel = { workflow: 'parallel', async: true, args: { tasks: [
    { agent: 'first', task: 'Inspect a.' }, { agent: 'first', task: 'Inspect b.' },
  ] } };
  assert.equal((await h.call('parallel-1', parallel))?.block, true);
});

test('disabled delegation and partial registration failure both block the native tool', async (t) => {
  const disabled = await makeHarness(t, { helpers: [] });
  assert.ok(!disabled.active().includes('subagent'));
  assert.equal((await disabled.call('disabled', task('first')))?.block, true);
  const failed = await makeHarness(t, { failRegistrationAt: 2 });
  assert.ok(!failed.active().includes('subagent'));
  assert.equal(failed.disposedCount(), 1);
  assert.equal((await failed.call('failed', task('first')))?.block, true);
  const thrown = await makeHarness(t, { throwRegistrationAt: 2 });
  assert.ok(!thrown.active().includes('subagent'));
  assert.equal(thrown.disposedCount(), 1);
  assert.equal((await thrown.call('thrown', task('first')))?.block, true);
});

test('malformed role policies do not expose native delegation', async (t) => {
  for (const rawPolicy of ['{', '{"helpers":{}}', 'null']) {
    const h = await makeHarness(t, { rawPolicy });
    assert.ok(!h.active().includes('subagent'));
    assert.equal((await h.call(`invalid-${rawPolicy}`, task('first')))?.block, true);
  }
});

test('management can stop only a run reserved by this role', async (t) => {
  const h = await makeHarness(t);
  assert.equal((await h.call('stop-foreign', { action: 'stop', id: 'foreign-run' }))?.block, true);
  assert.notEqual((await h.call('selected', task('first')))?.block, true);
  started(h, 'selected', 'own-run');
  assert.notEqual((await h.call('stop-own', { action: 'stop', id: 'own-run' }))?.block, true);
  assert.equal((await h.call('resume-own', { action: 'resume', id: 'own-run' }))?.block, true);
});

test('versions without an advertised start event still reserve until result and terminal proof', async (t) => {
  const h = await makeHarness(t, { hasStartedEvent: false });
  assert.notEqual((await h.call('selected', task('first')))?.block, true);
  h.result('selected', { mode: 'single', runId: 'run-1', asyncId: 'run-1', results: [] });
  assert.equal((await h.call('before-proof', task('second')))?.block, true);
  completed(h, 'run-1');
  processEnded(h, 'run-1');
  assert.notEqual((await h.call('after-proof', task('second')))?.block, true);
});

test('session shutdown while status is being checked cannot admit a child', async (t) => {
  const h = await makeHarness(t, { deferStatus: true });
  const decision = h.call('call-1', task('first'));
  await h.statusRequested;
  h.shutdown();
  h.releaseStatus();
  assert.equal((await decision)?.block, true);
});

test('unavailable native status blocks rather than allowing an unaccounted launch', async (t) => {
  const h = await makeHarness(t, { statusAvailable: false });
  assert.equal((await h.call('call-1', task('first')))?.block, true);
});

test('an unselected helper and a conflicting model override cannot launch', async (t) => {
  const h = await makeHarness(t);
  assert.equal((await h.call('call-1', task('unknown')))?.block, true);
  assert.equal((await h.call('call-2', { ...task('first'), model: 'other-provider/other-model' }))?.block, true);
});
