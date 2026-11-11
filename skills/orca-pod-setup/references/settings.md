# What orca-pod.yaml means

The file `.orca-pod/orca-pod.yaml` is one per Git repository, in the main
checkout (a linked worktree may have its own in its `.orca-pod/`); outside Git, one per project folder. The folder is
added to `.gitignore` when the project has one. The old layouts — the `.orca-pipeline/` directory (with `orca-pipeline.yaml`
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
| `full_access` of a profile | Direct launch setting (boolean); Coordinator always requests supported YOLO through `--coordinator`. Pi uses host permissions. |
| `roles` | The roles inside the selected set |
| `planner` | Writes the specification and the plan with waves of independent TODOs |
| `implementer` | Integrator: hands independent TODOs to parallel workers, integrates, sends the stage to review as one batch |
| `reviewer` | Optional. Batch review of a stage by parallel lanes; only serious findings block |
| `chief_reviewer` | Optional. The chief final review of all the code and of the history of reports |
| `provider` of a role | The program for this particular role instead of the common one |
| `model` | A model name understood by the selected program |
| `thinking` | The reasoning effort level supported by the model and the program |

The allowed programs are `pi`, `codex`, `claude-code` (also `claude`), `qoder` (also `qodercli`) and `omp`.
Model and thinking are required for every role. There can be up to three profiles:
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
  `~/.claude/agents/`). The launcher supplies the session definitions.

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
- For roles to call `orca` from the Codex sandbox, the rule
  a directly launched restricted session may need an Orca permission rule.

## Helpers: settings per role

They are configured inside each role independently:

```yaml
use_subagents: true
subagents:
  worker:
    model: inherit
    thinking: inherit
```

An omitted mapping uses the defaults below. An explicit selection replaces
them, including installed compatible custom names. Every selected helper needs
a model and thinking value; `inherit` refers to its own role. At most three
specializations can be selected, independently of `max_subagents` (6 by default,
range 1–100).

| Role | Defaults |
| --- | --- |
| Planner | scout, researcher, oracle |
| Implementer | worker, scout, verifier in self mode only |
| Reviewer | reviewer, scout |
| Chief Reviewer | reviewer, evidence-auditor, scout |

Resolve provider-native names at runtime. A missing/incompatible definition
requires inline work. Pi foreground children inherit registered providers and
exclude diagnostic extensions. Diagnostics stay with the main role.

Qoder uses `qodercli --list-models` and `thinking: default`. OMP uses
`omp models --json`, accepts the selected model's listed thinking levels, and
also offers `default`. When the installed Qoder/OMP catalog is incomplete, the
form accepts an exact manual ID with `default`. Availability is verified when
the CLI launches.

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
```

One level of nesting is two spaces, no tabs. `use_subagents` has no
quotes: `true` or `false`. Inside a helper only `model` and `thinking` are allowed.
Do not add passwords, tokens, shell commands, arbitrary roles or fields.
Inside a profile only `roles`, `default_provider`, `max_subagents` and `full_access` are allowed.
For a configuration with more than three profiles, setup/preflight first saves
all original bytes to a sibling `orca-pod.yaml.backup-<unique-id>`. It then keeps
the active profile and the first two other profiles in their original order.
An absent active profile, changed source or failed backup prevents replacement.
Cancel only dismisses the form. To restore, read the complete backup, choose up
to three profiles and set `active_profile` to one of them, then validate the
replacement. Keep the backup.

For legacy helpers, explicitly remove the retired diagnostics specialization and
choose the retained model/effort when moving Implementer's Researcher duties to
Scout. The profile migration preserves those settings until the form is saved.
