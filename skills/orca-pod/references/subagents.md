# Role subagents: Pi, Claude Code and Codex

Read by a role with `use_subagents: true` before its first delegation. The
Coordinator does not create children. No child accepts a plan, a batch or the
final — the decisions stay with the parent role and the user.

The helpers exist to **keep the role's context clean** and to work in parallel:
long reads, diffs, implementation of separate TODOs and checks go to children,
and the role receives a compact result. That is why with `use_subagents: true`
you delegate by default instead of doing it yourself.

## 1. Helper catalog

The `subagents` keys in YAML match `subagent_type` in Claude Code. In Pi
`worker`, `reviewer`, `scout`, `oracle` and `evidence-auditor` are the skill's
agents `orca-<key>` (`worker` → `orca-worker`, §2a); `researcher`,
`lens-checker`, `verifier` and a custom agent keep the key as `agent`. In Codex
`agent_type` is the same name with the `orca_` prefix and `_` instead of `-`
(`evidence-auditor` → `orca_evidence_auditor`).

| Helper | Permissions | Pi (pi-subagents) | Claude Code | Codex (`agents/codex/`) | Who uses it |
| --- | --- | --- | --- | --- | --- |
| `scout` | read-only | `agents/pi/orca-scout.md` (no extensions) | `agents/claude/scout.md` | `orca_scout` | all roles — code recon |
| `reviewer` | read-only | `agents/pi/orca-reviewer.md` (no extensions) | `agents/claude/reviewer.md` | `orca_reviewer` | Reviewer, Chief — review-lanes |
| `worker` | write within a scope | `agents/pi/orca-worker.md` (no extensions) | `agents/claude/worker.md` | `orca_worker` | Implementer — TODOs, fixes |
| `researcher` | read-only* | bundled (loads your extensions) | `agents/claude/researcher.md` | `orca_researcher` | Planner, Implementer — external docs |
| `oracle` | read-only | `agents/pi/orca-oracle.md` (no extensions) | `agents/claude/oracle.md` | `orca_oracle` | Planner — contested decision |
| `evidence-auditor` | read-only | `agents/pi/orca-evidence-auditor.md` (no extensions) | `agents/claude/evidence-auditor.md` | `orca_evidence_auditor` | Chief — criteria ↔ evidence |
| `lens-checker` | read-only | `agents/pi/lens-checker.md` | — (no pi-lens; the step is omitted) | — (no pi-lens) | Reviewer, Chief — type-check |
| `verifier` | read-only, runs only the commands from the task | `agents/pi/verifier.md` (with pi-lens) | `agents/claude/verifier.md` (without pi-lens) | `orca_verifier` (without pi-lens) | Implementer — self-check in `self` mode |

`*` The bundled Pi `researcher` has `write` (it writes `research.md`), which does
not guarantee read-only: its task must forbid writing in the project. For review
use `reviewer`; `scout` in review is only a fallback.

The definitions live in the skill (`agents/claude/`, `agents/pi/`) and are
connected by links with the `scripts/link-agents.sh` script (`~/.claude/agents/`,
`~/.pi/agent/agents/`). Project `.claude/agents/` and `.pi/agents/` with the same
names override the user ones. No agent — do not invent an alias: work inline/with
only the available helpers and note the degradation in the report; do not install
packages or change global settings for this. In Pi a missing `orca-<key>` follows
the §2a fallback.

## 2. Pi: pi-subagents (verified 0.78.0)

A single child (async by default, completion wakes the parent):

```javascript
subagent({ agent: "orca-reviewer", task: "<task>", model: "openai-codex/gpt-6-luna:high", cwd: "<abs>" })
```

After the launch return control: native completion wakes you — no `sleep`, no
polling of `status`, no `bg_wait` for these children.

Thinking is the model suffix `provider/id:<level>`; a separate `thinking` field is
ignored. For `model: inherit` substitute the parent's model; for `thinking:
inherit` — its thinking.

**In parallel** — the named workflow `parallel` (one `runs.all`, results in
order):

```javascript
subagent({ workflow: "parallel", args: { tasks: [
  { agent: "orca-reviewer", task: "<lane DEV-01>" },
  { agent: "orca-reviewer", task: "<lane DEV-02>" },
  { agent: "lens-checker", task: "<files>" }
] } })
```

If the children need different models — a workflow script in the same reply:

````text
```js workflow
const r = await runs.all([
  { key: "dev01", label: "Review DEV-01", agent: "orca-reviewer", model: "<m>:<t>", task: "<lane>" },
  { key: "dev02", label: "Review DEV-02", agent: "orca-reviewer", model: "<m>:<t>", task: "<lane>" },
]);
return r.map((x) => x.output).join("\n\n");
```
````

and the call `subagent({ workflow: true })`. An alternative without a script —
several direct calls in a row in one turn: each is async and wakes the parent on
its own. Control: `action: "list" | "models" | "status" | "steer"`. Do not set
hard `toolBudget`/`usageBudget` for children that write.

If the session has pi-interactive-subagents instead (`subagent`/`subagents_list`/
`subagent_message` without `action`), use its tools: thinking there is fixed by
the definition, parallelism is several calls in a row.

## 2a. Pi: pi-lens budget

Every Pi child is a separate runner process, also inside `workflow: "parallel"`
and with `async: false`. A child whose definition does not set `extensions`
loads all the user's Pi extensions, and pi-lens starts its own
typescript-language-server with two tsservers there on the first TypeScript file
(about 0.5–0.6 GB per child; twelve parallel workers took 8–10 GB).

- pi-lens lives in the role's session and in **at most one child at a time**.
- Children with pi-lens: `lens-checker`, `verifier`, the bundled `researcher`
  (it needs the web tools of the user's extensions) and any bundled or custom
  agent without `extensions` in its definition.
- Without pi-lens: the skill's `orca-worker`, `orca-reviewer`, `orca-scout`,
  `orca-oracle` and `orca-evidence-auditor` (an empty `extensions:`) — up to N at
  once.
- So a review round is `orca-reviewer` lanes plus one `lens-checker`; the
  `self` check in Pi is one `verifier`; a `researcher` does not run next to a
  `lens-checker` or a `verifier`.
- `lens_diagnostics` called by the role itself uses the role's own tsserver and
  costs nothing.
- An `orca-*` child that fails to start — the agent is missing, or its model
  comes from a provider extension (for example pi-claude-bridge: an empty
  `extensions:` disables provider extensions too) — use the bundled agent of the
  same name one at a time (it takes the pi-lens slot; its task must forbid writing
  outside the scope) or work inline; `evidence-auditor` — only inline (the
  bundled one checks web sources, not code). Note the degradation in the report.
- Do not change global settings for this (`subagents.agentOverrides`,
  `subagents.defaultExtensions`, the pi-lens config).

## 3. Claude Code

The `Agent` tool. Children work in the background, the result arrives as a
notification.

```javascript
Agent({ subagent_type: "reviewer", description: "Review DEV-01", prompt: "<task>", model: "sonnet", effort: "high" })
```

- **In parallel** — several `Agent` calls in **one** message. Do not wait for the
  first to launch the second; wait for the notifications of all; do not `sleep` or
  poll.
- The call's `model` accepts only an alias: `opus`, `sonnet`, `haiku`, `fable`.
  `inherit` → do not pass `model` (the definitions have `model: inherit`).
  A full id in the child's settings is not allowed (the launcher rejects it).
- The call's `effort`: `low | medium | high | xhigh | max`; `inherit` → do not
  pass it. Values from YAML are the user's explicit configuration, so they can be
  passed.
- To continue a child with its context — `SendMessage` by its id/name (useful for
  a repeat review round: the lane remembers its findings).
- No `lens-checker` (no pi-lens) — the type-lane is omitted without blocking.
- Skills: `Skill` with a name (`using-superpowers`, `brainstorming`,
  `writing-plans`); in Pi — `/skill:<name>`, in Codex — `$<name>` (plugin skills
  — `$superpowers:<name>`).
- Do not create agent teams, `claude -p`, new terminals and worktrees
  (`isolation: "worktree"` is not used).

OMP: use the native children mechanism if there is one, otherwise work inline;
the names in the table are purposes, not a promise of installed agents.

## 3a. Codex (verified 0.163)

Codex's built-in subagents. When a role starts, the launcher registers its
`orca_*` agents (`-c agents.orca_<name>.config_file=…`, the `agents/codex/*.toml`
files) and the limit `agents.max_concurrent_threads_per_session=N`; with
`use_subagents: false` — `agents.enabled=false`. In regular Codex sessions these
agents do not exist.

- **Always pass `agent_type`** (`orca_worker`, `orca_scout`, …) — with it Codex
  launches the child on the passed `model` of any multi-agent generation. Without
  `agent_type`, a model outside the Codex allowlist is silently replaced by
  another.
- `model` and `reasoning_effort` — from the role's child settings; `inherit` →
  the role's values. No entry for a helper — do not pass them (Codex's native
  defaults).
- Clean context: V2 (models with `multi_agent_version` v2, for example gpt-6-luna)
  — `spawn_agent({ task_name: "dev_01", agent_type: "orca_worker", message: "<task>",
  model: "<m>", reasoning_effort: "<e>", fork_turns: "none" })`; V1 (for example
  gpt-5.6-luna) — `spawn_agent({ agent_type, message, model, reasoning_effort })`,
  `fork_context` is false by default. Which version the role has is visible from
  its tool set (V2: `followup_task`, `list_agents`; V1: `send_input`,
  `close_agent`).
- **In parallel** — several `spawn_agent` in a row without waiting, then
  `wait_agent` in a loop until all return (V2 — `wait_agent({ timeout_ms })`,
  V1 — `wait_agent({ targets: [ids] })`), not `sleep`.
- Codex enforces the limit N: `collab spawn failed: agent thread limit reached` —
  wait for a child (`wait_agent`) and repeat the spawn; this is not a role error.
- A repeat round with the same child — V2 `followup_task`, V1 `send_input`.
- Read-only helpers are restricted by instruction: Codex gives a child no separate
  sandbox, it inherits the role's permissions. No grandchildren — also by
  instruction.
- No `lens-checker` (no pi-lens) — the type-lane is omitted without blocking.

## 4. Parallel Workers in one working folder

The pipeline deliberately allows several writing Workers at once — without
worktrees, but only with **non-overlapping write scopes**:

- scopes are taken from the TODO's `writeScope` in the approved plan; if they
  overlap — launch sequentially;
- shared files (DI/routing/registries, `pubspec.yaml`/`package.json`, lockfiles,
  generated code, localizations) are edited only by the Integrator after the wave;
- a Worker does not run package installation, code generation, formatting of the
  whole project, builds and full tests — these are shared side effects;
- after the wave the Integrator checks `git status` against the scopes: a file
  outside a scope — find out from the Worker and fix before the next wave (Git
  writes are still forbidden).

## 5. Task for a child

The task is self-sufficient: the child does not see the parent's conversation or
skills.

```text
Goal: <result and expected behavior>.
Working folder: <abs>. Plan: <abs path, todoId, needed steps>. Spec: <abs path>.
Criteria: <acceptance criteria verbatim>.
Write scope: <exact files/directories> | "writing forbidden".
Constraints: <the project's AGENTS.md/CLAUDE.md — path or excerpt; forbidden checks>.
Checks: <allowed> ; forbidden: <…>.
Tests: not requested — do not write, change or run them | <the requested tests>.
Context: plan=<v>, stage=<s>, attempt=<N>.
LANGUAGE: <tag>
Do not spawn agents, terminals, worktrees, branches; Git writes are forbidden.
Return: <result format>, no more than ~40–60 lines.
```

The `LANGUAGE:` line is the role's own `LANGUAGE`; the child answers in it (a child
whose task has no such line answers in the language of the request).

Pass the child settings from YAML as they are. A result is bound to the passed
version/attempt; do not apply a stale result to a new attempt. Wait for all
children and read the actual changes before declaring the work done.
