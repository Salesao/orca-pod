---
name: orca-pod-setup
description: Use when a user needs to create, explain, or reconfigure a project's orca-pod.yaml (roles Planner/Implementer/Reviewer/Chief Reviewer on Pi, Claude Code or Codex), or when the file is missing before a pipeline run. Opens a visual browser form — via the native Pi tool in Pi, via scripts/setup-form.mjs in Claude Code and Codex.
---

# Orca pipeline setup

This skill creates or changes the project's `.orca-pod/orca-pod.yaml` and connects the
pipeline's helper agents. Do not run the pipeline roles, Orca Run or subagents.

This skill configures only the YAML: profiles, role agents (provider), models, thinking,
helpers and the limit of concurrent subagents.
The Coordinator chooses additional skills separately, by the
[selection rules](../orca-pod/references/skill-selection.md);
the Planner always uses `using-superpowers` and `plan-blitz`. These are not YAML fields.

## 1. Find the project config

There is one config per repository: `.orca-pod/orca-pod.yaml` of the main checkout
(the folder is added to `.gitignore` in step 4 when the project has one); in a linked worktree its own file in
`.orca-pod/` wins, if there is one. Git is optional: outside a Git repository the project folder is the current
folder, or its nearest parent that already has `.orca-pod/` (but not the home folder). The form (the Pi tool and `setup-form.mjs`) finds
the active path itself — `targetPath` in the result — and before reading it migrates
the old layouts: the `.orca-pipeline/` directory (with `orca-pipeline.yaml` and `reports/`) entirely
into `.orca-pod/` (inside it `orca-pipeline.yaml` becomes `orca-pod.yaml`) and the file
`<project-root>/orca-pipeline.yaml` into `.orca-pod/orca-pod.yaml`. The `migration` field holds
`MOVED …`, `IGNORED …` and `SKIP …` lines separated by newlines (one per result) or
`null`. Report a non-empty `migration` to the user whatever the outcome of the form, one
line per result; if the old file or directory was tracked by git, say that git will show
it as deleted and that the commit is up to the user. Outside the form the path comes from
`node <skill-dir>/../orca-pod/scripts/config-location.mjs where`
(`activePath`, and `git: false` outside a Git repository); the migration is done by the same script with `migrate`.
Outside a Git repository tell the user in one line which folder the config goes into (the form prints it as a
`PROJECT …` line and returns `git: false`); if it is not the project, ask them to start the agent in the right
folder. Never run `git init`.
If there is a directory or a link at the target path, explain the problem; do not replace it.
Read an existing file before changing anything.

## 2. Connect the helper agents

Run (idempotent, does not replace existing regular files or live links of others, relinks dangling ones):

```bash
<skill-dir>/../orca-pod/scripts/link-agents.sh
```

In Codex run this script, `link-pi-extension.sh` below and `setup-form.mjs` (step 3) with elevated permissions
from the first call (Codex asks the user once per command): the link scripts write into `~/.claude` and `~/.pi`,
outside the project, so in the sandbox they fail with `Operation not permitted`.

It links native definitions for Claude Code, Pi and OMP to their user agent directories. Show the `SKIP` and `RELINK` lines to the
user. `SKIP`: an existing agent with the same name that is not from this skill (a regular file or a live
link, for example into another installed skill version) stays, and the pipeline will use it.
`RELINK`: a dangling link (it pointed into an older skill version that was removed) was replaced with a
link to this skill; this changes a link on the user's machine, so the user should see it.
`UNLINK` lines mean that broken links to agents that no longer exist in the skill were
removed (for example the former `courier`).
The launcher supplies selected helper definitions and role policy at startup.
The linker includes OMP's native definitions. Pi helper sessions inherit the
parent's registered providers and exclude ambient diagnostic extensions.

Link the Pi setup extension:

```bash
<skill-dir>/scripts/link-pi-extension.sh
```

It provides only `orca_pod_setup`. Run `/reload` after a new link. Existing
foreign links are preserved and reported. The question window is the independent
`pi-task` package. To use it, install with `pi install /absolute/path/to/pi-task`
from a local checkout and reload Pi. Missing pi-task does not block setup or
planning. Use an already installed legacy `orca_pod_ask` or numbered text.
Setup does not install pi-task.

## 3. Choose the path for the current agent

### Pi: the browser form in one tool call

```javascript
orca_pod_setup({})
```

This is a **Pi tool, not a shell command**. The extension
`~/.pi/agent/extensions/orca-pod-setup/index.js` (a link to this skill's `pi-extension/`,
step 2) starts a local
HTTP server inside the current Pi process and opens the browser. Clicking "Generate YAML" resolves
the tool's pending Promise: the answer appears in the result of the call.

- In Pi do not run `pipeline-form.mjs`/`setup-form.mjs` through Bash, `&` or a parallel shell.
  Do not use `sleep`, polling, `--detach`, `--wait` or `result.json`.
- If the tool is not visible, ask for `/reload` in Pi (or a restart), then repeat.
- If the browser did not open, the URL is visible in the intermediate result; `no_open: true`
  only shows the URL. `timeout` is the wait limit in seconds (900 by default).
- To reopen the form with the previous choice, pass `current_yaml: <YAML from the previous result>`.

The form: **profiles** are tabs; "Add profile" creates a copy of the current one. A
profile has a name, the "Default profile" mark (`active_profile`), a **default agent**
(`default_provider`), **concurrent subagents** (`max_subagents`,
1–100, 6 by default), **full access** (`full_access`, on for newly created profiles; direct launches only) and
"Delete profile" (the last profile cannot be deleted). For each
role of the profile there is **its own agent** ("default" / Pi / Claude Code / Codex), the model,
thinking, `use_subagents` and the helper subagents with `inherit`. The model catalogs
([catalogs.mjs](scripts/catalogs.mjs)):

| Agent | Source of models | Thinking levels |
| --- | --- | --- |
| Pi | in Pi, the registry of the current session; outside Pi, `pi --list-models` (the same synchronized catalog, including providers added by extensions such as claude-bridge) | `getSupportedThinkingLevels` over the objects of the RPC `get_available_models`; if the RPC is unavailable, the levels are approximate |
| Claude Code | the aliases `opus`/`sonnet`/`haiku`/`fable` (the latest version of the family) and specific versions (`claude-opus-5-5`, `claude-opus-4-8`, …) from the Anthropic catalog synchronized in Pi — the same one claude-bridge uses (if `claude` is found; without Pi, only the aliases) | the model's effort from the same catalog (`low..max`) |
| Codex | `codex debug models` — the models visible in the Codex picker (if `codex` is found); the fallback source is `~/.codex/models_cache.json` | the model's reasoning effort (`supported_reasoning_levels`, for example `low..ultra`) |

An agent's CLI is looked up in PATH and then in the usual install folders (`~/.local/bin`, `~/.claude/local`, the
folder of the running `node`, nvm, Volta, Bun, pnpm, Homebrew…): the shell an agent runs commands in often lacks
them in PATH. A CLI found only there is used by its absolute path, and its `CATALOG` line ends with
`[<path>, not in PATH]`. `ORCA_POD_BIN_DIRS` (folders separated by `:`) replaces the list of usual folders.

The form UI is in `scripts/form/` (`index.html`, `form.css`, `form.js`, `i18n.mjs`); the server
`scripts/pipeline-form.mjs` serves the static files and the data (`GET /data`) and validates the form when "Generate YAML" is pressed.
The form is bilingual (English and Russian): all texts are in `scripts/form/i18n.mjs`; the language is chosen by the
`language` field of the config (`ru` or `ru-*` — Russian, any other tag — English), and with `auto` by the browser
language; the EN/RU switch in the header changes the language without losing what has been entered.

Planner and Implementer are required. Reviewer and Chief Reviewer are optional: a
new file does not have them, the form adds them with the "Add …" button and removes them with the
"Remove role" button; the "Review mode" line shows what will result (`full`,
`reviewer`, `chief` or `self` — the Implementer's self-check without reviewers). A role that
was not added is not written to the YAML.

The model of a role and its helpers comes from the role's provider. Codex helpers can use any model from the Codex catalog and `inherit`: the role
starts them with `agent_type`, and Codex takes the model that is passed. Claude Code subagents get only an alias or inherit: the `Agent` tool does not accept a
full id; a specific version is available only to the role itself (`claude --model`). Changing the role's agent or the default resets incompatible models. In the YAML each
profile gets `default_provider`, `max_subagents` and the selected `full_access` value. It includes `provider:` only
for the roles whose agent differs from the profile's default. The catalog sources are shown in the form header.

Continue **only if `status: submitted`**. The result: `yaml` (the whole file),
`settings` (`activeProfile` and `profiles[]` with `name`, `defaultProvider`,
`maxSubagents`, `roles`), `targetPath`, `git` (`false` outside a Git repository), `sourceHash` (the SHA-256
of the source file, or `null`), `migration`. On `cancelled`,
`timeout`, `aborted` or an error the configuration does not change.

### Claude Code and Codex (and other agents without the Pi tool): the same form through a script

Run from the project root. Claude Code — **in the background** (Bash `run_in_background: true`;
the form waits up to 15 minutes, and foreground Bash is limited to 10 minutes). Codex — as an ordinary command,
and wait for it to finish: the script prints one JSON line at the end; if the tool
returned control earlier, keep waiting for the same command, do not start a new one:

```bash
node <skill-dir>/scripts/setup-form.mjs
```

- In Codex run the script with elevated permissions from the first call (Codex asks the user). In the Codex
  sandbox the form cannot open its local port (`The form cannot open a local port … run setup-form.mjs with elevated
  permissions`), Pi cannot take its lock files in `~/.pi/agent` and lists no models, and `open` may be refused.
  Do not bypass the sandbox; if the user refuses, run with `--no-open` and give the link.
- The script opens the browser and writes `FORM URL: …` to stderr — show the link to the
  user. Options: `--no-open` (only the URL), `--timeout <sec>` (900 by default),
  `--current-yaml-file <path>` (reopen with the previous choice).
- The catalogs are as in the table above: the script runs `pi --list-models` and an ephemeral
  Pi RPC session (`--no-session`, without tools/MCP/skills) only to get
  the model metadata, with no AI requests; the `CATALOG …` lines in stderr show the
  sources. An unavailable agent simply does not appear in the list. Show the user every `CATALOG` line that
  has no models, in one line each with what to do: `not found` — install the agent or put its folder in
  PATH; `no write access (sandbox?)` — run the script again with elevated permissions.
  `--programs pi`, `--programs claude-code` or `--programs codex` (comma-separated for several)
  limits the set of agents.
- Do not poll or wait in a loop: in Claude Code a notification about the background task
  arrives when it finishes. The last stdout line is one JSON with the same fields as the
  Pi tool (`status`, `yaml`, `settings`, `targetPath`, `git`, `sourceHash`, `migration`).
- Continue **only if `status: submitted`**; otherwise the configuration does not change.

The fallback if the browser is unavailable or the user is against the form: show an
example of Claude Code roles from the [template](../orca-pod/assets/orca-pod.yaml)
and in one AskUserQuestion ask for the profile name, the agent per role, the subagent limit
(6 by default, up to 100) and whether to apply the recommendation;
the Claude models are the aliases `opus`/`sonnet`/`haiku`/`fable`, and the
helpers of a claude-code role get only `inherit` or an alias.

## 4. Save the file and validate

- Re-read the target file before writing and compare the SHA-256 with `sourceHash`: the file may have
  changed while the choice was being made. If it does not match, show the difference and ask what to do.
- **There can be several profiles.** The form shows all the profiles of the file and
  returns the whole YAML: profiles added, renamed and deleted in the form
  are already accounted for, and `active_profile` is the default profile.
- If there is no file, create it (together with the `.orca-pod/` directory). If there is one, show a short "was → now" by profile
  (added / deleted / renamed / roles, agent or limit changed) and replace
  the file with the result of the form. Comments in the old file are not carried over: if there
  were any, say so.
- Do not write secrets or tokens.
- After writing, run only the schema check from the project root:

```bash
node <skill-dir>/../orca-pod/scripts/launch-provider.mjs --profiles
```

The command checks every profile: all must be `valid: true`. For each
profile tell the user its `summary` (roles, review mode, subagent limit).

Coordinator-launched roles request each provider's supported YOLO mode with
`--coordinator`. The Full access toggle applies to direct role launches. Setup
does not modify global permission rules for the Coordinator workflow.

Then add the pipeline's service folder to the project's `.gitignore` (idempotent; skip this step when the
result has `git: false`):

```bash
<skill-dir>/scripts/ensure-gitignore.sh <project-root>
```

The script changes only an existing `<project-root>/.gitignore` and adds `.orca-pod/`
(the pipeline writes the review reports there). `ADDED` — tell the user the file was changed;
`OK` — the folder is already ignored; `SKIP` — there is no `.gitignore` (the script does not create it), say
that `.orca-pod/` will be visible in `git status`.

The launcher reads the **saved** file. For a profile with `valid: false`, show its
`error` and reopen the form with the previous choice
(Pi — `current_yaml`, the script — `--current-yaml-file` with the YAML in a temporary file in the
scratchpad). `--resolve` checks that the CLI is on PATH or in the usual install folders and, for Codex roles, that the
model and thinking are in the Codex catalog; it does not check authorization or access to the model.

## 5. Summary

Custom helpers can be defined in the form with a unique name, one-line role
description and multiline instructions. Preserve both `description` and
`instructions` in each helper's YAML settings. The launcher registers them for
this session; do not require users to create agent files or install definitions.
With the definition switch off, the name resolves to an installed native agent.
Custom definitions and installed custom names have no selection count cap and
remain leaves. Only bundled preset specializations count toward the three-slot
limit; max_subagents controls concurrent instances separately.

For each profile (mark the default profile and the subagent limit) — a table
"role → agent → model → thinking → use_subagents → helpers"; the path to the file, the
result of link-agents and a reminder: the pipeline has not been run yet. If there are several
profiles, the Coordinator will ask at launch which one to use.
Summarize the five-profile and three-preset-specialization caps and the independent
concurrency setting. Show the retained and archived profiles and the backup path
when upgraded, even if the form is cancelled. Open the backup to recover any
five profiles, select an active one, validate and save that set.

## Fallback without the form in Pi

If the user is against the browser form — `pi --list-models`, comparison with the current
roles and questions about the missing fields ([settings.md](references/settings.md)).
Choosing helpers and models — [discovery-and-recommendations.md](references/discovery-and-recommendations.md).

## What not to do

- Do not run roles, providers, Orca Run or subagents.
- Do not edit the YAML by hand instead of using the form, except on an explicit, narrowly scoped request.
- Save the direct-launch access setting submitted through the form.
- Do not write tests and do not run checks beyond `--profiles`/`--validate`/`--resolve`.
