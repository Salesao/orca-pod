# Orca-pod workflow reliability and standalone pi-task

Date: 2026-11-11

Status: proposed design; implementation has not started. The approaches below
were selected in the conversation; this document still requires approval.

Builder check: a fresh independent reviewer found no important unanswered
questions preventing an implementation plan (2026-11-11).

## Intent

Improve orca-pod using the runs collected in `reports/`: remove redundant
diagnostic work, make user decisions survive planning, prevent accidental
delegation when disabled, simplify helper catalogs, and add Qoder and OMP as
supported role providers. Extract Pi's question UI into a separate, reusable
`pi-task` repository that the owner can later publish to Pi Packages.

This is coordinated work in two repositories. The existing terminal-based
pipeline stays: Coordinator, Planner, Implementer, optional Reviewer and
optional Chief Reviewer. There is no new orchestration daemon.

## Decisions made by the user

1. Blitz covers specifications and designs, followed by a blitz over the plan.
2. Plan blitz remains interactive. Planner proposes answers grounded in the
   agreed specification/design; the user selects the answers. The purpose is
   to expose inconsistencies, not to have Planner approve its own plan.
3. During work, Pi Lens is a targeted tool. The regular Reviewer performs one
   final diagnostic pass over all files changed by the task. Findings return
   to Implementer; subsequent checks cover the fix files and affected consumers.
4. Outside Pi, use diagnostics available to the chosen CLI and the checks in
   the plan. Do not require Pi Lens through MCP for every provider.
5. At most three helper **specializations per terminal role**. This is not a
   limit of three concurrent instances or three launches per run.
6. At most three configuration profiles.
7. Fix the failure where a model delegates despite subagents being disabled.
8. Support Qoder and OMP in the project.
9. Extract the question extension into a separate repository named `pi-task`.
   Prepare it for installation and later publication; the user will publish it.

Other behavioral details in this document are the author's proposed defaults,
explicitly subject to approval with this design.

## Evidence and current implementation

The local report corpus contains 104 Markdown documents in 28 directories,
including one standalone incident report. It is not a timing benchmark: no
percentage speedup or complete account of all runs can be inferred from it.
Reports are ignored local inputs; do not publish their application patches,
logs or proprietary details as part of this change.

| Evidence | Consequence for this design |
| --- | --- |
| `reports/reportsStashApp/v1/all-attempt1.md`: eight helper launches failed because the model came from an extension excluded from children; fallback reviewers ran sequentially | Separate model-provider extensions from diagnostic extensions; check compatibility before launching a wave |
| `reports/reportsIBoxApp/2026-10-17-codebase-refactor-v1/s2-attempt1.md` and `s3-attempt1.md`: Lens was kept out of children after a language-server memory incident | No dedicated Lens helper and no automatic Lens fleet in workers/review lanes |
| `reports/reportsStashApp/2026-10-25-go-server-migration-v2/chief-attempt1.md`: a 249-file diagnostic pass and memory-dependent reductions in concurrency | One owner for the final full pass; do not automatically repeat it in Chief |
| `reports/reportsStashApp/2026-10-25-go-server-migration-v2/S6-stale-lsp-note.md`: stale Lens messages contradicted clean current analyzer results | Track freshness, coverage and unavailable diagnostics separately from defects |
| `reports/2026-10-21-implementer-self-audit-in-full-mode.md`: six verifier audits delayed a handoff despite configured reviewers | Preserve the existing fix forbidding Implementer's independent self-audit when reviewers exist |
| Current Planner and Implementer handoff templates unconditionally request parallel scouts/workers while carrying `use_subagents` elsewhere | Resolve the policy once and generate conditional instructions and session guards |

The incident about an Implementer self-audit is distinct from the user's
reported `use_subagents: false` violation. The templates provide a plausible
mechanism for the latter; the collected reports do not establish its full trace.

Current code already supports OMP in YAML and a basic launch command, but
`catalogs.mjs` only enables Pi, Claude Code and Codex in setup. Qoder is absent.
The current question tool is `orca_pod_ask`, implemented by
`skills/orca-pod-setup/pi-extension/index.js` and `ask.js`; no
`orca_pod_task` definition was found in this checkout or the inspected installed
copies. This existing question component is the extraction source.

There are pre-existing local modifications in `.gitignore` and five Pi helper
definitions. Preserve them. In particular, the local provider-extension
configuration is evidence of a real compatibility need, not a universal
provider name to hard-code into the published project.

## Approaches

### Diagnostic cadence

Considered: one obligatory Lens pass per stage, versus targeted calls during
work. The user selected targeted calls, adding a final cumulative pass owned
by the regular Reviewer. This preserves a final broad check while removing
routine per-stage Lens work and duplicated Chief scans.

### Provider coverage

Considered: provider-native checks, versus a shared Pi Lens MCP dependency for
all role CLIs. The user selected provider-native checks. Diagnostic sets can
differ between providers; the plan records the actual coverage and fallback.
This avoids an additional mandatory server and an experimental integration.

### Question UI distribution

Considered: a separately installable package inside orca-pod, versus a separate
repository. The user selected the separate `pi-task` repository for later Pi
Packages publication. Its release and installation become independent of the
pipeline; plan-blitz keeps ownership of its domain-specific rules.

### Implementation structure (author's recommendation)

Extend the existing JavaScript scripts and Markdown skills. Share provider
capability descriptions between setup, config validation and launch generation.
Keep handoffs in Orca terminals and diagnostic evidence in existing reports.
A new persistent workflow controller would add a second source of state and is
outside this change. Prompt edits alone cannot address the launch/configuration
contradictions, so enforcement also belongs in the executable integration.

## Goals, constraints and non-goals

Goals:

- Preserve the user's intent from design/specification through plan approval.
- Reduce unnecessary scans, helper categories, failed provider launches and
  repeated analysis, without claiming incomplete checks passed.
- Make disabled delegation prominent and enforce it through CLI capabilities
  where available.
- Offer Qoder and OMP through the same setup and role workflow as existing CLIs.
- Make pi-task usable by any Pi skill, without installing orca-pod.

Constraints:

- Keep all four review modes: `full`, `reviewer`, `chief`, `self`.
- Keep Git optional, immutable approved documents/review reports, existing
  stage handoffs, finding severity rules and bounded review attempts.
- Keep the distinction between terminal roles, helper specializations and
  concurrent helper instances.
- Respect project restrictions and the pipeline's existing tests-on-request
  policy. A diagnostic request does not authorize builds, tests or autofixes.
- Keep English repository sources and English/Russian user documentation and
  setup strings where those already exist.
- Do not install missing providers, change credentials, or rewrite global
  extension settings during a pipeline run.

Non-goals:

- A hosted service, resumable workflow engine or replacement for Orca.
- A global concurrency limit of three, or a total helper launch budget.
- An AI reviewer built into pi-task, automated answer submission, or user
  approval inferred from a preselected answer.
- Fixing unrelated defects in the applications represented in `reports/`.
- Automatic public repository creation, pushing, package publication, or
  changes to the owner's installed production configuration during development.

## Planning and blitz

### Document sequence

Planner follows the existing brainstorming and planning skills, with explicit
orca-pod policy passed to each. It presents the written specification or design
through blitz before its approval. If both are separate authoritative
documents, both receive coverage; a combined specification/design gets one
blitz covering both aspects. A task without a separate visual design does not
need a fabricated additional document.

Planner then writes the implementation plan and conducts the interactive plan
blitz. It supplies the approved upstream document paths and their decision
records, rather than asking plan-blitz to infer user intent from the plan alone.
Revisions follow the same sequence for the affected decisions only.

### Decision trace

Use short stable decision identifiers in the existing documents, with the
decision, its source, whether it is user-confirmed or an author proposal, and
the relevant section. Preserve the existing human-readable blitz log. Do not
introduce a separate database or a tracking service.

For every material plan choice, Planner compares the plan with the approved
specification/design and classifies it as:

- consistent with an agreed decision;
- a conflict with an agreed decision;
- a new user-visible choice not decided upstream;
- an implementation detail with no change to agreed outcomes.

Consistent decisions appear in the overview/map and are not asked again merely
to repeat approval. Conflicts and new choices become cards. The proposed
answer favors the previously agreed outcome when one exists. A question is
needed when resolving a conflict requires choosing between genuine outcomes;
a simple transcription mistake is corrected before the question round.

The card explains the agreed outcome, what the plan would actually do, and the
consequence of the mismatch in plain language. Internal decision IDs and
document references provide traceability in the document, not code-like jargon
inside the question window. Spec/design disagreements are made explicit;
Planner does not silently invent a precedence rule between contradictory
user-approved documents.

The user still selects every asked answer. Choosing a different outcome
updates the affected upstream document as a new approved version before the
plan is handed off. Cancellation, an empty answer or a proposed default is
never approval. Keep current round limits, plain-text fallback, overview,
document paths and the final explicit approval.

The question transport is a separate concern: Pi uses pi-task; other CLIs use
their supported native question UI or the same numbered text fallback. OMP
and Qoder do not require the Pi extension to participate.

## Helper catalogs and disabled delegation

### At most three specializations

Proposed default catalogs:

| Terminal role | Available specializations | Scope adjustment |
| --- | --- | --- |
| Planner | `scout`, `researcher`, `oracle` | Code investigation, external references, contested decisions |
| Implementer | `worker`, `scout`, `verifier` | Scout also handles bounded reference research; verifier only in `self` mode |
| Reviewer | `reviewer`, `scout` | Main role owns diagnostics; two specializations are sufficient |
| Chief Reviewer | `reviewer`, `evidence-auditor`, `scout` | Final code assessment, criteria/evidence audit, bounded context lookup |

Remove `lens-checker` from the offered and effective catalogs. No substitute
diagnostics helper is introduced. Extend Scout's read-only research instructions
and provider tool configuration where needed; do not claim it has web access
when the host does not provide it.

An omitted `subagents` mapping selects the role's default catalog, filtered by
review mode. An explicit mapping selects the active specialization set instead
of being unioned with all defaults. Provider aliases for the same logical helper
do not add a specialization. Existing custom helper names remain possible only
within the three-entry set and after provider compatibility validation; they
replace default slots. The role must not invoke unselected native helpers as
an extra fourth specialization. Provider built-ins outside the effective set
are not authorized pipeline fallbacks.

Keep `max_subagents` as the independent concurrency setting with its current
default and accepted range. Multiple workers or reviewer lanes are instances of
one specialization. The existing prohibition on recursive delegation stays.

### Resolved role policy

Resolve once per launch: role identity, review mode, delegation enabled/disabled,
effective specializations, configured models and thinking, concurrency, language,
and diagnostic ownership. Use that same result for setup summaries, launcher
arguments, session instructions and handoff templates.

When delegation is disabled:

- Explicitly state that the role performs its work inline and may not launch
  native helpers, invoke another CLI as a helper, or follow another skill's
  instruction to delegate.
- Do not register or advertise orca-pod helper definitions for that session.
- Use native disable flags or supported session-local tool filters where the
  installed provider exposes them. Pi may use a narrowly scoped guard extension
  if its API is needed to remove/block delegation tools.
- Replace unconditional scout/worker/lane instructions everywhere, including
  retries, revisions and `self` mode. Repeated handoffs retain a compact policy
  line so a long session is not relying only on its first user prompt.
- Keep the policy in the provider's supported system/developer instruction
  channel so context compaction does not discard it as old conversation text.

This is protection against accidental delegation, not a security sandbox around
a general-purpose shell. Record whether enforcement is native/tool-filtered or
instruction-only. Unsupported installed versions must not be represented as
having a verified hard block; explain the limitation once and retain the inline
policy. The implementation must verify actual provider capabilities, rather
than passing speculative flags or silently enabling delegation as fallback.

With external reviewers, Implementer still cannot run verifier/audit lanes;
this existing rule remains true even when delegation is generally enabled.

## Diagnostic ownership and review flow

### Planned checks

Keep Implementer's planned verification checks. Add an explicit final-diagnostics
description to the plan: owner, cumulative file scope, available tool or exact
read-only command, expected language coverage, fallback, and whether the check
is required. Planner chooses it from the actual environment and project rules.
Documentation-only or unsupported files can have an explained not-applicable
status; no fake analysis is required for them.

Reviewer may execute these approved read-only analyzer/type-check/lint commands.
This is a narrow change to the current blanket ban on reviewer lint execution.
Commands that format, autofix, generate code, build or test are not authorized
by this exception. Tests still require the user's existing explicit request.

In Pi, the final owner uses `lens_diagnostics` in its own session, with an
explicit file list and current LSP evidence where supported. Outside Pi, it uses
the selected CLI's diagnostics or the plan's read-only commands. Do not install
or require Lens MCP. If Lens is missing or does not cover the language, use the
planned supported fallback and report the actual tool.

### One final cumulative pass

1. Ordinary implementation and stage review proceed as before. Lens is only
   called to resolve a concrete diagnostic question, not as a mandatory pass
   for every TODO, wave or intermediate stage.
2. Implementer supplies the task's cumulative changed-file list, not only the
   last stage's files. Include additions and renames; record deletions and
   identify affected consumers. Exclude pipeline artifacts and unrelated
   pre-existing dirty changes. Without Git, use the explicit change manifest.
3. In `full` and `reviewer` modes, regular Reviewer performs the full final pass
   during the first review attempt of the last stage. This covers files from
   earlier stages too. Full coverage means every relevant changed file is
   either checked or explicitly classified as unsupported/not applicable.
4. Confirmed blocking findings go through the existing finding registry and
   `CHANGES_REQUESTED` response. Implementer fixes them and returns the fix delta.
5. Subsequent diagnostic checks cover files changed since the previous pass and
   consumers affected by a changed shared interface. They do not rescan the
   cumulative set by default. A tool that can only analyze a whole project may
   run at its minimum supported scope; record that limitation explicitly.
6. After closure, Reviewer sends the report to Chief in `full` mode. Chief
   performs the final code/evidence review without automatically repeating the
   full diagnostics. In `reviewer` mode, Reviewer gives the final verdict.

The full pass includes diagnostic findings in earlier-stage files even though
ordinary repeat code review remains delta-based. It is a first diagnostic
coverage pass, not permission to reopen all earlier code for unrelated style
changes.

### Optional roles and late fixes (author's defaults)

| Mode | Final diagnostic owner | Final verdict |
| --- | --- | --- |
| `full` | Reviewer | Chief Reviewer: `FINAL_APPROVED` |
| `reviewer` | Reviewer | Reviewer: `FINAL_APPROVED` |
| `chief` | Chief Reviewer, acting as the only reviewer | Chief Reviewer: `FINAL_APPROVED` |
| `self` | Implementer, in the main session; verifier may evaluate criteria and planned static checks | Implementer: `SELF_VERIFIED` |

In `self`, existing per-stage static/criteria checks remain, but verifier does
not start a Lens instance; final cumulative Lens/native diagnostics belong to
the main role. There is still no independent review in this mode.

If Chief requests changes after Reviewer completed diagnostics, the final
diagnostic owner stays Reviewer in `full` mode. Implementer provides the fix
delta for a diagnostic-only check before Chief's next verdict. Reviewer returns
the result to Chief and Implementer; it does not reopen a full stage review or
assume authority over Chief's findings. New diagnostic defects are carried into
the pending Chief attempt for classification and the single final decision.

Review budgets do not reset on a diagnostic finding: the initial full pass and
its fixes use the last stage's existing three-attempt budget. A Chief fix's
diagnostic-only check is part of the pending Chief attempt, with one such check
per attempt, not an unbounded nested fix loop. Existing final review budgets
remain: two Chief attempts when a separate Reviewer exists, three final
attempts when a single reviewer owns both phases; self checks keep their
three-attempt bound. Unresolved blocking findings at the applicable limit are
`BLOCKED`, with the existing user-controlled continuation policy.

### Evidence, freshness and unavailable tools

Each diagnostic result records owner, tool/version where obtainable, scope,
checked/unsupported files, freshness limitations, duration when available,
and one of passed, findings, incomplete/unavailable or not applicable. Keep
this in the existing immutable review report, alongside the finding registry.

A zero-message response with no confirmed language analysis is not a pass.
Stale LSP messages must be checked against current file contents and a fresh
supported probe or analyzer before becoming code-change requests. Do not fix
unrelated baseline diagnostics. A concrete regression in an unchanged consumer
caused by the task's interface change remains in scope.

Each diagnostic call/command has a finite supported timeout. At most one
targeted refresh/retry is allowed for a timeout or stale state, then use the
planned fallback. A required check that cannot be completed is unresolved
verification, not a code defect and not success. Follow the existing blocked
workflow if no permitted fallback can satisfy it. Optional checks may be
reported skipped with reason. The builder selects practical per-tool timeout
values and records them; no speedup target is invented from the reports.

### Pi extension isolation

Provider extensions required to instantiate a selected model must remain
available to children. Lens and other heavy diagnostic hooks should not load
into workers, scouts, reviewer lanes or evidence auditors by default. Use
supported per-session/per-child inclusion or exclusion facilities, preserving
the owner's extension configuration. Do not hard-code `alibaba-token-plan` as
the only valid provider extension and do not rewrite global settings.

The main diagnostic owner retains Lens. Other main roles should use a
session-local minimal/targeted Lens setup where supported, avoiding automatic
full scans and write-time autofix during read-only review. Merely telling a
model not to call Lens does not disable extension lifecycle hooks: verify
actual loaded extensions and behavior. If a version cannot separate providers
and diagnostic hooks, identify that capability limitation before fan-out and
fall back to inline work rather than silently starting many full Lens sessions.

## Configuration limits and migration

Enforce one to three profiles in the canonical validator, form validation and
server-side form submission. Disable adding a fourth profile and explain the
limit. A manually edited four-profile YAML is invalid for launching.

Enforce at most three selected specialization entries per role at the same
boundaries. Also validate the resolved default/effective catalogs so an omitted
mapping or union with defaults cannot bypass the limit. Empty catalogs when
delegation is disabled do not create helper requirements.

Opening old settings must be lossless. Show all old profiles and helper entries,
mark the incompatible ones, and let the user choose what to keep before saving.
Do not silently truncate to three, drop model settings, or overwrite the file
when the form is cancelled.

For old `lens-checker` entries, explain that diagnostics now belong to the
main role and offer removal from the helper list. For Implementer's separate
`researcher`, offer merging its purpose into Scout; if both had different
model/thinking settings, let the user choose the retained setting. These
changes are part of normal setup review, not automatic runtime migration.
Custom helper selections can replace default slots within the same cap.

## Qoder and OMP integration

Treat `qoder` and `omp` as first-class role providers across discovery, setup,
model/thinking selection, YAML validation, role launch, helper definitions,
delegation policy, question transport and documentation. OMP's existing basic
launch support is a starting point, not evidence of complete support.

Use shared provider descriptions/adapter functions for:

- executable names, aliases and installation locations;
- read-only model discovery and the provenance of model/thinking capabilities;
- supported reasoning controls and handling of provider-managed defaults;
- role instruction injection and delegation filtering;
- helper name/model/effort mapping, completion notifications and limits;
- session-scoped full-access behavior and the existing setup warning;
- question UI capability, with numbered text fallback;
- diagnostic capabilities and their limitations.

Do not assume Qoder or OMP is a drop-in Pi or Claude invocation. Query installed
versions and read current help/official documentation. Qoder's documented
surface includes model listing, reasoning effort, appended system instructions
and tool filtering; OMP documents its own appended instructions, model catalog,
tool selection and approval settings. Model discovery must not issue an LLM
request or print credentials. Handle partial discovery explicitly: a model ID
may be entered where enumeration is unavailable; unavailable effort metadata
must not be replaced by an invented list.

Introduce a provider-default reasoning choice where a provider/model does not
expose a tunable level. Normalize it internally and omit an unsupported flag;
retain strict validation for providers whose effort is known. The exact schema
representation and version capability table are left to the builder, preserving
compatibility with existing required explicit effort values.

All roles remain interactive Orca terminals so Planner can receive user answers.
Use the existing setup browser script for OMP/Qoder; no port of the Pi-specific
setup extension is required. Use each provider's native subagent mechanism,
filtered to the effective logical specialization set, with the existing inline
fallback when helpers are unavailable. Do not create additional role terminals
or worktrees for helpers.

Support must be described at the granularity actually verified. If an installed
version cannot provide a capability, setup/launch reports it rather than hiding
the provider or pretending unsupported flags work. Full-access options remain
explicit and use provider semantics; they do not relax delegation policy.

## Standalone pi-task

### Boundary

Create a separate local Git repository at the proposed sibling location
`/Users/salesao/Desktop/worksApp/pi-task` after design approval. Repository and
package display name: `pi-task`. No remote creation, push or publication is
included. If the unscoped registry name is unavailable, keep the repository
name and settle a scoped publication name before publishing.

The package contains Pi's reusable question UI, parameter normalization,
structured/text results, lifecycle cleanup, tests and installation/use docs.
Use Pi's package manifest for extension discovery. Preserve attribution and the
MIT licensing of the extracted code and its upstream questionnaire adaptation.
It must install and run without orca-pod or neighboring skill directories.

Author's proposed model-facing tool name: `pi_task`, rather than a generic
`task` that can collide with orchestration tools. This is a question tool, not
a task scheduler or subagent launcher. Package naming and tool naming are
documented separately.

Preserve the existing interface: one to four questions, two to four options,
tabbed navigation, descriptions/context cards, a free-text answer, Submit,
Escape, abort cleanup and headless/no-UI fallback. Keep the existing validation
bounds initially. Do not add automatic selection/submission or persistent
question history to the UI component. The model supplies localized wording;
the current default labels and visual behavior should remain compatible.

Return the existing readable result plus structured answers and a clear
submitted/cancelled/aborted/no-UI/invalid state. Caller skills own the meaning
of an answer and all approval rules. The extension owns only interaction and
truthful outcomes.

### Orca-pod migration

Update plan-blitz to prefer `pi_task`. During a transitional release it may
call an already-installed legacy `orca_pod_ask` when the new tool is absent,
then fall back to numbered text. A task must never block solely because the
question UI package is missing.

The new orca-pod setup extension registers only `orca_pod_setup` and has no
vendored copy of the question UI. pi-task does not register the legacy name
by default, avoiding duplicate registrations alongside an older setup
extension. Keep the setup form install/link flow separate from pi-task.

Document local-path installation before publication and the eventual package
install path separately. Setup reports missing pi-task with a concise install
instruction; it does not assume an unpublished registry package exists or
silently install it. In development, verify the two projects together using a
temporary local installation. Future publication belongs to the owner.

## Acceptance and verification

Implementation acceptance criteria:

1. A specification, a design and a combined document can all be reviewed by
   blitz; a plan mismatch produces a question grounded in an upstream decision.
   User selection and final approval remain explicit.
2. Three profiles save and launch; four profiles are rejected without losing
   old configuration. Cancelling repair leaves the original file intact.
3. Every effective role catalog has at most three specializations. Multiple
   instances of a selected worker remain governed by `max_subagents`.
4. Disabled delegation produces inline instructions at every handoff and
   suppresses native delegation tools/registration on supported versions.
   A provider limitation is visible and cannot pass as hard enforcement.
5. Workers/lanes can use extension-provided Pi models without launching Lens
   per child. Compatibility failure is detected before a mass failed launch.
6. A multi-stage run has one cumulative final diagnostic pass. Its fix loop
   checks the delta; Chief does not repeat the full pass. Required incomplete
   diagnostics cannot yield a false success. All four review modes have an owner.
7. Qoder and OMP appear in setup when available and can launch each configured
   terminal role with the selected model, reasoning behavior and role policy.
8. pi-task works in a clean Pi installation independently of orca-pod, and
   plan-blitz uses it while the setup form continues to work separately.

Run the existing repository suite and extend only meaningful behavior tests:
validator and server/client limit bypasses; default-versus-explicit helper
selection; provider command/capability mapping; policy-aware handoffs; final
scope and retry ownership; old configuration preservation; question UI submit,
cancel, abort, invalid parameters and no-UI behavior. Tests should catch the
observed failures rather than merely assert the presence of new prose.

Use isolated configuration directories/fixtures for CLI smoke checks. Confirm
loaded tools/extensions and argv for the installed provider versions. A paid
end-to-end model run is not necessary for initial command/config tests; record
what was and was not exercised. If model interaction is needed to validate a
provider-specific behavior, keep it bounded and report the actual evidence.

Do not rerun the application patches from `reports/`. Use sanitized small
fixtures for a multi-stage full pass, a one-file fix, a shared-interface fix,
stale/unsupported LSP data and a disabled-delegation role. Record diagnostic
call counts and covered paths as the primary performance evidence; timings are
supplementary and environment-dependent.

## Delivery order and builder discretion

Proposed dependency order: prepare standalone pi-task and its stable interface;
update orca-pod's shared provider/policy and limits; implement diagnostic and
planning protocol changes; add full Qoder/OMP adapters; switch the Pi question
transport; update bilingual documentation and verify the integrated workflows.
This is a design, not the implementation task list; writing-plans follows only
after approval.

The builder may choose file/module boundaries, fixture organization, per-tool
timeouts, provider feature detection details, the representation of a
provider-default effort, and a minimal packaging/build setup. Those choices
must preserve the decisions and acceptance criteria above. Any newly discovered
provider limitation that changes user-visible behavior must be surfaced.

## Reference sources

- Local implementation: `skills/orca-pod/SKILL.md`,
  `references/handoff-contracts.md`, `references/review-protocol.md`,
  `references/subagents.md`, scripts for config/provider launch, setup catalogs,
  form validation and the Pi setup extension.
- Local installed Pi Lens 4.4.4 documentation: configuration, subagent
  compatibility, MCP limitations; used to distinguish model extensions from
  diagnostic lifecycle hooks. Installation state is not a universal version pin.
- [Qoder CLI reference](https://docs.qoder.com/cli/cli-reference),
  [subagents](https://docs.qoder.com/cli/subagent),
  [skills](https://docs.qoder.com/cli/Skills).
- [OMP CLI reference](https://github.com/can1357/oh-my-pi/blob/main/docs/cli-reference.md).
- [Pi Lens features and experimental MCP adapter](https://github.com/apmantza/pi-lens/blob/master/docs/features.md).

External interfaces were inspected on 2026-11-11 and must be checked against
the installed CLI during implementation. No vendor source was executed to
conduct this design review.
