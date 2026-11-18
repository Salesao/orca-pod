import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { roleRecords } from './terminal-records.mjs';
import { terminalExcerpt } from './terminal-excerpt.mjs';
import { startupCommand } from './role-terminal.mjs';

const terminal = fileURLToPath(new URL('./role-terminal.mjs', import.meta.url));
const launcher = fileURLToPath(new URL('./launch-provider.mjs', import.meta.url));
const recordsModule = fileURLToPath(new URL('./terminal-records.mjs', import.meta.url));
const mockHost = `
const fs = require('node:fs'), cp = require('node:child_process');
const args = process.argv.slice(2), get = (flag) => args[args.indexOf(flag) + 1];
const root = process.cwd(), mode = fs.readFileSync('mode', 'utf8');
const handle = get('--terminal'), id = 'repo::'+root, runtimeId = mode === 'other-runtime' ? 'changed' : 'runtime';
function out(result) { console.log(JSON.stringify({ok:true, result, _meta:{runtimeId}})); }
if (args[0] === 'worktree') out({worktree:{id,path:root,hostId:'local',address:{environment:'local',worktree:'identity:fixture'}}});
else if (args[1] === 'create') {
  if (mode === 'rejected') {
    console.log(JSON.stringify({ok:false,error:{code:'selector_not_found'},_meta:{runtimeId}})); process.exit(2);
  }
  const n = fs.readFileSync('creates','utf8').length + 1, issued = 'term_created-'+n;
  fs.appendFileSync('creates','1');
  cp.spawn('/bin/sh',['-c',get('--command')],{env:{...process.env,ORCA_TERMINAL_HANDLE:issued,ORCA_PANE_KEY:'tab:leaf'},detached:true,stdio:'ignore'}).unref();
  if (mode === 'lost') process.exit(1);
  out({terminal:{handle:issued}});
} else if (args[1] === 'show' && mode === 'stale' && handle === 'term_created-1') {
  console.log(JSON.stringify({ok:false,error:{code:'terminal_handle_stale'},_meta:{runtimeId}})); process.exitCode=1;
} else if (args[1] === 'show') out({terminal:{handle,incarnationId:mode==='recycled'?'new':'inc-'+handle,
  ptyId:'pty-'+handle,worktreeId:id,worktreePath:root,writable:true,tabId:'tab',leafId:'leaf',title:'painted provider title'}});
else if (args[1] === 'read') {
  fs.appendFileSync('reads',args.includes('--screen')?'S':'T');
  const tail = mode === 'answer' ? JSON.parse(fs.readFileSync('displayed.json','utf8')) :
    mode === 'blank-exit' ? [] : [args.includes('--screen')?'EVIDENCE_GAP bind-key-DO-NOT-STORE':' ▓▒  ░ '];
  out({terminal:{handle,status:mode==='exited' || mode==='blank-exit'?'exited':'running',source:args.includes('--screen')?'screen':'stream',
    tail,draft:'draft-DO-NOT-STORE'}});
} else process.exitCode=1;
`;

function fixture(t, provider = 'pi') {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "orca-terminal-'fixture ")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, '.orca-pod'));
  const model = provider === 'qoder' ? 'example' : 'test/model';
  writeFileSync(path.join(root, '.orca-pod/orca-pod.yaml'), `active_profile: fixture\nprofiles:\n  fixture:\n    default_provider: ${provider}\n    roles:\n      planner:\n        model: ${model}\n        thinking: default\n      implementer:\n        model: ${model}\n        thinking: default\n`);
  for (const file of ['mode', 'creates', 'reads']) writeFileSync(path.join(root, file), '');
  function cli(file, source) {
    const dest = path.join(root,file);
    writeFileSync(dest, '#!' + process.execPath + '\n' + source);
    chmodSync(dest,0o700);
    return dest;
  }
  const orca = cli('orca-fake', mockHost);
  cli(provider === 'qoder' ? 'qodercli' : 'pi', `
const f = process.argv[2];
if (f === '--help') console.log('--agents --reasoning-effort --dangerously-skip-permissions');
else if (f === '--version') console.log('1.1.89');
else if (f === 'list') console.log('npm:pi-subagents');
else if (f === '--list-models') console.log('MODEL\\nexample');
else if (f !== 'agents') {
  (async () => { if (process.env.ORCA_POD_ROLE && ${JSON.stringify(provider)}==='pi') {
    const {recordPiRuntime} = await import(${JSON.stringify(recordsModule)});
    recordPiRuntime({model:'actual/provider-model',thinking:'low',helpers:'disabled'});
  } })();
  const fs = require('node:fs');
  const root = process.cwd(), finished = root + '/stop-' + process.env.ORCA_TERMINAL_HANDLE;
  const timer = setInterval(() => { if (!fs.existsSync(root) || fs.existsSync(finished)) clearInterval(timer); }, 40);
  setTimeout(() => clearInterval(timer), 30000).unref();
}`);
  const env = {...process.env, ORCA_CLI_COMMAND:orca, ORCA_POD_BIN_DIRS:'', PATH:root + path.delimiter + process.env.PATH};
  const common = ['--role','implementer','--run','pipeline-1'];
  const run = (operation, ...extra) => spawnSync(process.execPath, [terminal, operation,...(operation === 'workspace' ? [] : common),...extra],
    {cwd:root,env,encoding:'utf8'});
  const read = (file) => readFileSync(path.join(root,file),'utf8');
  const mode = (value) => writeFileSync(path.join(root,'mode'),value);
  const ok = (result) => { assert.equal(result.status,0,result.stderr); return JSON.parse(result.stdout); };
  const stop = n => writeFileSync(path.join(root,'stop-term_created-'+n),'');
  return {root,run,read,mode,ok,env,stop,records:() => roleRecords(root,'pipeline-1','implementer')};
}

async function until(check) {
  for (let i=0;i<100;i++) {
    const result = check();
    if (result) return result;
    await delay(50);
  }
  assert.fail('Expected role observation');
}

test('create binds its own new pane once, read falls back to screen, exit retains only safe diagnostics', async t => {
  const {run,read,ok,root,stop,records} = fixture(t);
  assert.equal(ok(run('workspace')).worktree,'identity:fixture');
  const started = ok(run('create','--profile','fixture'));
  assert.equal(started.address,'term_created-1');
  assert.equal(started.processIncarnation,'inc-term_created-1');
  assert.equal(started.requested.model,'test/model');
  assert.equal(started.turnStarted,null);
  assert.equal(run('create','--profile','fixture').status,2);
  assert.equal(read('creates'),'1');
  await until(() => records().read(1,'runtime'));
  const resolved = ok(run('resolve'));
  assert.equal(resolved.observed.model,'actual/provider-model');
  assert.equal(resolved.observed.thinking,'low');
  assert.equal(resolved.stage,'provider_spawned');
  assert.equal(resolved.helpers,'disabled');
  const view = ok(run('read','--lines','3'));
  assert.equal(view.source,'screen');
  assert.match(view.tail.join(' '),/bind-key/);
  assert.match(read('reads'),/TS/);
  stop(1);
  await until(() => records().read(1,'exit'));
  const saved = ok(run('read','--saved','--generation','1'));
  assert.equal(saved.exit.code,0);
  assert.deepEqual(saved.diagnostic.recent.map(e=>e.event),['EVIDENCE_GAP']);
  assert.doesNotMatch(JSON.stringify(saved),/bind-key|DO-NOT-STORE/);
  const directory = path.join(root,'.orca-pod','runs','pipeline-1','implementer');
  for (const file of readdirSync(directory)) assert.doesNotMatch(readFileSync(path.join(directory,file),'utf8'),/DO-NOT-STORE/);
});

test('the last readable role answer survives an empty exit screen and retains its own sample time', async t => {
  const { root, env, run, ok, mode, stop, records } = fixture(t, 'qoder');
  execFileSync('git', ['init','--quiet'], { cwd: root, env });
  ok(run('create','--profile','fixture'));
  const diagnostic = '.orca-pod/runs/pipeline-1/implementer/1.diagnostic.json';
  assert.equal(execFileSync('git', ['check-ignore', diagnostic], { cwd:root, env, encoding:'utf8' }).trim(), diagnostic);
  const ignore = path.join(root, '.orca-pod/runs/.gitignore');
  writeFileSync(ignore, '*\n# existing local choice\n');
  const response = ['Изменение прошло проверку.', 'Three cases passed. The migration is still waiting for server evidence.']; // ru-fixture
  writeFileSync(path.join(root,'displayed.json'), JSON.stringify([
    '\x1b[32m' + response[0] + '\x1b[0m', response[1],
    'Authorization: Bearer sample-private-value', 'https://example.invalid/log?sign=sample-private-value',
  ]));
  mode('answer');
  ok(run('read'));
  const observed = records().read(1, 'diagnostic').excerpt;
  assert.ok(observed.text.startsWith(response.join('\n')));
  assert.doesNotMatch(observed.text, /private-value|example\.invalid|\x1b|DO-NOT-STORE/);
  assert.equal(observed.source, 'screen');
  assert.equal(observed.status, 'running');
  mode('blank-exit');
  stop(1);
  await until(() => records().read(1, 'exit') && records().read(1, 'diagnostic')?.status === 'exited');
  const saved = ok(run('read','--saved')).diagnostic;
  assert.equal(saved.status, 'exited');
  assert.ok(saved.sampledAt > observed.sampledAt);
  assert.deepEqual(saved.excerpt, observed);
  assert.equal(readFileSync(ignore,'utf8'), '*\n# existing local choice\n');
});

test('an excerpt fits the UTF-8 byte limit and omits controls, private key material, tokens and credential lines', () => {
  const text = terminalExcerpt([
    'Пройдено '.repeat(1000), '\x1b]52;c;clipboard-private-data\x07output continues', // ru-fixture
    '-----BEGIN PRIVATE KEY-----', 'pem-private-data', '-----END PRIVATE KEY-----',
    'use ghp_secretTokenWhichMustStayPrivate', 'bind-key-DO-NOT-STORE',
    '{"client_secret":"sample-private-value"}', 'clientSecret=sample-private-value', 'OPENAI_API_KEY=sample-private-value', 'access_token: sample-private-value', 'curl orca://pair?code=sample-private-value',
    'last visible conclusion',
  ]);
  assert.ok(Buffer.byteLength(text) <= 8192);
  assert.doesNotMatch(text, /private-data|private-value|secretToken|DO-NOT-STORE|\ufffd|\x1b|orca:\/\//);
  assert.match(text, /output continues/);
  assert.match(text, /last visible conclusion$/);
  assert.equal(terminalExcerpt(['key-fragment','-----END RSA PRIVATE KEY-----','retained']), 'retained');
});

test('lost create receipt recovers without a second launch; only explicit settled replacement can bind a new generation', async t => {
  const {run,mode,ok,read,stop,records} = fixture(t,'qoder');
  mode('lost');
  assert.equal(run('create','--profile','fixture').status,2);
  await until(() => records().read(1,'bound'));
  mode('');
  assert.equal(ok(run('resolve')).address,'term_created-1');
  assert.equal(ok(run('read')).source,'screen');
  assert.equal(read('reads'),'S');
  const replace = (...args) => run('create','--profile','fixture','--replace','term_created-1',...args);
  assert.equal(replace('--children-settled').status,2);
  mode('stale');
  assert.equal(replace('--children-settled').status,2);
  mode('recycled');
  assert.equal(run('resolve').status,2);
  assert.equal(replace('--children-settled').status,2);
  mode('other-runtime');
  assert.equal(replace('--children-settled').status,2);
  stop(1);
  await until(() => records().read(1,'exit'));
  mode('stale');
  assert.equal(replace().status,2);
  const next = ok(replace('--children-settled'));
  assert.equal(next.address,'term_created-2');
  assert.equal(next.generation,2);
  assert.equal(next.replaces.terminalState,'stale');
  assert.equal(next.replaces.childrenSettled,true);
  assert.equal(read('creates'),'11');
  assert.equal(ok(run('read','--saved','--generation','1')).address,'term_created-1');
  stop(2);
  await until(() => records().read(2,'exit'));
});

test('definitive host rejection can retry; replacement preserves helper routes, cap and access', async t => {
  const { root, run, read, mode, ok, stop, records } = fixture(t);
  const config = path.join(root, '.orca-pod', 'orca-pod.yaml');
  const yaml = readFileSync(config, 'utf8')
    .replace('    roles:', '    max_subagents: 3\n    full_access: false\n    roles:')
    .replace('      implementer:', '      implementer:\n        use_subagents: true\n        subagents:\n          scout:\n            model: child-model\n            thinking: high');
  writeFileSync(config, yaml);
  mode('rejected');
  const failed = run('create', '--profile', 'fixture');
  assert.equal(failed.status, 2);
  assert.match(failed.stderr, /rejected before terminal allocation/);
  assert.equal(records().read(1, 'rejected').code, 'selector_not_found');
  assert.equal(read('creates'), '');
  mode('');
  const next = ok(run('create', '--profile', 'fixture'));
  assert.equal(next.generation, 2);
  assert.match(next.settingsFingerprint, /^[0-9a-f]{64}$/);
  assert.doesNotMatch(JSON.stringify(next), /child-model/);
  for (const [from, to] of [['child-model','other-child'], ['thinking: high','thinking: low'], ['max_subagents: 3','max_subagents: 4'], ['full_access: false','full_access: true']]) {
    writeFileSync(config, yaml.replace(from, to));
    const blocked = run('create', '--profile', 'fixture', '--replace', next.address, '--children-settled');
    assert.equal(blocked.status, 2);
    assert.match(blocked.stderr, /launch policy changed/);
  }
  const sibling = run('create', '--role', 'planner', '--profile', 'fixture');
  assert.equal(sibling.status, 2);
  assert.match(sibling.stderr, /Run workspace, profile or configured launch policy changed/);
  writeFileSync(config, yaml);
  stop(1);
  await until(() => records().read(2, 'exit'));
  assert.equal(read('creates'), '1');
});

test('rejects mismatched direct launcher handles, project symlinks and arbitrary run paths', t => {
  const {root,env,run} = fixture(t);
  const direct = spawnSync(process.execPath,[launcher,'--role','implementer','--terminal','term_other'], {cwd:root,env,encoding:'utf8'});
  assert.equal(direct.status,2);
  assert.match(direct.stderr,/own terminal/);
  assert.throws(()=>roleRecords(root,'../elsewhere','planner',true),/valid --run/);
  symlinkSync(root,path.join(root,'.orca-pod/runs'),'dir');
  assert.equal(run('create','--profile','fixture').status,2);
  assert.ok(!existsSync(path.join(root,'pipeline-1')));
});

test('startup command preserves path arguments containing shell metacharacters', () => {
  const args = ["a'b", ' $(whoami) `pwd` '];
  const cmd = startupCommand([process.execPath,'-e','console.log(JSON.stringify(process.argv.slice(1)))',...args],'darwin');
  assert.deepEqual(JSON.parse(execFileSync('/bin/sh',['-c',cmd],{encoding:'utf8'})),args);
  assert.match(startupCommand(args,'win32'),/a''b/);
});
