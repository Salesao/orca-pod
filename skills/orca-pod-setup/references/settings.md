# What orca-pod.yaml means

The file `.orca-pod/orca-pod.yaml` is one per Git repository, in the main
checkout (a linked worktree may have its own in its `.orca-pod/`). The folder is added to
`.gitignore` when the project has one. The old layouts — the `.orca-pipeline/` directory (with `orca-pipeline.yaml`
and `reports/`) and the `orca-pipeline.yaml` file in the project root — are migrated there
automatically. The file sets the programs and models the pipeline works with. The file itself starts nothing.

## Main fields

| Field | Plain explanation |
| --- | --- |
| `active_profile` | The default profile: the Coordinator offers it first; without a file — `default` |
| `default_provider` | At the root — the fallback program for profiles that have none of their own; if it is set nowhere, `pi` is used |
| `language` | A root field, one language for the whole project and all its profiles: the language the roles use when they talk to the user. `auto` (the default) means the language of the user's message, English when there is no user text; otherwise a language tag matching `^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$`, such as `en`, `ru`, `pt-BR`. An explicit tag wins over `auto`; the launcher rejects any other value. The setup form's interface language follows the same field: an explicit `ru` or `ru-*` tag gives Russian, any other explicit tag gives English; with `auto` (or when the field is absent) it is the browser's first language (Russian for `ru` or `ru-*`, otherwise English). A language chosen with the EN/RU switch is remembered in this browser during the form session and overrides both |
| `profiles` | Named profiles: each has its own set of roles, agents, models and limits |
| `default_provider` of a profile | The program for the roles of this profile that have no `provider` of their own |
| `max_subagents` of a profile | How many subagents one role runs at once: an integer from 1 to 100, 6 if the field is absent |
| `full_access` of a profile | Full access (yolo), unquoted `true`/`false`, false if the field is absent. `true`: Codex roles are started with `--dangerously-bypass-approvals-and-sandbox`, Claude Code roles with `--dangerously-skip-permissions` (no confirmations and no sandbox, access to the whole machine); Pi and OMP do not change |
| `roles` | The roles inside the selected set |
| `planner` | Writes the specification and the plan with waves of independent TODOs |
| `implementer` | Integrator: hands independent TODOs to parallel workers, integrates, sends the stage to review as one batch |
| `reviewer` | Optional. Batch review of a stage by parallel lanes; only serious findings block |
| `chief_reviewer` | Optional. The chief final review of all the code and of the history of reports |
| `provider` of a role | The program for this particular role instead of the common one |
| `model` | A model name understood by the selected program |
| `thinking` | The reasoning effort level supported by the model and the program |

The allowed programs are `pi`, `codex`, `claude-code` (also `claude`) and `omp`.
Model and thinking are required for every role. There can be several profiles:
the name is letters (Cyrillic included), digits, `.`, `_`, `-`, no spaces, up to 64
characters. If there is more than one valid profile, the Coordinator asks before the
launch which one to use and shows each on one line; the choice is not
written to the file. `planner` and `implementer` are required;
`reviewer` and `chief_reviewer` are added if wanted and set the review mode:

| Reviewers | Mode | How the result is checked |
| --- | --- | --- |
| both | `full` | Reviewer accepts the stages, Chief Reviewer gives the final verdict |
| Reviewer only | `reviewer` | Reviewer accepts the stages and gives the final verdict |
| Chief Reviewer only | `chief` | Chief Reviewer accepts the stages and gives the final verdict |
| none | `self` | Implementer checks itself through the `verifier` subagent (if `use_subagents: true`, otherwise inline): pi-lens in Pi, static analysis from the plan (analyze, lint, typecheck) and a check against the criteria; the outcome is `SELF_VERIFIED` without an independent review |

### Claude Code specifics

- The role's `model` is an alias (`opus`, `sonnet`, `haiku`, `fable`) or a full id
  (`claude-opus-5-5`); `thinking` is `low | medium | high | xhigh | max`
  (passed as `--effort`).
- For the helpers of a claude-code role, `model` is only `inherit` or an alias:
  the `Agent` tool accepts only an alias in the call. `thinking` is `inherit` or
  `low..max` (passed as the `effort` of the call).
- The helpers are the pipeline skill's agents (`agents/claude/*.md`, linked in
  `~/.claude/agents/`). There is no `lens-checker` in Claude Code (no pi-lens): do not
  add it to claude-code roles.

### A role on codex

- The role's `model` is a model from `codex debug models` that is visible in Codex (for example
  `gpt-6-luna`, `gpt-6-astra`); `thinking` is a reasoning effort from the levels of that
  model (`low..ultra` for `gpt-6-astra`, `low..max` for `gpt-6-luna`), passed
  as `-c model_reasoning_effort`.
- For the helpers of a codex role, `model` is any model of the same catalog or `inherit`,
  and `thinking` is `inherit` or a level of the selected model. The multi-agent generation does not
  matter: the role starts the helpers with `agent_type`, and Codex takes the model that is passed.
- The helpers are the pipeline skill's `agents/codex/*.toml` (names `orca_worker`,
  `orca_scout`, …). The launcher registers them when it starts a role, only in its session,
  and passes `max_subagents` to Codex as `agents.max_concurrent_threads_per_session`.
  There is no `lens-checker` in Codex.
- For roles to call `orca` from the Codex sandbox, the rule
  `prefix_rule(pattern=["orca"], decision="allow")` is needed in `~/.codex/rules/`; setup
  offers to add it.

## Helpers: settings per role

They are configured inside each role independently:

```yaml
use_subagents: true
subagents:
  worker:
    model: inherit
    thinking: inherit
```

The YAML names are the same in all programs. Claude Code uses them as is; Pi runs `worker`,
`reviewer`, `scout`, `oracle` and `evidence-auditor` as the skill's `orca-<name>` agents
(without pi-lens); Codex adds the prefix `orca_` and `_` instead of `-`:

| Role | Helpers | Why |
| --- | --- | --- |
| Planner | `scout`, `researcher`, `oracle` | parallel code recon; external docs; a second opinion on a contested decision (≤ 1 per plan) |
| Implementer | `worker`, `scout`, `researcher`, `verifier` | a worker for each independent TODO of a wave (no more than `max_subagents` at once), fixes in groups; `verifier` — the self-check in `self` mode (pi-lens in Pi, static analysis, checking the criteria) |
| Reviewer | `reviewer`, `lens-checker` (Pi only) | parallel review lanes by TODO/seams/delta (no more than `max_subagents`); type-check |
| Chief Reviewer | `reviewer`, `evidence-auditor`, `lens-checker` (Pi only) | lanes by areas of the whole code; matching the criteria to the evidence (≤ 1 per attempt) |

`scout` is acceptable for reviewers as a fallback; the read-only `reviewer` is
preferable for review.
The Pi `reviewer` and the Claude Code `reviewer` are lanes inside the Reviewer terminal;
they do not replace the terminal roles Reviewer/Chief Reviewer and do not give decisions.

The only limit in the YAML is the profile's `max_subagents`: how many subagents one role
keeps running at once. It is not a counter of launches; the total number is not limited.
The other limits (oracle ≤ 1 per plan version, evidence-auditor ≤ 1 per attempt,
review attempts) are the policy of the [pipeline skill](../../orca-pod/SKILL.md#subagents-policy-and-limits).
Do not add `budget`, `max_calls` or `max_parallel`.

- `true` — the helpers are enabled, and delegation is the role's default mode.
- `false` or no `use_subagents` — the role works inline (the Implementer runs
  the waves sequentially, the reviewers review the slices themselves), with a note about the degradation.
- The name inside `subagents` is the exact name of the program's agent (lower-case, digits, hyphen).
  The launcher checks the format of the name, not that the agent exists.
- Each helper needs both fields: `model` and `thinking`. `inherit` takes the
  value of its own role. Without an entry the agent's own settings apply.
- A `subagents` block is accepted even when `use_subagents: false` (a stub for later); an empty `subagents:` block is rejected.

In Pi a model looks like `zai/glm-5.3-flash`; the `:high` suffix is not written in the YAML —
model and thinking are always separate fields. The Pi `orca-*` helpers start without the user's
extensions, so their model (after `inherit`) must come from a built-in or `models.json` provider:
a model from a provider extension (for example pi-claude-bridge) does not load there, and the role
falls back to the bundled helpers one at a time. Take the list of models from the current program,
not from the example.

## A full example

Two profiles — on Pi and on Claude Code — are in the
[pipeline template](../../orca-pod/assets/orca-pod.yaml).
A fragment of Reviewer in Pi:

```yaml
      reviewer:
        model: openai-codex/gpt-5.6-sol
        thinking: xhigh
        use_subagents: true
        subagents:
          reviewer:
            model: inherit
            thinking: high
          lens-checker:
            model: inherit
            thinking: low
```

One level of nesting is two spaces, no tabs. `use_subagents` has no
quotes: `true` or `false`. Inside a helper only `model` and `thinking` are allowed.
Do not add passwords, tokens, shell commands, arbitrary roles or fields.
Inside a profile only `roles`, `default_provider`, `max_subagents` and `full_access` are allowed.
Set `full_access: true` only at the user's explicit request (the "Full access" switch
in the form); do not enable it yourself or offer it as a way around confirmations.

## Reconfiguration examples

- "Turn off the helpers" → change only `implementer.use_subagents` to `false`.
- "Add a cheap profile" → a new profile next to the existing ones (in the form, a copy of the
  current one); do not touch the existing ones and `active_profile`.
- "Let there be 20 subagents" → `max_subagents: 20` in the needed profile.
- "Run the roles with full access / in yolo" → `full_access: true` in the needed profile;
  warn in one line that Codex and Claude Code will work without confirmations and a sandbox.
- "Let the worker use the same model and thinking as the Implementer" → both worker
  fields to `inherit`.
- "Change only the model of the reviewer lane" → keep its thinking and everything else.
- "Move the reviewers to Claude Code" → `provider: claude-code` on reviewer and chief_reviewer,
  models are Claude aliases/ids, thinking `low..max`, helpers are
  `reviewer`/`evidence-auditor` without `lens-checker`.

## How to see the actual model

The YAML stores the request. In Pi — the data of the loaded adapter (`subagent({ action:
"status" })`), in Claude Code — `/tasks`, in Codex — the child agent's details.
If the runtime does not reveal the model or thinking, the report says "not confirmed".
