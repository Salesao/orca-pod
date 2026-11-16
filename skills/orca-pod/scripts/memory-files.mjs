import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export function projectRoot(cwd) { return fs.realpathSync(cwd); }

export function localPath(root, relative, { kind, allowMissing = false } = {}) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative) || relative.includes('\\') || relative.split('/').some(s => !s || s === '.' || s === '..')) throw new Error(`Unsafe relative path: ${relative}`);
  const base = projectRoot(root);
  const parts = relative.split('/');
  let target = base;
  for (let i = 0; i < parts.length; i++) {
    target = path.join(target, parts[i]);
    let stat;
    try { stat = fs.lstatSync(target); } catch (e) {
      if (e.code === 'ENOENT' && allowMissing) return path.join(base, ...parts);
      throw e;
    }
    if (stat.isSymbolicLink()) throw new Error(`Symlink not allowed: ${target}`);
    if (i < parts.length - 1 && !stat.isDirectory()) throw new Error(`Not a directory: ${target}`);
    if (i === parts.length - 1 && kind === 'file' && !stat.isFile()) throw new Error(`Not a file: ${target}`);
    if (i === parts.length - 1 && kind === 'directory' && !stat.isDirectory()) throw new Error(`Not a directory: ${target}`);
  }
  return target;
}

export function readLocalFile(root, relative) { return fs.readFileSync(localPath(root, relative, {kind:'file'})); }

function temporary(target) { return path.join(path.dirname(target), `.orca-memory-${process.pid}-${crypto.randomBytes(8).toString('hex')}.tmp`); }
function publish(root, relative, bytes, replace) {
  const target = localPath(root, relative, { kind:'file', allowMissing:true });
  localPath(root, path.relative(projectRoot(root), path.dirname(target)).split(path.sep).join('/'), {kind:'directory'});
  const temp = temporary(target);
  let created = false;
  try {
    fs.writeFileSync(temp, bytes, {flag:'wx'}); created = true;
    localPath(root, relative, {kind:'file', allowMissing:true});
    if (replace) fs.renameSync(temp, target);
    else fs.linkSync(temp, target);
  } finally { if (created) { try { fs.unlinkSync(temp); } catch(e) { if(e.code !== 'ENOENT') throw e; } } }
}
export function publishNewFile(root, relative, bytes) { publish(root, relative, bytes, false); }
export function replaceLocalFile(root, relative, bytes) { publish(root, relative, bytes, true); }
export function acquireMemoryLock(root) {
  const relative = '.orca-pod/memory/.sync.lock';
  const file = localPath(root, relative, {kind:'file', allowMissing:true});
  let fd;
  try { fd = fs.openSync(file, 'wx'); }
  catch (e) { if(e.code === 'EEXIST') throw new Error(`Memory lock is occupied: ${file}; check its owner before removing it.`); throw e; }
  const stat = fs.fstatSync(fd);
  fs.writeFileSync(fd, `${process.pid}\n`);
  fs.closeSync(fd);
  return {release() { const current = fs.lstatSync(file); if (current.isSymbolicLink() || current.ino !== stat.ino || current.dev !== stat.dev) throw new Error(`Memory lock changed: ${file}`); fs.unlinkSync(file); }};
}
