import test from 'node:test';
import assert from 'node:assert/strict';
import { buildYaml, prefill, validateServer } from './pipeline-form.mjs';
import { parsePipelineYaml, resolveProfile } from '../../orca-pod/scripts/pipeline-config.mjs';
const models = [{ program: 'codex', id: 'example', levels: ['high'] }];
function config() {
  const role = { model: 'codex:example', thinking: 'high', useSubagents: false, subagents: [] };
  return { activeProfile: 'default', profiles: [{ name: 'default', defaultProvider: 'codex', defaultSurface: 'chat', maxSubagents: 6, roles: { planner: { ...role }, implementer: { ...role, surface: 'terminal' } } }] };
}
test('setup roundtrip preserves profile surface and per-role override', () => {
  const selection = config();
  assert.deepEqual(validateServer(selection, models), []);
  const yaml = buildYaml(selection);
  const resolved = resolveProfile(parsePipelineYaml(yaml));
  assert.equal(resolved.resolvedRoles.planner.surface, 'chat');
  assert.equal(resolved.resolvedRoles.implementer.surface, 'terminal');
  const saved = prefill(yaml).profiles[0];
  assert.equal(saved.defaultSurface, 'chat');
  assert.equal(saved.roles.planner.surface, '');
  assert.equal(saved.roles.implementer.surface, 'terminal');
});
test('old configs retain terminals; malformed surfaces are rejected at form and schema boundaries', () => {
  const selection = config();
  delete selection.profiles[0].defaultSurface;
  delete selection.profiles[0].roles.implementer.surface;
  const yaml = buildYaml(selection);
  assert.equal(resolveProfile(parsePipelineYaml(yaml)).resolvedRoles.planner.surface, 'terminal');
  for (const surface of ['auto', true, '']) {
    selection.profiles[0].defaultSurface = surface;
    assert.ok(validateServer(selection, models).length);
  }
  assert.throws(() => resolveProfile(parsePipelineYaml(yaml.replace('    roles:', '    default_surface: bad\n    roles:'))), /default_surface/);
  selection.profiles[0].defaultSurface = 'chat';
  selection.profiles[0].roles.planner.surface = 'bad';
  assert.ok(validateServer(selection, models).length);
});
