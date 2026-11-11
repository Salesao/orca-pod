import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { planProfileReduction, upgradeProfiles } from './profile-upgrade.mjs';

const source = '# old config\r\nactive_profile: f\r\nprofiles:\r\n    a: # keep\r\n      arbitrary: true\r\n    "b":\r\n      old: setting\r\n    c:\r\n      old: third\r\n    d:\r\n      old: fourth\r\n    e: # archive\r\n      old: archive\r\n    f:\r\n      # active setting\r\n      old: active\r\nlanguage: en\r\n';

function fixture(t) {
  const dir = fs.mkdtempSync(join(tmpdir(), 'orca-profile-test-'));
  t.after(() => fs.rmSync(dir, { force: true, recursive: true }));
  const file = join(dir, 'orca-pod.yaml');
  fs.writeFileSync(file, source);
  return file;
}

test('retains the active sixth profile and first four others with complete settings and original formatting', (t) => {
  const file = fixture(t);
  const plan = planProfileReduction(source);
  assert.deepEqual(plan.kept, ['a', 'b', 'c', 'd', 'f']);
  assert.deepEqual(plan.archived, ['e']);
  assert.equal(plan.nextText, source.replace('    e: # archive\r\n      old: archive\r\n', ''));
  const upgraded = upgradeProfiles(file);
  assert.equal(upgraded.status, 'upgraded');
  assert.equal(fs.readFileSync(file, 'utf8'), plan.nextText);
  assert.equal(fs.readFileSync(upgraded.backupPath, 'utf8'), source);
  assert.equal(upgradeProfiles(file).status, 'unchanged');
  assert.throws(() => planProfileReduction(source.replace('active_profile: f', 'active_profile: missing')), /not declared/);
});

test('existing four- and five-profile configurations remain byte-for-byte intact', () => {
  const five = source.replace('    e: # archive\r\n      old: archive\r\n', '');
  for (const text of [five, five.replace('    d:\r\n      old: fourth\r\n', '')]) {
    assert.equal(planProfileReduction(text).changed, false);
    assert.equal(planProfileReduction(text).nextText, text);
  }
});

test('backup failure and intervening edits cannot replace the input', (t) => {
  const file = fixture(t);
  assert.throws(() => upgradeProfiles(file, { fsOps: { ...fs, writeFileSync(target, ...args) {
    if (target.includes('.backup-')) throw new Error('backup unavailable');
    return fs.writeFileSync(target, ...args);
  } } }), /backup unavailable/);
  assert.equal(fs.readFileSync(file, 'utf8'), source);
  assert.throws(() => upgradeProfiles(file, { fsOps: { ...fs, writeFileSync(target, ...args) {
    fs.writeFileSync(target, ...args);
    if (target.includes('.backup-')) fs.writeFileSync(file, source + '# concurrent edit\n');
  } } }), /changed during/);
  assert.equal(fs.readFileSync(file, 'utf8'), source + '# concurrent edit\n');
});
