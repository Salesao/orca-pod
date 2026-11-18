const SNAPSHOT_KIND = 'pi-subagents.async-status-snapshot';
const TERMINAL_STATES = new Set(['complete', 'failed', 'partial', 'stopped', 'rejected']);
const READ_ONLY_ACTIONS = new Set(['list', 'guide', 'models', 'status']);

// Project the role policy onto Pi's model-facing declaration. Keep only fields
// the installed native tool declares (its enabled features can vary by session).
export function roleSubagentDeclaration(tool, available, maxSubagents) {
  const agent = { type: 'string', enum: [...available.keys()] };
  const model = { type: 'string', description: 'Optional. Omit to use the selected agent model and thinking level.' };
  const task = { type: 'string', minLength: 1 };
  const properties = {
    agent, task, model,
    async: { type: 'boolean', description: 'Use false for a foreground result or true for a background notification.' },
    workflow: { type: 'string', enum: ['parallel'], description: 'For parallel launches, supply args.tasks and an explicit async.' },
    args: { type: 'object', additionalProperties: false, required: ['tasks'], properties: {
      tasks: { type: 'array', minItems: 1, maxItems: maxSubagents, items: {
        type: 'object', required: ['agent', 'task'], additionalProperties: false, properties: { agent, task, model },
      } },
    } },
    action: { type: 'string', enum: [...READ_ONLY_ACTIONS, 'stop'], description: 'Management only. Stop requires the id of a run owned by this role.' },
    id: { type: 'string', description: 'Run id for a management action.' },
    options: { type: 'object', description: 'Launches accept only timeoutMs. Read-only actions accept their native options.',
      properties: { timeoutMs: { type: 'integer', minimum: 1, maximum: 300000 } } },
  };
  return { ...tool,
    description: tool.description + '\nOrca Pod: to launch one selected helper, supply agent, task and async. Omit unused fields.',
    parameters: { type: 'object', additionalProperties: false, properties: Object.fromEntries(
      Object.entries(properties).filter(([key]) => Object.hasOwn(tool.parameters.properties, key))) },
  };
}

function blocked(reason) {
  return { block: true, reason };
}

function rejectExtraFields(input, allowed, prefix = '') {
  const extra = Object.keys(input).filter((key) => !allowed.includes(key));
  if (extra.length) {
    return blocked(`Orca Pod forbids these subagent fields: ${extra.map((key) => prefix + key).join(', ')}. Omit them entirely.`);
  }
}

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function routeOf(helper) {
  return JSON.stringify([helper.model, helper.thinking]);
}

function closedProcess(instance) {
  if (!plainObject(instance) || typeof instance.processInstanceId !== 'string' || !instance.processInstanceId ||
      !Number.isFinite(instance.closeObservedAt) ||
      (instance.exitCode !== null && !Number.isFinite(instance.exitCode)) ||
      (instance.signal !== null && typeof instance.signal !== 'string')) return false;
  if (instance.kind === 'runner') return instance.attempt === undefined;
  const tree = instance.processTree;
  return instance.kind === 'pi-writer' && Number.isSafeInteger(instance.attempt) && instance.attempt >= 0 &&
    plainObject(tree) && tree.state === 'observed' && tree.mechanism === 'posix-process-group' &&
    Number.isSafeInteger(tree.processGroupId) && tree.processGroupId > 0 && Number.isFinite(tree.verifiedAt);
}

function terminalProof(proof, runId) {
  if (!plainObject(proof) || proof.version !== 1 || proof.runId !== runId) return false;
  if (proof.kind === 'workflow') {
    return proof.state === 'observed' && proof.dispatchClosed === true && Number.isFinite(proof.observedAt) &&
      Array.isArray(proof.children) && proof.children.every((child) => terminalProof(child, child?.runId));
  }
  if (typeof proof.runnerProcessInstanceId !== 'string' || !proof.runnerProcessInstanceId) return false;
  if (proof.state === 'not-started') return true;
  return proof.state === 'observed' && Number.isFinite(proof.observedAt) && Array.isArray(proof.instances) &&
    proof.instances.every(closedProcess) &&
    proof.instances.some((instance) => instance.kind === 'runner' && instance.processInstanceId === proof.runnerProcessInstanceId);
}

function allowedModel(model, helper) {
  if (model === undefined) return true;
  return typeof model === 'string' && (model === helper.model || model === `${helper.model}:${helper.thinking}`);
}

function checkLaunchOptions(options) {
  if (options === undefined) return;
  if (!plainObject(options)) return blocked('Subagent options must be an object.');
  const extra = rejectExtraFields(options, ['timeoutMs'], 'options.');
  if (extra) return extra;
  const { timeoutMs } = options;
  if (timeoutMs !== undefined && (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300000)) {
    return blocked('Subagent options.timeoutMs must be an integer between 1 and 300000.');
  }
}

/** Restrict native calls without implementing or wrapping the native tool. */
export function createNativeSubagentPolicy({ helpers, maxSubagents, inspectStatus }) {
  const available = new Map(helpers.map((helper) => [helper.name, helper]));
  const reservations = new Map();
  const runToCall = new Map();
  const earlyEvents = new Map();
  const finished = new Set();
  const routes = new Map();
  let disposed = false;
  let invalid = !Number.isSafeInteger(maxSubagents) || maxSubagents < 1 || typeof inspectStatus !== 'function';
  let queue = Promise.resolve();

  function remember(runId, field, value) {
    if (typeof runId !== 'string' || !runId) return;
    if (!earlyEvents.has(runId) && earlyEvents.size >= 256) {
      invalid = true;
      return;
    }
    const event = earlyEvents.get(runId) ?? {};
    event[field] = value;
    earlyEvents.set(runId, event);
  }

  function finishIfProven(callId) {
    const item = reservations.get(callId);
    if (!item || item.completion === undefined || item.terminal !== true) return;
    for (const route of item.preflightRoutes) routes.set(route, item.completion ? 'ready' : 'failed');
    reservations.delete(callId);
    if (item.runId) {
      finished.add(item.runId);
      runToCall.delete(item.runId);
      earlyEvents.delete(item.runId);
    }
  }

  function attach(callId, runId) {
    const item = reservations.get(callId);
    if (!item || typeof runId !== 'string' || !runId) return;
    if ((item.runId && item.runId !== runId) || (runToCall.has(runId) && runToCall.get(runId) !== callId)) {
      invalid = true;
      return;
    }
    item.runId = runId;
    runToCall.set(runId, callId);
    const buffered = earlyEvents.get(runId);
    if (buffered?.completion !== undefined) item.completion = buffered.completion;
    if (buffered?.terminal === true) item.terminal = true;
    finishIfProven(callId);
  }

  function reconcile(snapshot) {
    if (!plainObject(snapshot) || !plainObject(snapshot.fleet) || snapshot.fleet.version !== 1 ||
        !Number.isSafeInteger(snapshot.fleet.totalActive) || snapshot.fleet.totalActive < 0 ||
        !plainObject(snapshot.asyncSnapshot) || snapshot.asyncSnapshot.kind !== SNAPSHOT_KIND ||
        snapshot.asyncSnapshot.version !== 1 || !Array.isArray(snapshot.asyncSnapshot.runs) ||
        !plainObject(snapshot.asyncSnapshot.omitted)) return false;
    const omitted = snapshot.asyncSnapshot.omitted;
    if (omitted.runs !== 0 || omitted.children !== 0 || omitted.byteLimitExceeded !== false) return false;
    let knownActive = 0;
    for (const run of snapshot.asyncSnapshot.runs) {
      if (!plainObject(run) || typeof run.id !== 'string' || typeof run.state !== 'string') return false;
      if (runToCall.has(run.id)) {
        if (!TERMINAL_STATES.has(run.state)) {
          knownActive++;
        } else if (terminalProof(snapshot.proofs?.get(run.id), run.id)) {
          const callId = runToCall.get(run.id);
          const item = reservations.get(callId);
          item.completion ??= run.state === 'complete';
          item.terminal = true;
          finishIfProven(callId);
        }
      } else if (!finished.has(run.id)) {
        if (!TERMINAL_STATES.has(run.state) || !terminalProof(snapshot.proofs?.get(run.id), run.id)) return false;
        finished.add(run.id);
      }
    }
    // The public fleet can include foreground children, which are not in the async snapshot.
    // Refuse extra or unmatched activity rather than undercount it.
    const pending = [...reservations.values()].filter((item) => !item.runId).length;
    if (snapshot.fleet.totalActive > knownActive + pending) return false;
    return true;
  }

  async function decide({ callId, input }) {
    if (disposed || invalid || typeof callId !== 'string' || !callId || !plainObject(input)) {
      return blocked('Native subagent policy is unavailable; do not delegate.');
    }
    if (input.action !== undefined) {
      if (READ_ONLY_ACTIONS.has(input.action)) return rejectExtraFields(input, ['action', 'id', 'options']);
      if (input.action === 'stop' && typeof input.id === 'string' && runToCall.has(input.id)) {
        return rejectExtraFields(input, ['action', 'id']);
      }
      return blocked('This native subagent action is outside the selected role policy.');
    }
    const parallel = input.workflow === 'parallel';
    const fields = parallel ? ['workflow', 'args', 'async', 'options'] : ['agent', 'task', 'async', 'model', 'options'];
    const invalidField = rejectExtraFields(input, fields) ?? checkLaunchOptions(input.options);
    if (invalidField) return invalidField;
    if ((parallel || input.async !== undefined) && typeof input.async !== 'boolean') {
      return blocked('Supply a boolean async field for this subagent call.');
    }
    if (parallel) {
      if (!plainObject(input.args)) return blocked('The native parallel workflow requires an args object with tasks.');
      const extra = rejectExtraFields(input.args, ['tasks'], 'args.');
      if (extra) return extra;
    }
    const tasks = parallel ? input.args.tasks : [{ agent: input.agent, task: input.task, model: input.model }];
    if (!Array.isArray(tasks) || !tasks.length || tasks.length > maxSubagents) {
      return blocked('The number of subagent tasks is outside this role policy.');
    }
    for (const [index, task] of tasks.entries()) {
      if (!plainObject(task)) return blocked(`Subagent args.tasks[${index}] must be an object.`);
      if (parallel) {
        const extra = rejectExtraFields(task, ['agent', 'task', 'model'], `args.tasks[${index}].`);
        if (extra) return extra;
      }
      if (typeof task.agent !== 'string' || typeof task.task !== 'string' || !task.task.trim() ||
          !available.has(task.agent) || !allowedModel(task.model, available.get(task.agent))) {
        return blocked('The subagent, model or task is outside this role policy.');
      }
    }
    if (reservations.has(callId)) return blocked('The subagent call identity is already active.');
    let snapshot;
    try { snapshot = await inspectStatus(); }
    catch { return blocked('Native subagent status is unavailable; do not delegate.'); }
    if (disposed || invalid) return blocked('Native subagent policy changed while checking status; do not delegate.');
    if (!reconcile(snapshot)) return blocked('Native subagent status cannot be reconciled safely; do not delegate.');
    const snapshotLimit = snapshot.asyncSnapshot.caps?.maxChildrenPerNode;
    if (parallel && (!Number.isSafeInteger(snapshotLimit) || snapshotLimit < 1 || tasks.length > snapshotLimit)) {
      return blocked('The native status snapshot child limit is too small for this parallel workflow.');
    }
    const used = [...reservations.values()].reduce((total, item) => total + item.weight, 0);
    if (used + tasks.length > maxSubagents) return blocked('The configured subagent concurrency limit is reached.');
    const taskRoutes = tasks.map((task) => routeOf(available.get(task.agent)));
    for (const route of taskRoutes) {
      if (routes.get(route) === 'checking') return blocked('Wait for the first child on this model route to finish.');
      if (routes.get(route) === 'failed') return blocked('The first child on this model route failed; do not fan out.');
      if (!routes.has(route) && taskRoutes.filter((candidate) => candidate === route).length > 1) {
        return blocked('Run one child on each new model route before parallel fan-out.');
      }
    }
    const preflightRoutes = [...new Set(taskRoutes.filter((route) => !routes.has(route)))];
    for (const route of preflightRoutes) routes.set(route, 'checking');
    reservations.set(callId, { preflightRoutes, weight: tasks.length, asynchronous: input.async === true, terminal: false,
      parallel, tasks: tasks.map(({ agent, task }) => ({ agent, task })), launchedKeys: new Set() });
  }

  function admit(request) {
    const decision = queue.then(() => decide(request));
    queue = decision.catch(() => {});
    return decision;
  }

  function authorizeNested({ parentToolCallId, toolCallId, input, cwd }) {
    const item = reservations.get(parentToolCallId);
    if (disposed || invalid || !item?.parallel || typeof toolCallId !== 'string' ||
        !toolCallId.startsWith(`${parentToolCallId}/`) || !plainObject(input) ||
        Object.keys(input).some((key) => !['workflowRunId', 'key', 'agent', 'task', 'cwd', 'model', 'async', 'worktree'].includes(key)) ||
        typeof input.workflowRunId !== 'string' || !input.workflowRunId || typeof input.key !== 'string' ||
        input.async === true || (input.worktree !== undefined && input.worktree !== false) ||
        (input.cwd !== undefined && input.cwd !== cwd)) {
      return blocked('Only approved native parallel children may use the internal launch hook.');
    }
    const match = /^task-([1-9][0-9]*)$/.exec(input.key);
    const index = match ? Number(match[1]) - 1 : -1;
    const expected = item.tasks[index];
    const helper = expected && available.get(expected.agent);
    if (!expected || input.agent !== expected.agent || input.task !== expected.task ||
        !allowedModel(input.model, helper) || item.launchedKeys.has(input.key) ||
        (item.runId && item.runId !== input.workflowRunId)) {
      return blocked('The native parallel child does not match its approved task.');
    }
    attach(parentToolCallId, input.workflowRunId);
    if (invalid) return blocked('Native workflow identity cannot be reconciled safely.');
    item.launchedKeys.add(input.key);
  }

  function recordStart(event) {
    if (!plainObject(event) || typeof event.toolCallId !== 'string') return;
    attach(event.toolCallId, event.runId ?? event.id);
  }

  function recordToolResult({ callId, result, isError }) {
    const item = reservations.get(callId);
    if (!item) return;
    if (plainObject(result)) attach(callId, result.asyncId ?? (item.asynchronous ? result.runId : undefined));
    if (item.asynchronous) {
      if (isError) for (const route of item.preflightRoutes) routes.set(route, 'failed');
      return;
    }
    const rows = result?.results;
    if (isError || !Array.isArray(rows) || rows.length !== item.weight || rows.some((row) => row?.detached ||
        row?.interrupted || row?.timedOut || row?.stopped || row?.exitCode !== 0)) {
      for (const route of item.preflightRoutes) routes.set(route, 'failed');
      return;
    }
    for (const route of item.preflightRoutes) routes.set(route, 'ready');
    reservations.delete(callId);
  }

  function recordCompletion(event) {
    if (!plainObject(event)) return;
    const runId = event.runId ?? event.id;
    if (typeof runId !== 'string' || !runId || !TERMINAL_STATES.has(event.state)) return;
    const success = event.state === 'complete' && event.success === true;
    const callId = runToCall.get(runId);
    if (!callId) return remember(runId, 'completion', success);
    reservations.get(callId).completion = success;
    finishIfProven(callId);
  }

  function recordProcessTerminal(event) {
    if (!plainObject(event) || typeof event.runId !== 'string' || !event.runId ||
        !terminalProof(event, event.runId)) return;
    const callId = runToCall.get(event.runId);
    if (!callId) return remember(event.runId, 'terminal', true);
    reservations.get(callId).terminal = true;
    finishIfProven(callId);
  }

  function dispose() {
    disposed = true;
  }

  return { admit, authorizeNested, recordStart, recordToolResult, recordCompletion, recordProcessTerminal, reconcile, dispose };
}
