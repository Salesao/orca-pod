#!/usr/bin/env node
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { existsSync, realpathSync } from 'node:fs';
import { projectRoot, localPath, publishNewFile, replaceLocalFile, acquireMemoryLock } from './memory-files.mjs';
import { validateMemory, sameRecordPayload } from './memory-format.mjs';
import { collectCorpus, buildIndex, readIndex } from './memory-index.mjs';
import { ensureGraphify } from './graphify-runner.mjs';

const usage='Usage: memory-sync.mjs [--record -] [--index-only] [--timeout <sec>]';
function parse(args) {
  let record=false,indexOnly=false,timeoutMs=120000;
  for(let i=0;i<args.length;i++) {
    if(args[i]==='--record' && args[i+1]==='-' && !record) {record=true;i++;}
    else if(args[i]==='--index-only' && !indexOnly) indexOnly=true;
    else if(args[i]==='--timeout' && i+1<args.length) timeoutMs=Number(args[++i])*1000;
    else throw new Error(usage);
  }
  if(!Number.isFinite(timeoutMs) || timeoutMs<=0) throw new Error(usage);
  return {record,indexOnly,timeoutMs};
}
async function main() {
  let opt; try {opt=parse(process.argv.slice(2));} catch(e) {console.error(e.message);process.exitCode=2;return;}
  let input=null;
  if(opt.record) {
    try {input=JSON.parse(fs.readFileSync(0,'utf8'));} catch(e) {console.error(`Invalid record JSON: ${e.message}`);process.exitCode=1;return;}
    if (input === null || typeof input !== 'object' || Array.isArray(input)) {
      console.error('MEMORY SYNC ERROR: record must be a JSON object');
      console.log(JSON.stringify({record:'failed',index:'not-run',graph:opt.indexOnly?'not-requested':'not-run',overall:'failure'}));
      process.exitCode=1;
      return;
    }
  }
  const root=projectRoot(process.cwd());
  const state={record:opt.record?'pending':'not-requested',index:'pending',graph:opt.indexOnly?'not-requested':'pending',overall:'failure'};
  let lock;
  try {
    localPath(root,'.orca-pod/memory',{kind:'directory'});
    lock=acquireMemoryLock(root);
    const validation=validateMemory(root);
    for(const warning of validation.warnings) console.error(`WARNING ${warning.path}: ${warning.message}`);
    if(validation.errors.length) throw new Error(validation.errors.map(e=>`${e.path}: ${e.message}`).join('; '));
    if(input!==null) {
      const existing=validation.records.find(r=>r.taskId===input.taskId);
      if(existing) {
        if(!sameRecordPayload(existing,input)) throw new Error(`Record conflict: ${input.taskId}`);
        state.record='unchanged';
      } else {
        const next=validateMemory(root,{newRecord:input});
        if(next.errors.length) throw new Error(next.errors.map(e=>`${e.path}: ${e.message}`).join('; '));
        const rel=`.orca-pod/memory/records/${input.taskId}.json`;
        publishNewFile(root,rel,Buffer.from(JSON.stringify({...input,recordedAt:new Date().toISOString()},null,2)+'\n'));
        state.record='created';
      }
    }
    try {
      let previous=null;try {previous=readIndex(root);} catch { /* Missing or incompatible derived data is rebuilt by the writer. */ }
      const built=buildIndex(collectCorpus(root),previous);
      if(previous && built===previous) state.index='unchanged';
      else {
        const rel='.orca-pod/memory/.index/index.json';
        replaceLocalFile(root,rel,Buffer.from(JSON.stringify(built,null,2)+'\n'));
        state.index='updated';
      }
    } catch(e) { state.index='failed'; throw e; }
    if(!opt.indexOnly) {
      try { const graph=await ensureGraphify({cwd:root,timeoutMs:opt.timeoutMs}); state.graph=graph.status; }
      catch(e) { state.graph='failed'; throw e; }
    }
    state.overall='success';
  } catch(e) {console.error(`MEMORY SYNC ERROR: ${e.message}`);process.exitCode=1;}
  finally {if(lock) {try {lock.release();} catch(e) {console.error(`MEMORY SYNC ERROR: lock release: ${e.message}`);state.overall='failure';process.exitCode=1;}} console.log(JSON.stringify(state));}
}
if(process.argv[1] && existsSync(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(e=>{console.error(`MEMORY SYNC ERROR: ${e.message}`);process.exitCode=1;});
