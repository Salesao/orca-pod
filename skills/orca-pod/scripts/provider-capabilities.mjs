import { PROVIDER_LABELS } from './pipeline-config.mjs';

export const PROVIDER_EXECUTABLES = { pi: 'pi', codex: 'codex', 'claude-code': 'claude', qoder: 'qodercli', omp: 'omp' };
export const MODEL_CATALOG_ARGS = { qoder: ['--list-models'], omp: ['models', '--json'] };
export const OMP_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'auto'];
const NATIVE_ACCESS = {
  codex: ['--dangerously-bypass-approvals-and-sandbox'],
  'claude-code': ['--dangerously-skip-permissions'],
  qoder: ['--dangerously-skip-permissions'],
  omp: ['--approval-mode=yolo'],
};

export function getProviderCapabilities(provider, evidence = {}) {
  const { version = null, source = version ? 'installed CLI help' : 'unverified', help = '' } = evidence;
  const supports = (flag) => new RegExp(`(?:^|[\\s,])${flag}(?=[\\s,=<]|$)`, 'm').test(help);
  const established = ['pi', 'codex', 'claude-code'].includes(provider);
  const flags = NATIVE_ACCESS[provider] ?? [];
  const supportsYolo = provider === 'omp' ? supports('--approval-mode') && /\byolo\b/.test(help) : supports(flags[0]?.split('=')[0]);
  const access = provider === 'pi' ? { kind: 'host-default', flags: [] }
    : { kind: flags.length && (established || supportsYolo) ? 'yolo' : 'unsupported', flags };
  if (access.kind === 'unsupported') access.flags = [];
  const filter = { pi: '--exclude-tools', qoder: '--disallowed-tools', omp: '--tools' }[provider];
  const kind = ['codex', 'claude-code'].includes(provider) ? 'native'
    : filter && supports(filter) ? 'tool-filtered' : 'instruction-only';
  const reasoning = established || (provider === 'omp' && supports('--thinking')) ? 'levels'
    : provider === 'qoder' && supports('--list-models') ? 'provider-default' : 'unknown';
  return {
    provider, version, source, reasoning: { kind: reasoning, levels: [] }, delegation: { kind }, access,
    rolePrompt: established || supports('--append-system-prompt'),
    nativeAgents: ['codex', 'claude-code'].includes(provider) || (provider === 'qoder' && supports('--agents')) || (provider === 'omp' && supports('--config')),
    questions: { kind: { codex: 'request_user_input', 'claude-code': 'AskUserQuestion', pi: 'pi_task', qoder: evidence.questions, omp: evidence.questions }[provider] ?? 'text' },
    diagnostics: { kind: provider === 'pi' ? 'session-tools' : 'planned-checks' },
    plannerMode: provider === 'codex' ? 'plan' : null,
  };
}

export function parseModelCatalog(provider, output) {
  let rows;
  if (provider === 'qoder') {
    rows = output.trim().split(/\r?\n/).filter((line) => line.trim() && line.trim() !== 'MODEL').map((line) => {
      const match = /^\s*(.*?)\s*\(([^()\s]+)\)\s*$/.exec(line);
      return match ? { id: match[2], label: match[1] } : null;
    });
  } else if (provider === 'omp') {
    try { rows = JSON.parse(output)?.models; } catch { rows = []; }
    rows = Array.isArray(rows) ? rows.map((row) => ({ id: row?.selector, label: row?.name, thinking: row?.thinking })) : [];
  } else throw new Error(`No model-list adapter for ${provider}`);

  const source = `${PROVIDER_LABELS[provider]}: ${PROVIDER_EXECUTABLES[provider]} ${MODEL_CATALOG_ARGS[provider].join(' ')}`;
  const byId = new Map();
  for (const row of rows) {
    if (typeof row?.id !== 'string' || !isManualModelId(row.id)) continue;
    const levels = Array.isArray(row.thinking) ? OMP_LEVELS.filter((level) => row.thinking.includes(level)) : [];
    byId.set(row.id, { program: provider, id: row.id, label: row.label || row.id,
      levels: ['default', ...levels], source, reasoningKind: levels.length ? 'levels' : 'provider-default' });
  }
  const models = [...byId.values()];
  return { models, source, status: !models.length ? 'unavailable' : rows.length > models.length ? 'partial' : 'available' };
}

export function isManualModelId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_./:@+-]{0,255}$/.test(value);
}
