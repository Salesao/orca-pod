# Role subagents

Use the effective role policy returned by the launcher. The role owns delivery,
diagnostics and verdicts. Its selected helpers do bounded work under the plan.
Explicit selections replace defaults. For unavailable specializations or hosts,
complete that work inline and record the limitation.

| Provider | Bundled helper name for `scout` | Invocation and completion |
| --- | --- | --- |
| Pi with `npm:pi-subagents` | `orca-pod-scout` | use [Pi child sessions](#pi-child-sessions) and the installed package's `skills/pi-subagents/SKILL.md` or native `subagent({ action: "guide" })` |
| Pi with `pi-interactive-subagents` or missing native registration | — | the Orca Pod guard requires the `pi-subagents` registration and status APIs. Record the adapter/registration diagnostic and work inline. |
| Claude Code | `scout` | `Agent`, wait for foreground result or background notification |
| Codex | `orca_scout` | `spawn_agent` with `agent_type`, then `wait_agent` until all return |
| Qoder | `scout` | native `Agent`, wait for the reported result |
| OMP | `orca-scout` | native `task`, wait for the result or async notification |

Planner can split research by area, Implementer can assign independent TODOs
with disjoint write scopes, and both reviewers can split their review by area.
On each provider, dispatch the independent assignments before waiting for results.
Pi supports a parallel workflow. Claude Code and Qoder can issue multiple Agent
calls in one turn. In Codex spawn the selected agents before waiting. In OMP
submit the independent items together in the native task tool. Bound each wave
by the available slots and collect all results before the next dependent step.

Translate other bundled names by the same pattern. Custom names use the
configured name, with the `orca_` prefix and underscores in Codex. Resolve the
actual provider definition before calling it. Do not substitute a generic
worker or any unselected built-in.

## Lane budget and reporting

Give each child one independently verifiable question or TODO, a short list of
paths (for example one module and its callers), and one expected result such as
a file/line finding or the saved output of an approved command. Split broader
work before launch. State the lane's time budget in the assignment. Pi uses a
300 s maximum per lane. For a focused scout, a 120 s budget is a reasonable
starting point. For other hosts use their native timeout or wait controls where
available and state the budget in the prompt.

On expiry, collect available partial evidence, record the lane, seconds and
outcome, then finish the uncovered portion inline. A role may retry a failed
worker once on a narrower slice if time remains. Wait for completion or stop
the role's own run and verify termination before overlapping writes, a retry
on the same paths, or a review handoff. If a host cannot confirm termination,
record the blocked paths and continue only independent work. Use native events
or foreground results. Keep the same provider and workspace.

Every role reports `launched_total`, `peak_concurrent`, configured concurrency,
and `inline_reason` per affected lane. Count children that actually started,
including retries. Count a parallel workflow's children individually. Count
overlapping live children for the peak. A refused call starts zero children.
Pi's `Run fan-out` is the native run budget. It cannot establish the role's peak.
Use run IDs, child results or native status as evidence. Mark a count unknown
if the adapter exposes insufficient lifecycle data and report the known bounds.
When `use_subagents=true` and zero children ran, record the deviation and its
specific reason. Attribute inline findings to the role that did the work.

## Pi child sessions

At session start the Pi guard resolves selected models, registers the helper
definitions, checks the active tool and calls the adapter's read-only ping and
status APIs. The role receives the result before its first assignment.
`ready` confirms adapter capabilities and current process accounting. Child
model access and reasoning effort remain unobserved until execution.
`unverified` includes the status or reconciliation reason. The adapter's ready
event, the first turn and each subsequent launch can recheck transient status. `unavailable`
explains a registration, tool or model mismatch. Use the reported reason in
the affected lane's degradation. `disabled` is planned inline operation.

For a single helper, pass `agent` and `task`. The optional launch
fields are `async`, `model` (the selected route) and `options.timeoutMs`.
Omit `worktree` and `output` entirely, even when their value would be `false`.
For a foreground result, use

```javascript
subagent({ agent: "orca-pod-scout", task: "Trace the provider adapter entry point and return its file and line.", async: false, options: { timeoutMs: 120000 } })
```

With `async: true`, the parent may continue independent work while the child runs. Assign explicit,
non-overlapping write paths to each child and the parent: all share one folder,
and that separation is an agreement in the assignments, not technically enforced.
Wait for all children and their writes before review or stage handoff; a launch
receipt is not completion. Pi launch and foreground receipts include
`requested` and `observed` model/thinking fields for each assignment.
For native result-linked child sessions, `observedFrom: child_session` identifies
the last recorded assistant reply and the Pi thinking level active for that reply.
The guard reads the child's standard session file under this parent/run only,
up to 1 MiB. Ambiguous or missing evidence leaves the affected fields unknown.
Preserve `unknown` (JSON `null`) for each missing observation. If a later
child reply or targeted status identifies its actual model/effort, cite that
evidence in the lane report. Configuration, registration and a successful
result alone cannot confirm either field. Use native completion notifications, or a foreground
result, rather than timers or polling. A one-shot `subagent({ action: "status", id })`
can inspect a run; do not manage another role's runs.

Independent tasks can start together on the same model route from the first call.
Use the native `workflow: "parallel"` with `args.tasks` and an explicit `async`.
Each task uses one slot within `max_subagents`.
The guard blocks unselected names, model overrides, unsupported workflow forms,
unknown process status and excess children. Copy its reason into the affected
lane report, including any omitted run/child counts, byte limit, missing
terminal proof, unmatched live run or unexpected fleet count. Keep outstanding
children reserved until their termination is proven. In the tested
versions the native snapshot displays at most 8 children per workflow, so wider
workflows are refused even when `max_subagents` is higher. The snapshot displays
at most 20 runs; once its history is truncated the guard refuses new launches
rather than guessing whether omitted processes have ended. Finish existing work,
report the limitation and work inline. Child sessions exclude ambient diagnostic extensions. Foreground children use the parent model
registry; background children run in an isolated process and a provider requiring
per-child extensions may be unavailable. If registration, model access or
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
Time budget: <seconds and expected evidence within the budget>
Tests: not requested — do not write, change or run them | <the requested tests>.
Checks: <exact approved commands>
Delegation: none. Report evidence to the parent.
~~~
