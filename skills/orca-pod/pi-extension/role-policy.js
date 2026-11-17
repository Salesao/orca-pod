import { randomUUID } from 'node:crypto';
import { createNativeSubagentPolicy } from './native-subagent-policy.mjs';

const REGISTER = 'pi-subagents:runtime-agent-register:v1';
const RPC_REQUEST = 'subagents:rpc:v1:request';
const RPC_REPLY = 'subagents:rpc:v1:reply:';
const delegationTool = (name) => /^(?:subagents?($|_)|delegate($|_)|spawn_agent$|task($|_)|bg_wait$|contact_supervisor$)/.test(name);

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
  const dispose = () => {
    policy?.dispose();
    policy = undefined;
    for (const unsubscribe of subscriptions) unsubscribe();
    subscriptions = [];
    for (const registration of registrations) registration.dispose();
    registrations = [];
    available.clear();
  };
  const rpc = (method, params = {}) => new Promise((resolve) => {
    const requestId = randomUUID();
    let unsubscribe = () => {};
    const timer = setTimeout(() => { unsubscribe(); resolve(undefined); }, 2000);
    unsubscribe = pi.events.on(`${RPC_REPLY}${requestId}`, (response) => {
      clearTimeout(timer);
      unsubscribe();
      resolve(response?.success === true ? response.data : undefined);
    });
    try { pi.events.emit(RPC_REQUEST, { version: 1, requestId, method, params }); }
    catch { clearTimeout(timer); unsubscribe(); resolve(undefined); }
  });
  const filterTools = () => {
    const tools = pi.getActiveTools();
    const filtered = tools.filter((name) => !delegationTool(name) || (name === 'subagent' && available.size > 0));
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
          defaultAsync: false, defaultTimeoutMs: 300000, extensions: [], subagentOnlyExtensions: [], allowNestedSubagents: false,
          maxSubagentDepth: 1, systemPromptMode: 'replace', inheritSkills: false } };
        try { pi.events.emit(REGISTER, request); }
        catch { break; }
        if (!request.result?.ok || typeof request.result.registration?.dispose !== 'function') break;
        registrations.push(request.result.registration);
        available.set(name, { model: exactModel, thinking: definition.thinking });
      }
      if (available.size === helpers.length && !pi.getActiveTools().includes('subagent') &&
          pi.getAllTools?.().some(({ name }) => name === 'subagent')) {
        pi.setActiveTools([...pi.getActiveTools(), 'subagent']);
      }
      if (available.size !== helpers.length || !pi.getActiveTools().includes('subagent')) {
        dispose();
        if (ctx.hasUI) ctx.ui.notify('Pi could not prepare the selected helpers with isolated extensions. The role will work inline.', 'warning');
      } else {
        const sessionId = ctx.sessionManager?.getSessionId?.();
        const sessionFile = ctx.sessionManager?.getSessionFile?.();
        const inspectStatus = async () => {
          const ping = await rpc('ping');
          const capabilities = ping?.capabilities;
          if (!sessionId || ping?.session?.sessionId !== sessionId || capabilities?.status !== true ||
              capabilities?.fleetStatus?.version !== 1 || capabilities?.asyncStatusSnapshot?.version !== 1 ||
              capabilities?.processTerminalProof?.version !== 1 ||
              (ping?.events?.asyncStarted !== undefined && ping.events.asyncStarted !== 'subagent:async-started') ||
              ping?.events?.asyncComplete !== 'subagent:async-complete' ||
              ping?.events?.processTerminal !== 'subagent:process-terminal') return undefined;
          const status = await rpc('status');
          if (typeof status?.text !== 'string' || !status.text.startsWith('In-memory subagent status:') ||
              !Array.isArray(status?.asyncSnapshot?.runs) || status.asyncSnapshot.runs.length > 64) return undefined;
          const terminal = status.asyncSnapshot.runs.filter((run) => ['complete', 'failed', 'partial', 'stopped', 'rejected'].includes(run?.state));
          const proofs = new Map();
          await Promise.all(terminal.map(async (run) => {
            const detail = await rpc('status', { id: run.id });
            proofs.set(run.id, detail?.details?.workflowTerminalProof ?? detail?.details?.lifecycleStatus?.processTerminal);
          }));
          return { ...status, proofs };
        };
        policy = createNativeSubagentPolicy({ helpers: [...available].map(([name, settings]) => ({ name, ...settings })), maxSubagents, inspectStatus });
        const inSession = (event) => !event?.sessionId || event.sessionId === sessionId || event.sessionId === sessionFile;
        subscriptions.push(pi.events.on('subagent:async-started', (event) => { if (inSession(event)) policy?.recordStart(event); }));
        subscriptions.push(pi.events.on('subagent:async-complete', (event) => { if (inSession(event)) policy?.recordCompletion(event); }));
        subscriptions.push(pi.events.on('subagent:process-terminal', (event) => policy?.recordProcessTerminal(event)));
      }
    }
    filterTools();
  });
  pi.on('session_shutdown', dispose);
  pi.on('before_agent_start', filterTools);
  pi.on('tool_call', (event, ctx) => {
    if (!delegationTool(event.toolName)) return;
    if (event.toolName === 'subagent' && available.size && policy) {
      return policy.admit({ callId: event.toolCallId, input: event.input });
    }
    if (event.toolName === 'subagent_launch' && available.size && policy) {
      return policy.authorizeNested({ parentToolCallId: event.parentToolCallId, toolCallId: event.toolCallId,
        input: event.input, cwd: ctx.cwd });
    }
    return { block: true, reason: 'Only selected Pi subagents are permitted by this role policy.' };
  });
  pi.on('tool_result', (event) => {
    if (event.toolName === 'subagent') {
      policy?.recordToolResult({ callId: event.toolCallId, result: event.details, isError: event.isError });
    }
  });
}
