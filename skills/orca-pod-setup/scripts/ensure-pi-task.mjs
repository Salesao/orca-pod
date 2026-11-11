#!/usr/bin/env node
// Bootstrap the required Pi question package without replacing an existing source/version.
import { execFile } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { findExecutable, envFor } from '../../orca-pod/scripts/find-executable.mjs';

const exec = promisify(execFile);
const SOURCE = 'npm:pi-task';

function installedQuestionPackage(output) {
  const lines = output.replace(/\u001b\[[0-9;]*m/g, '').split(/\r?\n/);
  let source;
  let damaged;
  for (const line of lines) {
    const heading = /^  (\S.*)$/.exec(line);
    if (heading) {
      source = heading[1].trim();
      if (/^(?:npm:)?pi-task(?:@\S+)?$/.test(source)) damaged ??= { source, usable: false };
      continue;
    }
    const directory = /^    (\S.*)$/.exec(line)?.[1].trim();
    if (!source || !directory || !path.isAbsolute(directory)) continue;
    try {
      const manifest = JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8'));
      if (manifest.name !== 'pi-task') continue;
      const extensions = manifest.pi?.extensions;
      const hasExtension = Array.isArray(extensions)
        ? extensions.some((entry) => typeof entry === 'string' && !entry.startsWith('!') && existsSync(path.resolve(directory, entry)))
        : existsSync(path.join(directory, 'extensions'));
      const entry = { source, version: manifest.version, directory, usable: hasExtension };
      if (hasExtension) return entry;
      damaged ??= entry;
    } catch { /* A configured source without installed files needs installation. */ }
  }
  if (!output.trim() || (!/packages:/i.test(output) && !/no packages installed/i.test(output))) {
    throw new Error('Pi package listing was not recognized; dependency state cannot be verified.');
  }
  return damaged ?? null;
}

export async function ensurePiTask({ env = process.env, cwd = process.cwd(), checkOnly = false, timeoutMs = 120000, signal } = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('Pi dependency timeout must be positive');
  const executable = findExecutable('pi', { env });
  if (!executable) return { status: 'skipped', reason: 'Pi CLI was not found; no Pi package was installed.' };
  const commandEnv = envFor(executable, env);
  const run = async (args, timeout) => {
    try {
      return (await exec(executable.file, args, { env: commandEnv, cwd, signal, timeout, maxBuffer: 2 * 1024 * 1024 })).stdout;
    } catch (error) {
      const reason = error.killed ? 'command timed out' : error.stderr?.trim() || error.message;
      throw new Error(`Pi package ${args[0]} failed for pi-task: ${reason}. Run pi install ${SOURCE} and /reload before using Pi planning.`, { cause: error });
    }
  };
  const existing = installedQuestionPackage(await run(['list'], Math.min(timeoutMs, 10000)));
  if (existing?.usable) return { status: 'ready', ...existing };
  if (checkOnly) throw new Error(`Pi dependency pi-task is missing. Run pi install ${SOURCE}, then /reload.`);
  const requestedSource = existing?.source ?? SOURCE;
  // Local declarations resolve from their settings file, not this command's cwd.
  const installSource = existing?.directory && (requestedSource.startsWith('.') || path.isAbsolute(requestedSource))
    ? existing.directory : requestedSource;
  await run(['install', installSource], timeoutMs);
  const installed = installedQuestionPackage(await run(['list'], Math.min(timeoutMs, 10000)));
  if (!installed?.usable) throw new Error(`Pi reported success but pi-task installation could not be verified. Run pi install ${SOURCE}, then /reload.`);
  return { status: 'installed', ...installed };
}

async function main() {
  const options = {};
  for (let index = 2; index < process.argv.length; index++) {
    const arg = process.argv[index];
    if (arg === '--check') options.checkOnly = true;
    else if (arg === '--timeout' && index + 1 < process.argv.length) options.timeoutMs = Number(process.argv[++index]) * 1000;
    else throw new Error('usage: ensure-pi-task.mjs [--check] [--timeout <seconds>]');
  }
  const result = await ensurePiTask(options);
  if (result.status === 'skipped') console.log(`SKIP ${result.reason}`);
  else if (result.status === 'installed') console.log(`INSTALLED ${result.source} (${result.version ?? 'version unknown'}). Run /reload in Pi or restart it to load pi_task.`);
  else console.log(`OK pi-task is installed from ${result.source} (${result.version ?? 'version unknown'}).`);
}

if (process.argv[1] && existsSync(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(`PI DEPENDENCY ERROR: ${error.message}`); process.exitCode = 1; });
}
