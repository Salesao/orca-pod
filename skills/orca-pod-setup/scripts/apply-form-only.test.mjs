import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const CLI = fileURLToPath(new URL('./apply-form-only.mjs', import.meta.url));
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
  const cwd = realpathSync(mkdtempSync(path.join(tmpdir(), 'orca-form-apply-')));
  try {
    const dir = path.join(cwd, '.orca-pod');
    mkdirSync(dir);
    const targetPath = path.join(dir, 'orca-pod.yaml');
    writeFileSync(targetPath, YAML);
    const sourceHash = createHash('sha256').update(YAML).digest('hex');
    return run({ cwd, targetPath, sourceHash, dir });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

function invoke(cwd, input) {
  return spawnSync(process.execPath, [CLI], { cwd, input, encoding: 'utf8', maxBuffer: 1024 * 1024 });
}

test('CLI reads a JSON request and saves valid submitted settings', () => withProject(({ cwd, targetPath, sourceHash, dir }) => {
  const yaml = YAML.replace('thinking: high', 'thinking: medium');
  const result = invoke(cwd, JSON.stringify({ cwd, targetPath, sourceHash, yaml }));
  assert.equal(result.status, 0, result.stderr);
  const outcome = JSON.parse(result.stdout);
  assert.equal(outcome.status, 'saved');
  assert.equal(outcome.targetPath, targetPath);
  assert.ok(outcome.profiles.every((profile) => profile.valid));
  assert.equal(readFileSync(targetPath, 'utf8'), yaml);
  assert.deepEqual(readdirSync(dir), ['orca-pod.yaml']);
}));

test('CLI reports a source conflict as JSON without changing the newer file', () => withProject(({ cwd, targetPath, sourceHash, dir }) => {
  const newer = YAML + '# another session\n';
  writeFileSync(targetPath, newer);
  const result = invoke(cwd, JSON.stringify({ cwd, targetPath, sourceHash, yaml: YAML }));
  assert.equal(result.status, 1);
  assert.deepEqual([JSON.parse(result.stdout).status, JSON.parse(result.stdout).code], ['error', 'FORM_ONLY_CONFLICT']);
  assert.equal(readFileSync(targetPath, 'utf8'), newer);
  assert.deepEqual(readdirSync(dir), ['orca-pod.yaml']);
}));

test('CLI rejects malformed, incomplete, unexpected and oversized requests without echoing their contents', () => withProject(({ cwd, targetPath, sourceHash, dir }) => {
  for (const input of [
    '{"secret":"SENSITIVE-SECRET-91"',
    JSON.stringify({ cwd, targetPath, sourceHash }),
    JSON.stringify({ cwd, targetPath, sourceHash, yaml: YAML, unexpected: true }),
    JSON.stringify({ cwd: '\u0000SENSITIVE-SECRET-91', targetPath, sourceHash, yaml: YAML }),
    ' '.repeat(8 * 1024 * 1024 + 1),
  ]) {
    const result = invoke(cwd, input);
    assert.equal(result.status, 1, result.stderr);
    assert.equal(JSON.parse(result.stdout).status, 'error');
    assert.doesNotMatch(result.stdout + result.stderr, /SENSITIVE-SECRET-91/);
    assert.equal(readFileSync(targetPath, 'utf8'), YAML);
    assert.deepEqual(readdirSync(dir), ['orca-pod.yaml']);
  }
}));
