// Private, per-generation records. Only the role key, run ID and generation select files.
import { constants, closeSync, fstatSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { ROLE_KEYS } from './pipeline-config.mjs';

function checkDirectory(file) {
  const directory = path.dirname(file);
  if (realpathSync(directory) !== directory) throw new Error('Role record directory changed');
}

function readRecord(file) {
  checkDirectory(file);
  let fd;
  try {
    if (!lstatSync(file).isFile()) throw new Error('Role records must be regular files');
    fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > 32 * 1024) throw new Error('Invalid role record on disk');
    return JSON.parse(readFileSync(fd, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  } finally { if (fd !== undefined) closeSync(fd); }
}

function writeRecord(dest, value, exclusive) {
  checkDirectory(dest);
  const temp = path.join(path.dirname(dest), randomUUID());
  try {
    writeFileSync(temp, JSON.stringify(value) + '\n', { flag: 'wx', mode: 0o600 });
    if (exclusive) linkSync(temp, dest);
    else renameSync(temp, dest);
  } finally { rmSync(temp, { force: true }); }
}

export function roleRecords(root, run, role, create = false) {
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(run ?? '') || !ROLE_KEYS.includes(role)) throw new Error('Provide a valid --run and --role');
  let directory = root;
  for (const part of ['.orca-pod', 'runs', run, role]) {
    directory = path.join(directory, part);
    if (create) {
      try { mkdirSync(directory, { mode: 0o700 }); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    if (!lstatSync(directory).isDirectory()) throw new Error('Role records require real project directories');
  }
  const protectRuns = () => {
    const ignore = path.join(root, '.orca-pod', 'runs', '.gitignore');
    checkDirectory(ignore);
    try { writeFileSync(ignore, '*\n', { flag: 'wx', mode: 0o600 }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  };
  if (create) protectRuns();
  const recordPath = (generation, kind) => {
    if (!Number.isSafeInteger(generation) || generation < 1 ||
        !['claim', 'rejected', 'bound', 'process', 'runtime', 'diagnostic', 'exit'].includes(kind)) throw new Error('Invalid role record');
    return path.join(directory, `${generation}.${kind}.json`);
  };
  return {
    latest() {
      return readdirSync(directory).reduce((latest, name) => Math.max(latest, Number(/^(\d+)\.claim\.json$/.exec(name)?.[1] ?? 0)), 0);
    },
    read(generation, kind) { return readRecord(recordPath(generation, kind)); },
    write(generation, kind, value, exclusive = false) {
      if (kind === 'diagnostic') protectRuns();
      writeRecord(recordPath(generation, kind), value, exclusive);
    },
    bindRun(value) {
      const file = path.join(path.dirname(directory), 'profile.json');
      try { writeRecord(file, value, true); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const saved = readRecord(file);
        if (!saved || Object.keys(value).some(key => saved[key] !== value[key])) {
          throw new Error('Run workspace, profile or configured launch policy changed');
        }
      }
    },
  };
}

const helperReasons = ['registration_failed', 'model_unresolved', 'tool_unavailable', 'incompatible_adapter', 'status_unverified', 'invalid_policy'];

// Called in the Pi parent's session_start. Unknown observations stay null; no environment
// paths, unstructured provider text, bearer tokens or model registry objects get serialized.
export function recordPiRuntime({ model, thinking, helpers, helperReason, source = 'pi session_start' }) {
  try {
    const env = process.env;
    if (!env.ORCA_POD_RUN || env.ORCA_POD_RUNTIME_PARENT !== String(process.ppid)) return;
    const generation = Number(env.ORCA_POD_GENERATION);
    const records = roleRecords(process.cwd(), env.ORCA_POD_RUN, env.ORCA_POD_ROLE);
    const bound = records.read(generation, 'bound');
    if (!bound || bound.address !== env.ORCA_TERMINAL_HANDLE || bound.provider !== 'pi') return;
    records.write(generation, 'runtime', {
      source: ['pi session_start', 'pi adapter ready', 'pi before_agent_start'].includes(source) ? source : 'pi session', observedAt: new Date().toISOString(),
      model: typeof model === 'string' && /^[\w.][\w.\-/:@+]{0,255}$/.test(model) ? model : null,
      thinking: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra', 'auto'].includes(thinking) ? thinking : null,
      helpers: ['ready', 'unverified', 'unavailable', 'disabled'].includes(helpers) ? helpers : 'unverified',
      helperReason: helperReasons.includes(helperReason) ? helperReason : null,
    });
  } catch { /* A failed observation leaves runtime values unknown; it cannot stop the role. */ }
}
