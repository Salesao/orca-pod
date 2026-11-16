import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const { findSetupSkill } = await import(process.env.ORCA_TEST_FORM_LOCATOR || '../skills/orca-pod-form/scripts/locate-setup.mjs');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCATOR = path.join(ROOT, 'skills/orca-pod-form/scripts/locate-setup.mjs');
const SKILL_FILE = process.env.ORCA_TEST_SKILL_FILE || path.join(ROOT, 'skills/orca-pod-form/SKILL.md');

function withTree(run) {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'orca-form-skill-')));
  try {
    const home = path.join(root, 'home');
    const cwd = path.join(root, 'project');
    const skillDir = path.join(root, 'skill', 'orca-pod-form');
    for (const dir of [home, cwd, skillDir]) mkdirSync(dir, { recursive: true });
    return run({ root, home, cwd, skillDir });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function makeSetup(base) {
  const setup = path.join(base, 'orca-pod-setup');
  const pipeline = path.join(base, 'orca-pod');
  mkdirSync(path.join(setup, 'scripts'), { recursive: true });
  mkdirSync(path.join(pipeline, 'scripts'), { recursive: true });
  writeFileSync(path.join(setup, 'scripts', 'setup-form.mjs'), '');
  writeFileSync(path.join(setup, 'scripts', 'form-only-config.mjs'), '');
  writeFileSync(path.join(setup, 'scripts', 'apply-form-only.mjs'), '');
  writeFileSync(path.join(pipeline, 'scripts', 'pipeline-config.mjs'), '');
  return setup;
}

test('finds the real sibling setup before the canonical home installation', () => withTree(({ home, cwd, skillDir }) => {
  const sibling = makeSetup(path.dirname(skillDir));
  makeSetup(path.join(home, '.agents', 'skills'));
  assert.equal(findSetupSkill({ skillDir, cwd, home }), realpathSync(sibling));
}));

test('finds the canonical home setup when the new skill is installed separately', () => withTree(({ home, cwd, skillDir }) => {
  const setup = makeSetup(path.join(home, '.agents', 'skills'));
  assert.equal(findSetupSkill({ skillDir, cwd, home }), realpathSync(setup));
}));

test('finds each native-agent setup symlink and validates its real sibling pipeline', () => {
  for (const relative of ['.claude/skills', '.pi/agent/skills', '.qoder/skills', '.omp/agent/skills']) {
    withTree(({ root, home, cwd, skillDir }) => {
      const setup = makeSetup(path.join(root, 'bundle'));
      const native = path.join(home, relative);
      mkdirSync(native, { recursive: true });
      symlinkSync(setup, path.join(native, 'orca-pod-setup'));
      assert.equal(findSetupSkill({ skillDir, cwd, home }), realpathSync(setup), relative);
    });
  }
});

test('finds project skills above a nested working directory within the project boundary', () => withTree(({ home, cwd, skillDir }) => {
  const nested = path.join(cwd, 'src', 'nested');
  mkdirSync(nested, { recursive: true });
  mkdirSync(path.join(cwd, '.orca-pod'));
  const setup = makeSetup(path.join(cwd, '.agents', 'skills'));
  assert.equal(findSetupSkill({ skillDir, cwd: nested, home }), realpathSync(setup));
}));

test('returns null rather than accepting a setup without its sibling pipeline', () => withTree(({ home, cwd, skillDir }) => {
  const base = path.join(home, '.agents', 'skills');
  const setup = makeSetup(base);
  rmSync(path.join(base, 'orca-pod'), { recursive: true });
  assert.ok(existsSync(path.join(setup, 'scripts', 'setup-form.mjs')));
  assert.equal(findSetupSkill({ skillDir, cwd, home }), null);
}));

test('an older setup without the form-only helpers is not mistaken for a compatible version', () => withTree(({ home, cwd, skillDir }) => {
  const setup = makeSetup(path.join(home, '.agents', 'skills'));
  rmSync(path.join(setup, 'scripts', 'apply-form-only.mjs'));
  assert.equal(findSetupSkill({ skillDir, cwd, home }), null);
}));

test('locator CLI prints the sibling setup realpath without writing to the project', () => withTree(({ home, cwd, skillDir }) => {
  const setup = makeSetup(path.dirname(skillDir));
  const scripts = path.join(skillDir, 'scripts');
  mkdirSync(scripts);
  const script = path.join(scripts, 'locate-setup.mjs');
  copyFileSync(LOCATOR, script);
  const result = spawnSync(process.execPath, [script], { cwd, encoding: 'utf8', env: { ...process.env, HOME: home } });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), realpathSync(setup));
  assert.deepEqual(readdirSync(cwd), []);
}));

test('locator CLI recommends updating incompatible skills rather than silently installing them', () => withTree(({ home, cwd, skillDir }) => {
  const scripts = path.join(skillDir, 'scripts');
  mkdirSync(scripts);
  const script = path.join(scripts, 'locate-setup.mjs');
  copyFileSync(LOCATOR, script);
  const result = spawnSync(process.execPath, [script], { cwd, encoding: 'utf8', env: { ...process.env, HOME: home } });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /update.*skills/i);
  assert.deepEqual(readdirSync(cwd), []);
}));

test('the documented request file stays outside the project even when TMPDIR points inside it', () => withTree(({ cwd }) => {
  const skill = readFileSync(path.join(ROOT, 'skills/orca-pod-form/SKILL.md'), 'utf8');
  const blocks = [...skill.matchAll(/^```sh\n([\s\S]*?)^```/gm)].map((match) => match[1]);
  const command = blocks.find((block) => block.includes('mktemp'));
  assert.ok(command, 'the skill must document private request creation');
  const result = spawnSync('sh', ['-c', command], { cwd, encoding: 'utf8', env: { ...process.env, TMPDIR: cwd } });
  assert.equal(result.status, 0, result.stderr);
  const file = result.stdout.trim();
  try {
    const relative = path.relative(realpathSync(cwd), realpathSync(file));
    assert.ok(relative.startsWith('..' + path.sep) || path.isAbsolute(relative), 'request must be outside the project');
    assert.equal(statSync(file).mode & 0o777, 0o600);
  } finally {
    rmSync(file, { force: true });
  }
}));

test('the documented save command removes its private request on success and failure', () => withTree(({ root, cwd }) => {
  const skill = readFileSync(path.join(ROOT, 'skills/orca-pod-form/SKILL.md'), 'utf8');
  const blocks = [...skill.matchAll(/^```sh\n([\s\S]*?)^```/gm)].map((match) => match[1]);
  const command = blocks.find((block) => block.includes('apply-form-only.mjs'));
  assert.ok(command, 'the skill must contain the save command');
  const setup = path.join(root, 'setup');
  mkdirSync(path.join(setup, 'scripts'), { recursive: true });
  writeFileSync(path.join(setup, 'scripts', 'apply-form-only.mjs'), 'process.stdin.resume(); process.stdin.on("end", () => { process.exitCode = Number(process.env.TEST_EXIT); });\n');
  for (const exitCode of [0, 9]) {
    const request = path.join(root, `request-${exitCode}.json`);
    writeFileSync(request, '{"secret":"private"}', { mode: 0o600 });
    const result = spawnSync('sh', ['-c', command], { cwd, encoding: 'utf8', env: { ...process.env, SETUP_DIR: setup, ORCA_FORM_REQUEST: request, TEST_EXIT: String(exitCode) } });
    assert.equal(result.status, exitCode, result.stderr);
    assert.equal(existsSync(request), false, 'temporary request must be removed');
    assert.doesNotMatch(result.stdout + result.stderr, /private/);
  }
}));

test('documented OMP installation links only a present source and never replaces an existing path', () => withTree(({ home, cwd }) => {
  const readme = readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const blocks = [...readme.matchAll(/^```bash\n([\s\S]*?)^```/gm)].map((match) => match[1]);
  const command = blocks.find((block) => block.includes('OMP_FORM='));
  assert.ok(command, 'OMP installation command must be documented');
  const source = path.join(home, '.agents', 'skills', 'orca-pod-form');
  const target = path.join(home, '.omp', 'agent', 'skills', 'orca-pod-form');
  const run = () => spawnSync('sh', ['-c', command], { cwd, encoding: 'utf8', env: { ...process.env, HOME: home } });
  assert.equal(run().status, 0);
  assert.equal(existsSync(target), false, 'a missing source must not create a dangling link');
  mkdirSync(source, { recursive: true });
  writeFileSync(path.join(source, 'SKILL.md'), '---\nname: orca-pod-form\n---\n');
  assert.equal(run().status, 0);
  assert.equal(readlinkSync(target), source);
  assert.equal(run().status, 0);
  assert.equal(readlinkSync(target), source);
  rmSync(target);
  mkdirSync(target);
  writeFileSync(path.join(target, 'keep'), 'foreign');
  assert.equal(run().status, 0);
  assert.equal(readFileSync(path.join(target, 'keep'), 'utf8'), 'foreign');
}));

test('new skill has discovery metadata and documents all five host agents', () => {
  const skill = readFileSync(SKILL_FILE, 'utf8');
  assert.match(skill, /^---\nname: orca-pod-form\ndescription: Use when .+\n---\n/);
  for (const agent of ['Pi', 'Claude Code', 'Codex', 'Qoder', 'OMP']) assert.ok(skill.includes(agent), agent);
  assert.match(skill, /orca_pod_setup\(\{\s*form_only:\s*true\s*\}\)/);
  assert.match(skill, /setup-form\.mjs" --form-only/);
  assert.match(skill, /apply-form-only\.mjs/);
  assert.match(skill, /status` is `submitted`/);
  assert.match(skill, /FORM_ONLY_CONFLICT/);
  assert.match(skill, /FORM_ONLY_INVALID_RESULT/);
  assert.match(skill, /ask the user to run full `orca-pod-setup`/i);
  assert.match(skill, /do not run (?:it|full setup) automatically/i);
  assert.match(skill, /same shell (?:call|command)/i);
  for (const file of ['README.md', 'README.ru.md']) assert.ok(existsSync(path.join(ROOT, 'skills/orca-pod-form', file)), file);
});
