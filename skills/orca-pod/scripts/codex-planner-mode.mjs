#!/usr/bin/env node
import { execFile, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { closeSync, openSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { orcaCommand } from './orca-command.mjs';

const exec = promisify(execFile);
const digest = (content) => createHash('sha256').update(content).digest('hex');

async function requireMode(terminal, mode, session) {
  await terminal.wait();
  const current = await terminal.status();
  if (current.mode !== mode || (session && current.session !== session)) {
    throw new Error(`Could not verify ${mode} in the same Codex Planner session (observed ${current.mode ?? 'unknown'})`);
  }
  return current;
}

export async function preparePlanner(terminal, firstPrompt) {
  await terminal.wait();
  const initial = await terminal.status();
  if (initial.mode !== 'Plan') {
    await terminal.enterPlan();
    await requireMode(terminal, 'Plan', initial.session);
  }
  if (firstPrompt) await terminal.send(firstPrompt);
}

export async function savePlannerDocuments(terminal, write, continuation, expectedSession) {
  const { session } = await requireMode(terminal, 'Plan', expectedSession);
  let failure;
  try {
    await terminal.exitPlan();
    await requireMode(terminal, 'Default', session);
    await write();
  } catch (error) {
    failure = error;
  } finally {
    await terminal.enterPlan();
    await requireMode(terminal, 'Plan', session);
  }
  if (failure) {
    if (continuation) await terminal.send(`PLANNING SAVE FAILED: ${failure.message}. Do not ask for approval or hand off these documents.`);
    throw failure;
  }
  if (continuation) await terminal.send(`PLANNING DOCUMENTS SAVED. Plan mode verified. ${continuation}`);
}

export function readCodexStatus(tail) {
  const text = tail.join('\n');
  const mode = [...text.matchAll(/Collaboration mode:\s+(Plan|Default)\b/g)].at(-1)?.[1];
  const session = [...text.matchAll(/Session:\s+([a-f0-9-]{36})\b/gi)].at(-1)?.[1];
  if (!mode || !session) throw new Error('Codex /status did not expose a recognizable collaboration mode and session');
  return { mode, session };
}

export async function readCurrentCodexStatus(call, requestStatus, wait = delay) {
  const { terminal: before } = await call('read', ['--limit', '1']);
  if (before.nextCursor === undefined) throw new Error('Orca did not supply a terminal read cursor');
  await requestStatus();
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const { terminal: fresh } = await call('read', ['--cursor', String(before.nextCursor), '--limit', '45']);
    try {
      const status = readCodexStatus(fresh.tail);
      const { terminal: rendered } = await call('read', ['--screen', '--limit', '45']);
      if (rendered.source === 'screen') {
        const visible = readCodexStatus(rendered.tail);
        if (status.mode === visible.mode && status.session === visible.session) return visible;
      }
    } catch (error) {
      if (!(error instanceof Error)) throw error;
    }
    if (attempt < 11) await wait(150);
  }
  throw new Error('Could not verify fresh Codex /status evidence in the rendered Orca terminal');
}

export function orcaTerminal(handle, command = orcaCommand()) {
  if (!/^term_[a-z0-9-]+$/i.test(handle ?? '')) {
    throw new Error('Codex Planner mode control requires a terminal handle; chat sessions do not support TUI commands or the terminal Stop hook');
  }
  async function call(action, args = []) {
    const { stdout } = await exec(command, ['terminal', action, '--terminal', handle, ...args, '--json'], { timeout: 65000, maxBuffer: 1024 * 1024 });
    const response = JSON.parse(stdout);
    if (!response.ok) throw new Error(`Orca terminal ${action} failed`);
    return response.result;
  }
  const send = async (...args) => {
    const { send: receipt } = await call('send', args);
    if (!receipt?.accepted) throw new Error('Orca did not accept input for the Codex Planner');
  };
  let incarnation;
  const identify = async () => {
    const { terminal } = await call('show');
    if (!terminal?.incarnationId || !terminal.writable || (incarnation && terminal.incarnationId !== incarnation)) {
      throw new Error('Orca Planner terminal changed or is no longer writable');
    }
    incarnation ??= terminal.incarnationId;
    return terminal;
  };
  return {
    identify,
    async wait() {
      await identify();
      const { wait } = await call('wait', ['--for', 'tui-idle', '--timeout-ms', '60000']);
      if (!wait?.satisfied) throw new Error(`Codex Planner is not ready (${wait?.blockedReason ?? 'idle timeout'})`);
    },
    async status() {
      await identify();
      return readCurrentCodexStatus(call, () => send('--text', '/status', '--enter'));
    },
    async enterPlan() { await identify(); await send('--text', '/plan', '--enter'); },
    async exitPlan() { await identify(); await send('--text', '\u001b[Z'); },
    async send(text) { await identify(); await send('--text', text, '--enter', '--wait-submit', '5'); },
  };
}

const PLANNING_PATH = /^(?:docs\/superpowers\/(?:specs|plans)\/|\.orca-pod\/(?:specs|plans|reports)\/)[^\\]+\.md$/;

export function validateSaveRequest(value) {
  if (!Array.isArray(value?.documents) || !value.documents.length || value.documents.length > 8) throw new Error('Provide 1–8 named Markdown planning documents');
  const names = new Set();
  for (const document of value.documents) {
    const name = document?.path;
    if (typeof name !== 'string' || !PLANNING_PATH.test(name) || path.posix.normalize(name) !== name ||
      /[\u0000-\u001f]/.test(name) || names.has(name) || typeof document.content !== 'string' ||
      !(document.expectedHash === null || /^[a-f0-9]{64}$/.test(document.expectedHash))) {
      throw new Error('Each planning document needs a unique allowed path, content and expectedHash (null for a new file)');
    }
    names.add(name);
  }
  if (typeof value.continuation !== 'string' || !value.continuation.trim() || value.continuation.length > 1000) throw new Error('Provide the next planning step as continuation');
  return value;
}

async function writeDocuments(root, documents) {
  const staged = [];
  try {
    for (const document of documents) {
      const parts = document.path.split('/');
      let directory = root;
      for (const part of parts.slice(0, -1)) {
        directory = path.join(directory, part);
        await fs.mkdir(directory).catch((error) => { if (error.code !== 'EEXIST') throw error; });
        if (!(await fs.lstat(directory)).isDirectory()) throw new Error(`Planning directory is not a real directory: ${directory}`);
      }
      const target = path.join(directory, parts.at(-1));
      const verify = async () => {
        const stat = await fs.lstat(target).catch((error) => { if (error.code !== 'ENOENT') throw error; return null; });
        if (stat && !stat.isFile()) throw new Error(`Planning path is not a regular file: ${document.path}`);
        const actual = stat ? digest(await fs.readFile(target)) : null;
        if (actual !== document.expectedHash) throw new Error(`Planning document changed since it was read: ${document.path}`);
        return stat;
      };
      const stat = await verify();
      const temporary = `${target}.pending-${randomUUID()}`;
      staged.push({ target, temporary, verify, content: document.content });
      await fs.writeFile(temporary, document.content, { flag: 'wx', mode: stat ? stat.mode & 0o777 : 0o644 });
    }
    for (const { verify } of staged) await verify();
    for (const { target, temporary, verify, content } of staged) {
      const current = await verify();
      if (current) await fs.rename(temporary, target);
      else await fs.link(temporary, target);
      if (digest(await fs.readFile(target)) !== digest(content)) throw new Error(`Planning write could not be verified: ${target}`);
    }
  } finally {
    await Promise.all(staged.map(({ temporary }) => fs.rm(temporary, { force: true })));
  }
}

async function readInput() {
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > 512 * 1024) throw new Error('Planning payload exceeds 512 KiB');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString();
}

export function parseStopSave(input) {
  const text = input?.last_assistant_message?.trim();
  if (input?.hook_event_name !== 'Stop' || input.stop_hook_active || !text?.startsWith('ORCA_POD_PLANNING_SAVE\n')) return null;
  if (!/^[a-f0-9-]{36}$/i.test(input.session_id ?? '')) throw new Error('Codex Stop hook did not provide a session ID');
  return {
    request: validateSaveRequest(JSON.parse(text.slice('ORCA_POD_PLANNING_SAVE\n'.length))),
    session: input.session_id,
  };
}

async function main([operation, handle, expectedSession, ...extra]) {
  if (operation === '--stop-hook' && !handle) handle = process.env.ORCA_POD_PLANNER_TERMINAL;
  if (!/^term_[a-z0-9-]+$/i.test(handle ?? '') || extra.length || (expectedSession && operation !== '--save-after-turn')) {
    throw new Error('usage: codex-planner-mode.mjs --prepare|--prepare-and-send|--stop-hook <terminal-handle>');
  }
  const terminal = orcaTerminal(handle);
  if (operation === '--prepare' || operation === '--prepare-and-send') {
    const prompt = operation === '--prepare-and-send' ? await readInput() : undefined;
    if (operation === '--prepare-and-send' && !prompt.trim()) throw new Error('Provide the first task on stdin');
    await preparePlanner(terminal, prompt);
    console.log('Codex Planner: Plan mode verified');
    return;
  }
  if (operation !== '--stop-hook' && operation !== '--save-after-turn') throw new Error('Unknown Codex Planner operation');
  const input = JSON.parse(await readInput());
  const fromHook = operation === '--stop-hook' ? parseStopSave(input) : null;
  if (operation === '--stop-hook' && !fromHook) return;
  const request = fromHook?.request ?? validateSaveRequest(input);
  const { documents, continuation } = request;
  const { worktreePath } = await terminal.identify();
  const root = await fs.realpath(process.cwd());
  if (!worktreePath || await fs.realpath(worktreePath) !== root) throw new Error('Run this operation at the Planner terminal’s worktree root');
  if (fromHook) {
    if (await fs.realpath(input.cwd) !== root) throw new Error('Codex Stop hook workspace does not match the Planner terminal');
    const directory = await fs.mkdtemp(path.join(tmpdir(), 'orca-planning-save-'));
    const log = path.join(directory, 'result.log');
    const descriptor = openSync(log, 'wx', 0o600);
    try {
      const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--save-after-turn', handle, fromHook.session], {
        cwd: root, detached: true, stdio: ['pipe', descriptor, descriptor],
      });
      await new Promise((resolve, reject) => {
        child.once('error', reject);
        child.stdin.once('error', reject);
        child.stdin.end(JSON.stringify(request), resolve);
      });
      child.unref();
    } finally { closeSync(descriptor); }
    console.log(JSON.stringify({ systemMessage: `Planning save queued. Result log: ${log}` }));
    return;
  }
  const lock = path.join(tmpdir(), `orca-planning-save-${handle}.lock`);
  await fs.mkdir(lock);
  try {
    if (!expectedSession) throw new Error('Planning save requires a session-bound Codex Stop hook');
    await savePlannerDocuments(terminal, () => writeDocuments(root, documents), continuation, expectedSession);
    console.log('Planning documents saved and Plan mode restored');
  } finally { await fs.rmdir(lock); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => { console.error(error.message); process.exitCode = 2; });
}
