#!/usr/bin/env node
// Sandbox for `/orca-pod test`.
//   prepare [--dir <path>] [--config <orca-pod.yaml>]
//       Creates or resets the sandbox (default ~/orca-pod-test): copies
//       assets/test/sandbox, the role config if given, and makes a baseline commit.
//       Git writes happen only inside the sandbox. A foreign directory without the marker is left alone.
//   check [--dir <path>] [--profile <name>]
//       Checks the result of the run: files and behaviour of the modules, `node --test`, review reports.
//       --profile is the profile the Coordinator selected for the run (active_profile by default).
// prepare prints one JSON line; check prints PASS/WARN/FAIL line by line and exits with code 1 on FAIL.
// The module exports reportVerdict and catchesChunkDefect (reports are parsed by their English labels); the CLI starts
// only on a direct run.

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SEED_DIR = path.join(SKILL_DIR, 'assets/test/sandbox');
const MARKER = '.orca-pod-sandbox';
const DEFAULT_DIR = path.join(os.homedir(), 'orca-pod-test');

const USAGE = 'usage: test-sandbox.mjs prepare [--dir <path>] [--config <orca-pod.yaml>] | check [--dir <path>] [--profile <name>]';

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = { command, dir: DEFAULT_DIR, config: null, profile: null };
  for (let index = 0; index < rest.length; index += 1) {
    if (rest[index] === '--dir' && rest[index + 1]) options.dir = path.resolve(rest[++index]);
    else if (rest[index] === '--config' && rest[index + 1]) options.config = path.resolve(rest[++index]);
    else if (rest[index] === '--profile' && rest[index + 1]) options.profile = rest[++index];
    else throw new Error(USAGE);
  }
  if (!['prepare', 'check'].includes(command)) throw new Error(USAGE);
  return options;
}

function git(dir, args) {
  const result = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error('git ' + args.join(' ') + ': ' + (result.stderr || result.stdout).trim());
  return result.stdout.trim();
}

function prepare({ dir, config }) {
  if (existsSync(dir)) {
    if (!existsSync(path.join(dir, MARKER))) throw new Error(dir + ' exists and is not a sandbox (no ' + MARKER + ') — pass a different --dir');
    // Reset without deleting the directory: Orca keeps the repository registration by path.
    for (const entry of readdirSync(dir)) if (entry !== '.git') rmSync(path.join(dir, entry), { recursive: true, force: true });
  } else {
    mkdirSync(dir, { recursive: true });
  }
  cpSync(SEED_DIR, dir, { recursive: true });
  let configState = 'missing';
  if (config) {
    if (!existsSync(config)) throw new Error('config not found: ' + config);
    mkdirSync(path.join(dir, '.orca-pod'), { recursive: true });
    copyFileSync(config, path.join(dir, '.orca-pod', 'orca-pod.yaml'));
    configState = 'copied';
  }
  if (!existsSync(path.join(dir, '.git'))) git(dir, ['init', '-q']);
  // .orca-pod/ (config and reports) stays out of the baseline: otherwise the sandbox config looks like it came
  // with the repository (configTracked) and the Coordinator re-asks about full_access. The sandbox's .gitignore is left alone.
  const exclude = path.join(dir, '.git', 'info', 'exclude');
  mkdirSync(path.dirname(exclude), { recursive: true });
  const excluded = existsSync(exclude) ? readFileSync(exclude, 'utf8') : '';
  if (!excluded.split('\n').includes('.orca-pod/')) writeFileSync(exclude, excluded + (excluded && !excluded.endsWith('\n') ? '\n' : '') + '.orca-pod/\n');
  git(dir, ['rm', '-r', '-q', '--cached', '--ignore-unmatch', '.orca-pod']);
  git(dir, ['add', '-A']);
  git(dir, ['-c', 'user.name=orca-pod-test', '-c', 'user.email=orca-pod-test@localhost',
    'commit', '-q', '--allow-empty', '-m', 'sandbox baseline ' + new Date().toISOString()]);
  return {
    dir,
    project: path.basename(dir),
    task: path.join(dir, 'TASK.md'),
    config: configState,
    head: git(dir, ['rev-parse', 'HEAD']),
    reports: path.join(dir, '.orca-pod', 'reports'),
    seed: path.join(SKILL_DIR, 'assets/test/implementer-seed.md'),
    expected: path.join(SKILL_DIR, 'assets/test/EXPECTED.md'),
  };
}

// ── report parsing ──
// Only the English labels of the report template (review-protocol §7): the report prose is in the user's LANGUAGE.

// Verdict tokens: stage (APPROVED …), chief/final (FINAL_APPROVED …), self-check (SELF_VERIFIED …).
const VERDICT_TOKENS = ['APPROVED', 'CHANGES_REQUESTED', 'PLAN_REVISION_REQUIRED', 'BLOCKED', 'FINAL_APPROVED', 'SELF_VERIFIED'];
// Label line: optional `#…`, `-`/`*`/`+`, `1.` and emphasis around the word; `Verdict:` is case-insensitive.
const VERDICT_LABEL = /^[ \t]*(?:(?:#{1,6}|[-*+]|\d+[.)])[ \t]+)*[*_`]*Verdict[*_`]*[ \t]*:[ \t]*[*_`]*[ \t]*(.*)$/im;

// The report's verdict: the value of the first line with a `Verdict:` label (`- `, `1. `, `### `, `**…**` are allowed) —
// a bare token from VERDICT_TOKENS. No label, empty, an unchosen template (`APPROVED | …`), an explanation
// next to the token or an unknown word — null.
export function reportVerdict(text) {
  const match = VERDICT_LABEL.exec(text);
  if (!match) return null;
  const value = match[1].replace(/^[\s*_`]+|[\s*_`]+$/g, '');
  return VERDICT_TOKENS.includes(value) ? value : null;
}

// Whether the test defect in chunk was caught: a finding line — id `R<n>` and category BLOCKER/MAJOR — together with `chunk`
// and `AC-C2`, `2.5` or `integer` (case-insensitive, except the id and the category). A finding is this line and
// the indented lines that follow it (review-protocol §2 format); `chunk`, `2.5 s` and the like outside findings
// (the Checks section, prose) do not count.
export function catchesChunkDefect(text) {
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    if (!/\bR\d+\b/.test(lines[index]) || !/\b(?:BLOCKER|MAJOR)\b/.test(lines[index])) continue;
    let finding = lines[index];
    for (let next = index + 1; next < lines.length && /^[ \t]+\S/.test(lines[next]); next += 1) finding += '\n' + lines[next];
    if (/chunk/i.test(finding) && /(AC-C2|2\.5|integer)/i.test(finding)) return true;
  }
  return false;
}

// ── check ──
const results = [];
const record = (level, name, detail = '') => results.push({ level, name, detail });
const pass = (name, detail) => record('PASS', name, detail);
const warn = (name, detail) => record('WARN', name, detail);
const fail = (name, detail) => record('FAIL', name, detail);

function expectThrows(fn, type) {
  try { fn(); return false; } catch (error) { return error instanceof type; }
}

async function checkModules(dir) {
  const files = ['src/text/truncate.js', 'src/time/duration.js', 'src/data/chunk.js', 'src/report.js'];
  for (const file of files) (existsSync(path.join(dir, file)) ? pass : fail)('file ' + file);
  const tests = ['truncate', 'duration', 'chunk', 'report'];
  const testFiles = existsSync(path.join(dir, 'test')) ? readdirSync(path.join(dir, 'test')) : [];
  for (const name of tests) (testFiles.some((f) => f.includes(name)) ? pass : warn)('test for ' + name, testFiles.join(', '));

  let lib;
  try { lib = await import(pathToFileURL(path.join(dir, 'src/index.js')).href + '?t=' + Date.now()); }
  catch (error) { fail('import src/index.js', error.message); return; }
  for (const name of ['slugify', 'truncate', 'formatDuration', 'chunk', 'buildReport']) {
    (typeof lib[name] === 'function' ? pass : fail)('export ' + name);
  }
  const probe = (name, fn) => { try { (fn() ? pass : fail)(name); } catch (error) { fail(name, error.message); } };
  if (lib.truncate) {
    probe('AC-A1 short string unchanged', () => lib.truncate('abc', 5) === 'abc');
    probe('AC-A2 length ≤ max and emoji intact', () => {
      const out = lib.truncate('ab😀😀cdef', 4);
      return [...out].length <= 4 && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(out);
    });
    probe('AC-A3 max=0 → RangeError', () => expectThrows(() => lib.truncate('abc', 0), RangeError));
  }
  if (lib.formatDuration) {
    probe('AC-B1 3723000 → "1h 2m 3s"', () => lib.formatDuration(3723000) === '1h 2m 3s');
    probe('AC-B1 0 → "0s"', () => lib.formatDuration(0) === '0s');
    probe('AC-B2 90061000 → "1d 1h 1m 1s"', () => lib.formatDuration(90061000) === '1d 1h 1m 1s');
    probe('AC-B3 -1 → RangeError', () => expectThrows(() => lib.formatDuration(-1), RangeError));
  }
  if (lib.chunk) {
    probe('AC-C1 chunk([1..5], 2)', () => JSON.stringify(lib.chunk([1, 2, 3, 4, 5], 2)) === '[[1,2],[3,4],[5]]');
    probe('AC-C2 size=2.5 → RangeError (test defect fixed)', () => expectThrows(() => lib.chunk([1, 2, 3], 2.5), RangeError));
    probe('AC-C3 not an array → TypeError', () => expectThrows(() => lib.chunk('abc', 1), TypeError));
  }
  if (lib.buildReport) {
    probe('AC-D2 empty report → "Total: 0s"', () => lib.buildReport([]) === 'Total: 0s');
    probe('AC-D1 total line', () => lib.buildReport([{ title: 'a', durationMs: 1000 }, { title: 'b', durationMs: 2000 }]).split('\n').at(-1) === 'Total: 3s');
  }
}

function checkNodeTests(dir) {
  const result = spawnSync(process.execPath, ['--test'], { cwd: dir, encoding: 'utf8', timeout: 120000 });
  const summary = (result.stdout || '').split('\n').filter((line) => /^# (tests|pass|fail)/.test(line)).join('; ');
  (result.status === 0 ? pass : fail)('node --test in the sandbox', summary || (result.stderr || '').trim().split('\n').at(-1));
}

function latestPlanDir(reportsRoot) {
  if (!existsSync(reportsRoot)) return null;
  const dirs = readdirSync(reportsRoot).map((name) => path.join(reportsRoot, name)).filter((p) => statSync(p).isDirectory());
  return dirs.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0] || null;
}

// The sandbox's review mode is the same computation as the Coordinator's (launch-provider.mjs --roles --profile).
function reviewModeOf(dir, profile) {
  const args = [path.join(SKILL_DIR, 'scripts/launch-provider.mjs'), '--roles', ...(profile ? ['--profile', profile] : [])];
  const result = spawnSync(process.execPath, args, { cwd: dir, encoding: 'utf8' });
  try { return JSON.parse(result.stdout).reviewMode; } catch { return null; }
}

function checkReports(dir, profile) {
  const reportsRoot = path.join(dir, '.orca-pod', 'reports');
  const planDir = latestPlanDir(reportsRoot);
  if (!planDir) { fail('review reports', 'no directory ' + reportsRoot); return; }
  pass('review reports', planDir);
  const files = readdirSync(planDir);
  const mode = reviewModeOf(dir, profile);
  (mode ? pass : warn)('review mode', mode || 'could not determine via launch-provider --roles — checking as full');
  const read = (f) => readFileSync(path.join(planDir, f), 'utf8');
  // The verdict comes only from the report template's `Verdict:` label (review-protocol §7); without a label carrying a token the check does not pass.
  const verdictOf = (text) => reportVerdict(text) ?? '';
  const withLabel = (name, text) => name + (reportVerdict(text) === null ? ' — no "Verdict:" line with a single verdict token (review-protocol §7)' : '');
  const attemptNo = (f) => Number(f.match(/attempt(\d+)/)[1]);

  if (mode === 'self') {
    const selfChecks = files.filter((f) => /^self-check-.*-attempt\d+\.md$/.test(f)).sort((a, b) => attemptNo(a) - attemptNo(b));
    if (!selfChecks.length) { fail('self-check reports', 'no self-check-<stage>-attempt<N>.md'); return; }
    pass('self-check reports', selfChecks.join(', '));
    (selfChecks.length <= 3 ? pass : fail)('self-check attempt limit ≤ 3', String(selfChecks.length));
    const last = read(selfChecks.at(-1));
    (verdictOf(last) === 'SELF_VERIFIED' ? pass : fail)('final: SELF_VERIFIED', withLabel(selfChecks.at(-1), last));
    ((/verifier/i.test(last)) ? pass : warn)('self-check through the verifier subagent', 'without it — inline in the Implementer context');
    ((/lens|pi-lens/i.test(last)) ? pass : warn)('self-check: pi-lens mentioned', 'the step is skipped in Claude Code');
    ((/AC-[A-D]\d/.test(last)) ? pass : warn)('self-check: acceptance criteria AC-* checked');
    return;
  }

  const reviewer = files.filter((f) => /-attempt\d+\.md$/.test(f) && !/^(chief|final|self-check)-/.test(f))
    .sort((a, b) => Number(a.match(/attempt(\d+)/)[1]) - Number(b.match(/attempt(\d+)/)[1]));
  const finals = files.filter((f) => (mode === 'full' || !mode ? /^chief-attempt\d+\.md$/ : /^final-attempt\d+\.md$/).test(f))
    .sort((a, b) => attemptNo(a) - attemptNo(b));

  if (files.some((f) => /^[A-Z]+-\d+-attempt\d+\.md$/.test(f))) fail('batch review', 'per-TODO reports found: ' + files.filter((f) => /^[A-Z]+-\d+-attempt/.test(f)).join(', '));
  if (!reviewer.length) { fail('Reviewer reports', 'no <stage>-attempt<N>.md'); return; }
  pass('Reviewer reports', reviewer.join(', '));
  (reviewer.length <= 3 ? pass : fail)('review attempt limit ≤ 3', String(reviewer.length));

  const first = read(reviewer[0]);
  (verdictOf(first) === 'CHANGES_REQUESTED' ? pass : warn)('attempt 1: CHANGES_REQUESTED', withLabel('expected because of the test defect', first));
  (/\bR\d+\b/.test(first) ? pass : fail)('attempt 1: findings with ids R<n>');
  (catchesChunkDefect(first) ? pass : warn)('attempt 1: chunk defect caught (AC-C2)', 'finding line R<n> BLOCKER/MAJOR with chunk and AC-C2/2.5/integer');
  ((/BLOCKER|MAJOR/.test(first)) ? pass : warn)('attempt 1: defect classified as blocking');
  if (reviewer.length > 1) {
    const last = read(reviewer.at(-1));
    const verdict = verdictOf(last);
    (verdict === 'APPROVED' ? pass : warn)('last Reviewer round: APPROVED', withLabel(reviewer.at(-1), last));
    (/CLOSED/.test(last) ? pass : warn)('repeat round: registry with CLOSED');
    (/missed-earlier/.test(last) ? warn : pass)('repeat round without new findings outside the delta', /missed-earlier/.test(last) ? 'missed-earlier present' : '');
    const deltas = files.filter((f) => f.endsWith('.delta'));
    (deltas.length ? pass : warn)('delta between rounds', deltas.join(', '));
  } else {
    warn('Reviewer repeat round', 'only one round happened — the findings cycle was not checked');
  }
  const finalName = mode === 'full' || !mode ? 'chief-attempt<N>.md' : 'final-attempt<N>.md';
  if (!finals.length) { fail('final review', 'no ' + finalName); return; }
  (finals.length <= 2 ? pass : fail)('final review attempt limit ≤ 2', String(finals.length));
  const finalReport = read(finals.at(-1));
  (verdictOf(finalReport) === 'FINAL_APPROVED' ? pass : fail)('final: FINAL_APPROVED', withLabel(finals.at(-1), finalReport));
}

async function check({ dir, profile }) {
  if (!existsSync(path.join(dir, MARKER))) { fail('sandbox', dir + ' not found — run prepare'); return; }
  pass('sandbox', dir);
  const status = git(dir, ['status', '--porcelain']);
  (status ? pass : warn)('changes in the sandbox', status ? status.split('\n').length + ' paths' : 'no changes relative to the baseline');
  (existsSync(path.join(dir, 'docs/superpowers')) ? pass : warn)('Planner spec/plan in docs/superpowers/');
  await checkModules(dir);
  checkNodeTests(dir);
  checkReports(dir, profile);
}

// realpath: the skill is also connected through symlinks (~/.claude/skills, ~/.codex/skills), while import.meta.url is the real path.
// The module can be imported (tests take reportVerdict and catchesChunkDefect) — the CLI then does not start.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.command === 'prepare') {
      console.log(JSON.stringify(prepare(options)));
    } else {
      await check(options);
      for (const { level, name, detail } of results) console.log(level.padEnd(4) + '  ' + name + (detail ? ' — ' + detail : ''));
      const failed = results.filter((r) => r.level === 'FAIL').length;
      const warned = results.filter((r) => r.level === 'WARN').length;
      console.log('\nSummary: ' + (failed ? 'FAIL' : 'PASS') + ' — ' + results.length + ' checks, FAIL ' + failed + ', WARN ' + warned);
      process.exitCode = failed ? 1 : 0;
    }
  } catch (error) {
    console.error('TEST SANDBOX ERROR: ' + error.message);
    process.exitCode = 2;
  }
}
