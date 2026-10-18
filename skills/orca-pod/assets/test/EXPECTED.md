# What should happen in a test run

Sandbox: `~/orca-pod-test` (a git repository with a baseline commit).
Review reports: `~/orca-pod-test/.orca-pod/reports/<planVersion>/` (inside the sandbox).
Result check: `/orca-pod test check`.

| Step | Role | Expected | Where to look |
| --- | --- | --- | --- |
| 1 | Coordinator | a profile question if the config has several (one line per profile); `PIPELINE CONFIG RESOLVED` with the selected profile and the subagent limit, the role terminals in the sandbox, `PLANNER DISPATCHED — COORDINATOR EXITING` | the terminal where `test` was invoked |
| 2 | Planner | parallel scouts; spec and plan in the sandbox's `docs/superpowers/`; TODO A (truncate), B (duration), C (chunk) — wave 1; D (report) — wave 2 (`dependsOn` A, B); `src/index.js` — an `integration` item; one stage `all`; `verificationChecks: node --test`; `tests: requested` (TASK.md item 6). Before each approval runs plan-blitz (a round of multiple-choice questions over the spec, then over the plan, and an approval window) — answer the questions, then approve | the Planner terminal |
| 3 | Implementer | wave 1 — three workers in parallel, wave 2 — a worker or inline, integration of `index.js`, `node --test`, **one** `REVIEW_REQUEST [stage=all, attempt=1]` | the Implementer terminal |
| 4 | Reviewer | parallel lanes (A, B, C, D + integration; in Pi also lens-checker); `all-attempt1.md` with the registry; `CHANGES_REQUESTED` with a blocking `R<n>` about a non-integer `size` in `chunk` (AC-C2) | the Reviewer terminal, `all-attempt1.md` |
| 5 | Implementer | fixes only the blocking ids; `REVIEW_REQUEST [attempt=2]` with `R<n> — FIXED` | the Implementer terminal |
| 6 | Reviewer | registry check mode: `R<n>` → `CLOSED`, only the delta is checked, no new findings outside the delta (except a `missed-earlier` BLOCKER); `APPROVED`; `FINAL_READY` → Chief | `all-attempt2.md`, `all-attempt2.delta` |
| 7 | Chief Reviewer | lanes by area + evidence-auditor; `chief-attempt1.md`; `FINAL_APPROVED` (or `C<n>` → CHIEF_FIX → attempt 2) | the Chief terminal, `chief-attempt*.md` |
| 8 | Implementer | the final report: waves and delegation, checks, review rounds, a line about the test defect | the Implementer terminal |

The table above is the `full` mode (Reviewer + Chief Reviewer). The mode is taken from
the sandbox's `.orca-pod/orca-pod.yaml`:

- `reviewer` / `chief` — steps 4–6 are performed by the single reviewer, step 7 is the same
  reviewer: the final check over all the code, the report `final-attempt<N>.md`, `FINAL_APPROVED`.
- `self` — there are no reviewers and no test defect. After the waves the Implementer assigns
  the self-check to the `verifier` subagent (with `use_subagents: true`): pi-lens in Pi,
  `node --check` and `node --test` from the plan, the AC-* check; findings `S<n>`, the report
  `self-check-all-attempt<N>.md` and the verdict `SELF_VERIFIED` from the Implementer. The final report states explicitly that there was
  no independent review.

Roles on Codex: on the first launch in the sandbox Codex asks whether to trust the folder
(`terminal wait` → `blockedReason: agent-trust-workspace`) — the user answers in the
role's terminal, the Coordinator repeats wait. Codex helpers are `orca_*` with the models from the
profile; on hitting the `agent thread limit reached` limit the role waits and repeats the spawn.

Signs of problems that the test should reveal:

- on attempt 2 the Reviewer opens new MAJOR/MINOR findings on code outside the delta — the
  registry check mode is violated;
- more than 3 review attempts without `BLOCKED` — the round limit does not work;
- a REVIEW_REQUEST per TODO separately — the Implementer does not assemble a batch;
- the workers of wave 1 are launched sequentially — there is no parallelism;
- the plan has no `tests:` line or says `not requested` although TASK.md asks for tests — the
  tests rule is not applied;
- a role waits for its children with `sleep` or polls `status` between waves — the waiting
  rule is not applied;
- the Reviewer reads the whole diff itself while lanes are available — a waste of context;
- the defect in `chunk` is not caught — weak review against the acceptance criteria.
