#!/usr/bin/env node
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { existsSync, realpathSync } from 'node:fs';
import { localPath, projectRoot, publishNewFile } from './memory-files.mjs';
import { memoryTemplates } from './memory-format.mjs';

function main() {
  if (process.argv.length !== 2) { console.error('Usage: memory-init.mjs'); process.exitCode = 2; return; }
  const root = projectRoot(process.cwd());
  for (const dir of ['.orca-pod', '.orca-pod/memory', '.orca-pod/memory/deltas', '.orca-pod/memory/records', '.orca-pod/memory/.index']) {
    const target = localPath(root, dir, {kind:'directory', allowMissing:true});
    try { fs.mkdirSync(target); } catch(e) { if(e.code !== 'EEXIST') throw e; localPath(root, dir, {kind:'directory'}); }
  }
  for (const [relative, content] of memoryTemplates(new Date().toISOString())) {
    localPath(root, relative, {kind:'file', allowMissing:true});
    try { publishNewFile(root, relative, Buffer.from(content)); console.log(`CREATED ${relative}`); }
    catch(e) { if(e.code !== 'EEXIST') throw e; localPath(root, relative, {kind:'file'}); console.log(`OK ${relative}`); }
  }
}
if (process.argv[1] && existsSync(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch(e) { console.error(`MEMORY INIT ERROR: ${e.message}`); process.exitCode = 1; }
}
