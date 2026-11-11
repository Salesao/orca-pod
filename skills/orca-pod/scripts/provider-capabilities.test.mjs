import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getProviderCapabilities, parseModelCatalog } from './provider-capabilities.mjs';

test('new providers expose only capabilities supported by the supplied CLI evidence', () => {
  assert.equal(getProviderCapabilities('qoder').delegation.kind, 'instruction-only');
  const capability = getProviderCapabilities('qoder', { version: '1.1.81', help: '--disallowed-tools --append-system-prompt --dangerously-skip-permissions --list-models' });
  assert.equal(capability.delegation.kind, 'tool-filtered');
  assert.equal(capability.reasoning.kind, 'provider-default');
  assert.deepEqual(capability.access.flags, ['--dangerously-skip-permissions']);
});

test('Qoder and OMP model listings retain proven levels and identify partial results', () => {
  assert.deepEqual(parseModelCatalog('qoder', 'MODEL\nName (model-id)\ninvalid row\n').models.map(({ id, levels }) => [id, levels]), [['model-id', ['default']]]);
  assert.deepEqual(parseModelCatalog('qoder', 'MODEL\nQwen-3.8-Flash\n').models.map(({ id }) => id), ['Qwen-3.8-Flash']);
  const result = parseModelCatalog('omp', JSON.stringify({ models: [
    { selector: 'example/precise', thinking: ['low', 'high', 'imaginary'] },
    { selector: 'example/default', thinking: null }, {},
  ] }));
  assert.equal(result.status, 'partial');
  assert.deepEqual(result.models.map(({ id, levels }) => [id, levels]), [['example/precise', ['default', 'low', 'high']], ['example/default', ['default']]]);
  assert.equal(parseModelCatalog('omp', '{}').status, 'unavailable');
});
