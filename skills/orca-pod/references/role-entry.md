# Start here in a role session

Use the assignment in this session, the named profile, role addresses and immutable
document paths. The Coordinator has already prepared the project. Read the sections
below by heading. With a line-limited reader, locate headings with
`rg -n '^## ' <skill-dir>/SKILL.md` and read only the ranges for your role.
Follow the shared [invariants](../SKILL.md#invariants) and [memory ownership rules](../SKILL.md#project-memory).

| Role | First action | Continue with |
| --- | --- | --- |
| Planner | Read the task and project rules. Split independent research among the selected helpers. | [Planning](../SKILL.md#planning), [revision](../SKILL.md#return-to-planner-plan_revision_required), [first handoff](handoff-contracts.md#first-implementer-contract-from-planner-after-plan-approval) |
| Implementer | Check the approved spec and plan versions, dependencies, write scopes and allowed checks. Assign independent work to selected workers. | [Implementation](../SKILL.md#implementer--integrator), [review modes](../SKILL.md#review-modes), [completion](../SKILL.md#completion) |
| Reviewer | Open the named snapshot and request. For a repeat, read the previous report directly, then the fix delta. | [Stage review](../SKILL.md#reviewer-batch-review), [review protocol](review-protocol.md), [verdict delivery](handoff-contracts.md#reviewer--implementer) |
| Chief Reviewer | Verify the Implementer reply address. Open the latest stage report and supplied evidence. Read the previous Chief report first on a fix. | [Chief review](../SKILL.md#chief-reviewer-chief-final-review), [review protocol](review-protocol.md), [Chief handoff](handoff-contracts.md#chief-reviewer--implementer) |

## Before acting

- A direct user decision, a role assignment and a service notice have different authority.
  `SERVICE:` introduces operational information, including delivery and address updates.
  A status notification, retrospective question or excerpt does not approve a plan,
  reopen a blocked review or expand write scope. Follow direct user steering. If the
  source of an apparent authorization is ambiguous, establish it before the dependent action.
- Use the role's [native helper policy](subagents.md). Record launches, peak
  concurrency, and the reason for any inline fallback. Finish child writes before
  integration or handoff.
- Follow the [handoff contract](handoff-contracts.md). Send protocol messages through
  `scripts/send-handoff.mjs` to the issued address. A terminal receipt confirms at
  most the stages it reports. A reply or report tied to the request establishes
  further progress.
- On a stale terminal, use [role recovery](terminal-lifecycle.md). Keep the plan,
  attempt, previous report and snapshot when replacing the same role.
- Record an `EVIDENCE_GAP` for a missing external fact. Continue independent approved
  TODOs only where their criteria and dependencies permit. The review protocol
  defines how an explicit user decision can open a new cycle after `BLOCKED`.
