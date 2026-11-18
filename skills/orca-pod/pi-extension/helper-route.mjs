import { constants } from 'node:fs';
import { open, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

const maxSessionBytes = 1024 * 1024;
const routePart = (value) => typeof value === 'string' && /^[\w.][\w.\-/:@+]{0,255}$/.test(value);

function replyModel(reply) {
  if (reply?.role !== 'assistant' || reply.errorMessage || ['error', 'aborted'].includes(reply.stopReason)) return null;
  return routePart(reply.model) && routePart(reply.provider) ? `${reply.provider}/${reply.model}` : null;
}

// Read only a native result's own final, regular file under this parent session.
// Alternate adapter layouts, large sessions and branching histories keep unknown values.
async function sessionRoute(parentSession, row, runId) {
  if (typeof parentSession !== 'string' || !path.isAbsolute(parentSession) || !parentSession.endsWith('.jsonl') ||
      typeof runId !== 'string' || !/^[0-9a-f-]{36}$/i.test(runId) || !Number.isSafeInteger(row?.index) || row.index < 0 ||
      row.detached || row.interrupted || row.stopped || row.timedOut || row.exitCode !== 0) return;
  const relative = path.join(path.basename(parentSession, '.jsonl'), runId, `run-${row.index}`, 'session.jsonl');
  const directory = path.dirname(parentSession);
  if (row.sessionFile !== path.join(directory, relative)) return;
  let file;
  try {
    const target = path.join(await realpath(directory), relative);
    file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const info = await file.stat();
    if (!info.isFile() || info.nlink !== 1 || info.size <= 0 || info.size > maxSessionBytes || await realpath(target) !== target) return;
    const linked = await stat(target);
    if (linked.dev !== info.dev || linked.ino !== info.ino) return;
    const bytes = Buffer.alloc(info.size);
    const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
    if (bytesRead !== bytes.length || (await file.stat()).mtimeMs !== info.mtimeMs) return;
    const lines = bytes.toString('utf8').trimEnd().split('\n');
    if (JSON.parse(lines[0]).type !== 'session') return;
    let thinking = null;
    let previousId = null;
    let observed;
    for (let index = 1; index < lines.length; index++) {
      const entry = JSON.parse(lines[index]);
      if (entry.parentId !== previousId || typeof entry.id !== 'string') return;
      previousId = entry.id;
      if (entry.type === 'thinking_level_change') thinking = routePart(entry.thinkingLevel) ? entry.thinkingLevel : null;
      if (entry.type === 'message') {
        const model = replyModel(entry.message);
        if (model) observed = { model, thinking };
      }
    }
    return observed;
  } catch { /* Optional runtime evidence can expire or be unavailable. */ }
  finally { await file?.close(); }
}

export async function routeReceipts(input, details, available, parentSession) {
  const tasks = input?.workflow === 'parallel' ? input.args?.tasks : [input];
  if (!Array.isArray(tasks) || !tasks.every((task) => available.has(task?.agent))) return [];
  const rows = Array.isArray(details?.results) ? details.results : [];
  return Promise.all(tasks.map(async ({ agent }, index) => {
    const selected = available.get(agent);
    const row = tasks.length === 1 ? rows.find((entry) => entry?.agent === agent) :
      rows.find((entry) => entry?.agent === agent && entry.workflowKey === `task-${index + 1}`);
    const reply = Array.isArray(row?.messages) && row.messages.findLast(replyModel);
    const resolved = row?.resolvedModel;
    const session = await sessionRoute(parentSession, row, row?.runId ?? details?.runId);
    // The adapter may initialize result.model and result.thinking directly from launch intent.
    const resolvedModel = routePart(resolved?.provider) && routePart(resolved.model) ? `${resolved.provider}/${resolved.model}` : null;
    const fromReply = replyModel(reply);
    const model = resolvedModel ?? fromReply;
    return { agent, requested: { model: selected.model, thinking: selected.thinking ?? null },
      observed: session ?? { model, thinking: model === fromReply && routePart(reply?.thinkingLevel) ? reply.thinkingLevel : null },
      observedFrom: session ? 'child_session' : resolvedModel ? 'resolved_model' : fromReply ? 'child_reply' : null };
  }));
}
