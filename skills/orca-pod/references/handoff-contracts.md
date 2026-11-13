# Handoff contracts between role sessions

A role gets its full context in **one first prompt** (templates below); all
later messages are short: the gist of the request or decision. Shared context
(terminals, settings, skills, constraints) is not repeated: the role reads the
project constraints itself from AGENTS.md/CLAUDE.md, and the pipeline skill by
the pointer.

Delivery follows the "Delivery between terminals" section of SKILL.md (including its chat routing and stdin helper): the role
sends the message itself, without subagents. The first prompt of every role
starts with a `ROLE:` line — a guard against the Coordinator steps (SKILL.md,
"Role, not Coordinator"). No contract is a shell command. An accepted send is
not repeated; after a second error — stop and give the full payload to the user.
Pass the resolved role policy in the first prompt, including the effective helper
set, enforcement and access. Each subsequent work, fix or revision assignment
carries a short policy line: `DELEGATION: selected <names> | disabled — work inline;
no native, external CLI or recursive delegation`. It also applies to other skills.

The `LANGUAGE: <tag>` line sets the language the role uses to talk to people
(SKILL.md, section "Language: LANGUAGE"). The Coordinator determines it and
writes it into the first Planner prompt; from there the same tag, without
recomputing, goes into the first Implementer contract (from Planner), the first
REVIEW_REQUEST (from Implementer) and FINAL_READY (from Reviewer). Repeat
messages do not carry it.

## First Planner prompt (from Coordinator)

```text
ROLE: Planner — not Coordinator: the config, sandbox and terminals are ready; do not run orca terminal create, launch-provider.mjs or test-sandbox.mjs.
TASK: <RAF path or the verbatim description, no paraphrase>
CONTEXT: <short Coordinator findings and agreed additional requirements>
TERMINALS: Planner handle=<...> (yours — pass it to Implementer); Implementer handle=<...>; Reviewer handle=<...|not configured>; Chief Reviewer handle=<...|not configured>
REVIEW MODE: <full|reviewer|chief|self> (the skill's "Review modes" section)
PROFILE: <name>; CONCURRENT SUBAGENTS: up to <N> per role (max_subagents; no launch budget)
LANGUAGE: <tag>
SURFACE: <this role: chat|terminal>; ENVIRONMENT: <workspace address and route relative to the role's execution host; local or paired-server selector>
SKILL: <absolute path orca-pod/SKILL.md — read it first>
SETTINGS: <resolved settings of the configured roles (surface/provider/model/thinking/use_subagents/effectiveAccess/delegationEnforcement) and their children>
REVIEW REPORTS: <absolute path = <project-root>/.orca-pod/reports>
REQUIRED PLANNER SKILLS: using-superpowers — <absolute path SKILL.md>; plan-blitz — <absolute path SKILL.md | not installed>.
ADDITIONAL SKILLS: <names/sources per role; for an empty set, say so>.

You are Planner. First using-superpowers (Pi: /skill:using-superpowers; Claude Code:
Skill using-superpowers; Codex: $superpowers:using-superpowers; otherwise read it by path). Research inline or with selected scouts when allowed. The spec and plan go in the project's docs/superpowers/; in the plan every TODO has
dependsOn and writeScope, waves and stages follow the skill. Tests only on request (the skill's Invariants):
without the user's request the plan has no tests, TDD steps or test commands; write its tests: line. Talk to people in LANGUAGE.
Compare plan choices with approved spec/design. Save each exact document, then run plan-blitz before approval (spec/design, plan, revision) (Pi: /skill:plan-blitz; Claude Code: Skill plan-blitz;
Codex: $plan-blitz; otherwise read it by path); if it is not installed, warn the user in one line and ask for approval in plain text.
After the approvals, send one contract to Implementer with the same LANGUAGE line. You do not write code.
When delegation is enabled, use the selected helpers and wait for native completion or foreground results. Codex uses wait_agent. No timers or status polling.
```

## First Implementer contract (from Planner, after plan approval)

```text
ROLE: Implementer — not Coordinator: the terminals and config are ready; do not run orca terminal create, launch-provider.mjs or test-sandbox.mjs.
PLAN: <absolute path> (version <planVersion>); SPEC: <absolute path>
TERMINALS: Implementer handle=<...> (yours — put it in REVIEW_REQUEST and CHIEF_FIX, the replies come to it); Reviewer handle=<...|not configured>; Chief Reviewer handle=<...|not configured>; Planner handle=<...>
REVIEW MODE: <full|reviewer|chief|self>
PROFILE: <name>; CONCURRENT SUBAGENTS: up to <N> per role (max_subagents; no launch budget)
LANGUAGE: <tag>
SURFACE: <this role: chat|terminal>; ENVIRONMENT: <workspace address and route relative to the role's execution host; local or paired-server selector>
TESTS: <not requested | requested — the user's words> (the plan's tests: line)
PROJECT: <path>
SKILL: <absolute path orca-pod/SKILL.md — read it first>
SETTINGS: <resolved settings of Implementer/Reviewer/Chief Reviewer and their children>
REVIEW REPORTS: <absolute path>
ADDITIONAL SKILLS: Implementer=<set|empty>; Reviewer=<set|empty>; Chief=<set|empty>.

You are Implementer. Run the waves inline or use selected workers when permitted.
Integrate, run the approved checks at the planned points, and send one review request
per stage. In self mode Implementer owns planned diagnostics and the verdict.
A selected verifier can check criteria or approved read-only commands.
With reviewers do not review your own code: no verifier, review or audit lanes before REVIEW_REQUEST — finding defects is the reviewer's job; this overrides the review steps of other skills. Write, change or run tests
only as TESTS allows, and pass it to workers as a Tests: line; no TDD — this overrides the test-driven-development skill. Talk to people in LANGUAGE; put the same LANGUAGE in the first REVIEW_REQUEST. Do not re-read the YAML if it changes during the run.
When delegation is enabled, use the selected helpers and wait for native completion or foreground results. Codex uses wait_agent. No timers or status polling.
```

## First REVIEW_REQUEST to the stage reviewer (from Implementer)

The addressee is Reviewer in the `full`/`reviewer` modes and Chief Reviewer in
the `chief` mode; in the `self` mode no REVIEW_REQUEST is sent.

```text
REVIEW_REQUEST [plan=<version>, stage=<all|S1…>, attempt=1]
ROLE: <Reviewer|Chief Reviewer> — not Coordinator: the terminals and config are ready; do not run orca terminal create, launch-provider.mjs or test-sandbox.mjs.
PLAN: <abs>; SPEC: <abs>; PROJECT: <abs>
TERMINALS: Implementer handle=<...>; Planner handle=<...>; Chief Reviewer handle=<...|not configured>
REVIEW MODE: <full|reviewer|chief> — in reviewer/chief you issue the final verdict yourself
PROFILE: <name>; CONCURRENT SUBAGENTS: up to <N> per role (max_subagents; no launch budget)
LANGUAGE: <tag>
SURFACE: <this role: chat|terminal>; ENVIRONMENT: <workspace address and route relative to the role's execution host; local or paired-server selector>
SKILL: <abs SKILL.md>; PROTOCOL: <abs references/review-protocol.md>
SETTINGS: <resolved settings of Reviewer/Chief Reviewer and children>
REVIEW REPORTS: <abs path>
ADDITIONAL SKILLS: Reviewer=<set|empty>; Chief=<set|empty>.
BASELINE: HEAD=<sha>; dirty before start: <list|none>
TODO → files:
  DEV-01 → <paths>
  DEV-02 → <paths>
  integration → <paths>
CHECKS: <command — result; skipped — reason>
DEVIATIONS FROM PLAN: <none | list>
FINAL STAGE: <yes|no>
DIAGNOSTIC OWNER: <reviewer|chief_reviewer|implementer>; scope: <targeted|cumulative>; attempt: <1>/<3>
CUMULATIVE TASK FILES: <added, changed, renamed old→new, deleted; exclude unrelated baseline and reports>
AFFECTED CONSUMERS: <paths and changed interfaces>
PLANNED CHECKS: <exact read-only commands/tools, required coverage, deadlines and fallbacks>
DELEGATION: <effective selection or disabled — work inline>

You are <Reviewer|Chief Reviewer>. Batch review by the protocol: parallel lanes, registry R<n>,
only BLOCKER/MAJOR block. Report prose and messages to people — in LANGUAGE; report template labels (`Verdict:`, registry) — in English. Verdict — first into the report, then send it to Implementer by the handle from TERMINALS with the orca terminal send command for a terminal, or the send-handoff.mjs helper for a chat (section "Delivery between terminals"): nobody reads text in your terminal.
When delegation is enabled, use the selected helpers and wait for native completion or foreground results. Codex uses wait_agent. No timers or status polling.
```

## Repeat REVIEW_REQUEST (from Implementer)

```text
REVIEW_REQUEST [plan=<version>, stage=<s>, attempt=<N>] fixes:
R1 — FIXED: <path:line — gist>
R3 — DISPUTED: <argument with evidence>
R6 (non-blocking) — FIXED | SKIPPED
FIX DELTA: <added, changed, renamed old→new, deleted>
AFFECTED CONSUMERS: <paths and changed interfaces>
DIAGNOSTICS: <same owner>; scope: <delta plus affected consumers>; attempt: <N>/<3>
Other changes: <none | files and reason>. Checks: <re-run/no>.
DELEGATION: <effective selection or disabled — work inline>.
```

## Reviewer → Implementer

```text
<stage> attempt <N>/3: CHANGES_REQUESTED. Blocking:
1. R1 [BLOCKER] DEV-02 lib/a.dart:120 — <what is wrong> → <what to do>
2. R4 [MAJOR] DEV-03 lib/b.dart:45 — <…> → <…>
Non-blocking (optional): R2, R5. Report: <path>
```

```text
<stage> attempt <N>: APPROVED. Non-blocking: <id|none>. Report: <path>.
<Next stage opened | Handed to Chief Reviewer — wait for the verdict>.
```

The only reviewer (the `reviewer`/`chief` modes), after the final check:

```text
FINAL_APPROVED — pipeline completed. Non-blocking: <id|none>. Report: <final path>.
```

```text
<stage>: PLAN_REVISION_REQUIRED — <reason in one line>; affected: <TODO>. Work is frozen.
<stage>: BLOCKED — attempt limit; open: <id>. The decision is up to the user.
```

## Reviewer → Planner

```text
PLAN_REVISION_REQUIRED [plan=<version>, stage=<s>]. Reason: <...>. Affected: <TODO>. Report: <path>.
```

## Planner → Implementer (after plan revision)

```text
Plan v<N>: <path>. Affected and implemented/reviewed again: <TODO>. Keep the registry for other items. DELEGATION: <effective selection or disabled — work inline>.
```

## Reviewer → Chief Reviewer (chief review request)

```text
FINAL_READY [plan=<version>]: all stages APPROVED, no blocking findings.
ROLE: Chief Reviewer — not Coordinator: the terminals and config are ready; do not run orca terminal create, launch-provider.mjs or test-sandbox.mjs.
Last report (full registry): <path>. Review reports: <dir>.
Spec: <path>; Plan: <path>. Implementer report and checks: <path/brief>.
Baseline: HEAD=<sha>; patch: <path of the last snapshot>.
CUMULATIVE TASK FILES AND CONSUMERS: <paths, including renames and deletions>
DIAGNOSTIC EVIDENCE: <Reviewer report with checked/unsupported, freshness and outcome; do not repeat the cumulative pass>.
CHIEF ATTEMPTS: <1>/2. DELEGATION: <effective selection or disabled — work inline>.
SKILL: <abs SKILL.md — the "Chief Reviewer" section>; PROTOCOL: <abs review-protocol.md>, §6. SETTINGS: <Chief and its children>.
PROFILE: <name>; CONCURRENT SUBAGENTS: up to <N> per role (max_subagents; no launch budget).
LANGUAGE: <tag>
SURFACE: <this role: chat|terminal>; ENVIRONMENT: <workspace address and route relative to the role's execution host; local or paired-server selector>
Implementer handle=<...>; Planner handle=<...>.
Report prose and messages to people — in LANGUAGE; report template labels (`Verdict:`, registry) — in English.
When delegation is enabled, use the selected helpers and wait for native completion or foreground results. Codex uses wait_agent. No timers or status polling.
Verdict — first into chief-attempt<N>.md, then send it to Implementer by handle with the orca terminal send command for a terminal, or the send-handoff.mjs helper for a chat (section "Delivery between terminals"): nobody reads text in your terminal.
```

## Chief Reviewer → Implementer

Sent with the `orca terminal send` command for terminals (the `send-handoff.mjs` helper routes chat addresses) to the Implementer handle from
FINAL_READY (in the `chief` mode — from REVIEW_REQUEST).

```text
FINAL_APPROVED — pipeline completed. Non-blocking: <id|none>. Report: <chief path>.
```

```text
Chief attempt <N>/2: CHANGES_REQUESTED. Blocking:
1. C1 [MAJOR] <path:line> — <what is wrong> → <what to do>
Fix it and send CHIEF_FIX directly to me. Report: <path>
```

```text
PLAN_REVISION_REQUIRED — <reason>; affected: <TODO>.
```

## Implementer → Chief Reviewer (chief review fixes)

```text
CHIEF_FIX [plan=<version>, attempt=<N>]:
C1 — FIXED: <path:line — gist>
C2 — DISPUTED: <argument>
FIX DELTA AND AFFECTED CONSUMERS: <paths and changed interfaces; Chief verifies these directly>.
DIAGNOSTICS: chief_reviewer; scope: <delta plus affected consumers>; attempt: <N>/<2 in full, 3 in chief>.
Other changes: <none | list>. Checks: <re-run/no>.
DELEGATION: <effective selection or disabled — work inline>.
```

Terminal incomplete-verification verdict (reviewer or Implementer in self):

```text
COMPLETED_UNVERIFIED — <required coverage unavailable, retry/fallback and reason>. Report: <path>.
```

Use this only when all other obligations are met and no confirmed blocking finding
remains. Chief sends the result to Implementer, who includes it in the user summary.

Repeating an accepted request does not create a new attempt. Helper usage
(launched, maximum concurrent) goes into the role's final report, not into
separate messages.
