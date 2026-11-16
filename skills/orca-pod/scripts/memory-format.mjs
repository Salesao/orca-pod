import fs from 'node:fs';
import path from 'node:path';
import { localPath, readLocalFile } from './memory-files.mjs';

const base = '.orca-pod/memory';
const categories = { 'MEMORY.md':'context', 'log.md':'context', 'activeContext.md':'context', 'architecture.md':'architecture', 'patterns.md':'patterns', 'anti-patterns.md':'anti-patterns', 'conventions.md':'conventions' };
const idPattern = /^[A-Za-z0-9_-]{1,120}$/;
const text = value => typeof value === 'string' && value.trim().length > 0;
const strings = value => Array.isArray(value) && value.every(x => typeof x === 'string');
const issue = (path, message) => ({path, message});
function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)?$/.test(value)) return false;
  const date = new Date(value);
  if (!Number.isFinite(date.valueOf())) return false;
  if (date.toISOString().slice(0, 10) !== value.slice(0, 10)) return false;
  if (value.length > 10 && date.toISOString().slice(0, 19) !== value.slice(0, 19)) return false;
  return true;
}
export function memoryTemplates(isoDate) {
  const templates = new Map();
  for (const [file, category] of Object.entries(categories)) {
    const header = `---\ncategory: ${category}\ntags: []\nupdated: ${isoDate}\nrelated: []\n---\n\n`;
    let body;
    if (file === 'MEMORY.md') {
      body = '# Project memory\n\n' + Object.keys(categories).map(name => `- [${name}](${name}) — ${name === 'MEMORY.md' ? 'Memory index' : `Project ${name.slice(0,-3)} notes`}`).join('\n') + '\n- [Decisions](deltas/) — Accepted decisions\n- [Results](records/) — Task results\n';
    } else {
      const sections = { 'log.md':['Chronology'], 'activeContext.md':['Current work','Known issues','Next steps'], 'architecture.md':['Modules','Connections','Decisions'], 'patterns.md':['Patterns'], 'anti-patterns.md':['Anti-patterns'], 'conventions.md':['Naming','Style','Testing'] };
      body = `# ${file.slice(0,-3)}\n\n` + sections[file].map(s => `## ${s}\n`).join('\n');
    }
    templates.set(`${base}/${file}`, header + body);
  }
  return templates;
}
function parsePage(relative, value, delta, errors) {
  const lines = value.split(/\r?\n/);
  if (lines[0] !== '---') { errors.push(issue(relative,'Missing frontmatter')); return null; }
  const end = lines.indexOf('---',1);
  if (end < 0) { errors.push(issue(relative,'Missing frontmatter terminator')); return null; }
  const fields = {};
  for (const line of lines.slice(1,end)) {
    if (!line.trim()) continue;
    const match = /^([a-z]+): (.*)$/.exec(line);
    if (!match || Object.hasOwn(fields,match[1])) { errors.push(issue(relative,'Unsupported or duplicate frontmatter')); continue; }
    fields[match[1]] = match[2];
  }
  const keys = delta ? ['type','status','date','commit','tags','related'] : ['category','tags','updated','related'];
  for (const key of Object.keys(fields)) if (!keys.includes(key)) errors.push(issue(relative,`Unsupported field ${key}`));
  for (const key of keys) if (!(key in fields)) errors.push(issue(relative,`Missing field ${key}`));
  for (const key of ['tags','related']) {
    try { const array = JSON.parse(fields[key]); if (!strings(array)) throw Error(); fields[key] = array; }
    catch { errors.push(issue(relative,`${key} must be a JSON array of strings`)); fields[key] = []; }
  }
  if (!validDate(fields[delta ? 'date' : 'updated'])) errors.push(issue(relative,'Invalid date'));
  if (delta) {
    if (fields.type !== 'delta' || fields.status !== 'accepted') errors.push(issue(relative,'Invalid delta type/status'));
    if (!/^(null|[0-9a-fA-F]{40}|[0-9a-fA-F]{64})$/.test(fields.commit ?? '')) errors.push(issue(relative,'Invalid commit'));
  } else if (!Object.values(categories).includes(fields.category)) errors.push(issue(relative,'Invalid category'));
  return { fields, body:lines.slice(end+1).join('\n') };
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).filter(k => k !== 'recordedAt').sort().map(k => [k, canonical(value[k])]));
  return value;
}
export function sameRecordPayload(a,b) { return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b)); }
export function validateRecord(record, {root, existingRecords = [], historical = false} = {}) {
  const errors = [], warnings = [], rel = `${base}/records/${record?.taskId ?? '?'} .json`.replace(' .json','.json');
  const add = message => errors.push(issue(rel,message));
  if (!record || typeof record !== 'object' || Array.isArray(record)) { add('Record must be an object'); return {errors,warnings}; }
  const expected = ['schemaVersion','taskId','mode','title','summary','outcome','verification','tags','items','supersedes'];
  if (record.mode === 'pipeline') expected.push('pipeline');
  if (historical) expected.push('recordedAt');
  for (const key of expected) if (!(key in record)) add(`Missing ${key}`);
  for (const key of Object.keys(record)) if (!expected.includes(key)) add(`Unsupported ${key}`);
  if (record.schemaVersion !== 1 || typeof record.taskId !== 'string' || !idPattern.test(record.taskId)) add('Invalid schemaVersion or taskId');
  if (!['pipeline','standalone'].includes(record.mode)) add('Invalid mode');
  if (!text(record.title) || !text(record.summary)) add('Title and summary required');
  if (!['completed','partial','blocked'].includes(record.outcome)) add('Invalid outcome');
  if (!['reviewed','self-checked','not-checked'].includes(record.verification) || (record.mode === 'standalone' && record.verification === 'reviewed')) add('Invalid verification');
  if (!strings(record.tags) || !strings(record.supersedes)) add('Invalid tags or supersedes');
  if (historical && !validDate(record.recordedAt)) add('Invalid recordedAt');
  if (Array.isArray(record.supersedes)) for (const id of record.supersedes) if (id === record.taskId || !existingRecords.some(r => r.taskId === id)) add(`Invalid supersedes ${id}`);
  const checkFile = source => {
    if (typeof source !== 'string' || !source || path.isAbsolute(source) || source.includes('\\') || source.split('/').some(part => !part || part === '.' || part === '..')) {
      add(`Unsafe source path: ${source}`);
      return;
    }
    try { localPath(root, source, {kind:'file'}); }
    catch(e) { (historical ? warnings : errors).push(issue(rel,`source unavailable ${source}: ${e.message}`)); }
  };
  if (!Array.isArray(record.items)) add('Invalid items');
  else for (const item of record.items) {
    if (!item || typeof item !== 'object' || !['decision','fact','fix','open-question'].includes(item.kind) || !['user-stated','observed','inferred'].includes(item.basis) || !text(item.text) || !Array.isArray(item.sources)) { add('Invalid item'); continue; }
    if (item.kind !== 'open-question' && item.basis !== 'inferred' && item.sources.length === 0) add('Fact requires a source');
    for (const source of item.sources) {
      if (!source || !text(source.note)) { add('Invalid source'); continue; }
      if (source.kind === 'file' && text(source.path)) checkFile(source.path);
      else if (source.kind !== 'conversation' || !text(source.reference)) add('Invalid source');
    }
  }
  if (record.mode === 'pipeline') {
    const p = record.pipeline;
    if (!p || typeof p !== 'object' || !text(p.planVersion) || !text(p.stage) || !['full','reviewer','chief','self'].includes(p.reviewMode) || typeof p.finalStage !== 'boolean') add('Invalid pipeline');
    else {
      if (record.outcome === 'completed') {
        const verdict = p.reviewMode === 'self' ? 'SELF_VERIFIED' : p.finalStage ? 'FINAL_APPROVED' : 'APPROVED';
        if (p.verdict !== verdict || !text(p.report)) add('Invalid completed verdict/report');
      } else if (p.verdict === null && p.report === null) {
        if (record.verification === 'reviewed') add('No review can be claimed without a report');
      } else if (!text(p.verdict) || !text(p.report)) add('Verdict and report must be paired');
      if (text(p.report)) checkFile(p.report);
    }
  }
  return {errors,warnings};
}
export function validateMemory(root, {newRecord = null} = {}) {
  const errors = [], warnings = [], pages = [], records = [];
  for (const dir of [base, `${base}/deltas`, `${base}/records`, `${base}/.index`]) {
    try { localPath(root,dir,{kind:'directory'}); } catch(e) { errors.push(issue(dir,e.message)); }
  }
  function walk(relative) {
    let names; try { names = fs.readdirSync(localPath(root,relative,{kind:'directory'})); } catch (e) { errors.push(issue(relative,`Unable to read directory; page counts may be incomplete: ${e.message}`)); return; }
    for (const name of names) {
      const rel = `${relative}/${name}`;
      try {
        const target = localPath(root,rel); const st = fs.lstatSync(target);
        if (st.isDirectory()) { if (rel !== `${base}/.index` && rel !== `${base}/records`) walk(rel); }
        else if (st.isFile() && name.endsWith('.md')) {
          const content = readLocalFile(root,rel).toString('utf8');
          const delta = relative === `${base}/deltas`;
          const parsed = parsePage(rel,content,delta,errors);
          if (parsed) {
            if (categories[name] && relative === base && parsed.fields.category !== categories[name]) errors.push(issue(rel,'Incorrect category for page'));
            for (const related of parsed.fields.related) { try { if (!related.endsWith('.md')) throw Error('not Markdown'); localPath(root,`${base}/${related}`,{kind:'file'}); } catch(e) { errors.push(issue(rel,`Invalid related ${related}: ${e.message}`)); } }
            pages.push({path:rel,text:content,metadata:parsed.fields});
            if (delta) {
              const match = /^(\d{4,})-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/.exec(name);
              if (!match || Number(match[1]) < 1 || !new RegExp(`^# ADR-${match?.[1]}: \\S`, 'm').test(parsed.body)) errors.push(issue(rel,'Invalid ADR name or heading'));
              for (const heading of ['Context','Decision','Consequences']) if (!parsed.body.split('\n').includes(`## ${heading}`)) errors.push(issue(rel,`Missing ${heading}`));
            }
          }
        } else if (relative === `${base}/deltas`) errors.push(issue(rel,'Unsupported delta entry'));
      } catch(e) { errors.push(issue(rel,e.message)); }
    }
  }
  walk(base);
  for (const name of Object.keys(categories)) if (!pages.some(p => p.path === `${base}/${name}`)) errors.push(issue(`${base}/${name}`,'Missing required page'));
  const deltas = pages.filter(p=>p.path.startsWith(`${base}/deltas/`)).map(p=>Number(path.basename(p.path).split('-')[0])).sort((a,b)=>a-b);
  if (deltas.some((n,i)=>n!==i+1)) errors.push(issue(`${base}/deltas`,'Non-sequential or duplicate ADR number'));
  const index = pages.find(p=>p.path === `${base}/MEMORY.md`);
  if (index) {
    const entries = [];
    for (const line of index.text.split(/\r?\n/)) {
      if (!line.includes('](') && !line.startsWith('- [')) continue;
      const m = /^- \[([^\]]+)\]\(([^\s()#?]+)\) — (\S.*)$/.exec(line);
      if (!m) { errors.push(issue(index.path,'Unsupported index link')); continue; }
      if (m[2] === 'deltas/' || m[2] === 'records/') continue;
      entries.push(`${base}/${m[2]}`);
    }
    for (const page of pages) if (entries.filter(e=>e===page.path).length !== 1) errors.push(issue(index.path,`Page missing or duplicated: ${page.path}`));
    for (const entry of entries) if (!pages.some(p=>p.path===entry)) errors.push(issue(index.path,`Unknown index page: ${entry}`));
  }
  try {
    for (const name of fs.readdirSync(localPath(root,`${base}/records`,{kind:'directory'}))) {
      const rel = `${base}/records/${name}`;
      try { if (!name.endsWith('.json')) throw Error('Unsupported record name'); const record = JSON.parse(readLocalFile(root,rel)); if (`${record.taskId}.json` !== name) throw Error('Record filename mismatch'); records.push(record); }
      catch(e) { errors.push(issue(rel,e.message)); }
    }
  } catch (e) { errors.push(issue(`${base}/records`,`Unable to read directory; record count is incomplete: ${e.message}`)); }
  for (const record of records) { const result = validateRecord(record,{root,existingRecords:records,historical:true}); errors.push(...result.errors); warnings.push(...result.warnings); }
  if (newRecord) { const result = validateRecord(newRecord,{root,existingRecords:records,historical:false}); errors.push(...result.errors); warnings.push(...result.warnings); }
  return {errors,warnings,pages,records};
}
