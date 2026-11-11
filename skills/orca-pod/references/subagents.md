# Role subagents

Use the effective role policy returned by the launcher. The role owns delivery,
diagnostics and verdicts. Its selected helpers do bounded work under the plan.
Explicit selections replace defaults. For unavailable specializations or hosts,
complete that work inline and record the limitation.

| Provider | Bundled helper name for `scout` | Invocation and completion |
| --- | --- | --- |
| Pi with pi-subagents | `orca-pod-scout` | `orca_pod_helpers`, native foreground results |
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
pi-subagents. It uses local foreground children, with discovered and child-only
extensions excluded. Foreground sessions inherit the providers registered in the
parent's model registry. If a provider requires its own per-child hooks, the
configured helper needs a different runtime, or preflight cannot resolve the
model or register the definition, use inline work. For a new provider/model
combination verify one child before parallel work. A provider-hook failure ends
fan-out for that route. Do not assume a hard-coded provider extension name.

```javascript
orca_pod_helpers({ tasks: [
  { agent: "orca-pod-scout", task: "Trace the provider adapter entry point." },
  { agent: "orca-pod-scout", task: "Trace the setup form model selection." },
] })
```

The runtime guard limits work to selected names, configured models and effort,
and the profile concurrency. It blocks background/workflow routes that could
load ambient diagnostics. It also removes known delegation tools for an inline
role. A compatible main Pi role retains Lens. The launcher disables detected
automatic scan, test and rewrite flags for the session. Diagnostics belong to the
main role, including the cumulative pass and any fix-delta rechecks. Verifier
may check criteria or approved commands in self mode.

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
