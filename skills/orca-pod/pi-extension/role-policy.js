import { randomUUID } from 'node:crypto';
import { createNativeSubagentPolicy, roleSubagentDeclaration } from './native-subagent-policy.mjs';
import { routeReceipts } from './helper-route.mjs';
import { recordPiRuntime } from '../scripts/terminal-records.mjs';

const REGISTER = 'pi-subagents:runtime-agent-register:v1';
const RPC_REQUEST = 'subagents:rpc:v1:request';
const RPC_REPLY = 'subagents:rpc:v1:reply:';
const delegationTool = (name) => /^(?:subagents?($|_)|delegate($|_)|spawn_agent$|task($|_)|bg_wait$|contact_supervisor$)/.test(name);

function describeRoutes(routes) {
  return routes.map(({ agent, requested, observed, observedFrom }) =>
    `${agent} requested=${requested.model}:${requested.thinking ?? 'unknown'} observed=${observed.model ?? 'unknown'}:${observed.thinking ?? 'unknown'}` +
    (observedFrom ? ` (${observedFrom})` : '')).join('\n');
}

async function inspectNativeStatus(rpc, sessionId) {
  const ping = await rpc('ping');
  if (!sessionId || ping?.session?.sessionId !== sessionId) throw new Error('RPC did not identify the current Pi session.');
  if (ping.capabilities?.status !== true) throw new Error('Adapter does not advertise the status RPC.');
  for (const feature of ['fleetStatus', 'asyncStatusSnapshot', 'processTerminalProof']) {
    if (ping.capabilities?.[feature]?.version !== 1) throw new Error(`Adapter does not advertise ${feature} v1.`);
  }
  for (const [key, expected] of Object.entries({ asyncStarted: 'subagent:async-started', asyncComplete: 'subagent:async-complete',
    processTerminal: 'subagent:process-terminal' })) {
    if (key === 'asyncStarted' && ping.events?.[key] === undefined) continue;
    if (ping.events?.[key] !== expected) throw new Error(`Incompatible ${key} event.`);
  }
  const status = await rpc('status');
  if (typeof status?.text !== 'string' || !status.text.startsWith('In-memory subagent status:')) {
    throw new Error('Adapter did not return current in-memory status.');
  }
  const runs = status.asyncSnapshot?.runs;
  if (!Array.isArray(runs) || runs.length > 64) throw new Error('Async run list missing or oversized.');
  const proofs = new Map();
  await Promise.all(runs.filter((run) => ['complete', 'failed', 'partial', 'stopped', 'rejected'].includes(run?.state)).map(async (run) => {
    if (typeof run.id !== 'string' || !run.id) return;
    const detail = await rpc('status', { id: run.id });
    proofs.set(run.id, detail?.details?.workflowTerminalProof ?? detail?.details?.lifecycleStatus?.processTerminal);
  }));
  return { ...status, proofs };
}

export default function (pi) {
  let config;
  try { config = JSON.parse(process.env.ORCA_POD_PI_POLICY ?? '{}'); }
  catch { config = {}; }
  if (!config || typeof config !== 'object' || Array.isArray(config)) config = {};
  const helpers = Array.isArray(config.helpers) && config.helpers.every((helper) => helper &&
    typeof helper === 'object' && typeof helper.name === 'string' && typeof helper.model === 'string') ? config.helpers : [];
  const maxSubagents = config.maxSubagents === undefined ? 6 : config.maxSubagents;
  const available = new Map();
  let registrations = [];
  let subscriptions = [];
  let policy;
  let readiness;
  let readinessCheck;
  let announce = false;
  const dispose = () => {
    policy?.dispose();
    policy = undefined;
    for (const unsubscribe of subscriptions) unsubscribe();
    subscriptions = [];
    for (const registration of registrations) registration.dispose();
    registrations = [];
    available.clear();
    readiness = undefined;
    readinessCheck = undefined;
    announce = false;
  };
  const rpc = (method, params = {}) => new Promise((resolve, reject) => {
    const requestId = randomUUID();
    let unsubscribe = () => {};
    const timer = setTimeout(() => { unsubscribe(); reject(new Error(`No reply to pi-subagents RPC ${method} within 2 s.`)); }, 2000);
    unsubscribe = pi.events.on(`${RPC_REPLY}${requestId}`, (response) => {
      clearTimeout(timer);
      unsubscribe();
      if (response?.success === true && response.version === 1 && response.requestId === requestId) resolve(response.data);
      else reject(new Error(`pi-subagents RPC ${method} failed (${response?.error?.code ?? 'invalid reply'}).`));
    });
    try { pi.events.emit(RPC_REQUEST, { version: 1, requestId, method, params }); }
    catch { clearTimeout(timer); unsubscribe(); reject(new Error(`Could not send pi-subagents RPC ${method}.`)); }
  });
  const filterTools = () => {
    const tools = pi.getActiveTools();
    const filtered = tools.filter((name) => !delegationTool(name) || (name === 'subagent' && available.size > 0));
    if (tools.length !== filtered.length) pi.setActiveTools(filtered);
  };
  const report = (ctx, state, detail, code, source = 'pi session_start') => {
    const content = `Orca Pod helper preflight: ${state}. ${detail}`;
    if (readiness?.content === content) return;
    announce = true;
    readiness = { state, content, code };
    if (process.env.ORCA_POD_RUN) {
      recordPiRuntime({ model: ctx.model && `${ctx.model.provider}/${ctx.model.id}`, thinking: pi.getThinkingLevel?.(),
        helpers: state, helperReason: code, source });
    }
    if (ctx.hasUI && state !== 'disabled') ctx.ui.notify(content, state === 'ready' ? 'info' : 'warning');
  };
  const checkReadiness = async (ctx, source) => {
    if (readinessCheck) return readinessCheck;
    const current = policy;
    const check = current.checkedStatus().then(({ reason }) => {
      if (policy !== current) return;
      if (reason) report(ctx, 'unverified', reason + ' Each launch rechecks the adapter.', 'status_unverified', source);
      else report(ctx, 'ready', 'pi-subagents registration, selected model lookup and session status checks passed. Child execution is unobserved.', undefined, source);
    });
    readinessCheck = check;
    try { await check; }
    finally { if (readinessCheck === check) readinessCheck = undefined; }
  };
  pi.on('session_start', async (_event, ctx) => {
    dispose();
    if (helpers.length) {
      let models;
      try { models = ctx.modelRegistry?.getAvailable?.(); }
      catch { /* A registry that is still initializing cannot confirm any selected model. */ }
      let problem;
      let code;
      for (const { name, model, ...definition } of helpers) {
        if (!Array.isArray(models)) {
          problem = 'The Pi session model registry is unavailable.';
          code = 'model_unresolved';
          break;
        }
        const matches = models.filter((candidate) => `${candidate.provider}/${candidate.id}` === model || candidate.id === model);
        if (matches.length !== 1) {
          problem = `Selected model ${model} for ${name} has ${matches.length} registry matches.`;
          code = 'model_unresolved';
          break;
        }
        const exactModel = `${matches[0].provider}/${matches[0].id}`;
        const request = { version: 1, name, definition: { ...definition, model: exactModel,
          defaultAsync: false, defaultTimeoutMs: 300000, extensions: [], subagentOnlyExtensions: [], allowNestedSubagents: false,
          maxSubagentDepth: 1, systemPromptMode: 'replace', inheritSkills: false } };
        try { pi.events.emit(REGISTER, request); }
        catch { problem = `pi-subagents runtime registration threw for ${name}.`; }
        if (!request.result?.ok || typeof request.result.registration?.dispose !== 'function' || problem) {
          problem ??= request.result ? `pi-subagents rejected the definition for ${name}.` : `No pi-subagents v1 registration acknowledgement for ${name}.`;
          code = 'registration_failed';
          break;
        }
        registrations.push(request.result.registration);
        available.set(name, { model: exactModel, thinking: definition.thinking });
      }
      const tool = pi.getAllTools?.().find(({ name }) => name === 'subagent');
      if ([tool?.sourceInfo?.path, tool?.sourceInfo?.source].some((value) => typeof value === 'string' && value.includes('pi-interactive-subagents'))) {
        problem = 'The active subagent tool belongs to pi-interactive-subagents. This guard requires pi-subagents.';
        code = 'incompatible_adapter';
      }
      if (!problem && available.size === helpers.length && !pi.getActiveTools().includes('subagent') && tool) {
        pi.setActiveTools([...pi.getActiveTools(), 'subagent']);
      }
      if (problem || available.size !== helpers.length || !pi.getActiveTools().includes('subagent')) {
        dispose();
        report(ctx, 'unavailable', (problem ?? 'Selected helper registration is incomplete or the subagent tool is inactive.') + ' Work inline.', code ?? 'tool_unavailable');
      } else {
        const sessionId = ctx.sessionManager?.getSessionId?.();
        const sessionFile = ctx.sessionManager?.getSessionFile?.();
        const inspectStatus = () => inspectNativeStatus(rpc, sessionId);
        policy = createNativeSubagentPolicy({ helpers: [...available].map(([name, settings]) => ({ name, ...settings })), maxSubagents, inspectStatus });
        const inSession = (event) => !event?.sessionId || event.sessionId === sessionId || event.sessionId === sessionFile;
        subscriptions.push(pi.events.on('subagent:async-started', (event) => { if (inSession(event)) policy?.recordStart(event); }));
        subscriptions.push(pi.events.on('subagent:async-complete', async (event) => {
          const owner = policy;
          if (!owner || !inSession(event)) return;
          const tasks = owner.recordCompletion(event);
          if (!tasks || !pi.sendMessage) return;
          const routes = await routeReceipts({ workflow: 'parallel', args: { tasks } }, event, available, sessionFile);
          if (policy !== owner) return;
          const runId = event.runId ?? event.id;
          pi.sendMessage({ customType: 'orca-pod-helper-routes', display: false,
            content: `Pi helper completion ${runId}\n${describeRoutes(routes)}`,
            details: { runId, orcaPodHelperRoutes: routes } }, { triggerTurn: false });
        }));
        subscriptions.push(pi.events.on('subagent:process-terminal', (event) => { if (inSession(event)) policy?.recordProcessTerminal(event); }));
        subscriptions.push(pi.events.on('subagents:rpc:v1:ready', (event) => {
          if (policy && readiness?.state === 'unverified' && event?.session?.sessionId === sessionId) {
            return checkReadiness(ctx, 'pi adapter ready');
          }
        }));
        await checkReadiness(ctx);
      }
    } else if (Array.isArray(config.helpers) && config.helpers.length === 0) report(ctx, 'disabled', 'The role has no selected helpers.');
    else report(ctx, 'unavailable', 'Invalid helper policy. Work inline.', 'invalid_policy');
    filterTools();
  });
  pi.on('session_shutdown', dispose);
  pi.on('before_agent_start', async (_event, ctx) => {
    filterTools();
    if (!announce) return;
    if (policy && readiness?.state === 'unverified') await checkReadiness(ctx, 'pi before_agent_start');
    announce = false;
    if (readiness && readiness.state !== 'disabled') {
      return { message: { customType: 'orca-pod-helper-preflight', content: readiness.content, display: true } };
    }
  });
  pi.on('context_with_system', ({ messages }) => {
    if (!policy) return;
    return { messages: messages.map((message) => {
      if (message.role !== 'system' || !message.toolsAdded?.some((tool) => tool.name === 'subagent')) return message;
      return { ...message, toolsAdded: message.toolsAdded.map((tool) => tool.name === 'subagent'
        ? roleSubagentDeclaration(tool, available, maxSubagents) : tool) };
    }) };
  });
  pi.on('tool_call', (event, ctx) => {
    if (!delegationTool(event.toolName)) return;
    if (event.toolName === 'subagent' && available.size && policy) {
      return policy.admit({ callId: event.toolCallId, input: event.input });
    }
    if (event.toolName === 'subagent_launch' && available.size && policy) {
      return policy.authorizeNested({ parentToolCallId: event.parentToolCallId, toolCallId: event.toolCallId,
        input: event.input, cwd: ctx.cwd });
    }
    return { block: true, reason: readiness?.state === 'unavailable' ? readiness.content : 'Only selected Pi subagents are permitted by this role policy.' };
  });
  pi.on('tool_result', async (event, ctx) => {
    if (event.toolName === 'subagent') {
      policy?.recordToolResult({ callId: event.toolCallId, result: event.details, isError: event.isError });
      const routes = await routeReceipts(event.input, event.details, available, ctx.sessionManager?.getSessionFile?.());
      if (routes.length) {
        return { details: { ...event.details, orcaPodHelperRoutes: routes },
          content: [...event.content, { type: 'text', text: describeRoutes(routes) }],
          ...(event.structuredContent === undefined ? {} : { structuredContent: event.structuredContent }) };
      }
    }
  });
}
