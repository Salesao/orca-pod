#!/usr/bin/env node
// Standalone runner of the orca-pod setup form for agents without the Pi tool
// (Claude Code). Collects model catalogs of the enabled agents (Pi via `pi --list-models`,
// Claude Code), opens the same browser form, waits for Submit/Cancel/timeout and prints exactly
// one JSON result line to stdout. Diagnostics, catalog sources and the URL go to stderr.
// Does not write orca-pod.yaml: the agent saves it by the orca-pod-setup skill.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expectedPipelineSkill, findPipelineSkill, PIPELINE_MISSING } from './pipeline-skill.mjs';

// pipeline-form.mjs, catalogs.mjs and config-location.mjs take modules of the sibling skill orca-pod, so they
// are loaded dynamically and only after findPipelineSkill: a static import without the sibling fails with
// ERR_MODULE_NOT_FOUND before any code runs. Filled in by loadSiblingModules().
let startPipelineForm;
let discoverCatalogs;
let ENABLED_PROGRAMS;
let KNOWN_PROGRAMS;
let configLocation;
let gitLocation;
let migrateLegacyConfig;
let migrationText;

async function loadSiblingModules(pipelineSkill) {
  const [form, catalogs, location] = await Promise.all([
    import('./pipeline-form.mjs'),
    import('./catalogs.mjs'),
    import(pathToFileURL(path.join(pipelineSkill, 'scripts', 'config-location.mjs')).href),
  ]);
  ({ startPipelineForm } = form);
  ({ discoverCatalogs, ENABLED_PROGRAMS, KNOWN_PROGRAMS } = catalogs);
  ({ configLocation, gitLocation, migrateLegacyConfig, migrationText } = location);
}

function parseArgs(argv) {
  const options = { timeout: 900, open: true, currentYamlFile: null, programs: ENABLED_PROGRAMS };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--timeout' && index + 1 < argv.length) options.timeout = Number(argv[++index]);
    else if (arg === '--no-open') options.open = false;
    else if (arg === '--programs' && index + 1 < argv.length) options.programs = argv[++index].split(',').map((p) => p.trim()).filter(Boolean);
    else if (arg === '--current-yaml-file' && index + 1 < argv.length) options.currentYamlFile = argv[++index];
    else throw new Error('usage: setup-form.mjs [--timeout <seconds>] [--no-open] [--programs ' + ENABLED_PROGRAMS.join(',') + '] [--current-yaml-file <path>]');
  }
  if (!Number.isFinite(options.timeout) || options.timeout <= 0) throw new Error('--timeout must be a positive number of seconds');
  const unknown = options.programs.filter((p) => !KNOWN_PROGRAMS.includes(p));
  if (unknown.length) throw new Error('--programs: unknown ' + unknown.join(', '));
  return options;
}

function locate() {
  try { return configLocation(gitLocation(process.cwd())); }
  catch { throw new Error('Open a Git project folder before configuring the pipeline'); }
}

async function readExistingConfig(file) {
  try {
    const stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('orca-pod.yaml must be a regular file, not a directory or a link');
    const text = await readFile(file, 'utf8');
    return { text, hash: createHash('sha256').update(text).digest('hex') };
  } catch (error) {
    if (error.code === 'ENOENT') return { text: '', hash: null };
    throw error;
  }
}

function openBrowser(url) {
  const [command, args] = process.platform === 'darwin'
    ? ['open', [url]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  const result = spawnSync(command, args, { stdio: 'ignore', timeout: 10000 });
  return result.status === 0;
}

const controller = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => controller.abort());

let targetPath = '';
let sourceHash = null;
let migration = null;
const setupSkillDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pipelineSkill = findPipelineSkill(setupSkillDir);
try {
  if (!pipelineSkill) {
    const error = new Error(PIPELINE_MISSING(expectedPipelineSkill(setupSkillDir)));
    error.exitCode = 2;
    throw error;
  }
  await loadSiblingModules(pipelineSkill);
  const options = parseArgs(process.argv.slice(2));
  const location = locate();
  // The old .orca-pipeline/ and orca-pipeline.yaml move into .orca-pod/ before the config is read.
  migration = migrationText(migrateLegacyConfig(location));
  if (migration) for (const line of migration.split('\n')) console.error('MIGRATION ' + line);
  const root = location.worktreeRoot;
  targetPath = location.activePath; // migrateLegacyConfig has already recomputed it: a migrated worktree file wins over the shared one
  const current = await readExistingConfig(targetPath);
  sourceHash = current.hash;
  const currentYaml = options.currentYamlFile ? readFileSync(options.currentYamlFile, 'utf8') : current.text;

  const { models, sources } = await discoverCatalogs({ cwd: root, programs: options.programs });
  for (const source of sources) console.error('CATALOG ' + source);

  const form = await startPipelineForm({ models, sources, currentYaml, targetPath, timeout: options.timeout, signal: controller.signal });
  console.error('FORM URL: ' + form.url);
  if (options.open && !openBrowser(form.url)) console.error('The browser did not open automatically — open the link manually.');
  const outcome = await form.result;
  form.close();
  // No process.exit: let the accepted Submit/Cancel response flush; the closed server ends the loop.
  console.log(JSON.stringify({ ...outcome, targetPath, sourceHash, migration, sources }));
} catch (error) {
  console.log(JSON.stringify({ status: 'error', targetPath, sourceHash, migration, url: '', error: error.message || String(error) }));
  process.exitCode = error.exitCode ?? 1;
}
