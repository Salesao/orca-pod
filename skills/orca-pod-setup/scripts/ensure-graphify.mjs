#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { existsSync, realpathSync } from 'node:fs';
import { ensureGraphify } from '../../orca-pod/scripts/graphify-runner.mjs';

async function main(args) {
  let checkOnly = false;
  let timeoutMs = 120000;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--check') checkOnly = true;
    else if (args[i] === '--timeout' && i + 1 < args.length) timeoutMs = Number(args[++i]) * 1000;
    else throw new Error('Usage: ensure-graphify.mjs [--check] [--timeout <sec>]');
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('Usage: ensure-graphify.mjs [--check] [--timeout <sec>]');
  const result = await ensureGraphify({ cwd: process.cwd(), checkOnly, timeoutMs });
  console.log(`OK ${result.version}: ${result.status}${result.graphPath ? ` ${result.graphPath}` : ''}`);
}

if (process.argv[1] && existsSync(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => { console.error(`GRAPHIFY ERROR: ${error.message}`); process.exitCode = 1; });
}
