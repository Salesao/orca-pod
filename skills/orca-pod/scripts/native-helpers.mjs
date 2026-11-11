import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { CODEX_AGENT_KEYS } from './pipeline-config.mjs';
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
        const file = fileFor(provider, helper.name, skillDir, cwd);
        if (!file) throw new Error(`No native definition for ${helper.name}; install it for ${provider} or change the helper selection`);
        return { ...helper, file };
      });
      if (provider === 'codex') {
        native.files = Object.fromEntries(entries.map(({ name, file, model, thinking }) => {
          if (!materialize) return [name, file];
          const body = readFileSync(file, 'utf8').replace(/^(?:model|model_reasoning_effort)\s*=.*\r?\n/gm, '');
          const configured = path.join(makeDirectory(), `${name}.toml`);
          writeFileSync(configured, `model = ${tomlString(model)}\nmodel_reasoning_effort = ${tomlString(thinking)}\n${body}`, { mode: 0o600 });
          return [name, configured];
        }));
        warnings.push('Codex exposes built-in agent types. The role instruction limits selection to the registered helpers.');
      } else if (provider === 'claude-code' || provider === 'qoder') {
        native.agents = Object.fromEntries(entries.map(({ name, file, model, thinking }) => {
          const { description, prompt, tools } = parseAgent(file);
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
        const selected = entries.map(({ name, model, thinking }) => ({ name: CODEX_AGENT_KEYS.includes(name) ? `orca-${name}` : name, model, thinking }));
        setEnv({ ORCA_POD_OMP_POLICY: JSON.stringify({ helpers: selected, maxSubagents: policy.maxSubagents }) });
        if (materialize) {
          native.config = path.join(makeDirectory(), 'omp-config.json');
          writeFileSync(native.config, JSON.stringify({ task: { maxConcurrency: policy.maxSubagents, perCallModel: false, enableEffort: false, speculativeLaunch: false } }), { mode: 0o600 });
        }
      } else if (provider === 'pi') {
        const helpers = entries.map(({ name, file, model, thinking }) => {
          const { description, prompt, tools, header } = parseAgent(file);
          const bundled = CODEX_AGENT_KEYS.includes(name);
          if (!bundled && /^(?:runner|launcher|machine|extensions|subagentOnlyExtensions|skills|skillPath):/m.test(header)) {
            throw new Error(`Pi helper ${name} requires custom runtime resources; cannot isolate diagnostics for it`);
          }
          return { name: bundled ? `orca-pod-${name}` : name, model, thinking, description, systemPrompt: prompt,
            tools: (tools ?? ['read', 'grep', 'find', 'ls']).filter((tool) => !/^(?:lens_|subagent|delegate|spawn_agent|task|codemode|bg_wait)/.test(tool)) };
        });
        setEnv({ PI_SUBAGENT_MAX_DEPTH: '1', ORCA_POD_PI_POLICY: JSON.stringify({ helpers, maxSubagents: policy.maxSubagents }) });
      }
    } catch (error) {
      delete native.agents;
      delete native.files;
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
