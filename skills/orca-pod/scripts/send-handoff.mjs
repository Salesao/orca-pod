#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { orcaCommand } from './orca-command.mjs';

async function main(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    if (!['--to', '--environment', '--on', '--retry-request'].includes(key) || !argv[i + 1] || argv[i + 1].startsWith('--') || key in options) {
      throw new Error('usage: send-handoff.mjs --to <term_handle|orca_session_id:id> [--environment <selector> | --on <paired-server>] [--retry-request <id>] < payload');
    }
    options[key] = argv[i + 1];
  }
  const target = options['--to'] ?? '';
  const terminal = /^term_[a-z0-9-]+$/i.test(target);
  const chat = /^orca_session_id:[a-z0-9_-]+$/i.test(target);
  if (!terminal && !chat) throw new Error('Use the exact term_ handle or orca_session_id: mailbox supplied by Orca; never a title or active tab');
  if (options['--on'] && (terminal || options['--environment'])) throw new Error('--on is for chat mail to a paired server and cannot be combined with --environment');
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > 128 * 1024) throw new Error('Handoff exceeds 128 KiB; send context by absolute file path');
    chunks.push(chunk);
  }
  const payload = Buffer.concat(chunks).toString('utf8');
  if (!payload.trim() || payload.includes('\0')) throw new Error('Provide a non-empty text payload without NUL on stdin');
  const args = terminal
    ? ['terminal', 'send', '--terminal', target, '--text', payload, '--enter', '--wait-submit', '5']
    : ['orchestration', 'send', '--to', target, '--subject', 'orca-pod handoff', '--body', payload, '--type', 'handoff'];
  for (const key of ['--environment', '--on', '--retry-request']) if (options[key]) args.push(key, options[key]);
  args.push('--json');
  const result = spawnSync(orcaCommand(), args, { encoding: 'utf8', timeout: 65000, maxBuffer: 4 * 1024 * 1024 });
  // Preserve receipts (including replay IDs) even on a nonzero CLI exit. Never auto-retry.
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  let receipt;
  try { receipt = JSON.parse(result.stdout); } catch { throw new Error('Orca returned no JSON receipt; delivery is unknown, do not resend as a fresh request'); }
  const accepted = terminal ? receipt.result?.send?.accepted === true
    : typeof receipt.result?.messageId === 'string' && receipt.result.messageId.length > 0;
  if (result.status !== 0 || receipt.ok !== true || !accepted) process.exitCode = 2;
}
main(process.argv.slice(2)).catch((error) => { console.error(error.message); process.exitCode = 2; });
