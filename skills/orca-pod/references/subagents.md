# Role subagents

Use the effective role policy returned by the launcher. The role owns delivery,
diagnostics and verdicts. Its selected helpers do bounded work under the plan.
Explicit selections replace defaults. For unavailable specializations or hosts,
complete that work inline and record the limitation.

| Provider | Bundled helper name for `scout` | Invocation and completion |
| --- | --- | --- |
| Pi with pi-subagents | `orca-pod-scout` | native `subagent`, foreground results or background notifications |
| Claude Code | `scout` | `Agent`, wait for foreground result or background notification |
| Codex | `orca_scout` | `spawn_agent` with `agent_type`, then `wait_agent` until all return |
| Qoder | `scout` | native `Agent`, wait for the reported result |
| OMP | `orca-scout` | native `task`, wait for the result or async notification |

Translate other bundled names by the same pattern. Custom names use the
configured name, with the `orca_` prefix and underscores in Codex. Resolve the
actual provider definition before calling it. Do not substitute a generic
worker or any unselected built-in. Plan one retry for a failed worker, then do
its task inline. Do not use timers, polling, other CLIs, additional worktrees or
recursive helpers to work around policy.

## Pi child sessions

The role policy registers selected definitions in the active session through
pi-subagents. For a single helper, pass `agent` and `task`. The optional launch
fields are `async`, `model` (the selected route) and `options.timeoutMs`.
Omit `worktree` and `output` entirely, even when their value would be `false`.
For a foreground result, use

```javascript
subagent({ agent: "orca-pod-scout", task: "Trace the provider adapter entry point.", async: false })
```

With `async: true`, the parent may continue independent work while the child runs. Assign explicit,
non-overlapping write paths to each child and the parent: all share one folder,
and that separation is an agreement in the assignments, not technically enforced.
Wait for all children and their writes before review or stage handoff; a launch
receipt is not completion. Use native completion notifications, or a foreground
result, rather than timers or polling. A one-shot `subagent({ action: "status", id })`
can inspect a run; do not manage another role's runs.

For each new provider/model/thinking route, verify one child completes successfully
before parallel fan-out. After that, the bounded native `workflow: "parallel"`
with selected agents and explicit `async` is supported within `max_subagents`.
The guard blocks unselected names, model overrides, unsupported workflow forms,
unknown process status and excess children; do not bypass it. In the tested
versions the native snapshot displays at most 8 children per workflow, so wider
workflows are refused even when `max_subagents` is higher. The snapshot displays
at most 20 runs; once its history is truncated the guard refuses new launches
rather than guessing whether omitted processes have ended. Finish existing work,
report the limitation and work inline. Child sessions exclude ambient diagnostic extensions. Foreground children use the parent model
registry; background children run in an isolated process and a provider requiring
per-child extensions may be unavailable. If registration, route preflight or
completion accounting is incompatible, stop delegating through that route, work
inline and report the limitation. A compatible main Pi role retains Lens, and its
diagnostics remain the main role's responsibility, including cumulative and
fix-delta checks. Verifier may check criteria or approved commands in self mode.

## Native settings and permissions

The launcher supplies session-local policy and tool filters where supported.
Codex exposes some built-in agent names even when selected definitions are
registered. The role uses only its configured types. Claude Code and Qoder
receive selected definitions through `--agents` and disable Agent for inline
roles. Qoder also excludes discovered unselected agents when the list is
available. OMP definitions use its native agents directory and its session hook
rejects unselected task agents. The setup linker preserves existing files and
links. Directly supplied custom definitions must be compatible with the native
mechanism and the role policy. An instruction-only limitation is reported.

Plan the work around the provider's actual model/effort and tool support. Use
native completion events or foreground results. Never count a child outcome as
plan approval, a stage verdict, or verified diagnostic coverage.


## Child task template

~~~text
LANGUAGE: <tag>
Task: <bounded work and expected evidence>
Paths: <read scope and explicit write scope, if any>
Tests: not requested — do not write, change or run them | <the requested tests>.
Checks: <exact approved commands>
Delegation: none. Report evidence to the parent.
~~~
