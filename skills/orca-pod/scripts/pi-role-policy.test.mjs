import assert from 'node:assert/strict';
import { test } from 'node:test';
import register from '../pi-extension/role-policy.js';

test('Pi selects the configured provider and disables ambient diagnostics for child definitions', async () => {
  const restore = process.env.ORCA_POD_PI_POLICY;
  const helper = { name: 'custom', model: 'arbitrary-provider/model', thinking: 'off', tools: ['read'] };
  process.env.ORCA_POD_PI_POLICY = JSON.stringify({ helpers: [helper], maxSubagents: 6 });
  try {
    const hooks = new Map();
    const definitions = [];
    let active = ['read', 'subagent', 'bg_wait', 'lens_diagnostics'];
    let disposed = 0;
    const pi = {
      on: (name, handler) => hooks.set(name, handler),
      registerTool: ({ name }) => active.push(name),
      getActiveTools: () => active,
      setActiveTools: (tools) => { active = tools; },
      events: { on() { return () => {}; }, emit(name, request) {
        assert.equal(name, 'pi-subagents:runtime-agent-register:v1');
        definitions.push(request.definition);
        request.result = { ok: true, registration: { dispose: () => disposed++ } };
      } },
    };
    register(pi);
    await hooks.get('session_start')({}, { modelRegistry: { getAvailable: () => [{ provider: 'arbitrary-provider', id: 'model' }] },
      sessionManager: { getSessionId: () => 'session-1' } });
    assert.deepEqual(active, ['read', 'subagent', 'lens_diagnostics']);
    assert.equal(definitions[0].model, helper.model);
    assert.deepEqual(definitions[0].extensions, []);
    assert.deepEqual(definitions[0].subagentOnlyExtensions, []);
    assert.equal(definitions[0].allowNestedSubagents, false);
    assert.equal(definitions[0].defaultTimeoutMs, 300000);
    hooks.get('session_shutdown')();
    assert.equal(disposed, 1);
  } finally {
    if (restore === undefined) delete process.env.ORCA_POD_PI_POLICY;
    else process.env.ORCA_POD_PI_POLICY = restore;
  }
});

test('Pi permits a selected native subagent to start in the background', async () => {
  const restore = process.env.ORCA_POD_PI_POLICY;
  process.env.ORCA_POD_PI_POLICY = JSON.stringify({
    helpers: [{ name: 'custom', model: 'arbitrary-provider/model', thinking: 'off', tools: ['read'] }],
    maxSubagents: 1,
  });
  try {
    const hooks = new Map();
    const listeners = new Map();
    let active = ['read', 'subagent'];
    const bus = {
      on(name, handler) {
        const callbacks = listeners.get(name) ?? new Set();
        callbacks.add(handler);
        listeners.set(name, callbacks);
        return () => callbacks.delete(handler);
      },
      emit(name, request) {
        if (name === 'pi-subagents:runtime-agent-register:v1') {
          request.result = { ok: true, registration: { dispose() {} } };
        } else if (name === 'subagents:rpc:v1:request') {
          const data = request.method === 'ping'
            ? { version: 1, session: { cwd: '/tmp/project', sessionId: 'session-1', sessionFile: null },
              capabilities: { status: true, fleetStatus: { version: 1 },
                asyncStatusSnapshot: { kind: 'pi-subagents.async-status-snapshot', version: 1 },
                processTerminalProof: { version: 1, lifecycleArtifactVersion: 3 } },
              events: { asyncStarted: 'subagent:async-started', asyncComplete: 'subagent:async-complete',
                processTerminal: 'subagent:process-terminal' } }
            : { text: 'In-memory subagent status: 0 active children.', details: { mode: 'management', results: [] },
              fleet: { version: 1, entries: [], totalActive: 0, omitted: 0 },
              asyncSnapshot: { kind: 'pi-subagents.async-status-snapshot', version: 1,
                omitted: { runs: 0, children: 0, byteLimitExceeded: false }, runs: [] } };
          bus.emit(`subagents:rpc:v1:reply:${request.requestId}`, { version: 1, requestId: request.requestId, success: true, data });
        }
        for (const handler of listeners.get(name) ?? []) handler(request);
      },
    };
    const pi = { on: (name, handler) => hooks.set(name, handler), events: bus,
      getActiveTools: () => active, setActiveTools: (tools) => { active = tools; } };
    register(pi);
    const ctx = { modelRegistry: { getAvailable: () => [{ provider: 'arbitrary-provider', id: 'model' }] },
      sessionManager: { getSessionId: () => 'session-1' }, hasUI: false };
    await hooks.get('session_start')({}, ctx);
    const result = await hooks.get('tool_call')({ toolName: 'subagent', toolCallId: 'async-1',
      input: { agent: 'custom', task: 'Inspect a separate file.', async: true } }, ctx);
    assert.notEqual(result?.block, true, result?.reason);
    hooks.get('session_shutdown')();
  } finally {
    if (restore === undefined) delete process.env.ORCA_POD_PI_POLICY;
    else process.env.ORCA_POD_PI_POLICY = restore;
  }
});
