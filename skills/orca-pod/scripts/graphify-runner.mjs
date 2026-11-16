import { execFile } from 'node:child_process';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { findExecutable } from './find-executable.mjs';

const exec = promisify(execFile);

async function checkOutputPath(cwd, requireGraph) {
  const dir = path.join(cwd, 'graphify-out');
  const graph = path.join(dir, 'graph.json');
  for (const [name, expected] of [[dir, 'directory'], [graph, 'file']]) {
    let stat;
    try { stat = await lstat(name); }
    catch (error) {
      if (error.code === 'ENOENT' && !requireGraph) continue;
      throw new Error(`Cannot access ${name}: ${error.message}`);
    }
    if (stat.isSymbolicLink() || (expected === 'directory' ? !stat.isDirectory() : !stat.isFile())) {
      throw new Error(`Unsafe ${expected} path: ${name}`);
    }
  }
  if (requireGraph) {
    try {
      const data = JSON.parse(await readFile(graph, 'utf8'));
      if (!data || typeof data !== 'object' || Array.isArray(data) || !Array.isArray(data.nodes) ||
          (!Array.isArray(data.links) && !Array.isArray(data.edges)) ||
          ('links' in data && !Array.isArray(data.links)) || ('edges' in data && !Array.isArray(data.edges))) {
        throw new Error('expected an object with nodes and links or edges arrays');
      }
    } catch (error) { throw new Error(`Invalid graph JSON ${graph}: ${error.message}`); }
  }
  return graph;
}

export async function ensureGraphify({ cwd, env = process.env, checkOnly = false, timeoutMs = 120000 } = {}) {
  if (!cwd || !Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('Graphify timeout must be a positive finite number and cwd is required.');
  const found = findExecutable('graphify', { env, dirs: [] });
  if (!found) throw new Error('Graphify CLI not found in PATH; setup cannot continue. Install with uv tool install graphifyy or pipx install graphifyy, then add graphify to PATH.');
  const childEnv = { ...env };
  delete childEnv.GRAPHIFY_FORCE;
  const run = async (args, timeout) => {
    try { return await exec(found.file, args, { cwd, env: childEnv, timeout, maxBuffer: 4 * 1024 * 1024 }); }
    catch (error) {
      const reason = error.killed || error.signal ? 'command timed out or was terminated' : error.stderr?.trim() || error.message;
      throw new Error(`graphify ${args.join(' ')} failed: ${reason}`);
    }
  };
  if (!checkOnly) await checkOutputPath(cwd, false);
  const result = await run(['--version'], Math.min(timeoutMs, 10000));
  const version = result.stdout.trim();
  if (!/\b\d+\.\d+(?:\.\d+)?\b/.test(version)) throw new Error('Unrecognized graphify version output.');
  if (checkOnly) return { version, graphPath: null, status: 'checked' };
  await run(['update', '.'], timeoutMs);
  const graphPath = await checkOutputPath(cwd, true);
  return { version, graphPath, status: 'updated' };
}
