import { askResultText, createAskComponent, normalizeAskParams } from './ask.js';
import { lstat, readFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// The extension is connected by the link ~/.pi/agent/extensions/orca-pod-setup -> <skill>/pi-extension.
// The Pi loader resolves relative imports from the link's path, so the skill directory is found
// from the file's real path and the form scripts are loaded lazily, only when the tool is called.
// The form scripts import the sibling skill orca-pod: without it, instead of ERR_MODULE_NOT_FOUND
// the tool returns a clear error (pipeline-skill.mjs itself imports nothing from orca-pod).
async function loadSetupScripts() {
  const here = path.dirname(realpathSync(fileURLToPath(import.meta.url)));
  const scripts = path.resolve(here, '../scripts');
  const load = (name) => import(pathToFileURL(path.join(scripts, name)).href);
  const { expectedPipelineSkill, findPipelineSkill, PIPELINE_MISSING } = await load('pipeline-skill.mjs');
  const setupSkillDir = path.resolve(here, '..');
  if (!findPipelineSkill(setupSkillDir)) throw new Error(PIPELINE_MISSING(expectedPipelineSkill(setupSkillDir)));
  const [form, catalogs, location] = await Promise.all([
    load('pipeline-form.mjs'), load('catalogs.mjs'), load('../../orca-pod/scripts/config-location.mjs'),
  ]);
  return { startPipelineForm: form.startPipelineForm, discoverCatalogs: catalogs.discoverCatalogs, location };
}

// Pi's packages are @earendil-works/* since Pi 0.74 and @mariozechner/* before it. Pi maps them for extensions, dynamic
// imports included: Pi 0.74+ maps both scopes, older Pi only the old one. So each package is imported by the new name and,
// failing that, by the old one, and the extension loads in both. A static import would tie it to one of them.
const PI_SCOPES = ['@earendil-works', '@mariozechner'];

async function importPiPackage(name) {
  let firstError;
  for (const scope of PI_SCOPES) {
    try { return await import(scope + '/' + name); }
    catch (error) { firstError ??= error; }
  }
  throw firstError;
}

function formOutputSchema(Type) {
  const AgentSettings = Type.Object({ name: Type.String(), model: Type.String(), thinking: Type.String() });
  const RoleSettings = Type.Object({
    provider: Type.Optional(Type.String()),
    model: Type.String(),
    thinking: Type.String(),
    useSubagents: Type.Boolean(),
    subagents: Type.Array(AgentSettings),
  });
  const ProfileSettings = Type.Object({
    name: Type.String(),
    defaultProvider: Type.String(),
    maxSubagents: Type.Number(),
    roles: Type.Object({ planner: RoleSettings, implementer: RoleSettings, reviewer: Type.Optional(RoleSettings), chief_reviewer: Type.Optional(RoleSettings) }),
  });
  return Type.Object({
    status: Type.Union(['submitted', 'cancelled', 'timeout', 'aborted', 'error'].map((s) => Type.Literal(s))),
    targetPath: Type.String(),
    // false outside a Git repository: the config goes into the project folder, there is no .gitignore step.
    git: Type.Optional(Type.Boolean()),
    sourceHash: Type.Union([Type.String(), Type.Null()]),
    url: Type.String(),
    // Migration of the old .orca-pipeline/ and <project-root>/orca-pipeline.yaml into .orca-pod/: MOVED/IGNORED/SKIP lines joined by \n, or null.
    migration: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    yaml: Type.Optional(Type.String()),
    settings: Type.Optional(Type.Object({
      activeProfile: Type.String(),
      profiles: Type.Array(ProfileSettings),
    })),
    error: Type.Optional(Type.String()),
  });
}

function askQuestionSchema(Type) {
  const AskOption = Type.Object({ label: Type.String(), description: Type.Optional(Type.String()) });
  return Type.Object({
    question: Type.String({ description: 'The full question, about the matter itself' }),
    header: Type.String({ description: 'Tab label, up to 12 characters, e.g. "3 Rollback"' }),
    context: Type.Optional(Type.String({ description: 'The card (situation, proposal, cost) shown above the question, up to 600 characters' })),
    options: Type.Array(AskOption, { description: '2-4 options; the free answer "Type something." is added automatically' }),
  });
}

// The question window needs a terminal UI. ctx.mode exists since Pi 0.78; older Pi has only hasUI, which is also true in RPC
// (there ctx.ui.custom returns undefined, and the call ends as interrupted).
const hasTerminalUi = (ctx) => (ctx.mode === undefined ? ctx.hasUI === true : ctx.mode === 'tui');

async function readExistingConfig(file) {
  try {
    const stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('orca-pod.yaml must be a regular file, not a directory or a link');
    const text = await readFile(file, 'utf8');
    return { text, hash: createHash('sha256').update(text).digest('hex') };
  } catch (error) {
    if (error.code === 'ENOENT') return { text: '', hash: null };
    throw error;
  }
}

async function openBrowser(pi, url, cwd, signal) {
  const [command, args] = process.platform === 'darwin'
    ? ['open', [url]]
    : process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', url]]
      : ['xdg-open', [url]];
  const result = await pi.exec(command, args, { cwd, signal, timeout: 10000 });
  if (result.code !== 0 || result.killed) throw new Error('Could not open the browser automatically; open the form URL manually');
}

function toolResult(data) {
  let text;
  if (data.status === 'submitted') {
    text = [
      'The user submitted the Orca pipeline settings from the browser form.',
      'Target file: ' + data.targetPath,
      ...(data.git === false ? ['Not a Git repository: the config goes into this folder; tell the user the path in one line.'] : []),
      'SHA-256 of the source file: ' + (data.sourceHash ?? '(there was no file)'),
      'Default profile (active_profile): ' + data.settings.activeProfile,
      ...data.settings.profiles.flatMap((p) => [
        'Profile ' + p.name + ': default_provider=' + p.defaultProvider + '; concurrent subagents up to ' + p.maxSubagents,
        ...Object.entries(p.roles).map(([role, r]) =>
          '  ' + role + ': ' + (r.provider || p.defaultProvider) + ' | ' + r.model + ' | ' + r.thinking + ' | use_subagents=' + r.useSubagents),
      ]),
      '',
      'The configuration is NOT saved yet; the pipeline roles were NOT started.',
      'Continue the orca-pod-setup skill: re-read the target file and compare the SHA-256 (if it does not match, show the difference and ask the user what to do), show “was → now” per profile, write the whole YAML (comments in the old file are not carried over — say so if there were any) and run launch-provider.mjs --profiles — all profiles must be valid.',
      '',
      '```yaml', data.yaml.trimEnd(), '```',
    ].join('\n');
  } else {
    const reason = {
      cancelled: 'The user cancelled the form.',
      timeout: 'The wait for the form timed out.',
      aborted: 'The setup was interrupted.',
      error: 'Form error: ' + (data.error || 'unknown error'),
    }[data.status];
    text = reason + ' The configuration is unchanged. Do not create a YAML from default values.';
  }
  // The migration happens before the form opens, so it is reported whatever the outcome.
  if (data.migration) text = 'Config migration:\n' + data.migration + '\n— tell the user briefly (one line per result).\n' + text;
  return { content: [{ type: 'text', text }], details: data, structuredContent: data };
}

const askToolResult = (data) => ({ content: [{ type: 'text', text: askResultText(data) }], details: data });

export default async function (pi) {
  const [{ Type, getSupportedThinkingLevels }, { defineTool }, { Editor, Key, matchesKey, visibleWidth, wrapTextWithAnsi }] = await Promise.all([
    importPiPackage('pi-ai'), importPiPackage('pi-coding-agent'), importPiPackage('pi-tui'),
  ]);
  const TUI_KIT = { Editor, Key, matchesKey, visibleWidth, wrapTextWithAnsi };
  const AskQuestion = askQuestionSchema(Type);
  // Resources start only in execute(), never while loading the extension.
  const activeForms = new Set();
  const activeAsks = new Set();
  pi.on('session_shutdown', () => {
    for (const controller of [...activeForms, ...activeAsks]) controller.abort();
    activeForms.clear();
    activeAsks.clear();
  });

  // The question window of the plan-blitz skill in Pi (Claude Code has AskUserQuestion, Codex request_user_input).
  pi.registerTool(defineTool({
    name: 'orca_pod_ask',
    label: 'Ask the user',
    description: 'Ask the user 1-4 multiple-choice questions in a terminal window like Claude Code AskUserQuestion: a tab per question, options with descriptions, a free "Type something." answer, Submit; Esc cancels. An optional per-question context (up to 600 characters) is shown above the question: put the plan-blitz card there. Used by the plan-blitz skill. Returns one line per question: selected "<label>" or wrote "<text>".',
    promptSnippet: 'Ask the user multiple-choice questions in a terminal window (plan-blitz).',
    parameters: Type.Object({ questions: Type.Array(AskQuestion, { description: '1-4 questions' }) }),
    exposure: 'model-only',
    executionMode: 'sequential',
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const parsed = normalizeAskParams(params);
      if (!parsed.ok) return askToolResult({ reason: 'invalid', error: parsed.error });
      // print/json have no UI; in rpc ctx.ui.custom returns undefined.
      if (!hasTerminalUi(ctx)) return askToolResult({ reason: 'no-ui', mode: ctx.mode ?? 'without UI' });
      const controller = new AbortController();
      const onAbort = () => controller.abort();
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) controller.abort();
      activeAsks.add(controller);
      try {
        const result = await ctx.ui.custom((tui, theme, _keybindings, done) => createAskComponent({
          questions: parsed.questions, tui, theme, kit: TUI_KIT, signal: controller.signal, done,
        }));
        return askToolResult(result ?? { answers: [], cancelled: true, reason: 'aborted' });
      } finally {
        signal?.removeEventListener('abort', onAbort);
        activeAsks.delete(controller);
      }
    },
  }));

  pi.registerTool(defineTool({
    name: 'orca_pod_setup',
    label: 'Orca pipeline setup',
    description: 'Open the existing Orca pipeline configuration form in a browser. “Generate YAML” returns the chosen settings and YAML directly to this tool call, like pi-interview. No shell server, polling, sleep or result files. Resolve the project folder (the Git root; outside Git the current folder) and prefill the active orca-pod.yaml (the linked worktree’s own file if there is one, otherwise the shared one). Does not write that file or launch pipeline roles. After submitted, follow the orca-pod-setup skill to save the config and validate it. Cancellation must not generate default settings.',
    promptSnippet: 'Configure orca-pod.yaml through the browser form; the answer returns directly to the agent.',
    exposure: 'model-only',
    executionMode: 'sequential',
    parameters: Type.Object({
      timeout: Type.Optional(Type.Number({ description: 'Seconds before cancellation by deadline', default: 900, minimum: 1, maximum: 86400 })),
      no_open: Type.Optional(Type.Boolean({ description: 'Show form URL without launching the browser', default: false })),
      current_yaml: Type.Optional(Type.String({ description: 'Previous generated YAML to prefill when reopening after a validation error; omit to use the project config' })),
    }, { additionalProperties: false }),
    outputSchema: formOutputSchema(Type),

    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      if (activeForms.size) throw new Error('A pipeline setup form is already open in this session');
      const controller = new AbortController();
      const onAbort = () => controller.abort();
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) controller.abort();
      activeForms.add(controller);
      let form;
      let targetPath = '';
      let sourceHash = null;
      let migration = null;
      let git;
      const cancelledResult = () => toolResult({ status: 'aborted', targetPath, git, sourceHash, migration, url: form?.url || '' });
      try {
        if (controller.signal.aborted) return cancelledResult();
        const { startPipelineForm, discoverCatalogs, location: configModule } = await loadSetupScripts();
        // Git is optional: outside a repository the config goes into the current folder (or its nearest parent with .orca-pod/).
        const location = configModule.configLocation(configModule.projectLocation(ctx.cwd));
        git = location.git;
        if (controller.signal.aborted) return cancelledResult();
        // The old .orca-pipeline/ and orca-pipeline.yaml move into .orca-pod/ before the config is read.
        migration = configModule.migrationText(configModule.migrateLegacyConfig(location));
        const root = location.worktreeRoot;
        targetPath = location.activePath; // migrateLegacyConfig has already recomputed it: a migrated worktree file wins over the shared one
        const current = await readExistingConfig(targetPath);
        sourceHash = current.hash;
        // Reload local configuration only. No AI sessions, paid probes or catalog network refresh.
        await ctx.modelRegistry.refresh({ allowNetwork: false, signal: controller.signal });
        if (controller.signal.aborted) return cancelledResult();
        if (ctx.modelRegistry.getError()) throw new Error('Pi could not load the model settings; check models.json');
        // Pi — the registry of the current session (the same catalog as pi --list-models); the other enabled agents — their own catalogs.
        const piModels = ctx.modelRegistry.getAvailable().map((model) => ({
          program: 'pi', provider: model.provider, id: model.id, levels: getSupportedThinkingLevels(model),
        }));
        // The Anthropic catalog from the session registry (the same one claude-bridge uses) — specific versions for Claude Code.
        const anthropicModels = ctx.modelRegistry.getAll().filter((model) => model.provider === 'anthropic')
          .map((model) => ({ id: model.id, levels: getSupportedThinkingLevels(model) }));
        const { models, sources } = await discoverCatalogs({ cwd: root, piModels, anthropicModels });
        form = await startPipelineForm({
          models, sources, currentYaml: params.current_yaml ?? current.text, targetPath,
          timeout: params.timeout ?? 900, signal: controller.signal,
        });
        if (controller.signal.aborted) return cancelledResult();
        const update = (message) => onUpdate?.({
          content: [{ type: 'text', text: message + '\n' + form.url }],
          details: { status: 'waiting', url: form.url, targetPath },
        });
        update('The form is open. Waiting for “Generate YAML” — the answer arrives directly, without file polling.');
        if (!params.no_open) {
          try { await openBrowser(pi, form.url, root, controller.signal); }
          catch {
            if (!controller.signal.aborted) update('The browser could not be opened automatically. Open this link manually:');
          }
        }
        // Browser POST resolves this Promise and Pi resumes the agent automatically.
        const outcome = await form.result;
        if (outcome.status === 'error') throw new Error(outcome.error);
        return toolResult({ ...outcome, targetPath, git, sourceHash, migration });
      } catch (error) {
        if (controller.signal.aborted) return cancelledResult();
        throw error;
      } finally {
        form?.close();
        signal?.removeEventListener('abort', onAbort);
        activeForms.delete(controller);
      }
    },
  }));
}
