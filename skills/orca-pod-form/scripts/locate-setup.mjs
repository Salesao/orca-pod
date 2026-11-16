#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function realOrResolved(value) {
  try { return realpathSync(value); }
  catch { return path.resolve(value); }
}

function validSetup(candidate) {
  try {
    const setup = realpathSync(candidate);
    const pipeline = path.join(path.dirname(setup), 'orca-pod', 'scripts', 'pipeline-config.mjs');
    const scripts = ['setup-form.mjs', 'form-only-config.mjs', 'apply-form-only.mjs'];
    return scripts.every((name) => statSync(path.join(setup, 'scripts', name)).isFile()) && statSync(pipeline).isFile() ? setup : null;
  } catch {
    return null;
  }
}

function projectBoundary(cwd, home) {
  const git = spawnSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] });
  if (git.status === 0 && git.stdout.trim()) return realOrResolved(git.stdout.trim());
  for (let current = cwd; current !== home; current = path.dirname(current)) {
    if (existsSync(path.join(current, '.orca-pod'))) return current;
    if (path.dirname(current) === current) break;
  }
  return cwd;
}

/** Locate the installed setup and its pipeline sibling without writing or installing anything. */
export function findSetupSkill({ skillDir, cwd, home }) {
  const skill = realOrResolved(skillDir);
  const folder = realOrResolved(cwd);
  const userHome = realOrResolved(home);
  const boundary = projectBoundary(folder, userHome);
  const candidates = [path.join(path.dirname(skill), 'orca-pod-setup')];
  for (let current = folder; ; current = path.dirname(current)) {
    candidates.push(path.join(current, '.agents', 'skills', 'orca-pod-setup'));
    if (current === boundary || path.dirname(current) === current) break;
  }
  for (const directory of ['.agents/skills', '.claude/skills', '.pi/agent/skills', '.qoder/skills', '.omp/agent/skills']) {
    candidates.push(path.join(userHome, directory, 'orca-pod-setup'));
  }
  for (const candidate of candidates) {
    const setup = validSetup(candidate);
    if (setup) return setup;
  }
  return null;
}

let direct = false;
try { direct = Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
catch { /* Imported by a host without a script path. */ }
if (direct) {
  const skillDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const setup = findSetupSkill({ skillDir, cwd: process.cwd(), home: homedir() });
  if (setup) console.log(setup);
  else {
    console.error('A compatible orca-pod-setup and sibling orca-pod were not found; update the Orca Pod skills. If the project is not configured, run full setup first.');
    process.exitCode = 1;
  }
}
