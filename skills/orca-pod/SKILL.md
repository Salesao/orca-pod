---
name: orca-pod
description: Use for plan approval and a direct Orca handoff with separate Planner, Implementer (an integrator with parallel Workers) terminals and optional Reviewer (batch review by parallel lanes) and Chief Reviewer (chief final review); without reviewers the Implementer checks itself with static analysis. Works in Pi, Claude Code and Codex. Takes a RAF path or a verbatim task description; the `test` argument runs the whole flow in a sandbox (`test check` verifies the result, `test reset` resets the sandbox).
---

# Direct Orca handoff: plan, parallel implementation and batch review

The Coordinator is the calling context: a quick check of `orca-pod.yaml`, one
question about the profile (if there are several) and additional skills, the role
terminals, the first assignment to Planner — and exit. Planner and Implementer are
mandatory; Reviewer and Chief Reviewer are optional roles (see "Review modes").
Each role is a separate Orca terminal and can run in Pi, Claude Code or Codex
according to `orca-pod.yaml`.

**Role, not Coordinator.** If a role launcher started you or the first prompt
starts with a `ROLE:` line, you are Planner, Implementer, Reviewer or Chief
Reviewer. The config, sandbox and terminals are already ready. Do not execute the
sections "Required project configuration", "Profile selection", "Coordinator skill
selection", "Terminal setup and Coordinator exit" and the Coordinator steps of
"Test mode"; do not run `orca terminal create`, `launch-provider.mjs` and
`test-sandbox.mjs`. Read the shared sections and the section of your role; the
language for talking to people is the `LANGUAGE:` line of the same prompt (section
"Language: LANGUAGE"). The launcher duplicates this in the session's system
instruction: Codex — `developer_instructions`, Pi and Claude Code —
`--append-system-prompt`.

```text
Coordinator  config → profile + skills → role terminals → Planner assignment → exit
Planner      spec + plan (TODOs with dependsOn/writeScope, waves, stages) → approvals → Implementer
Implementer  integrator: wave → parallel Workers → integration → … → the plan's checks
             (no self-review) → one REVIEW_REQUEST for the whole stage
Reviewer     parallel review-lanes → registry R<n> → CHANGES_REQUESTED for blocking
             items only ↔ Implementer (≤ 3 attempts) → APPROVED → Chief Reviewer
Chief        all code + Reviewer reports → C<n> ↔ Implementer (≤ 2 attempts) → FINAL_APPROVED
no reviewers  Implementer → verifier subagent: pi-lens + static analysis + criteria → fixes (≤ 3) → SELF_VERIFIED
```

Provider CLI syntax is in [launch-provider.mjs](scripts/launch-provider.mjs).
Pi, Claude Code and Codex subagents — [subagents.md](references/subagents.md). The
severity scale, the findings registry and the re-review rules —
[review-protocol.md](references/review-protocol.md). Messages between roles —
[handoff-contracts.md](references/handoff-contracts.md). Orca Run, worker task,
the new Orca API or an alternative orchestrator are not used.

## Invariants

- The Coordinator remains the calling context; no additional Coordinator is created.
- A role talks to people in `LANGUAGE` — the language from the `LANGUAGE: <tag>`
  line of the first prompt (section "Language: LANGUAGE"): terminal messages,
  questions, self-review, approvals, spec/plan, reports. Protocol tokens and report
  labels are always in English; keep code, commands, paths and identifiers.
- At the start and before using Orca, the active role reads the `orca-cli` skill
  (Pi — `$orca-cli`/`/skill:orca-cli`, Claude Code — `Skill orca-cli`, Codex —
  `$orca-cli`), resolves the executable, checks `ORCA status --json`, then
  `ORCA skills get orca-cli`. If the skill is missing, do not stop: use `--help` of
  the discovered executable.
- In Codex call Orca with the `orca` command, not an absolute path: the Codex rule
  `prefix_rule(pattern=["orca"])` matches the beginning of the command.
  `runtime_access_denied` (EPERM) from `orca` means there is no rule: do not
  bypass the sandbox, request a retry with elevated privileges (Codex will ask the
  user) and say that the rule is offered by orca-pod-setup.
- After the Orca preflight, migrate the old config layouts: `node <skill-dir>/scripts/config-location.mjs migrate`
  (show the user every `MOVED`/`IGNORED`/`SKIP` line — one line per result, `OK` — silently).
  After that — only the active config: `activePath` from `config-location.mjs where`.
  An invalid config stops bootstrap. A run works with one profile, chosen at start;
  YAML edits during the run are not re-read. Unavailable environment components
  (skill, helper, adapter) — a warning with continuation, not a stop.
- The task source is an exact RAF path or a non-empty inline description. The RAF
  path takes priority. Pass the inline `TASK DESCRIPTION` verbatim; analysis and
  constraints go in separate blocks.
- Roles are tied to the issued handle, `ptyId`, `incarnationId`, host and workspace.
  Title, `tabId`, active tab and UUID do not replace identity.
- Do not write pipeline service files (registry, intents, receipts, journals):
  everything needed is passed in prompts. The exception is `.orca-pod/reports/` in
  the project root: review reports and patch snapshots are written by Reviewer and
  Chief Reviewer, and in `self` mode by Implementer (self-check reports).
- `.orca-pod/` is the pipeline's service folder inside the project. It is not part
  of `writeScope`, patch snapshots, changed-file lists and the `git status` check.
  `ensure-gitignore.sh` adds it to the project's `.gitignore` (only if a
  `.gitignore` already exists; the script does not create the file itself).
- Do not compute SHA/digest tuples of the plan and changes: the plan version
  (immutable path), stage and attempt are sufficient identity.
- The Coordinator does not change application code. Git commit, push, stash, reset,
  branch and other Git writes require separate permission; reading does not.
  Worktrees are not created.
- The Planner chooses the architecture, does an inline self-review and gets explicit
  approval of the specification, the plan and a substantial revision in its terminal,
  each after a plan-blitz round of questions.
- **Tests only on request.** The pipeline does not write, change or run tests and does
  not follow TDD unless the user asked for tests — in the task (RAF, description, the
  demo `TASK.md`) or in a message to a role; do not offer them yourself. The checks are
  static: analyzer, linter, typecheck. This overrides the TDD steps of `writing-plans`
  and the `test-driven-development` skill. The plan records `tests: not requested` or
  `tests: requested — <the user's words>`; the roles and their children follow that line.
- The next stage opens only after the reviewer's `APPROVED` for the current one (in
  `self` mode — after a clean self-check); `COMPLETED` — only after the mode's final
  verdict: the reviewer's `FINAL_APPROVED` or the Implementer's `SELF_VERIFIED`
  without reviewers. Idle and the user's "done" do not replace it.
- Before review the Integrator waits for all children and stops side effects and
  writing. While the review runs, writing is forbidden; changing code during review
  invalidates the verdict.
- **The reviewers check the code.** With a Reviewer or Chief Reviewer (`full`,
  `reviewer`, `chief`) the Implementer does not review its own code: before
  REVIEW_REQUEST it runs only the plan's `verificationChecks` and fixes what they
  report — no `verifier`, review or audit lanes and no reading the diff in search of
  defects. Finding defects is the stage reviewer's job; a self-audit duplicates the
  review and delays the request. This overrides the review steps of
  `subagent-driven-development` and `requesting-code-review`. The self-check through
  `verifier` is only for `self` mode.
- Reviewer, Chief Reviewer and their lanes work read-only.
- Only `BLOCKER`/`MAJOR` on the review-protocol scale block; unlikely and
  non-critical findings are recorded but do not extend the cycle.
- A role's first prompt carries the full context; further messages are short. An
  accepted input is not repeated because of silence/timeout; a delivery error gets
  one retry.
- Planning questions go to Planner, implementation questions to Implementer, a
  child's questions to its own parent. The Coordinator and Orca ask/escalation are
  not intermediaries.

## Language: LANGUAGE

`LANGUAGE` is the language in which roles talk to people. There is one per run; the
Coordinator determines it before the first Planner prompt:

1. The `language` field of the active `orca-pod.yaml` (printed by
   `launch-provider.mjs --profiles` and `--roles`) is a tag (`en`, `ru`, `pt-BR` …), not
   `auto`: `LANGUAGE` equals this tag. An explicit tag wins over the user's language: with `language: en`
   roles write in English even if the user writes in Russian.
2. `language: auto` (or no field): the language of the user's text in the request —
   the task description and the user's messages in this Coordinator session
   (including the answer to the profile and skills question). The text of a RAF file
   determines the language the same way as an inline description: the user wrote the file.
3. `auto` and no user text at all — for example, a bare `/orca-pod test` with nothing
   else written by the user: `LANGUAGE` is `en`. The skill's own demo task (`TASK.md`
   in `test`) is not user text and never decides the language: under `auto` the user's
   own messages in this Coordinator session (for example, the answer to the profile
   question) decide, and only when there are none is `LANGUAGE` `en`.

No task yet (`TERMINALS READY`) — in `PIPELINE CONFIG RESOLVED` the `Language:` line
shows the tag from the config or `auto`, and `LANGUAGE` is determined when the task
arrives.

The `LANGUAGE: <tag>` line is a separate line in the first Planner prompt, the first
Implementer contract, the first REVIEW_REQUEST and FINAL_READY
([handoff-contracts.md](references/handoff-contracts.md)). A role passes the same tag
on and does not determine the language again.

**Roles.** A role communicates with people in `LANGUAGE`: terminal messages, questions
and approvals, spec and plan, the prose of review and self-check reports, the final
report. Always in English, under any `LANGUAGE`: protocol tokens and labels
(`REVIEW_REQUEST`, `APPROVED`, `LANGUAGE:` …), the labels and fields of the report
template ([review-protocol.md §7](references/review-protocol.md): `Verdict:`, registry
columns, ids `R<n>`/`C<n>`/`S<n>`, categories), the Coordinator service blocks
`PIPELINE CONFIG RESOLVED` and `PLANNER DISPATCHED`, a profile's `summary` and script
messages. Code, commands, paths and identifiers stay as they are.

## Required project configuration

The only source of provider, model, thinking, helper enablement and the limit of
concurrent subagents is the active `orca-pod.yaml`. There is one per repository:
`.orca-pod/orca-pod.yaml` of the main checkout; a linked worktree's own file in
`.orca-pod/` wins. Git is optional: outside a Git repository it is `.orca-pod/orca-pod.yaml` of the
project folder (section "Project without Git"). The folder is added to `.gitignore` only when the project already has one
(`ensure-gitignore.sh` never creates the file), so the file stays out of git; without a
`.gitignore` the folder is not ignored, and the user adds `.orca-pod/` before committing. The old
layouts — the `.orca-pipeline/` directory (with `orca-pipeline.yaml` and `reports/`) and
the file `<project-root>/orca-pipeline.yaml` — are migrated by `config-location.mjs migrate`: the
directory entirely into `.orca-pod/` (inside it `orca-pipeline.yaml` becomes
`orca-pod.yaml`), the file into `.orca-pod/orca-pod.yaml`; the launcher does not move
files, and when the new config is missing it suggests the migration command. The
invocation conditions and other limits are set by this skill, not by YAML. There is no
model fallback, profile inheritance or field copying. A role without a provider gets
the profile's `default_provider`, then the root one, then pi. `use_subagents` is an
unquoted boolean, false by default.

If the file is missing, invoke [orca-pod-setup](../orca-pod-setup/SKILL.md)
in the Coordinator (project root, this workflow, [template](assets/orca-pod.yaml),
task source, stack). Do not silently replace an existing file/directory/link. An
invalid config stops the workflow; name the field and the setup path.

### Project without Git

`<project-root>` is the Git root, or the project folder outside Git: `config-location.mjs where` returns
`git: false`, and a role finds it out itself when `git rev-parse` fails in the project. Without Git the
pipeline runs the same way, but nothing records the changes, so they are tracked by lists instead:

- Coordinator: no `.gitignore` step; `configTracked` is always false.
- Implementer: no `HEAD` and no `git status`. The changed files of a stage are the files from the workers'
  reports plus your own integration edits; check them against the `writeScope`s by those reports. The
  REVIEW_REQUEST (and the self-check) gets the list TODO → files with `baseline: no Git`.
- Reviewer and Chief Reviewer: there is no patch snapshot; review the listed files as they are now. A repeat
  round checks the places named in the `FIXED <path:line>` answers and the list of other changes. The report
  says `no Git: no patch, the files from the request were reviewed`.
- What is lost: a change outside the listed files is not visible to the review. The final report says so.
- `test` mode needs Git anyway: the sandbox is its own Git repository with a baseline commit.

### Schema

Root: active_profile (the default profile), optional default_provider (the fallback
for profiles without their own) and language (`auto` — the default — or a language
tag, for example `en`, `ru`, `pt-BR`; section "Language: LANGUAGE"), profiles. A
profile name is letters, digits, `.`, `_`, `-`, no spaces, up to 64 characters. A
profile: roles with required planner, implementer and optional reviewer,
chief_reviewer; optional default_provider, max_subagents (an integer 1–100, 6 if
absent) and full_access (an unquoted boolean, false if absent; see below). There can
be several profiles; a run uses one — the one chosen at start ("Profile selection").
A role: provider, model, thinking (non-empty strings), use_subagents, subagents.
`subagents` is a non-empty mapping of exact helper names (lower-case, digits, hyphen)
to model/thinking pairs; `inherit` takes the value of **its own** parent role; a
missing entry keeps the native defaults. Provider values: pi, codex, claude-code
(alias claude), omp. For a claude-code role the launcher additionally requires
thinking from `low|medium|high|xhigh|max`, and the model of its helpers to be
`inherit` or an alias `opus|sonnet|haiku|fable` (the Agent tool does not accept a full id).

`full_access: true` is yolo: the launcher starts Codex roles with
`--dangerously-bypass-approvals-and-sandbox` and Claude Code roles with
`--dangerously-skip-permissions`: no confirmations and no sandbox, with access to the
whole machine. Pi and OMP are unchanged. Only the user enables it (the "Full access"
toggle in the orca-pod-setup form); the Coordinator and the roles do not enable it and
do not write it into YAML. Codex shows the folder trust dialog even with it.
For a codex role the launcher, at `--resolve` and at launch, checks the model and thinking
of the role and of its helpers (after `inherit`) against the Codex catalog
(`codex debug models`): the model must be among those visible in Codex, thinking
among the levels of this model; there is no `lens-checker` in Codex.
If the catalog is unavailable — a line in `warnings`, not an error.

`node <skill-dir>/scripts/launch-provider.mjs --profiles` validates every profile
and prints their list (the active one first). `--roles --profile <name>` validates the
selected profile and prints the configured roles, `reviewMode` (`full` | `reviewer` |
`chief` | `self`) and `maxSubagents`. `--role <role> --profile <name> --validate`
validates the schema of one role; `--resolve` additionally looks for the executable
(required for every configured role, but it proves neither authorization, nor the
model, nor the children's permissions). Without `--profile`, active_profile is used.
Do not combine `--validate` and `--resolve`.

On an error, print this and finish without creating terminals:

```text
PIPELINE CONFIG REJECTED — COORDINATOR EXITING
File: <absolute path of the active config>
Reason: <exact field and error>
Fix: <the required migration through orca-pod-setup>
```

### Profile selection

`launch-provider.mjs --profiles` returns for each profile `name`, `isActive`,
`valid` and either `summary` — one line: the roles by full names (agent · model ·
thinking), the review mode, the subagent limit and "full access (yolo)" when
`full_access: true` — or `error`.

- An error of the file itself (`--profiles` exited with code 2) or no valid profile
  at all — `PIPELINE CONFIG REJECTED` with the file's error or the active profile's error.
- One valid — use it without asking.
- Several valid — one question before bootstrap, together with the skills question
  ("Coordinator skill selection"). Claude Code: one AskUserQuestion call with two
  questions; a profile option — label = name (the active one first, marked
  "(default)"), description = `summary` verbatim. Pi, Codex and other agents — as
  text, one line `<name> — <summary>` per profile. More than 4 valid — the full list
  as text; the options hold the active one and the next two, and the rest are
  entered by name through "Other".
- Do not offer invalid ones; list them in one line `<name>: <error>`.
- An answer through "Other" must exactly match the name of a valid profile from
  `--profiles`; otherwise ask again and do not substitute it into commands.

Full access from someone else's config must be confirmed. If the selected profile has
`fullAccess: true`, and `--profiles` returned `configTracked: true` (the config file is
tracked by git — it came with the repository) or the migration in this run produced at least one `MOVED` line,
add a confirmation to the same question: "The profile starts Codex and Claude Code
roles without confirmations and sandbox — continue?". "No" — `PIPELINE CONFIG REJECTED`
with the reason "full_access not confirmed" and a hint to turn off full access in
orca-pod-setup. Your own config (in `.gitignore`, not migrated just now) needs no
confirmation.

Order: `--profiles` → one question (the profile, if there are several, and skills) →
`--roles --profile <selected>` and `PIPELINE CONFIG RESOLVED` → terminals.
The choice is not written to YAML: active_profile stays the default profile.
After that, everywhere — `--profile <selected>`: `--roles`, launching the role
terminals, SETTINGS in the prompts.

After resolve:

```text
PIPELINE CONFIG RESOLVED
File: <absolute path>
Profile: <selected profile>
Language: <tag | auto — resolved when the task arrives>
Planner: <provider> / <model> / <thinking>; use_subagents=<boolean>
Implementer: <provider> / <model> / <thinking>; use_subagents=<boolean>
Reviewer: <provider> / <model> / <thinking>; use_subagents=<boolean> | not configured
Chief Reviewer: <provider> / <model> / <thinking>; use_subagents=<boolean> | not configured
Review mode: <full | reviewer | chief | self — short explanation>
Concurrent subagents: up to <maxSubagents> per role (max_subagents; no launch budget)
Full access: yes — Codex and Claude Code without confirmations and sandbox (full_access) | no
Child settings by role: <full JSON; null keeps native defaults>
Review reports: <absolute path = <project-root>/.orca-pod/reports>
```

## Subagents: policy and limits

Helpers are invoked by the roles themselves; the Coordinator does not create children
and does not investigate capabilities. The mechanics of Pi (pi-subagents), Claude Code
(`Agent`) and Codex (`spawn_agent` with the `orca_*` agents), the name mapping and
parallel launch — [subagents.md](references/subagents.md); read it before the first
delegation. The Pi and Claude Code agents are linked by `scripts/link-agents.sh` (setup
does this itself); the launcher registers the Codex agents itself — only in the
role's session.

With `use_subagents: true` **delegation is the default mode**: the role's context is
spent on decisions, not on reading diffs and writing code. Inline — for small things
and when a helper is unavailable. An unavailable mechanism is not a blocker: the role
works inline and notes the degradation in the report; do not install packages and do
not change global settings.

**N** is the selected profile's `max_subagents` (6 by default, from 1 to 100): how
many helpers one role keeps running at the same time; the rest wait for a free slot.
It is not a counter: the total number of helpers a role launches per run is not limited.

**pi-lens budget (Pi).** pi-lens and its tsserver (about 0.5–0.6 GB per session) live in
the role's session and in **at most one child at a time**. A Pi child gets pi-lens when its
definition does not set `extensions`: `lens-checker`, `verifier`, the bundled `researcher`
and any other bundled or custom agent. The pipeline's `worker`, `reviewer`, `scout`,
`oracle` and `evidence-auditor` run in Pi as the skill's `orca-*` agents without the
user's extensions — without pi-lens, up to N at once. Calling `lens_diagnostics` yourself
uses the role's own tsserver and costs nothing. Details and the fallback —
[subagents.md §2a](references/subagents.md#2a-pi-pi-lens-budget).

| Role | Helpers and purpose | Concurrently | Rules |
| --- | --- | --- | --- |
| Planner | `scout` (parallel by code area), `researcher` as needed, `oracle` for a contested decision | up to N | oracle ≤ 1 per plan version |
| Implementer | `worker` for each TODO of a wave and for fix groups; `scout`/`researcher` for clarifications; `verifier` — only the self-check of `self` mode, not launched with reviewers | up to N in total; verifier — up to 3 of them (in Pi — 1, the pi-lens budget) | one worker per TODO/group per attempt; retry of a failed one — 1 time; one verifier set per self-check attempt |
| Reviewer | `reviewer`-lanes by TODO/seams/delta; `lens-checker` (Pi) | up to N | one set of lanes per attempt |
| Chief Reviewer | `reviewer`-lanes by area, `evidence-auditor`, `lens-checker` (Pi) | up to N | one set per attempt; evidence-auditor ≤ 1 per attempt |

- **Waiting for children.** Launch the children, then wait for completion: in Pi (async
  children) and Claude Code (background `Agent` calls) return control — the completion
  notification wakes the role; in Codex wait with `wait_agent` (a loop with `timeout_ms` is
  fine): Codex does not wake an idle role. Do not use `sleep`, timers or polling (`git status`,
  checks, `status`) while children run: the tree in the middle of a wave says nothing —
  check after the completion notification. `bg_wait` (Pi) is only for work without its own
  notification (external CLIs, detached processes). Measure the system (memory, processes)
  at the event, not by a timer.
- The rules in the last column limit repeats within an attempt, not the total number
  of launches. A failed worker is repeated once; if it fails again, the TODO is done
  inline. BLOCKED is not issued for this reason alone.
- Recursive children, terminals and worktrees are forbidden. No child accepts a
  plan, a stage or the final.
- There is no launch budget: do not count "used X of Y" and do not stop delegation
  because of the number of launches. In the role's final report, in one line: how
  many helpers were launched and the maximum concurrent (no more than N).

**Oracle (Planner).** Once per spec/plan version, only when a choice is needed
between substantially different architectural options or there is a risk of violating
the agreed decisions. Pass the question, the options with consequences, the
requirements, the accepted decisions and the needed files. The answer is risk,
evidence, recommendation, uncertainty; no APPROVED. The decision and the approval stay
with the Planner and the user.

**Evidence-auditor (Chief).** Once per chief review attempt, in parallel with the
lanes. Pass the key acceptance criteria, the Implementer's claims, the patch/paths and
the check results. Returns for each criterion VERIFIED / CONTRADICTED / UNSUPPORTED /
NOT_CHECKED with a source. A check that was not run is not passed. The auditor's opinion
is evidence, not permission.

## Coordinator skill selection

After `--profiles`, before resolve and bootstrap — [manual-first selection](references/skill-selection.md):
one question about which additional skills each role needs (in Claude Code — through
AskUserQuestion). If there are several profiles, ask it together with the profile
question — in one AskUserQuestion ("Profile selection"). An explicit list — as is;
"not needed" — empty sets; "I don't know/pick for me" — the catalog + the stack by the
main manifest, a small set.

The Planner **always** uses `using-superpowers` (Pi — `/skill:using-superpowers`,
Claude Code — `Skill using-superpowers`, Codex — `$superpowers:using-superpowers`,
otherwise — read SKILL.md by path) and `plan-blitz` (Pi — `/skill:plan-blitz`, Claude Code —
`Skill plan-blitz`, Codex — `$plan-blitz`). plan-blitz is looked up at
`<real path of the skill dir>/../plan-blitz/SKILL.md` (the `npx skills` side-by-side layout);
missing — `not installed` in the Planner prompt and one warning line to the user, not a stop.
Pass names/sources per role, including empty sets.

## Terminal identity

Remember the `terminal create` response at once and pass the addressees' handles in
every handoff prompt — there is no file registry. A run failure is solved by a new
pipeline launch, not by restoring from files.

## Delivery between terminals

The addressee is always a handle from the prompt. A role gets its own handle in the
first prompt ("yours" in the TERMINALS line) and writes it into every request it waits
for a reply to. A reply in your own terminal is not delivered: another role will not
see it. If the addressee's handle is unknown or not accepted by Orca — do not guess by
title: `BLOCKED` to the user with the full payload.

The role sends the message itself, without subagents. A payload that is multi-line,
with quotes, `$` and backticks — pass it through a heredoc in single quotes so that
the shell substitutes nothing:

```bash
ORCA terminal send --terminal <handle> --enter --json --text "$(cat <<'PAYLOAD'
<payload>
PAYLOAD
)"
```

Delivery is the same for Pi, Claude Code and Codex: Orca knows their TUIs and
confirms the start of a turn (`turn_started` with `--wait-submit`).

An accepted send (`accepted: true`) is not repeated because of silence/timeout. On an
ambiguous transport error repeat the same command with `--retry-request <id>` from the
response — then the message will not be delivered twice. One retry; a second error —
stop and show the user the full payload.

## Terminal setup and Coordinator exit

First add `.orca-pod/` to the project's `.gitignore` (in `test` — the sandbox's):
`<skill-dir>/../orca-pod-setup/scripts/ensure-gitignore.sh <project-root>` (skip it without Git). The script is
idempotent and changes only an existing `.gitignore`; this is the only project edit
the Coordinator makes. Report `ADDED` to the user in one line, `OK` and `SKIP` —
silently. No script — a warning, not a stop.

This is a new pipeline: create your own role terminals right away in the exact workspace;
do not scan or adopt the user's live terminals. Terminals — only for the roles from
`launch-provider.mjs --roles --profile <selected>`. For each such role:

1. `ORCA terminal create --worktree <exact selector> --title <role> --json`.
2. Immediately record the result and the handle; get any missing PTY metadata through
   `terminal show` of this handle, without searching by title.
3. `ORCA terminal send --terminal <handle> --text 'exec node <absolute skill-dir>/scripts/launch-provider.mjs --role <role-key> --profile <selected profile>' --enter --json`.
4. `ORCA terminal wait --terminal <handle> --for tui-idle --timeout-ms 60000 --json`;
   readiness is `satisfied: true`. `blockedReason: "agent-trust-workspace"` — the
   role's agent (Codex, Claude Code) asks whether to trust the folder: do not send the
   prompt, ask the user to answer in the `<title>` terminal and repeat wait after
   their answer.

Role keys: planner, implementer, reviewer, chief_reviewer. Create is not idempotent:
on a lost response check `terminal show` before retrying. The configured reviewers are
prepared at bootstrap but receive work only on a review request.
Pass the path `<project-root>/.orca-pod/reports/`, the profile, `reviewMode`, the subagent
limit (`maxSubagents`) and `LANGUAGE` in the first prompts.

Without a task source after the preflight, report `TERMINALS READY`: the next input is
a RAF path or a description. With a task, determine `LANGUAGE` (section "Language:
LANGUAGE") and send Planner one full prompt per the contracts. After accepted:

```text
PLANNER DISPATCHED — COORDINATOR EXITING
Profile: <selected>; concurrent subagents: up to <maxSubagents> per role; full access: yes | no
Language: <tag>
Planner: handle=<handle>; ptyId/incarnationId if available
Implementer: handle=<handle>; Reviewer: handle=<handle> | not configured; Chief Reviewer: handle=<handle> | not configured
Review mode: <reviewMode — who accepts stages and who issues the final verdict>
Skills: <role → exact name/source>
Review reports: <absolute path = <project-root>/.orca-pod/reports>
Next handoff: Planner → Implementer.
```

The Coordinator exits and does not accompany implementation and replan.

## Test mode: `test`

`/orca-pod test` runs the whole flow on a built-in demo task in the sandbox
`~/orca-pod-test` — the current project is not changed. The task
([TASK.md](assets/test/sandbox/TASK.md)) covers all branches: three independent TODOs
(a parallel wave of workers), a dependent TODO (the second wave), the shared
`src/index.js` (integration), `node --test` as the final check (`TASK.md` asks for tests
(item 6), so the plan says `tests: requested`). The Implementer gets a
hidden defect ([implementer-seed.md](assets/test/implementer-seed.md)) so that the
review goes through the cycle "finding → fix → registry check". The expected course —
[EXPECTED.md](assets/test/EXPECTED.md).

The Coordinator in `test` is a regular start with the following differences:

1. After the Orca preflight run
   `node <skill-dir>/scripts/test-sandbox.mjs prepare --config <activePath>` (`activePath` —
   from `node <skill-dir>/scripts/config-location.mjs where`; without `--config` if there is no file). The script creates or resets the
   sandbox and makes a baseline commit — the only allowed Git write, only
   inside the sandbox. From the JSON take `dir`, `task`, `config`, `reports`, `seed`, `expected`.
   Coordinator in Codex: the sandbox is outside the working folder, and in the Codex
   sandbox writing there and git commit require elevated privileges — request a retry with
   elevated privileges (Codex will ask the user) or ask to start Codex with `--add-dir ~/orca-pod-test`.
   Do not bypass the sandbox.
2. `config: missing` → invoke orca-pod-setup with the root `dir` (the form is launched
   from the sandbox). After that resolve/validate — from `dir`.
3. No `dir` in `ORCA repo list --json` — `ORCA repo add --path <dir> --json`.
4. Do not ask the skills question: the additional sets are empty, the Planner's
   `using-superpowers` and `plan-blitz` stay. The profile question — as usual, if the sandbox config
   has several.
5. Create the terminals in `path:<dir>`; reports — `reports` from the JSON.
6. The task source is `task`. Add a block to the Planner's first prompt:
   `TEST MODE: sandbox <dir>. Spec and plan approvals are given by the user, as usual.
   In the first Implementer contract add the line "TEST MODE: read <seed>";
   do not read the file itself and do not mention it in spec/plan.` In `self` mode do not
   add the seed line: the defect is checked by an independent review, and the self-check
   is static.
   `LANGUAGE` — by the general rule (section "Language: LANGUAGE"): `TASK.md` is the
   skill's demo task, not user text, so with `language: auto` the user's own messages in
   this Coordinator session decide (for example, the answer to the profile question), and
   only when there are none is it `en`; an explicit tag from the config wins.
7. Add to the exit message: `Expected course: <expected>. After the final
   verdict — /orca-pod test check` (if a profile other than the default is selected —
   `test check --profile <selected>`).

Reviewers do not know about the defect and review by the usual rules.

- `test check [--profile <name>]` — `node <skill-dir>/scripts/test-sandbox.mjs check [--profile <name>]`
  (the review mode is taken from this profile, without the flag — from active_profile): PASS/WARN/FAIL by
  modules and criteria, `node --test` and the check of its own mode: batch review,
  round limits, catching and fixing the defect, a repeat round by the registry and
  FINAL_APPROVED — or, in `self` mode, the self-check reports and SELF_VERIFIED.
  The report's verdict is read from the `Verdict:` line (exactly one verdict token), and
  the caught defect is detected by the finding line (`R<n>`, `BLOCKER`/`MAJOR`) with `chunk` and
  `AC-C2` (or `2.5`, `integer`) — review-protocol §7; so the check does not depend
  on `LANGUAGE`.
  Show the user the result and all FAIL/WARN.
- `test reset` — only `prepare` (with the same `--config`), no terminals.
- The `--dir <path>` option of both commands is another sandbox; the script does not
  touch a foreign directory without the `.orca-pod-sandbox` marker.

## Planning

Invoke `using-superpowers` first, then the agreed Planner skills and the mandatory
brainstorming (Pi and Codex — `$superpowers:brainstorming`, Claude Code —
`Skill brainstorming`). Delegate code research to parallel `scout`s by area;
Researcher — as needed; Oracle — by the rules above.

Write the specification without Git writes: the RAF path or the verbatim
TASK DESCRIPTION, constraints, agreed requirements. Right after writing it, print its path on a separate line,
`SPEC WRITTEN: <absolute path>`, so the user can open the document the blitz will ask about. If Git does not
show the file (no Git, or its folder is ignored: `git check-ignore -q <path>` succeeds), add one line that it
will not appear among the changes in git or the IDE and is opened by this path. Inline self-review for the task,
criteria and feasibility → `SELF-REVIEW: no issues` or `SELF-REVIEW: fixed <list>` →
plan-blitz over the spec (Pi — `/skill:plan-blitz`, Claude Code — `Skill plan-blitz`, Codex —
`$plan-blitz`): rounds of multiple-choice questions whose last window is the user approval in the
Planner's visible terminal. If plan-blitz is `not installed` (the REQUIRED PLANNER SKILLS line), warn
the user in one line and ask for approval in plain text; this is not a stop.

Then writing-plans (Pi and Codex — `$superpowers:writing-plans`, Claude Code —
`Skill writing-plans`). Each TODO:

- `todoId`, goal and boundaries, independent acceptance criteria;
- `dependsOn` — the TODOs without whose result this one cannot start;
- `writeScope` — the files/directories that **only** this TODO changes;
- shared files (DI/routing/registries, dependency manifests, lockfiles,
  code generation, localizations) — a separate `integration` item owned by the Integrator;
- stop conditions.

From `dependsOn` and non-overlapping `writeScope`s derive the **waves**: the TODOs of one
wave are independent and are executed in parallel. A TODO is a complete verifiable
result, not a line and not a set of unrelated functions. By default the plan is one
stage (`all`) with one batch review. The Planner may split a large plan into stages
with a review checkpoint if the later stages build on the results of the earlier ones
and an error there would be expensive. Specify `verificationChecks` — the stack's static
checks (analyzer, linter, typecheck), consistent with the project's constraints; test
commands only with `tests: requested` — or an empty list with `verificationRationale`.
In `self` mode an empty list is not allowed: the static checks are the only
verification of the result. Write the plan's `tests:` line (Invariants, "Tests only on
request"): with `not requested` the plan has no test TODOs, no failing-test steps and
no edits to existing tests; with `requested` — only the tests the user asked for, and
no new test framework without their consent. Record the resolved settings and skill sources.

Print `PLAN WRITTEN: <absolute path>` after writing the plan, with the same line about Git when it applies.
Inline cross-review of the plan against the spec (scope, files, order, waves, risks,
checks) → plan-blitz over the plan, whose last window is the user approval. The approved
spec/plan are immutable versions with
absolute paths in the project; earlier versions are not overwritten. Then one
full Implementer contract and:

```text
IMPLEMENTATION HANDOFF SENT — PLANNER IDLE
Spec path: <immutable absolute path>
Plan path: <immutable absolute path>; Plan version: <planVersion>
Implementer: handle=<handle>; Reviewer: handle=<handle> | not configured; Chief Reviewer: handle=<handle> | not configured
Planner is available for a verified PLAN_REVISION_REQUIRED; Coordinator has exited.
```

The Planner does not implement TODOs and does not poll the Implementer; keep the session for replan.

## Review modes

The mode is set by the set of roles in the selected profile (`launch-provider.mjs --roles --profile` →
`reviewMode`); the Coordinator passes it in the first prompts.

| Mode | Roles | Who accepts the stages | Who issues the final |
| --- | --- | --- | --- |
| `full` | Reviewer + Chief Reviewer | Reviewer (≤ 3 attempts) | Chief Reviewer — `FINAL_APPROVED` (≤ 2 attempts) |
| `reviewer` | Reviewer only | Reviewer (≤ 3 attempts) | Reviewer — `FINAL_APPROVED` |
| `chief` | Chief Reviewer only | Chief Reviewer (≤ 3 attempts) | Chief Reviewer — `FINAL_APPROVED` |
| `self` | no reviewers | Implementer — self-check (≤ 3 attempts) | Implementer — `SELF_VERIFIED` |

The single reviewer (`reviewer`/`chief`) combines both phases: the stages — per
review-protocol §3–5, then the final check over all the code per §6 in the same role,
without sending FINAL_READY. `evidence-auditor` — if this role has it.

### Implementer self-check (`self` mode)

Only in `self` mode: with a Reviewer or Chief Reviewer the Implementer goes from the
checks straight to REVIEW_REQUEST (Invariants, "The reviewers check the code").
There is no independent review, so the check is static and by criteria. With
`use_subagents: true` the Implementer **does not check itself** but assigns this to the
`verifier` subagent ([subagents.md](references/subagents.md)): it does not see the
author's reasoning, keeps the analyzers' long output out of the Implementer's context
and returns only findings. After the last wave of each stage:

1. Wait for the children, stop writing, save the stage's patch snapshot in
   `.orca-pod/reports/<planVersion>/` (like a reviewer, review-protocol §3 item 1; without Git there is none,
   and the `verifier` gets the list of changed files).
2. Launch `verifier`: the changed files and the patch, the stage's acceptance criteria,
   the **exact** static-check commands from `verificationChecks` (analyzer,
   linter, typecheck — for example `flutter analyze`, `dart analyze`, `tsc --noEmit`,
   `eslint`), the path to review-protocol and the id prefix `S`. In Pi `verifier` itself calls
   pi-lens (`lens_diagnostics`); in Claude Code there is no pi-lens — the step is skipped.
   A large stage (more than ~6 TODOs) — up to 3 `verifier`s in parallel (no more than N; in Pi
   only one — the pi-lens budget): the first runs all the commands and pi-lens, the others
   check the criteria of their TODO groups.
3. Consolidate the answer: ids `S<n>`, the review-protocol §1 scale (analyzer errors
   in the changed files — BLOCKER, warnings — MINOR), an uncovered criterion is a
   finding. You make the decision: the subagent does not issue `SELF_VERIFIED`.
4. Blocking `S<n>` → a fix (by workers on non-overlapping files or
   inline) → a repeat `verifier` run in registry check mode: the former ids
   and the delta (review-protocol §4). No more than 3 attempts per stage, then `BLOCKED`
   to the user. Do not fix warnings and errors outside the changed files —
   list them in the report.
5. The report `self-check-<stage>-attempt<N>.md` in `.orca-pod/reports/<planVersion>/`: the header like a review's,
   the `S<n>` registry, the checks table, the line `Verdict: SELF_VERIFIED` or
   `Verdict: CHANGES_REQUESTED`.

`use_subagents: false` or `verifier` unavailable — the same steps inline: pi-lens
(`lens-checker` or `lens_diagnostics`), the commands from the plan, the criteria
check; in the report note that the self-check ran without a subagent.

`SELF_VERIFIED` confirms the static checks and the coverage of the criteria, but does
not replace review: in the final report state explicitly that there was no
independent review.

## Implementer = Integrator

Read the plan, the selected skills, the contract and [subagents.md](references/subagents.md).
Record the baseline once per stage: `HEAD=<sha>` and the list of files already dirty
before the start (`git status --porcelain`); without Git — section "Project without Git". Do not count `.orca-pod/` in the baseline and in
`git status` checks: these are pipeline reports, not project changes.

**Waves.** For each wave of the current stage:

1. Launch **in parallel** one `worker` per TODO of the wave (up to N
   at once — the profile's `max_subagents`, the rest as slots free up). The assignment: the whole TODO,
   the criteria, `writeScope` as the exclusive write zone, the needed places of
   the spec/plan, the project's constraints, the allowed local checks, the report
   format. A small TODO can be done inline, several small ones of one area — by
   one worker.
2. While the wave runs, answer the children's questions; decisions outside the plan
   go to the user or the Planner (PLAN_REVISION_REQUIRED), not silently.
3. After the wave: read the reports, check `git status` against the zones, make the
   `integration` edits and the out-of-zone changes requested by workers. A failed or
   incomplete TODO — one retry of the worker with a refined assignment, otherwise inline.
4. Move to the next wave only when all TODOs of the current one are finished.

With `use_subagents: false` or without a `worker` — the same waves sequentially inline.

**Checks.** After the last wave of the stage (or only of the last stage — as
specified in the plan) run the approved `verificationChecks` yourself, fix what they
report, record the actual commands/results/skipped with reasons. These are the plan's
commands, not a review: with a Reviewer or Chief Reviewer do not launch `verifier`,
review or audit lanes and do not read the diff in search of defects (Invariants, "The
reviewers check the code"); `scout` and `researcher` clarify assignments, they do not
audit finished code. Tests — only as the plan's
`tests:` line allows (Invariants, "Tests only on request"): with `not requested` neither
you nor the workers write, change or run tests or follow TDD, a worker's task carries
`Tests: not requested`, and the report lists tests as skipped — not requested.

**Review.** Wait for all children, stop writing and send the stage reviewer of your
mode (Reviewer in `full`/`reviewer`, Chief Reviewer in `chief`) **one**
REVIEW_REQUEST for the whole stage: TODO → files, baseline, checks, deviations from
the plan. Do not send one TODO at a time for review. Do not change code until the verdict.
In `self` mode, instead — the self-check (section "Review modes").

- `CHANGES_REQUESTED` — fix **only the listed blocking** ids
  (non-blocking ones optionally, if cheap and safe). Independent groups of
  fixes — by parallel workers on non-overlapping files. Then a
  repeat REVIEW_REQUEST with an answer for each id: `FIXED` / `DISPUTED` /
  `SKIPPED` (non-blocking only) and a list of other changes.
- `APPROVED` of a stage — open the next stage; after the last one wait for the final
  verdict (in `full` — from the Chief Reviewer).
- `PLAN_REVISION_REQUIRED` — freeze the work, wait for a new plan version.
- `BLOCKED` — wait for the user's decision.

The Chief's `CHANGES_REQUESTED` is handled the same way, but the repeat request goes
directly to the Chief Reviewer (CHIEF_FIX). Do not change the scope/approved plan silently.

## Reviewer: batch review

Work strictly by [review-protocol.md](references/review-protocol.md). In brief:

- the first round: patch snapshot → parallel `reviewer`-lanes (by TODO, seams,
  risk zones; in Pi also `lens-checker`) → consolidation and deduplication → classification
  by the scale → report → verdict;
- in `CHANGES_REQUESTED` — a numbered list of **blocking items only** `R<n>`:
  what is wrong, where, the scenario, the minimal fix;
- a repeat round — only the registry check (`CLOSED`/`NOT_FIXED`/`PARTIAL`)
  and regressions inside the delta; new findings on already reviewed code outside the delta —
  only `BLOCKER` with the `missed-earlier` mark;
- no more than 3 attempts per stage, then `BLOCKED` to the user;
- `APPROVED` of the last stage: in `full` mode — a request to the Chief Reviewer
  (FINAL_READY) and a notification to the Implementer, the Reviewer does not issue `FINAL_APPROVED`;
  in `reviewer` mode (Chief not configured) — you perform the final check yourself per
  review-protocol §6 and issue `FINAL_APPROVED` / `CHANGES_REQUESTED`.

Your context is for decisions: do not read the whole diff yourself if lanes are
available; check only the contested places selectively. The `lens-checker` (Pi)
type-check is explicitly allowed by the pipeline owner; without the agent, run
`lens_diagnostics` yourself; without the tool (Claude Code), skip it.
Reviewers do not run build/test/lint.

## Chief Reviewer: chief final review

An optional role on a stronger model than the Reviewer; it does not write code. In
`full` mode it does not take part in stage review; in `chief` mode (Reviewer not
configured) it first conducts the batch stage review itself per the "Reviewer"
section and review-protocol §3–5 — REVIEW_REQUEST comes directly to you. On
FINAL_READY (or after `APPROVED` of the last stage in `chief` mode): the last
Reviewer report (the full registry), spec/plan, the Integrator's report, then **in
parallel** lanes by area of the whole code + `evidence-auditor` (+ `lens-checker`
in Pi). Check that the blocking `R<n>` are closed and have not returned, assess the
code as a whole, write `chief-attempt<N>.md` and issue:

- **FINAL_APPROVED** — no blocking findings; the only verdict that completes the pipeline;
- **CHANGES_REQUESTED** — a list of blocking `C<n>`; the Integrator fixes and
  sends CHIEF_FIX directly to you; attempt 2 is the registry check mode;
- **PLAN_REVISION_REQUIRED** — a proven plan error → the Planner by handle;
- **BLOCKED** — blocking findings after the 2nd attempt or an unresolvable conflict.

Send the verdict to the Implementer by the handle from FINAL_READY (in `chief` mode —
from REVIEW_REQUEST) with the `orca terminal send` command: the role will not see
output in its own terminal. A previous FINAL_APPROVED does not cover new changes.

## Review reports

`<project-root>/.orca-pod/reports/<planVersion>/` — in the project, not in the skill
folder. The Reviewer creates the subdirectory at the first verdict; `ensure-gitignore.sh`
adds the `.orca-pod/` folder to the project's `.gitignore` only when the project already
has one (the script never creates the file); without a `.gitignore` the reports are not
ignored, and the user adds `.orca-pod/` before committing. Files, template and registry —
[review-protocol.md §7](references/review-protocol.md). Reports are immutable; each
contains the full registry, so the last one is enough for the next round and for the Chief.
The Planner reads them on replan; the Implementer — by the link from the verdict.

## Return to Planner: PLAN_REVISION_REQUIRED

The reviewer records a proven plan error and the area of revision; the Implementer is
frozen; one message to the Planner by handle (the same terminal, there is no second
Planner; **there is no Orca terminal resume command**). The Planner drafts the
revision, gets explicit approval (plan-blitz over the changed items only), then creates
new immutable spec/plan versions and tells the Implementer the new version and
`affectedTodoIds` (including transitively dependent ones). The
affected TODOs are implemented and reviewed again; the registry for the unaffected
ones is kept. The user's refusal keeps BLOCKED. The Coordinator does not come back to life.

## Completion

Only after the mode's final verdict (the reviewer's `FINAL_APPROVED` or
`SELF_VERIFIED` in `self` mode) the Implementer reports in `LANGUAGE`: the review mode,
changed files, waves and delegation (helpers launched, maximum concurrent), checks run/skipped,
the verdicts and rounds of review or self-check, open non-blocking findings
(`ACCEPTED_RISK`), plan revisions, report paths and the final status. No final
verdict — no COMPLETED, even with green checks. On an ambiguous process/delivery —
BLOCKED. A new task requires a new workflow launch.
