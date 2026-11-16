#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { existsSync, realpathSync } from 'node:fs';
import { validateMemory } from './memory-format.mjs';
import { projectRoot } from './memory-files.mjs';

function main() {
  if (process.argv.length !== 2) { console.error('Usage: memory-lint.mjs'); process.exitCode = 2; return; }
  const result = validateMemory(projectRoot(process.cwd()));
  for (const entry of result.errors) console.error(`ERROR ${entry.path}: ${entry.message}`);
  for (const entry of result.warnings) console.error(`WARNING ${entry.path}: ${entry.message}`);
  console.log(`Checked ${result.pages.length} pages and ${result.records.length} records; structure only.`);
  if (result.errors.length) process.exitCode = 1;
}
if (process.argv[1] && existsSync(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch(e) { console.error(`MEMORY LINT ERROR: ${e.message}`); process.exitCode = 1; }
}
