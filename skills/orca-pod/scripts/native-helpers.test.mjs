import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { prepareNativeHelpers } from './native-helpers.mjs';
import { providerCommand } from './provider-command.mjs';

const skillDir = fileURLToPath(new URL('..', import.meta.url));
const helper = { name: 'domain-expert', model: 'provider/model', thinking: 'default',
  description: 'Check domain rules: "orders"', instructions: 'Check domain rules.\nPreserve "quotes", \\ paths and Unicode: \u0437\u0430\u043a\u0430\u0437\u044b.' };

for (const provider of ['codex', 'claude-code', 'qoder', 'omp', 'pi']) {
  test(`${provider}: all custom definitions are registered independently of concurrency`, () => {
    const root = mkdtempSync(path.join(tmpdir(), 'orca-many-helpers-'));
    try {
      const helpers = Array.from({ length: 12 }, (_, index) => ({ ...helper, name: 'domain-' + index }));
      const prepared = prepareNativeHelpers({ provider, model: helper.model },
        { role: 'implementer', useSubagents: true, helpers, maxSubagents: 6 },
        { nativeAgents: true, delegation: { kind: 'tool-filtered' } },
        { skillDir, cwd: root, env: {}, executable: { file: '/usr/bin/false' }, makeDirectory: () => root, materialize: true });
      assert.equal(prepared.effective.helpers.length, 12);
      assert.equal(prepared.effective.maxSubagents, 6);
      const registered = prepared.native.files ?? prepared.native.agents
        ?? JSON.parse(prepared.env[provider === 'pi' ? 'ORCA_POD_PI_POLICY' : 'ORCA_POD_OMP_POLICY']).helpers;
      assert.equal(Object.keys(registered).length, 12, prepared.warnings.join('\n'));
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test(`${provider}: a form-defined helper needs no installed agent file`, () => {
    const root = mkdtempSync(path.join(tmpdir(), 'orca-inline-helper-'));
    try {
      const settings = { provider, model: helper.model, thinking: helper.thinking };
      const policy = { role: 'implementer', reviewMode: 'self', useSubagents: true, helpers: [helper], maxSubagents: 6 };
      const capabilities = { nativeAgents: true, rolePrompt: true, delegation: { kind: 'tool-filtered' }, access: { flags: [] } };
      const prepared = prepareNativeHelpers(settings, policy, capabilities, { skillDir, cwd: root, env: {},
        executable: { file: '/usr/bin/false' }, makeDirectory: () => root, materialize: true });
      assert.equal(prepared.effective.useSubagents, true, prepared.warnings.join('\n'));
      const command = providerCommand(settings, { role: 'implementer', maxSubagents: 6, skillDir, policy: prepared.effective,
        capabilities, native: prepared.native });
      if (provider === 'codex') {
        const source = readFileSync(prepared.native.files[helper.name], 'utf8');
        assert.ok(source.includes(JSON.stringify(helper.instructions + '\nDo not delegate or spawn another agent.')));
        assert.match(source, /sandbox_mode = "workspace-write"/);
        assert.ok(command.some((arg) => arg.includes('agents.orca_domain_expert.description=')));
      } else if (provider === 'claude-code' || provider === 'qoder') {
        const agent = prepared.native.agents[helper.name];
        assert.equal(agent.description, helper.description);
        assert.ok(agent.prompt.startsWith(helper.instructions));
        assert.ok(agent.tools.includes('Edit'));
        assert.ok(agent.disallowedTools.includes('Agent'));
      } else if (provider === 'omp') {
        const selected = JSON.parse(prepared.env.ORCA_POD_OMP_POLICY).helpers[0];
        assert.notEqual(selected.name, helper.name, 'session definition cannot be shadowed by a project agent');
        const source = readFileSync(path.join(prepared.native.agentExtension, 'agents', selected.name + '.md'), 'utf8');
        assert.ok(source.includes(helper.instructions));
        assert.match(source, /spawns: ""/);
        assert.ok(command.includes(prepared.native.agentExtension));
        assert.ok(command.some((arg) => arg.includes(selected.name)));
      } else {
        const agent = JSON.parse(prepared.env.ORCA_POD_PI_POLICY).helpers[0];
        assert.equal(agent.description, helper.description);
        assert.ok(agent.systemPrompt.startsWith(helper.instructions));
        assert.ok(agent.tools.includes('edit'));
        assert.ok(!agent.tools.includes('subagent'));
      }
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}

for (const provider of ['codex', 'claude-code', 'qoder', 'omp', 'pi']) {
  test(`${provider}: planning helpers retain read-only policy`, () => {
    const root = mkdtempSync(path.join(tmpdir(), 'orca-inline-read-'));
    try {
      const prepared = prepareNativeHelpers({ provider, model: helper.model },
        { role: 'planner', useSubagents: true, helpers: [helper], maxSubagents: 6 },
        { nativeAgents: true, delegation: { kind: 'tool-filtered' } },
        { skillDir, cwd: root, env: {}, executable: { file: '/usr/bin/false' }, makeDirectory: () => root, materialize: true });
      assert.equal(prepared.effective.useSubagents, true, prepared.warnings.join('\n'));
      if (provider === 'codex') assert.match(readFileSync(prepared.native.files[helper.name], 'utf8'), /sandbox_mode = "read-only"/);
      else if (prepared.native.agents) assert.ok(!prepared.native.agents[helper.name].tools.includes('Edit'));
      else if (provider === 'pi') assert.ok(!JSON.parse(prepared.env.ORCA_POD_PI_POLICY).helpers[0].tools.includes('edit'));
      else {
        const name = JSON.parse(prepared.env.ORCA_POD_OMP_POLICY).helpers[0].name;
        assert.match(readFileSync(path.join(prepared.native.agentExtension, 'agents', name + '.md'), 'utf8'), /tools: read, grep, glob/);
      }
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}
