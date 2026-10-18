# Choosing the available helpers and models

Use this reference to create a configuration, to choose or change helpers and
their models, and for roles on programs other than Pi. It helps to offer a choice from the real
environment rather than copying names from the example; reading the catalogs does not by itself start
subagents.

For a simple change of the main model in an existing Pi profile the short
path from the parent `SKILL.md` applies: one command `pi --list-models`. In that case do not
read this reference or the historical caches.

For a detailed preflight use only the data of the current session and host: assume
nothing in advance and re-check at every launch.

## 1. Discover the options of the selected program

First determine the provider of each Planner/Implementer/Reviewer role and the project's working
folder. There is no need to repeat identical discovery for one runtime;
different programs, hosts and config scopes are checked separately. The catalog of the current
Coordinator fits only when it is the same program, account, configuration and
project scope. Codex models cannot be automatically considered available in Pi,
nor Pi agents as existing in Claude Code.

For each candidate save the exact name, purpose, read/write permissions,
source, limitations and the effective model settings. For models the exact
id/alias, the available thinking levels and the information about capabilities are needed, if the catalog
reveals them. Do not print tokens, keys or the full contents of authorization files.

### Pi

First determine the package that is actually connected and the tool schema. For a confirmed
pi-subagents, read its native skill and its models section (`guide` topic `models`). Management actions can
belong only to this API, and only if the current schema confirms them:

```javascript
subagent({ action: "guide", topic: "models" })
subagent({ action: "list", capabilities: true })
subagent({ action: "models" })
subagent({ action: "get", agent: "<candidate from the list>" })
```

In the previous version of pi-subagents, 0.76.1, `models` without the `agent` filter shows the effective
settings of the agents and the available `provider/id` of the registry of this Pi session. The output may
be shortened: do not call the first lines a full list. For details and the full
catalog use the read-only registry interface supported by the current version.
Check `disabled`/`restricted`, the capability ceiling, the applicable `modelScope` and
the thinking limit. A model being present in the common registry does not cancel the child's restrictions.

The target package is **npm pi-subagents** (verified 0.78.0); the git version
pi-interactive-subagents conflicts on the `subagent` tool, do not install it alongside. A single
`subagent` tool: a direct child `{ agent, task, model?, cwd? }`, the actions
`list`/`models`/`guide`/`steer`/`status`. Per-call thinking is the model suffix
`provider/id:<level>`; a separate `thinking` field is ignored at dispatch. The bundled
agents: scout, researcher, worker, reviewer, oracle, delegate, evidence-auditor;
the project's `.pi/agents/` override the global ones. The pipeline itself runs worker,
reviewer, scout, oracle and evidence-auditor as the skill's `orca-*` agents (an empty
`extensions:` — no pi-lens per child) and uses only `researcher` from the bundled ones. Do not promise a pair that is not
in the role's `{ action: "models" }`.

For an ordinary choice of the main model it is enough to run
`pi --list-models` once; use the exact model IDs it shows as candidates and compare them
with the current profile. This is the list of models that the current Pi shows as available,
but it does not prove that the model will answer from Orca or that the runtime preflight will pass.
Do not run separate auth/model probes, do not repeat the command per role and do not go on
to read caches/registries for this scenario.
If the list does not contain enough information to compare models by speed,
price or quality, do not invent a ranking: briefly state the limitation instead of
an extended search of your own.

Check the observed session registry and the supported thinking only when configuring
specific Pi helpers or doing a detailed provider preflight. The local
`models-store.json`/`models.json` are only a dated fallback source. An exact
`provider/id` removes ambiguity; Pi's fuzzy matching and thinking clamp do not
meet the pipeline's no-silent-fallback requirement. Check the requested/observed pairs
separately; do not take a CLI success as proof of the exact runtime pair.

If the Pi tools are not available from the current Coordinator, read the local
help of the connected version and use only a documented read-only
catalog. Do not start a new AI session, a workflow, a profile load or the creation of a
child for the sake of discovery. Definition files outside Pi give information about the settings,
but do not confirm that they are loaded and resolved in a future session.

### Codex

The catalog is `codex debug models` (no AI request; this is how the form reads it): the models with
`visibility: list` get into the form and into the launcher's check, the reasoning efforts are
the model's `supported_reasoning_levels`. `~/.codex/models_cache.json` is Codex's internal
cache (TTL 300 s, may be incomplete): only a fallback source, with the date noted.
Do not run `codex exec` and do not start an app-server just to get a list.

The pipeline helpers in Codex are the `agents/codex/*.toml` of the skill
`orca-pod` (`orca_worker`, `orca_scout`, `orca_researcher`,
`orca_reviewer`, `orca_verifier`, `orca_oracle`, `orca_evidence_auditor`). In the YAML the
keys are the same as in Pi and Claude Code (`worker`, `scout`, …); the launcher registers the
`orca_*` agents when it starts a role, only in its session. Codex's built-in roles
(`default`, `worker`, `explorer`) are not overridden.

A helper's model is any model from the Codex catalog or `inherit`: the role passes it to
`spawn_agent` together with `agent_type`, and Codex takes the model that is passed, of any
multi-agent generation (verified on 0.163). `ultra` does not take a slot in the subagent limit.
Offer the helpers a cheaper model and effort than the role's if the helper's task
is narrow (scout, reviewer-lane).

Sources: [Codex model catalog](https://learn.chatgpt.com/docs/app-server),
[Codex subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents).

### Claude Code

The pipeline helpers for Claude Code are the agents of the skill `orca-pod/agents/claude/`
(`scout`, `reviewer`, `worker`, `researcher`, `oracle`, `evidence-auditor`,
`verifier`), linked by `scripts/link-agents.sh` into `~/.claude/agents/`. The names
match Pi's, so one YAML key works in both programs. The project's
`.claude/agents/` with the same name override the user's — say so.
There is no `lens-checker` in Claude Code (no pi-lens). The built-in `Explore`/`Plan`/
`general-purpose` do not fit as YAML keys (case) and the pipeline does not use them.

Models: the alias `opus`/`sonnet`/`haiku`/`fable` or a full id from the current session,
taking `availableModels` into account; an allowlist does not prove the account's access. For child agents (subagents) —
only an alias or `inherit` (the `Agent` tool accepts only an alias in the call);
per-call `effort` is supported (`low..max`, Claude Code ≥ 2.1.292). Do not change
settings and do not pick an item in the model selector just to look.

Sources: [Claude Code subagents](https://code.claude.com/docs/en/sub-agents),
[model settings](https://code.claude.com/docs/en/model-config).

### OMP and an unavailable catalog

Discover a read-only catalog from the current OMP schema/help; do not carry over the commands
of other programs. If the catalog is missing, incomplete or unavailable from the current
environment, say which list exactly could not be obtained. Show the confirmed
part and ask for the missing options / the exact choice. Do not call a guess available.

## 2. Select the useful helpers

Check the candidates' compatibility with the current launcher: the `subagents` keys allow
lower-case Latin letters, digits and hyphen, start with a letter, and are up to 64 characters long.
Do not fix an incompatible native name with an invented alias and do not save an invalid YAML.
For such an agent state the compatibility limitation directly and exclude it from the configuration.

Show the suitable candidates found in a simple table:
"helper → what it does → when it is useful → whether it is proposed now". With a large
catalog, first show the recommended ones and a few alternatives; offer to expand
the rest. Do not hide the other options behind a single `worker: inherit`.

Match the available definitions to the needs of the task, not only to the name:

- Planner — a read-only `scout` (in parallel by area) and a `researcher` as
  needed; `oracle` — for a contested decision.
- Implementer (integrator) — `worker` is required for parallel waves: one
  worker per independent TODO; `scout`/`researcher` — for clarifications. The worker's
  model is the workhorse (often `inherit`), not the most expensive.
- Reviewer — an independent Orca terminal; it needs a read-only `reviewer` for the
  parallel lanes of the batch review and, in Pi, `lens-checker`. The lane model may
  be cheaper than the Reviewer's own: the decision and classification stay with it.
- Chief Reviewer — `reviewer` lanes on a strong model and `evidence-auditor`.
- A native `reviewer` of any role is a lane, not a replacement for the terminal Reviewer/Chief.

For the full workflow keep the listed capabilities. Without `worker` the Implementer
works sequentially, without `reviewer` the reviewers read the diff themselves — this is
acceptable, but it eats the roles' context on large tasks; explain that.
If only a single universal type is available, explain that it performs the different assignments.
With a fixed catalog keep its exact name; several assignments of one
type use one model entry if the YAML does not allow telling them apart.

## 3. Choose models from the discovered list

First take into account the user's explicit preferences, the project's restrictions and the
provider's confirmed recommendations. Use the descriptions of capabilities, context, thinking and
the available information about speed/price; do not invent an unknown price or performance.
A model's name alone cannot prove that it is stronger or cheaper.

For the selected set show up to three applicable options:

- **Faster:** a model suited to limited work and moderate thinking.
- **Balanced — recommended:** a sufficiently strong executor; for a complex review
  a strong model, if its advantage is confirmed and it is available.
- **More depth:** extra reasoning for a specific hard part;
  not maximum thinking for all helpers by default.

These are targets for the selection, not three required different models. If only one
model is available or the differences are unknown, honestly offer one option instead of an invented
comparison. `inherit/inherit` remains a full option: show which
settings of its own parent role it will take and whether the adapter can apply the pair.
Before it is launched, it is the requested configuration, not the observed model of the child.
For Planner/Implementer/Reviewer also choose the models
from the catalog of the corresponding program, not from the built-in YAML example.

Each recommendation contains the concrete model/alias found and the thinking for
each helper, a short reason for the choice and the source. When needed, mark
"in the catalog", "allowed by the current mechanism" and "runtime not yet confirmed".
Exclude pairs that are known to be forbidden; do not check them with a paid trial run.
Do not silently switch to another model when the one you need is missing.

## 4. Agree on the choice with a clear question

Show the recommendations before the question, then offer to apply the recommended option
or to choose other available roles/models. Turning off help for any role is allowed:
the role works inline (the Implementer, in waves sequentially), but on large
tasks its context fills faster; explain this explicitly.
Let the user choose a separate model for a separate helper. Do not make the
user assemble the YAML by hand and do not repeat decisions that are already agreed.
If the choice is delegated to the agent, apply the recommended option within the delegation.

Explain: the `subagents` set stores the settings in case of a launch, it does not start everything
listed. Reviewer lanes are started on each attempt of the batch review. If the
user additionally assigned research,
save it as an explicit requirement of the current task and pass it to the Coordinator for the plan.
In the YAML write only existing fields: `use_subagents`, `subagents`, `model`,
`thinking`. Do not add the non-existent `enabled`, `required` or `review_loop`.
