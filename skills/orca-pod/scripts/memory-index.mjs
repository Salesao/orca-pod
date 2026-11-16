import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { localPath, readLocalFile } from './memory-files.mjs';

const indexPath = '.orca-pod/memory/.index/index.json';
const normalize = value => String(value ?? '').normalize('NFKC').toLowerCase();
const words = value => normalize(value).match(/[\p{L}\p{N}_]+/gu) ?? [];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function listFiles(root, rel, out) {
  let dir;
  try { dir = localPath(root, rel, {kind:'directory'}); }
  catch (e) { if (e.code === 'ENOENT') return; throw e; }
  for (const entry of fs.readdirSync(dir, {withFileTypes:true})) {
    const child = `${rel}/${entry.name}`;
    if (entry.isSymbolicLink() || entry.name.startsWith('.')) continue;
    const reportDirectory = rel === '.orca-pod/reports' || rel.startsWith('.orca-pod/reports/');
    if (entry.isDirectory() && reportDirectory && ['baseline','snapshot','snapshots'].includes(entry.name)) continue;
    if (entry.isDirectory()) listFiles(root, child, out);
    else if (entry.isFile() && /\.md$/i.test(entry.name)) out.push(child);
  }
}
function extractTitle(text, fallback) { return /^#\s+(.+)$/m.exec(text)?.[1].trim() || fallback; }
export function collectCorpus(root) {
  const files = [];
  listFiles(root, '.orca-pod/memory', files);
  listFiles(root, 'docs/superpowers', files);
  listFiles(root, '.orca-pod/reports', files);
  const recordsDir = '.orca-pod/memory/records';
  try {
    for (const ent of fs.readdirSync(localPath(root, recordsDir, {kind:'directory'}),{withFileTypes:true})) {
      if (ent.isFile() && !ent.isSymbolicLink() && ent.name.endsWith('.json')) files.push(`${recordsDir}/${ent.name}`);
    }
  } catch (e) { if (e.code !== 'ENOENT') throw e; }
  return files.sort().map(relative => {
    const bytes = readLocalFile(root, relative), content = bytes.toString('utf8');
    let record = null;
    if (relative.startsWith(`${recordsDir}/`)) {
      try { record = JSON.parse(content); } catch (error) { throw new Error(`Invalid record ${relative}: ${error.message}`); }
    }
    const kind = record ? 'record' : relative.startsWith('.orca-pod/memory/') ? 'memory' : relative.startsWith('.orca-pod/reports/') ? 'report' : relative.includes('/specs/') ? 'spec' : relative.includes('/plans/') ? 'plan' : 'document';
    const tags = record?.tags ?? (()=>{ const match = /^tags: (\[.*\])$/m.exec(content); try { return match ? JSON.parse(match[1]) : []; } catch { return []; } })();
    return {id:record ? `record:${record.taskId}` : `file:${relative}`,path:relative,kind,text:content,title:record?.title ?? extractTitle(content,path.basename(relative)),tags:Array.isArray(tags)?tags:[],summary:record?.summary ?? '',date:record?.recordedAt ?? fs.statSync(localPath(root,relative,{kind:'file'})).mtime.toISOString(),fingerprint:hash(bytes),verification:record?.verification ?? 'unknown',outcome:record?.outcome ?? 'unknown',pipeline:record?.pipeline ?? null,supersedes:record?.supersedes ?? []};
  });
}
export function buildIndex(sources, previous = null) {
  const old = new Map((previous?.sources ?? []).map(source=>[source.id, source]));
  const indexed = sources.map(source=>{
    const prior = old.get(source.id);
    if (prior && prior.fingerprint === source.fingerprint && prior.path === source.path && prior.kind === source.kind && prior.search) return prior;
    return {...source, search:{title:normalize(source.title),tags:normalize(source.tags.join(' ')),summary:normalize(source.summary),body:normalize(source.text)}};
  });
  if (previous?.schemaVersion === 1 && previous?.algorithmVersion === 1 && JSON.stringify(indexed) === JSON.stringify(previous.sources)) return previous;
  return {schemaVersion:1,algorithmVersion:1,generatedAt:new Date().toISOString(),sources:indexed};
}
export function readIndex(root) {
  let data;
  try { data = JSON.parse(readLocalFile(root,indexPath).toString('utf8')); }
  catch (e) { throw new Error(`Index unavailable or invalid: ${e.message}; ask the authorized writer to run memory-sync.mjs --index-only.`); }
  if (!data || data.schemaVersion !== 1 || data.algorithmVersion !== 1 || !Array.isArray(data.sources) || data.sources.some(s=>!s || typeof s.id !== 'string' || typeof s.path !== 'string' || !s.search || typeof s.search.body !== 'string')) throw new Error('Incompatible search index; ask the authorized writer to run memory-sync.mjs --index-only.');
  return data;
}
export function checkFreshness(root,index) {
  const previous = new Map(index.sources.map(s=>[s.id,s]));
  const current = new Map(collectCorpus(root).map(s=>[s.id,s]));
  const changed=[],missing=[],added=[];
  for (const [id,s] of previous) { if (!current.has(id)) missing.push(s.path); else if (current.get(id).fingerprint !== s.fingerprint) changed.push(s.path); }
  for (const [id,s] of current) if (!previous.has(id)) added.push(s.path);
  return {stale:!!(changed.length+missing.length+added.length),changed,missing,added};
}
export function searchIndex(index,query,limit=8) {
  const tokens = [...new Set(words(query))], phrase=normalize(query).trim();
  if (!tokens.length) return [];
  const weights={title:6,tags:5,summary:4,body:1};
  const results=[];
  for (const source of index.sources) {
    const fields=source.search;
    const match=(field,token)=>{const all=words(field);return all.includes(token) || (token.length>=3 && field.includes(token));};
    if (!tokens.every(token=>Object.keys(weights).some(key=>match(fields[key] ?? '',token)))) continue;
    const exact=Object.keys(weights).some(key=>(fields[key]??'').includes(phrase)) ? 1 : 0;
    let score=0; for (const [key,weight] of Object.entries(weights)) for (const token of tokens) if(match(fields[key]??'',token)) score+=weight;
    const taskId=source.id.startsWith('record:') ? source.id.slice(7) : null;
    const supersededBy=taskId ? index.sources.filter(s=>Array.isArray(s.supersedes) && s.supersedes.includes(taskId)).map(s=>s.id) : [];
    results.push({id:source.id,path:source.path,kind:source.kind,title:source.title,excerpt:(source.summary || source.text.replace(/\s+/g,' ').trim()).slice(0,300),date:source.date,verification:source.verification,outcome:source.outcome,report:source.pipeline?.report ?? null,supersedes:source.supersedes ?? [],supersededBy,score,exact});
  }
  results.sort((a,b)=>b.exact-a.exact || b.score-a.score || String(b.date).localeCompare(String(a.date)) || a.id.localeCompare(b.id));
  return results.slice(0,limit);
}
