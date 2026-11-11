import { randomUUID } from 'node:crypto';

const REGISTER = 'pi-subagents:runtime-agent-register:v1';
const REQUEST = 'prompt-template:subagent:request';
const RESPONSE = 'prompt-template:subagent:response';
const CANCEL = 'prompt-template:subagent:cancel';
const TOOL = 'orca_pod_helpers';
const delegationTool = (name) => /^(?:subagents?($|_)|delegate($|_)|spawn_agent$|task($|_)|bg_wait$|contact_supervisor$)/.test(name);

function runLeaf(pi, request, signal) {
  if (signal?.aborted) return Promise.resolve({ status: 'cancelled' });
  return new Promise((resolve) => {
    function finish(result) {
      clearTimeout(timer);
      unsubscribe();
      signal?.removeEventListener('abort', onAbort);
      resolve(result);
    }
    const identity = { requestId: request.requestId, ownerRunId: request.ownerRunId, nodeId: request.nodeId };
    const cancel = (status) => {
      finish({ status });
      pi.events.emit(CANCEL, identity);
    };
    const onAbort = () => cancel('cancelled');
    const timer = setTimeout(() => cancel('timed_out'), request.timeoutMs + 1000);
    const unsubscribe = pi.events.on(RESPONSE, (result) => {
      if (result?.requestId === identity.requestId && result.ownerRunId === identity.ownerRunId && result.nodeId === identity.nodeId) finish(result);
    });
    signal?.addEventListener('abort', onAbort, { once: true });
    try { pi.events.emit(REQUEST, request); } catch (error) { finish({ status: 'failed', error: error.message }); }
  });
}

/** Check one leaf on each newly selected provider/model route before fan-out. */
export async function dispatchSelectedTasks(tasks, available, maxSubagents, compatibility, run) {
  if (!Array.isArray(tasks) || !tasks.length || tasks.length > maxSubagents ||
      tasks.some((task) => !available.has(task?.agent) || typeof task.task !== 'string' || !task.task.trim())) {
    throw new Error('Use only selected helper names, within the profile concurrency limit. Handle other work inline.');
  }
  const results = new Array(tasks.length);
  const groups = new Map();
  for (const [index, { agent }] of tasks.entries()) {
    const { model, thinking } = available.get(agent);
    const route = JSON.stringify([model, thinking]);
    if (!groups.has(route)) groups.set(route, []);
    groups.get(route).push(index);
  }
  await Promise.all([...groups].map(async ([route, indexes]) => {
    if (!compatibility.has(route)) {
      const index = indexes.shift();
      results[index] = await run(tasks[index], index);
      compatibility.set(route, results[index].status === 'completed');
    }
    if (!compatibility.get(route)) {
      for (const index of indexes) results[index] = { status: 'inline', error: 'The selected Pi route failed compatibility preflight. Complete this task inline.' };
      return;
    }
    await Promise.all(indexes.map(async (index) => { results[index] = await run(tasks[index], index); }));
  }));
  return results;
}

export default function (pi) {
  const { helpers = [], maxSubagents = 6 } = JSON.parse(process.env.ORCA_POD_PI_POLICY ?? '{}');
  const available = new Map();
  const compatibility = new Map();
  let registrations = [];
  const dispose = () => {
    for (const registration of registrations) registration.dispose();
    registrations = [];
    available.clear();
    compatibility.clear();
  };
  const filterTools = () => {
    const tools = pi.getActiveTools();
    const filtered = tools.filter((name) => !delegationTool(name) && (available.size || name !== TOOL));
    if (tools.length !== filtered.length) pi.setActiveTools(filtered);
  };
  pi.on('session_start', (_event, ctx) => {
    dispose();
    if (helpers.length) {
      const models = ctx.modelRegistry.getAvailable();
      for (const { name, model, ...definition } of helpers) {
        const matches = models.filter((candidate) => `${candidate.provider}/${candidate.id}` === model || candidate.id === model);
        if (matches.length !== 1) break;
        const exactModel = `${matches[0].provider}/${matches[0].id}`;
        const request = { version: 1, name, definition: { ...definition, model: exactModel,
          defaultAsync: false, extensions: [], subagentOnlyExtensions: [], allowNestedSubagents: false,
          maxSubagentDepth: 1, systemPromptMode: 'replace', inheritSkills: false } };
        pi.events.emit(REGISTER, request);
        if (!request.result?.ok) break;
        registrations.push(request.result.registration);
        available.set(name, { model: exactModel, thinking: definition.thinking });
      }
      if (available.size !== helpers.length) {
        dispose();
        if (ctx.hasUI) ctx.ui.notify('Pi could not prepare the selected helpers with isolated extensions. The role will work inline.', 'warning');
      } else if (!pi.getActiveTools().includes(TOOL)) {
        pi.setActiveTools([...pi.getActiveTools(), TOOL]);
      }
    }
    filterTools();
  });
  pi.on('session_shutdown', dispose);
  pi.on('before_agent_start', filterTools);
  pi.on('tool_call', (event) => {
    if (delegationTool(event.toolName)) return { block: true, reason: 'Use the selected Pi helper interface if available. Otherwise work inline.' };
  });
  if (!helpers.length) return;
  pi.registerTool({
    name: TOOL, label: 'Orca role helpers', executionMode: 'sequential',
    description: 'Run selected local Pi helper tasks. A new model route is tested with one task before parallel dispatch. Handle any unavailable task inline.',
    parameters: { type: 'object', required: ['tasks'], additionalProperties: false, properties: {
      tasks: { type: 'array', minItems: 1, maxItems: maxSubagents, items: {
        type: 'object', required: ['agent', 'task'], additionalProperties: false,
        properties: { agent: { type: 'string', enum: helpers.map(({ name }) => name) }, task: { type: 'string' } },
      } },
    } },
    async execute(_id, { tasks }, signal, _update, ctx) {
      const ownerRunId = randomUUID();
      const results = await dispatchSelectedTasks(tasks, available, maxSubagents, compatibility, ({ agent, task }, index) => {
        const { model, thinking } = available.get(agent);
        return runLeaf(pi, { requestId: randomUUID(), ownerRunId, nodeId: String(index + 1), agent, task,
          context: 'fresh', cwd: ctx.cwd, model, thinking, timeoutMs: 300000,
          intercomBridge: { mode: 'off' }, result: { kind: 'text' } }, signal);
      });
      const text = results.map(({ status, result, error }, index) =>
        `${index + 1}. ${tasks[index].agent}: ${status}\n${result?.text ?? error ?? 'Work inline if the task remains incomplete.'}`).join('\n\n');
      return { content: [{ type: 'text', text }], details: { results } };
    },
  });
}
