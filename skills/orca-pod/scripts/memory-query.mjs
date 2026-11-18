#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { existsSync, realpathSync } from 'node:fs';
import { projectRoot, readLocalFile } from './memory-files.mjs';
import { collectCorpus, readIndex, checkFreshness, searchIndex } from './memory-index.mjs';

const usage = 'Usage: memory-query.mjs search <query> [--limit N] | show <id> [--offset N] | recent [--limit N] | context';
function parse(args) {
  const command=args.shift();
  if (!['search','show','recent','context'].includes(command)) throw new Error(usage);
  let value=null, limit=8, offset=0;
  if (command==='search' || command==='show') { value=args.shift(); if (!value?.trim()) throw new Error(usage); }
  if (args.length) {
    const flag=args.shift(), number=args.shift();
    if (!number || !/^\d+$/.test(number) || args.length) throw new Error(usage);
    if ((command==='search' || command==='recent') && flag==='--limit') { limit=Number(number); if (limit<1 || limit>20) throw new Error(usage); }
    else if (command==='show' && flag==='--offset') { offset=Number(number); if (!Number.isSafeInteger(offset)) throw new Error(usage); }
    else throw new Error(usage);
  }
  return {command,value,limit,offset};
}
function view(source,index) {
  const taskId=source.id.startsWith('record:') ? source.id.slice(7) : null;
  const supersededBy=taskId ? index.sources.filter(s=>Array.isArray(s.supersedes) && s.supersedes.includes(taskId)).map(s=>s.id) : [];
  return {id:source.id,path:source.path,kind:source.kind,title:source.title,date:source.date,verification:source.verification,outcome:source.outcome,report:source.pipeline?.report ?? null,supersedes:source.supersedes ?? [],supersededBy};
}
function main() {
  let options;
  try { options=parse(process.argv.slice(2)); } catch(e) { console.error(e.message); process.exitCode=2; return; }
  const root=projectRoot(process.cwd()), index=readIndex(root);
  const sources=collectCorpus(root), freshness=checkFreshness(root,index,sources);
  let result;
  if (options.command==='search') result=searchIndex(index,options.value,options.limit);
  else if (options.command==='recent') result=index.sources.filter(s=>s.kind!=='memory').sort((a,b)=>String(b.date).localeCompare(String(a.date)) || a.id.localeCompare(b.id)).slice(0,options.limit).map(s=>view(s,index));
  else if (options.command==='show') {
    const indexed = index.sources.some(s=>s.id===options.value);
    const source=sources.find(s=>s.id===options.value) ?? index.sources.find(s=>s.id===options.value);
    if (!source) throw new Error(`Source not found: ${options.value}`);
    try {
      const chars=Array.from(readLocalFile(root,source.path).toString('utf8'));
      const text=chars.slice(options.offset,options.offset+20000).join('');
      result={...view(source,index),text,offset:options.offset,nextOffset:options.offset+20000<chars.length?options.offset+20000:null,current:true,indexed,changed:freshness.changed.includes(source.path)};
    } catch(e) { result={...view(source,index),unavailable:true,error:e.message}; process.exitCode=1; }
  } else {
    let remaining=6000, truncated=false; const pages=[];
    for (const name of ['MEMORY.md','activeContext.md']) {
      const relative=`.orca-pod/memory/${name}`;
      try { const chars=Array.from(readLocalFile(root,relative).toString('utf8')); const text=chars.slice(0,remaining).join(''); if(chars.length>remaining) truncated=true; remaining-=Array.from(text).length; pages.push({path:relative,text}); }
      catch(e) { pages.push({path:relative,unavailable:true,error:e.message}); }
    }
    const recent=index.sources.filter(s=>s.kind==='record').sort((a,b)=>String(b.date).localeCompare(String(a.date)) || a.id.localeCompare(b.id)).slice(0,5).map(s=>view(s,index));
    result={pages,truncated,recent};
  }
  const built = Date.parse(index.generatedAt);
  const snapshot = { generatedAt: index.generatedAt ?? null,
    ageSeconds: Number.isFinite(built) ? Math.max(0, Math.floor((Date.now()-built)/1000)) : null };
  console.log(JSON.stringify({status:freshness.stale?'STALE':'CURRENT',snapshot,
    ...(freshness.stale?{warning:'Read the current report or use show file:<path>. See freshness.added for sources outside the snapshot.',freshness}:{}),result},null,2));
}
if (process.argv[1] && existsSync(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch(e) { console.error(`MEMORY QUERY ERROR: ${e.message}`); process.exitCode=1; }
}
