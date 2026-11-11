import assert from 'node:assert/strict';
import { test } from 'node:test';
import register, { dispatchSelectedTasks } from '../pi-extension/role-policy.js';

test('Pi selects the configured provider and disables ambient diagnostics for child definitions', () => {
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
      events: { emit(name, request) {
        assert.equal(name, 'pi-subagents:runtime-agent-register:v1');
        definitions.push(request.definition);
        request.result = { ok: true, registration: { dispose: () => disposed++ } };
      } },
    };
    register(pi);
    hooks.get('session_start')({}, { modelRegistry: { getAvailable: () => [{ provider: 'arbitrary-provider', id: 'model' }] } });
    assert.deepEqual(active, ['read', 'lens_diagnostics', 'orca_pod_helpers']);
    assert.equal(definitions[0].model, helper.model);
    assert.deepEqual(definitions[0].extensions, []);
    assert.deepEqual(definitions[0].subagentOnlyExtensions, []);
    assert.equal(definitions[0].allowNestedSubagents, false);
    assert.equal(hooks.get('tool_call')({ toolName: 'subagent' }).block, true);
    hooks.get('session_shutdown')();
    assert.equal(disposed, 1);
  } finally {
    if (restore === undefined) delete process.env.ORCA_POD_PI_POLICY;
    else process.env.ORCA_POD_PI_POLICY = restore;
  }
});

test('a failing Pi provider combination gets only one attempt before the rest move inline', async () => {
  const available = new Map([['selected', { model: 'arbitrary/one', thinking: 'off' }]]);
  const tasks = ['first', 'second', 'third'].map((task) => ({ agent: 'selected', task }));
  let calls = 0;
  const result = await dispatchSelectedTasks(tasks, available, 3, new Map(), async () => {
    calls++;
    return { status: 'failed' };
  });
  assert.equal(calls, 1);
  assert.deepEqual(result.map(({ status }) => status), ['failed', 'inline', 'inline']);
  await assert.rejects(dispatchSelectedTasks(tasks, available, 2, new Map(), () => assert.fail('must not launch')), /concurrency/);
});
