import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { configLocation, projectLocation } from '../../orca-pod/scripts/config-location.mjs';

const { applyFormOnly, readFormOnlyConfig } = await import(process.env.ORCA_TEST_FORM_CONFIG || './form-only-config.mjs');

const YAML = `active_profile: default
profiles:
  default:
    default_provider: pi
    roles:
      planner:
        model: provider/model
        thinking: high
        use_subagents: false
      implementer:
        model: provider/model
        thinking: high
        use_subagents: false
`;

function withProject(run) {
  const project = realpathSync(mkdtempSync(path.join(tmpdir(), 'orca-form-only-')));
  try {
    const targetPath = path.join(project, '.orca-pod', 'orca-pod.yaml');
    return run({ project, targetPath, location: { activePath: targetPath } });
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
}

function write(file, content) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}

function snapshot(dir, prefix = '') {
  return readdirSync(dir).sort().flatMap((name) => {
    const relative = path.join(prefix, name);
    const file = path.join(dir, name);
    const stat = lstatSync(file);
    if (stat.isDirectory()) return [[relative, 'directory'], ...snapshot(file, relative)];
    if (stat.isSymbolicLink()) return [[relative, 'symlink', readlinkSync(file)]];
    return [[relative, 'file', readFileSync(file).toString('hex')]];
  });
}

function errorCode(expected) {
  return (error) => {
    assert.equal(error.code, expected);
    return true;
  };
}

test('reads the existing configuration and SHA-256 without modifying project files', () => withProject(({ project, targetPath, location }) => {
  write(targetPath, YAML);
  const before = snapshot(project);
  const result = readFormOnlyConfig(location);
  assert.deepEqual(result, {
    targetPath,
    text: YAML,
    sourceHash: createHash('sha256').update(YAML).digest('hex'),
  });
  assert.deepEqual(snapshot(project), before);
}));

test('UTF-8 BOM is preserved and included in the source hash', () => withProject(({ targetPath, location }) => {
  const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(YAML)]);
  write(targetPath, bytes);
  const result = readFormOnlyConfig(location);
  assert.equal(result.text, '\ufeff' + YAML);
  assert.equal(result.sourceHash, createHash('sha256').update(bytes).digest('hex'));
}));

test('legacy-only project requires full setup without migrating the old file', () => withProject(({ project, location }) => {
  const legacy = path.join(project, 'orca-pipeline.yaml');
  write(legacy, YAML);
  const before = snapshot(project);
  assert.throws(() => readFormOnlyConfig(location), errorCode('FORM_ONLY_SETUP_REQUIRED'));
  assert.deepEqual(snapshot(project), before);
}));

test('six profiles require full setup without reducing profiles or creating backups', () => withProject(({ project, targetPath, location }) => {
  const source = 'active_profile: f\nprofiles:\n' + ['a', 'b', 'c', 'd', 'e', 'f']
    .map((name) => `  ${name}:\n    default_provider: pi\n`).join('');
  write(targetPath, source);
  const before = snapshot(project);
  assert.throws(() => readFormOnlyConfig(location), errorCode('FORM_ONLY_UPGRADE_REQUIRED'));
  assert.deepEqual(snapshot(project), before);
}));

test('malformed YAML and missing active profiles are refused rather than prefilled with defaults', () => withProject(({ project, targetPath, location }) => {
  for (const source of ['not a mapping\n', 'active_profile: absent\nprofiles:\n  default:\n    default_provider: pi\n', 'active_profile: default\nprofiles:\n  default: broken\n']) {
    write(targetPath, source);
    const before = snapshot(project);
    assert.throws(() => readFormOnlyConfig(location), errorCode('FORM_ONLY_INVALID_CONFIG'));
    assert.deepEqual(snapshot(project), before);
  }
}));

test('malformed source diagnostics do not echo configuration contents', () => withProject(({ targetPath, location }) => {
  const source = 'SENSITIVE-SECRET-91: one\nSENSITIVE-SECRET-91: two\n';
  write(targetPath, source);
  assert.throws(() => readFormOnlyConfig(location), (error) => {
    assert.equal(error.code, 'FORM_ONLY_INVALID_CONFIG');
    assert.doesNotMatch(error.message, /SENSITIVE-SECRET-91/);
    return true;
  });
  assert.equal(readFileSync(targetPath, 'utf8'), source);
}));

test('an otherwise parseable configuration with a repairable role error can be opened', () => withProject(({ targetPath, location }) => {
  const source = YAML.replace('model: provider/model', 'model: ""');
  write(targetPath, source);
  assert.equal(readFormOnlyConfig(location).text, source);
}));

test('a dangling worktree config symlink cannot silently redirect editing to the shared config', () => withProject(({ project, targetPath }) => {
  const sharedPath = path.join(project, 'main', '.orca-pod', 'orca-pod.yaml');
  write(sharedPath, YAML);
  mkdirSync(path.dirname(targetPath), { recursive: true });
  symlinkSync(path.join(project, 'missing.yaml'), targetPath);
  const before = snapshot(project);
  const location = { activePath: sharedPath, worktreePath: targetPath, sharedPath };
  assert.throws(() => readFormOnlyConfig(location), errorCode('FORM_ONLY_INVALID_CONFIG'));
  assert.deepEqual(snapshot(project), before);
}));

test('directory, symlink and invalid UTF-8 targets are refused without touching their contents', () => withProject(({ project, targetPath, location }) => {
  mkdirSync(targetPath, { recursive: true });
  let before = snapshot(project);
  assert.throws(() => readFormOnlyConfig(location), errorCode('FORM_ONLY_INVALID_CONFIG'));
  assert.deepEqual(snapshot(project), before);
  rmSync(targetPath, { recursive: true });

  const target = path.join(project, 'other.yaml');
  write(target, YAML);
  symlinkSync(target, targetPath);
  before = snapshot(project);
  assert.throws(() => readFormOnlyConfig(location), errorCode('FORM_ONLY_INVALID_CONFIG'));
  assert.deepEqual(snapshot(project), before);
  rmSync(targetPath);

  writeFileSync(targetPath, Buffer.from([0xff, 0xfe, 0x61]));
  before = snapshot(project);
  assert.throws(() => readFormOnlyConfig(location), errorCode('FORM_ONLY_INVALID_CONFIG'));
  assert.deepEqual(snapshot(project), before);
}));

const editedYaml = YAML.replace('thinking: high', 'thinking: medium');

test('applies valid submitted YAML and preserves the original file mode', () => withProject(({ project, targetPath, location }) => {
  write(targetPath, YAML);
  chmodSync(targetPath, 0o640);
  const initial = readFormOnlyConfig(location);
  const result = applyFormOnly({ cwd: project, targetPath, sourceHash: initial.sourceHash, yaml: editedYaml });
  assert.equal(result.status, 'saved');
  assert.equal(result.targetPath, targetPath);
  assert.ok(result.profiles.every((profile) => profile.valid));
  assert.equal(readFileSync(targetPath, 'utf8'), editedYaml);
  assert.equal(statSync(targetPath).mode & 0o777, 0o640);
  assert.deepEqual(readdirSync(path.dirname(targetPath)), ['orca-pod.yaml']);
}));

test('a failed close removes the temporary file and leaves the original unchanged', () => withProject(({ project, targetPath, location }) => {
  write(targetPath, YAML);
  const initial = readFormOnlyConfig(location);
  const before = snapshot(project);
  const originalOpen = fs.openSync;
  const originalClose = fs.closeSync;
  let temporaryDescriptor;
  let injected = false;
  try {
    fs.openSync = (file, ...args) => {
      const descriptor = originalOpen(file, ...args);
      if (typeof file === 'string' && path.basename(file).startsWith('.orca-pod-form-')) temporaryDescriptor = descriptor;
      return descriptor;
    };
    fs.closeSync = (descriptor) => {
      if (descriptor === temporaryDescriptor && !injected) {
        injected = true;
        originalClose(descriptor);
        throw Object.assign(new Error('simulated close failure'), { code: 'EIO' });
      }
      return originalClose(descriptor);
    };
    syncBuiltinESMExports();
    assert.throws(() => applyFormOnly({ cwd: project, targetPath, sourceHash: initial.sourceHash, yaml: editedYaml }));
  } finally {
    fs.openSync = originalOpen;
    fs.closeSync = originalClose;
    syncBuiltinESMExports();
  }
  assert.notEqual(temporaryDescriptor, undefined);
  assert.equal(injected, true);
  assert.deepEqual(snapshot(project), before);
}));

test('changed source is a conflict and neither the newer config nor submitted YAML is overwritten', () => withProject(({ project, targetPath, location }) => {
  write(targetPath, YAML);
  const initial = readFormOnlyConfig(location);
  const newer = YAML + '# saved by another session\n';
  writeFileSync(targetPath, newer);
  const before = snapshot(project);
  assert.throws(() => applyFormOnly({ cwd: project, targetPath, sourceHash: initial.sourceHash, yaml: editedYaml }), errorCode('FORM_ONLY_CONFLICT'));
  assert.deepEqual(snapshot(project), before);
  assert.equal(readFileSync(targetPath, 'utf8'), newer);
}));

test('a concurrent change during saving is not overwritten and leaves no temporary file', () => withProject(({ project, targetPath, location }) => {
  write(targetPath, YAML);
  const initial = readFormOnlyConfig(location);
  const newer = YAML + '# concurrent write\n';
  const originalFsync = fs.fsyncSync;
  let injected = false;
  try {
    fs.fsyncSync = (descriptor) => {
      originalFsync(descriptor);
      if (!injected) {
        injected = true;
        writeFileSync(targetPath, newer);
      }
    };
    syncBuiltinESMExports();
    assert.throws(() => applyFormOnly({ cwd: project, targetPath, sourceHash: initial.sourceHash, yaml: editedYaml }), errorCode('FORM_ONLY_CONFLICT'));
  } finally {
    fs.fsyncSync = originalFsync;
    syncBuiltinESMExports();
  }
  assert.equal(injected, true);
  assert.equal(readFileSync(targetPath, 'utf8'), newer);
  assert.deepEqual(readdirSync(path.dirname(targetPath)), ['orca-pod.yaml']);
}));

test('invalid generated configs are rejected before writing or leaving temporary files', () => withProject(({ project, targetPath, location }) => {
  write(targetPath, YAML);
  const initial = readFormOnlyConfig(location);
  const six = 'active_profile: a\nprofiles:\n' + ['a', 'b', 'c', 'd', 'e', 'f']
    .map((name) => `  ${name}:\n    default_provider: pi\n`).join('');
  const badSecond = YAML + YAML.replace('  default:\n', '  other:\n').split('profiles:\n')[1]
    .replace('model: provider/model', 'model: ""');
  for (const yaml of [
    'this is not YAML SENSITIVE-SECRET-91\n',
    YAML + 'unknown_root_field: true\n',
    YAML.replace('model: provider/model', 'model: ""'),
    badSecond,
    six,
  ]) {
    const before = snapshot(project);
    assert.throws(() => applyFormOnly({ cwd: project, targetPath, sourceHash: initial.sourceHash, yaml }), (error) => {
      assert.equal(error.code, 'FORM_ONLY_INVALID_RESULT');
      assert.doesNotMatch(error.message, /SENSITIVE-SECRET-91/);
      return true;
    });
    assert.deepEqual(snapshot(project), before);
  }
}));

test('a symlink or directory substituted after opening cannot be overwritten', () => withProject(({ project, targetPath, location }) => {
  write(targetPath, YAML);
  const initial = readFormOnlyConfig(location);
  const outside = path.join(project, 'other.yaml');
  writeFileSync(outside, YAML);
  rmSync(targetPath);
  symlinkSync(outside, targetPath);
  let before = snapshot(project);
  assert.throws(() => applyFormOnly({ cwd: project, targetPath, sourceHash: initial.sourceHash, yaml: editedYaml }));
  assert.deepEqual(snapshot(project), before);
  assert.equal(readFileSync(outside, 'utf8'), YAML);
  rmSync(targetPath);
  mkdirSync(targetPath);
  before = snapshot(project);
  assert.throws(() => applyFormOnly({ cwd: project, targetPath, sourceHash: initial.sourceHash, yaml: editedYaml }));
  assert.deepEqual(snapshot(project), before);
}));

test('a new worktree config after opening causes a conflict instead of overwriting the shared config', () => withProject(({ project }) => {
  const main = path.join(project, 'main');
  const worktree = path.join(project, 'worktree');
  mkdirSync(main);
  const git = (...args) => {
    const result = spawnSync('git', ['-C', main, '-c', 'user.name=test', '-c', 'user.email=test@example.test', ...args], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  };
  git('init', '-q');
  git('commit', '-q', '--allow-empty', '-m', 'fixture');
  git('worktree', 'add', '-q', '-b', 'fixture', worktree);
  const shared = path.join(main, '.orca-pod', 'orca-pod.yaml');
  const local = path.join(worktree, '.orca-pod', 'orca-pod.yaml');
  write(shared, YAML);
  const initial = readFormOnlyConfig(configLocation(projectLocation(worktree)));
  assert.equal(initial.targetPath, shared);
  write(local, editedYaml);
  assert.throws(() => applyFormOnly({ cwd: worktree, targetPath: initial.targetPath, sourceHash: initial.sourceHash, yaml: editedYaml }), errorCode('FORM_ONLY_CONFLICT'));
  assert.equal(readFileSync(shared, 'utf8'), YAML);
  assert.equal(readFileSync(local, 'utf8'), editedYaml);
}));

test('linked worktree saves the shared config until it has an independent local config', () => withProject(({ project }) => {
  const main = path.join(project, 'main');
  const worktree = path.join(project, 'worktree');
  mkdirSync(main);
  const git = (...args) => {
    const result = spawnSync('git', ['-C', main, '-c', 'user.name=test', '-c', 'user.email=test@example.test', ...args], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  };
  git('init', '-q');
  git('commit', '-q', '--allow-empty', '-m', 'fixture');
  git('worktree', 'add', '-q', '-b', 'fixture', worktree);
  const shared = path.join(main, '.orca-pod', 'orca-pod.yaml');
  const local = path.join(worktree, '.orca-pod', 'orca-pod.yaml');
  write(shared, YAML);
  let initial = readFormOnlyConfig(configLocation(projectLocation(worktree)));
  assert.equal(initial.targetPath, shared);
  applyFormOnly({ cwd: worktree, targetPath: initial.targetPath, sourceHash: initial.sourceHash, yaml: editedYaml });
  assert.equal(readFileSync(shared, 'utf8'), editedYaml);

  write(local, YAML);
  initial = readFormOnlyConfig(configLocation(projectLocation(worktree)));
  assert.equal(initial.targetPath, local);
  const localYaml = YAML.replace('thinking: high', 'thinking: low');
  applyFormOnly({ cwd: worktree, targetPath: initial.targetPath, sourceHash: initial.sourceHash, yaml: localYaml });
  assert.equal(readFileSync(local, 'utf8'), localYaml);
  assert.equal(readFileSync(shared, 'utf8'), editedYaml);
}));

test('several valid profiles survive a form-only save', () => withProject(({ project, targetPath, location }) => {
  write(targetPath, YAML);
  const initial = readFormOnlyConfig(location);
  const second = YAML.replace('  default:\n', '  other:\n').split('profiles:\n')[1];
  const twoProfiles = YAML + second;
  const result = applyFormOnly({ cwd: project, targetPath, sourceHash: initial.sourceHash, yaml: twoProfiles });
  assert.deepEqual(result.profiles.map((profile) => profile.name), ['default', 'other']);
  assert.equal(readFileSync(targetPath, 'utf8'), twoProfiles);
}));
