import assert from 'node:assert/strict';
import { test } from 'node:test';
import { listProfiles, resolveProfile } from './pipeline-config.mjs';
import { resolveRolePolicy } from './role-policy.mjs';

const role = () => ({ model: 'example/model', thinking: 'high', use_subagents: true });
const profile = () => ({ roles: { planner: role(), implementer: role() } });
const config = () => ({ active_profile: 'a', profiles: { a: profile() } });

test('form-defined role and instructions reach effective policy with inherited model', () => {
  const value = config();
  const definition = { description: 'Domain expert', instructions: 'Inspect domain rules.\nExplain violations.' };
  value.profiles.a.roles.planner.subagents = { expert: { model: 'inherit', thinking: 'low', ...definition } };
  const resolved = resolveProfile(value);
  assert.deepEqual(resolveRolePolicy(resolved, 'planner').helpers, [{ name: 'expert', model: 'example/model', thinking: 'low', ...definition }]);
  delete resolved.resolvedRoles.planner.resolvedSubagentSettings;
  assert.equal(resolveRolePolicy(resolved, 'planner').helpers[0].instructions, definition.instructions);
});

test('inline helper definitions require a one-line role and nonempty instructions', () => {
  for (const definition of [{ description: 'Domain expert' }, { instructions: 'Inspect' },
    { description: 'Domain\nexpert', instructions: 'Inspect' }, { description: 'Expert', instructions: '  ' },
    { description: null, instructions: 'Inspect' }]) {
    const value = config();
    value.profiles.a.roles.planner.subagents = { expert: { model: 'inherit', thinking: 'inherit', ...definition } };
    assert.throws(() => resolveProfile(value), /description|instructions/);
  }
});

test('profile and specialization caps are independent of concurrency', () => {
  const value = config();
  const active = value.profiles.a;
  active.roles.planner.subagents = Object.fromEntries(['one', 'two', 'three'].map((name) => [name, { model: 'inherit', thinking: 'inherit' }]));
  assert.equal(resolveProfile(value).maxSubagents, 6);
  active.max_subagents = '100';
  assert.equal(resolveProfile(value).maxSubagents, 100);
  active.roles.planner.subagents.four = { model: 'inherit', thinking: 'inherit' };
  assert.throws(() => resolveProfile(value), /at most 3 specializations/);
  delete active.roles.planner.subagents.four;
  Object.assign(value.profiles, { b: profile(), c: profile(), d: profile(), e: profile() });
  assert.equal(listProfiles(value).profiles.length, 5);
  assert.equal(resolveProfile(value).profile, 'a');
  value.profiles.f = profile();
  assert.throws(() => listProfiles(value), /at most 5 profiles/);
  assert.throws(() => resolveProfile(value), /at most 5 profiles/);
});

test('custom choices replace defaults and disabled roles have no effective helpers', () => {
  const value = config();
  const planner = value.profiles.a.roles.planner;
  assert.deepEqual(resolveRolePolicy(resolveProfile(value), 'planner').helpers.map(({name}) => name), ['scout', 'researcher', 'oracle']);
  planner.subagents = { custom: { model: 'inherit', thinking: 'low' } };
  assert.deepEqual(resolveRolePolicy(resolveProfile(value), 'planner').helpers, [{ name: 'custom', model: planner.model, thinking: 'low' }]);
  planner.use_subagents = false;
  assert.deepEqual(resolveRolePolicy(resolveProfile(value), 'planner').helpers, []);
  planner.subagents = { 'lens-checker': { model: 'inherit', thinking: 'inherit' } };
  assert.throws(() => resolveProfile(value), /lens-checker/);
});

test('one diagnostics owner per review mode and verifier only in self', () => {
  for (const [roles, owner] of [[[], 'implementer'], [['reviewer'], 'reviewer'], [['chief_reviewer'], 'chief_reviewer'], [['reviewer', 'chief_reviewer'], 'reviewer']]) {
    const value = config();
    for (const name of roles) value.profiles.a.roles[name] = role();
    const policy = resolveRolePolicy(resolveProfile(value), 'implementer');
    assert.equal(policy.diagnosticOwner, owner);
    assert.deepEqual(policy.helpers.map(({name}) => name), roles.length ? ['worker', 'scout'] : ['worker', 'scout', 'verifier']);
  }
});
