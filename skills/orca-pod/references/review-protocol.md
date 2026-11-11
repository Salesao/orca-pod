# Review protocol: batch review, parallel lanes, findings registry

Read by Reviewer, Chief Reviewer and their review-lanes. Implementer (Integrator)
reads sections 1, 2 and 5 — to answer findings correctly.

Why the protocol is the way it is. The previous scheme reviewed each TODO
separately and on every attempt re-read the whole TODO with a fresh Scout.
Findings had no stable identifiers, fixes were not checked against them one by
one, and any theoretical scenario became a HIGH blocker. As a result every
attempt found "new" findings (DEV-02 reached 15 attempts), and the return
counter was bypassed. Below are the rules that rule this out.

## 1. Severity scale and blocking

Each finding is rated on two axes and gets one category.

- **Probability** — `high` (the main scenario, reproduces always or often),
  `medium` (a plausible secondary scenario: network error, re-login or re-opening a screen, a typical
  UI race), `low` (a rare combination of conditions, a theoretical race, a
  non-standard platform, a scenario without a proven path from real code).
- **Impact** — `high` (crash, data loss/corruption, security, violation of an
  acceptance criterion, compile/type error), `medium` (wrong behavior with a
  workaround, UX degradation), `low` (cosmetics, style, readability).

| Category | When | Blocks |
| --- | --- | --- |
| `BLOCKER` | impact high and probability high/medium; compile/type error; direct violation of an acceptance criterion; vulnerability | yes |
| `MAJOR` | impact medium and probability high/medium; or impact high at low probability if the consequence is catastrophic (security, irreversible data loss) | yes |
| `MINOR` | probability low at an impact below catastrophic; impact medium at low probability; a noticeable but not critical flaw | no |
| `NIT` | style, naming, minor readability | no |

Rules:

- **Only** `BLOCKER` and `MAJOR` block. `MINOR`/`NIT` are written into the report
  as recommendations and go to the Chief Reviewer as a "known non-blocking"
  list; CHANGES_REQUESTED is not issued because of them.
- Without a concrete reproduction scenario (input/state → wrong result) a
  finding cannot be above `MINOR`. "Theoretically possible" is `low`.
- To raise a finding higher on the scale you need an argument in the `scenario`
  field, not an epithet. If you hesitate between two categories, choose the lower
  one and mark `confidence: low`.
- A missing or not updated test is not a finding while the plan says `tests: not
  requested` (SKILL.md, "Tests only on request").
- Requirements outside the approved plan/specification are not findings. If the
  solution is wrong without them, that is `PLAN_REVISION_REQUIRED`, not an
  endless CHANGES_REQUESTED.

## 2. Finding format and registry

Identifiers are stable within a plan version and are never reused:
`R1, R2, …` — Reviewer, `C1, C2, …` — Chief Reviewer. Lanes return draft
numbers (`L<lane>-<n>`); the Reviewer assigns the final id when consolidating.

```text
R<n> [BLOCKER|MAJOR|MINOR|NIT] <TODO-ID> <path:line> — <what is wrong>
  scenario: <input/state → wrong result>; probability=<h/m/l>; impact=<h/m/l>
  criterion: <AC / spec section / plan>; fix: <minimal>; confidence=<h/m/l>
```

The **registry** is a table of all findings of the plan version with their
current status. Every new Reviewer/Chief report contains the full registry as of
the verdict, so the last report is enough for the next round and for the Chief
Reviewer.

| Status | Meaning |
| --- | --- |
| `OPEN` | open, waiting for a fix (blocking only) |
| `CLOSED` | the fix is verified |
| `NOT_FIXED` / `PARTIAL` | checked, the fix is missing/incomplete — stays blocking |
| `ACCEPTED_RISK` | non-blocking, left deliberately (MINOR/NIT by default) |
| `WITHDRAWN` | the reviewer withdrew the finding after the Integrator's argument (`DISPUTED`) |

The Integrator's answer to CHANGES_REQUESTED is line by line per id:
`FIXED <path:line, gist>`, `DISPUTED <argument with evidence>` or `SKIPPED`
(for non-blocking only). A blocking id that is not mentioned counts as
`NOT_FIXED`.

## 3. Batch review — first round (attempt 1)

The Integrator sends one REVIEW_REQUEST for the whole batch (the whole plan, or a
stage if the Planner split the plan into stages). The Reviewer:

1. **Snapshot.** Save the batch patch into the reports directory:
   `<stage>-attempt1.patch` = `git diff <baseline HEAD> -- <batch files>` plus
   new files via `git diff --no-index /dev/null <file>`. Without Git there is no patch: review the files
   from the request as they are now (SKILL.md, "Project without Git"). Do not attribute files that
   were dirty before the start (the list from the request) to the batch without
   evidence. Do not compute SHA/digest tuples: the plan version, stage
   and attempt are sufficient identity. The `.orca-pod/` folder (pipeline
   reports) is not part of the batch.
2. **Lanes.** Split the batch into independent slices and assign them **in parallel** when the effective role policy permits (mechanics — [subagents.md](subagents.md)):
   - TODO-lane: one per TODO; combine small TODOs of the same area into one lane;
   - integration-lane: the seams between TODOs — shared interfaces,
     initialization order, conflicting assumptions, whatever is not visible
     inside a single TODO; related TODOs (`dependsOn`) are also reviewed in
     parallel: each TODO-lane gets its own TODO plus the dependency contract,
     and the integration-lane checks the seam itself — sequential review for the
     sake of the link is not needed;
   - for a large batch — an extra lane for a risk zone (data migrations,
     concurrency, security) if the plan singles it out.
   The number of concurrent lanes is at most N, the profile's `max_subagents`
   (SKILL.md, "Subagents: policy and limits").
   Without helpers (use_subagents=false or the mechanism is unavailable) go
   through the same slices yourself sequentially and note the degradation in the
   report.
3. **Consolidation.** Wait for all lanes. Remove duplicates, verify contested
   places by targeted reading of the code (do not re-read the whole diff), assign
   `R<n>`, re-check the category against the scale in section 1. A lane is
   evidence, not a decision.
4. **Verdict.** At least one blocking finding → `CHANGES_REQUESTED` with a list of
   **blocking items only**; non-blocking ones by a link to the report. No blocking
   findings → `APPROVED` and handoff to the Chief Reviewer. A proven plan error →
   `PLAN_REVISION_REQUIRED`.
5. **Report** — before sending the message (format — section 7).

## 4. Repeat round (attempt ≥ 2) — registry check mode

A repeat review does **not** re-examine the whole batch from scratch. Its scope
is strictly:

1. **Registry check.** For every `OPEN`/`NOT_FIXED`/`PARTIAL` id — a
   verdict `CLOSED` / `NOT_FIXED` / `PARTIAL` with evidence. `DISPUTED` — either
   `WITHDRAWN` with a reason, or it stays with a counter-argument.
2. **Fix regressions.** Save `<stage>-attempt<N>.patch` and
   `<stage>-attempt<N>.delta` = `diff -u attempt<N-1>.patch attempt<N>.patch` (without Git the delta is the
   places from the `FIXED` answers and the list of other changes).
   Look for new problems **only inside the delta** (and in consumers affected by changed shared interfaces). Apply planned
   diagnostics to that scope, even if a consumer itself is unchanged.
3. **No "moving the goalposts".** A new finding on code outside the delta that
   was already reviewed is allowed only with category `BLOCKER` and only with the
   `missed-earlier` mark and a justification of why it was not found in the
   first round. `MAJOR`/`MINOR` outside the delta are not opened in a repeat
   round — they can be written into the report as an observation for the Chief
   Reviewer.

Repeat-round lanes: one per group of ids being verified (group by file/TODO) plus
one delta-lane for regressions. If in Claude Code or Codex a first-round lane for
the same slice is still alive, continue it (`SendMessage` in Claude Code,
`followup_task`/`send_input` in Codex) — it remembers its own findings; a new lane
gets an excerpt of the registry and the delta, not the whole patch.

## 5. Diagnostic scope and round limit

The plan names the owner, read-only tool or exact command, required checks,
scoping support, timeout and fallback. Do not install or update tools, apply
fixes, format files, build or run unrequested tests during review. Use the
smallest available scope when a tool only accepts a whole project, and record
that expansion. Outside Pi use available native analyzers and planned checks.

| Mode | Initial cumulative owner | Final-stage attempts | Chief attempts after separate Reviewer |
| --- | --- | --- | --- |
| full | Reviewer | 3 | 2 |
| reviewer | Reviewer | 3 | — |
| chief | Chief Reviewer | 3 | — |
| self | Implementer | 3 | — |

- During implementation and earlier stages use targeted diagnostics for a
  specific issue. On the first attempt of the last stage the owner runs one
  cumulative pass. Its scope includes task additions, changes, rename old/new
  paths, deletions and affected consumers from all stages. Check the current
  paths and affected edges, record deletions explicitly, and exclude unrelated
  baseline changes and service reports. Without Git use the explicit path list.
- On later attempts check the fix delta, affected consumers and open findings.
  The final diagnostics and last-stage review share the same attempt budget.
  A timeout or stale result allows one targeted retry, then the planned
  equivalent fallback. Compare results against current source and the active
  diagnostics revision or timestamp. Empty or unsupported output is not evidence
  of a pass. Use the plan's timeout, or 30 seconds for a targeted request and
  120 seconds for the cumulative request.
- A confirmed BLOCKER/MAJOR is `CHANGES_REQUESTED` while attempts remain, then
  `BLOCKED`. With all other work complete and no confirmed blocking finding,
  required coverage still unavailable after retry/fallback yields
  `COMPLETED_UNVERIFIED`. State the missing scope and reason in the report and
  final message. Optional missing evidence is recorded.

## 6. Final review and late fixes

In `full`, Chief reads the approved documents, cumulative Reviewer diagnostics,
registry and Integrator evidence. Assess the code and closure of blockers. Use
selected review/evidence helpers only if allowed. Chief does not run the
Reviewer’s cumulative pass again. Chief owns the diagnostic delta and affected
consumers after a `CHIEF_FIX`. Report fresh evidence for the fixed paths and
any earlier uncovered scope relevant to the delta.

In `reviewer` and `chief`, the sole reviewer combines final verification with the
last stage under the same attempt counter. In `self`, Implementer owns the
cumulative pass and applies the same delta rules. A selected Verifier can
check criteria and listed read-only commands.

Close with `FINAL_APPROVED` or `SELF_VERIFIED` only when required evidence is
complete. Follow section 5 for unavailable coverage and blockers.

## 7. Reports

Directory: `<project-root>/.orca-pod/reports/<planVersion>/` — in the project, not in
the skill folder. `.orca-pod/` is added to the project's `.gitignore` if there is
one, and is not part of patch snapshots, changed-file lists and the `git status`
check. Reports are immutable: a new attempt is a new file. The Reviewer and the Chief
Reviewer write review reports; in `self` mode the Implementer writes self-check
reports.

| File | Who |
| --- | --- |
| `<stage>-attempt<N>.md` | Reviewer: the round verdict (`<stage>` = `all` for a plan without stages) |
| `<stage>-attempt<N>.patch`, `.delta` | Reviewer: the snapshot and the diff between rounds |
| `chief-attempt<N>.md` | Chief Reviewer (`full` mode) |
| `final-attempt<N>.md` | the only reviewer — the final check (`reviewer`/`chief` modes) |
| `self-check-<stage>-attempt<N>.md` | Implementer — self-check, registry `S<n>` (`self` mode) |

Report template (compact, no retelling of code):

```markdown
# Review <stage> — attempt <N>
- planVersion: <v>; stage: <stage>; attempt: <N>/<limit>; date: <YYYY-MM-DD>
- Verdict: APPROVED | CHANGES_REQUESTED | PLAN_REVISION_REQUIRED | BLOCKED
- Lanes: <name → slice → result>; degradations: <none | what is unavailable>

## New findings of this round
<section 2 format; only genuinely new ones>

## Registry
| id | category | TODO | path | status | summary |

## Checks
| Owner | Tool/version | Scope | Checked | Unsupported | Freshness | Duration | Outcome/reason |
| --- | --- | --- | --- | --- | --- | --- | --- |
<For each planned check: attempt, exact command, required/optional, retry and fallback if used. Mark unchecked coverage explicitly.>
```

The template above is a stage report. The value of `Verdict:` is exactly one
token, with no explanations (those go in the prose below); the tokens depend on
the report type:

- `<stage>-attempt<N>.md` — `APPROVED | CHANGES_REQUESTED | PLAN_REVISION_REQUIRED | BLOCKED`;
- `chief-attempt<N>.md`, `final-attempt<N>.md` — `FINAL_APPROVED | CHANGES_REQUESTED | PLAN_REVISION_REQUIRED | BLOCKED | COMPLETED_UNVERIFIED`;
- `self-check-<stage>-attempt<N>.md` — `SELF_VERIFIED | CHANGES_REQUESTED | BLOCKED | COMPLETED_UNVERIFIED` (id `S<n>` instead of `R<n>`).

The rest of the chief/final and self-check reports uses the same template.

The template labels — headings, `planVersion`, `Verdict:`, registry columns, the
finding-format fields (`scenario`, `probability`, `impact`, `criterion`, `fix`,
`confidence`), ids `R<n>`/`C<n>`/`S<n>`, categories and statuses — are always in
English, under any `LANGUAGE` (SKILL.md, "Language: LANGUAGE"). Only prose is
written in `LANGUAGE`: finding descriptions, `summary` cells, the `Checks`
section.

`test-sandbox.mjs check` does not rely on words of the report's language. It takes
the verdict from the `Verdict:` line (`- `, `1. `, `### `, `**…**` are accepted;
the value is exactly one verdict token, otherwise there is no verdict). The caught
test defect is detected by the finding line: id `R<n>` and category
`BLOCKER`/`MAJOR`, `chunk` and `AC-C2` (or `2.5`, `integer`) in one finding line
or in its indented lines (the section 2 format). `chunk` and `2.5` in the
`Checks` section or in prose outside a finding do not count.

## 8. Lane task template

```text
You are review-lane <name> reviewing <stage> attempt <N> (plan <v>). Read-only.
Protocol: <abs path review-protocol.md>, sections 1–2 (and 4 for a repeat round).
Slice: <TODO-ID/files/seam>; patch: <abs path>; delta: <abs path | none>.
Criteria: <AC of the chosen TODOs verbatim or plan path+section>.
Ids to verify: <registry excerpt | none>.
LANGUAGE: <tag>
Do not review outside the slice. Return findings in the section 2 format with draft ids
L<lane>-<n> (in registry check mode — a verdict for every id) and a "Checked: …" line.
No more than ~40 lines. Do not edit files, do not run build/test, do not spawn agents.
```

A lane does not issue APPROVED. A stale result (another attempt) is not applied.
