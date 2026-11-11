import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { CODEX_AGENT_KEYS, codexAgentName } from './pipeline-config.mjs';
import { helperDefinition, helperDefinitionError } from './helper-definition.mjs';
import { tomlString } from './provider-command.mjs';

function parseAgent(file) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\s*\r?\n([\s\S]+)$/.exec(readFileSync(file, 'utf8'));
  if (!match) throw new Error(`Cannot read agent frontmatter in ${file}`);
  const get = (field) => new RegExp(`^${field}:\\s*(.+)$`, 'm').exec(match[1])?.[1].trim();
  const description = get('description');
  if (!description || /^[|>]/.test(description)) throw new Error(`Agent ${file} needs a one-line description`);
  const tools = get('tools')?.replace(/^\[|\]$/g, '').split(',').map((name) => name.trim()).filter(Boolean);
  return { description, prompt: match[2].trim(), tools, header: match[1] };
}

function searchDefinition(name, directories, suffix = '.md') {
  return directories.map((dir) => path.join(dir, name + suffix)).find(existsSync);
}

function fileFor(provider, name, skillDir, cwd) {
  const piHome = process.env.PI_CODING_AGENT_DIR ?? path.join(homedir(), '.pi', 'agent');
  const directories = {
    codex: [path.join(cwd, '.codex', 'agents'), path.join(process.env.CODEX_HOME ?? path.join(homedir(), '.codex'), 'agents')],
    'claude-code': [path.join(cwd, '.claude', 'agents'), path.join(homedir(), '.claude', 'agents')],
    qoder: [path.join(cwd, '.qoder', 'agents'), path.join(homedir(), '.qoder', 'agents')],
    omp: [path.join(cwd, '.omp', 'agents'), path.join(homedir(), '.omp', 'agent', 'agents')],
    pi: [path.join(cwd, '.pi', 'agents'), path.join(piHome, 'agents'), path.join(homedir(), '.agents')],
  }[provider];
  if (provider === 'omp') return searchDefinition(CODEX_AGENT_KEYS.includes(name) ? `orca-${name}` : name, directories);
  if (CODEX_AGENT_KEYS.includes(name)) {
    const family = provider === 'claude-code' || provider === 'qoder' ? 'claude' : provider;
    const filename = provider === 'codex' ? `${name}.toml` : provider === 'pi' && name !== 'verifier' && name !== 'researcher' ? `orca-${name}.md` : `${name}.md`;
    return searchDefinition(filename, [path.join(skillDir, 'agents', family)], '') ?? searchDefinition(name, directories);
  }
  return searchDefinition(name, directories, provider === 'codex' ? '.toml' : '.md');
}

export function prepareNativeHelpers(settings, policy, capabilities, { skillDir, executable, env, cwd, makeDirectory, materialize }) {
  const warnings = [];
  const native = {};
  const provider = settings.provider;
  let launchEnv = env;
  const setEnv = (patch) => { launchEnv = { ...launchEnv, ...patch }; };
  let effective = policy;
  const inline = (reason) => {
    warnings.push(`${reason}; ${policy.role} will work inline`);
    effective = { ...policy, useSubagents: false, helpers: [] };
  };
  if (provider === 'pi' || (provider === 'omp' && capabilities.nativeAgents)) {
    native.guard = path.join(skillDir, `${provider}-extension`, 'role-policy.js');
  }
  if (policy.useSubagents && !capabilities.nativeAgents && provider !== 'pi') inline(`${provider} native helper registration is unavailable`);
  if (effective.useSubagents) {
    try {
      const entries = policy.helpers.map((helper) => {
        const definitionError = helperDefinitionError(helper);
        if (definitionError) throw new Error(`Helper ${helper.name} needs valid description and instructions`);
        if (Object.keys(helperDefinition(helper)).length) return { ...helper, inline: true };
        const file = fileFor(provider, helper.name, skillDir, cwd);
        if (!file) throw new Error(`No native definition for ${helper.name}; install it for ${provider} or change the helper selection`);
        return { ...helper, file };
      });
      if (provider === 'codex') {
        native.helperNames = Object.fromEntries(entries.map(({ name }) => [name, codexAgentName(name)]));
        native.files = Object.fromEntries(entries.map(({ name, file, model, thinking, inline, description, instructions }) => {
          if (!materialize) return [name, file ?? `<session>/${name}.toml`];
          const body = inline ? `name = ${tomlString(codexAgentName(name))}\ndescription = ${tomlString(description)}\nsandbox_mode = ${tomlString(policy.role === 'implementer' ? 'workspace-write' : 'read-only')}\ndeveloper_instructions = ${tomlString(instructions + '\nDo not delegate or spawn another agent.')}\n`
            : readFileSync(file, 'utf8').replace(/^(?:model|model_reasoning_effort)\s*=.*\r?\n/gm, '');
          const configured = path.join(makeDirectory(), `${name}.toml`);
          writeFileSync(configured, `model = ${tomlString(model)}\nmodel_reasoning_effort = ${tomlString(thinking)}\n${body}`, { mode: 0o600 });
          return [name, configured];
        }));
        warnings.push('Codex exposes built-in agent types. The role instruction limits selection to the registered helpers.');
      } else if (provider === 'claude-code' || provider === 'qoder') {
        native.agents = Object.fromEntries(entries.map((entry) => {
          const { name, file, model, thinking } = entry;
          const { description, prompt, tools } = entry.inline
            ? { description: entry.description, prompt: entry.instructions,
              tools: policy.role === 'implementer' ? ['Read', 'Grep', 'Glob', 'Bash', 'Edit', 'Write'] : ['Read', 'Grep', 'Glob'] }
            : parseAgent(file);
          return [name, { description, prompt: `${prompt}\nDo not delegate or spawn another agent.`,
            tools, disallowedTools: ['Agent'], model: model === settings.model ? 'inherit' : model,
            ...(thinking !== 'default' ? { effort: thinking } : {}) }];
        }));
        if (provider === 'qoder') {
          const listed = spawnSync(executable.file, ['agents', 'list'], { env, cwd, encoding: 'utf8', timeout: 3500 });
          native.excludedAgents = (listed.status === 0 ? listed.stdout : '').split(/\r?\n/)
            .map((line) => /^\s+([A-Za-z0-9_.:-]+)\s+·/.exec(line)?.[1])
            .filter((name) => name && !Object.hasOwn(native.agents, name));
        }
        warnings.push(`${provider}: the selected definitions are registered for this session; other host agents may remain visible. Follow the selected list.`);
      } else if (provider === 'omp') {
        native.helperNames = {};
        const selected = entries.map(({ name, model, thinking, inline, description, instructions }) => {
          // Extension roots are lower priority than installed agents. A session namespace
          // keeps an existing project definition from shadowing the role entered in the form.
          const actualName = inline ? `${path.basename(materialize ? makeDirectory() : 'orca-pod-session')}-${name}`
            : CODEX_AGENT_KEYS.includes(name) ? `orca-${name}` : name;
          native.helperNames[name] = actualName;
          if (inline && materialize) {
            native.agentExtension ??= path.join(makeDirectory(), 'helpers');
            mkdirSync(path.join(native.agentExtension, 'agents'), { recursive: true, mode: 0o700 });
            writeFileSync(path.join(native.agentExtension, 'index.js'), 'export default function () {}\n', { mode: 0o600 });
            const tools = policy.role === 'implementer' ? 'read, grep, glob, bash, edit, write' : 'read, grep, glob';
            writeFileSync(path.join(native.agentExtension, 'agents', actualName + '.md'),
              `---\nname: ${actualName}\ndescription: ${JSON.stringify(description)}\ntools: ${tools}\nspawns: ""\n---\n${instructions}\nDo not delegate or spawn another agent.\n`, { mode: 0o600 });
          }
          return { name: actualName, model, thinking };
        });
        setEnv({ ORCA_POD_OMP_POLICY: JSON.stringify({ helpers: selected, maxSubagents: policy.maxSubagents }) });
        if (materialize) {
          native.config = path.join(makeDirectory(), 'omp-config.json');
          writeFileSync(native.config, JSON.stringify({ task: { maxConcurrency: policy.maxSubagents, perCallModel: false, enableEffort: false, speculativeLaunch: false } }), { mode: 0o600 });
        }
      } else if (provider === 'pi') {
        const helpers = entries.map((entry) => {
          const { name, file, model, thinking } = entry;
          const { description, prompt, tools, header } = entry.inline
            ? { description: entry.description, prompt: entry.instructions,
              tools: policy.role === 'implementer' ? ['read', 'grep', 'find', 'ls', 'bash', 'edit', 'write'] : ['read', 'grep', 'find', 'ls'], header: '' }
            : parseAgent(file);
          const bundled = !entry.inline && CODEX_AGENT_KEYS.includes(name);
          if (!bundled && /^(?:runner|launcher|machine|extensions|subagentOnlyExtensions|skills|skillPath):/m.test(header)) {
            throw new Error(`Pi helper ${name} requires custom runtime resources; cannot isolate diagnostics for it`);
          }
          return { name: bundled ? `orca-pod-${name}` : name, model, thinking, description, systemPrompt: prompt,
            tools: (tools ?? ['read', 'grep', 'find', 'ls']).filter((tool) => !/^(?:lens_|subagent|delegate|spawn_agent|task|codemode|bg_wait)/.test(tool)) };
        });
        native.helperNames = Object.fromEntries(entries.map(({ name }, index) => [name, helpers[index].name]));
        setEnv({ PI_SUBAGENT_MAX_DEPTH: '1', ORCA_POD_PI_POLICY: JSON.stringify({ helpers, maxSubagents: policy.maxSubagents }) });
      }
    } catch (error) {
      delete native.agents;
      delete native.files;
      delete native.agentExtension;
      delete native.helperNames;
      inline(error.message);
    }
  }
  if (!effective.useSubagents) {
    if (provider === 'pi') setEnv({ ORCA_POD_PI_POLICY: '{"helpers":[]}' });
    if (provider === 'omp') setEnv({ ORCA_POD_OMP_POLICY: '{"helpers":[]}' });
    if (capabilities.delegation.kind === 'instruction-only') warnings.push(`${provider}: delegation disable is instruction-only on this host`);
  }
  return { native, effective, env: launchEnv, warnings };
}
