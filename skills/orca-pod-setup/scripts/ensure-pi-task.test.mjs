import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const SCRIPT = fileURLToPath(new URL('./ensure-pi-task.mjs', import.meta.url));

function fixture(t, { installed = false, source = 'npm:pi-task', mode = '' } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'orca-pi-task-dependency-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = path.join(root, 'bin');
  const agent = path.join(root, 'agent');
  const pkg = path.join(root, 'package');
  mkdirSync(bin); mkdirSync(agent);
  const state = path.join(root, 'state.json');
  writeFileSync(state, JSON.stringify({ installed, source, pkg, mode }));
  const define = () => {
    mkdirSync(path.join(pkg, 'extensions'), { recursive: true });
    writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name: 'pi-task', version: '1.0.0', pi: { extensions: ['./extensions/index.js'] } }));
    writeFileSync(path.join(pkg, 'extensions/index.js'), 'export default function () {}\n');
  };
  if (installed) define();
  writeFileSync(path.join(bin, 'pi'), `#!${process.execPath}
import fs from 'node:fs';
const file=process.env.FIXTURE_STATE;
const state=JSON.parse(fs.readFileSync(file,'utf8'));
const args=process.argv.slice(2);
fs.appendFileSync(file+'.calls',JSON.stringify(args)+'\\n');
if(args[0]==='list') {
 if(state.mode==='list-fail') process.exit(7);
 console.log(state.installed ? 'User packages:\\n  '+state.source+'\\n    '+state.pkg : 'No packages installed.');
} else if(args[0]==='install') {
 if(state.mode==='install-fail') { console.error('Registry unavailable'); process.exit(9); }
 if(state.mode==='hang') await new Promise(r=>setTimeout(r,5000));
 if(state.mode!=='false-success') {
  state.installed=true; state.source=args[1]; fs.mkdirSync(state.pkg+'/extensions',{recursive:true});
  fs.writeFileSync(state.pkg+'/package.json',JSON.stringify({name:'pi-task',version:'1.0.0',pi:{extensions:['./extensions/index.js']}}));
  fs.writeFileSync(state.pkg+'/extensions/index.js','export default function () {}'); fs.writeFileSync(file,JSON.stringify(state));
 }
} else process.exit(8);
`, { mode: 0o755 });
  // A .mjs entrypoint makes the fake CLI independent of ambient package type.
  writeFileSync(path.join(bin, 'package.json'), '{"type":"module"}');
  const env = { ...process.env, PATH: bin, ORCA_POD_BIN_DIRS: '', PI_CODING_AGENT_DIR: agent, FIXTURE_STATE: state };
  const run = (args = [], patch = {}) => spawnSync(process.execPath, [SCRIPT, ...args], { env: { ...env, ...patch }, cwd: root, encoding: 'utf8', timeout: 6000 });
  const calls = () => { try { return readFileSync(state + '.calls', 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse); } catch { return []; } };
  return { run, calls, env, bin, agent, pkg };
}

test('dependency bootstrap skips a machine without Pi', (t) => {
  const box = fixture(t);
  const result = box.run([], { PATH: '', ORCA_POD_BIN_DIRS: '' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /SKIP.*Pi/);
  assert.deepEqual(box.calls(), []);
});

test('installs the published package once, verifies it and requests reload', (t) => {
  const box = fixture(t);
  const first = box.run();
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /INSTALLED.*npm:pi-task/);
  assert.match(first.stdout, /\/reload/);
  assert.deepEqual(box.calls(), [['list'], ['install', 'npm:pi-task'], ['list']]);
  assert.equal(box.run().status, 0);
  assert.equal(box.calls().filter(([command]) => command === 'install').length, 1);
});

for (const source of ['npm:pi-task', 'npm:pi-task@1.0.0', 'git:github.com/Salesao/pi-task', './my-question-package']) {
  test(`preserves the existing ${source} installation`, (t) => {
    const box = fixture(t, { installed: true, source });
    const result = box.run();
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /OK.*pi-task/);
    assert.deepEqual(box.calls(), [['list']]);
  });
}

test('check mode reports missing dependency without installing it', (t) => {
  const box = fixture(t);
  const result = box.run(['--check']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /pi install npm:pi-task/);
  assert.deepEqual(box.calls(), [['list']]);
});

test('repairs a configured pinned package without changing its source', (t) => {
  const box = fixture(t, { installed: true, source: 'npm:pi-task@1.0.0' });
  rmSync(path.join(box.pkg, 'extensions/index.js'));
  const result = box.run();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(box.calls().find(([command]) => command === 'install'), ['install', 'npm:pi-task@1.0.0']);
});

test('preserves a pin even when the entire installed package directory is gone', (t) => {
  const box = fixture(t, { installed: true, source: 'npm:pi-task@1.0.0' });
  rmSync(box.pkg, { recursive: true });
  const result = box.run();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(box.calls().find(([command]) => command === 'install'), ['install', 'npm:pi-task@1.0.0']);
});

test('repairs a relative local source through its resolved package path', (t) => {
  const box = fixture(t, { installed: true, source: './my-question-package' });
  rmSync(path.join(box.pkg, 'extensions/index.js'));
  const result = box.run();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(box.calls().find(([command]) => command === 'install'), ['install', box.pkg]);
});

for (const mode of ['install-fail', 'list-fail', 'false-success', 'hang']) {
  test(`${mode} cannot be reported as a completed installation`, (t) => {
    const box = fixture(t, { mode });
    const result = box.run(mode === 'hang' ? ['--timeout', '0.5'] : []);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /pi-task|Pi package/);
    assert.doesNotMatch(result.stdout, /INSTALLED|^OK/m);
    if (mode === 'list-fail') assert.equal(box.calls().length, 1);
  });
}

test('finds Pi in a configured usual folder when it is absent from PATH', (t) => {
  const box = fixture(t, { installed: true });
  const result = box.run([], { PATH: '', ORCA_POD_BIN_DIRS: box.bin });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /OK.*pi-task/);
});
