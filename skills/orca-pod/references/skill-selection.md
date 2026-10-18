# Coordinator skill selection: ask the user first

The Coordinator performs this stage after `launch-provider.mjs --profiles`, before
resolving the selected profile and before bootstrap. If there are several valid
profiles, the skill question is asked in the same AskUserQuestion as the profile
question (SKILL.md, "Profile selection"). `orca-pod-setup` configures only the
YAML and does not choose additional skills.

## 1. The required Planner skill

The Planner **always** uses `/skill:using-superpowers` before planning, even if
the user did not name it or declined additional skills. In the first handoff,
pass its name and the readable absolute path to its `SKILL.md` separately from
the additional set. If the short command is unavailable, read the skill from that
path; if the source itself is unavailable, report the problem and do not call the
skill done. For other providers, their native way of invoking the same skill
applies:

| Provider | Invocation | Superpowers names |
| --- | --- | --- |
| pi | `/skill:<name>` | `using-superpowers`, `$superpowers:brainstorming`, `$superpowers:writing-plans` |
| claude-code | the `Skill` tool with a name | `using-superpowers`, `brainstorming`, `writing-plans` (links in `~/.claude/skills/`) |
| codex | `$<name>` | `$superpowers:using-superpowers`, `$superpowers:brainstorming`, `$superpowers:writing-plans` (the Codex superpowers plugin) |

The Planner also **always** uses `plan-blitz` before each approval (spec, plan,
revision): Pi — `/skill:plan-blitz`, Claude Code — `Skill plan-blitz`, Codex —
`$plan-blitz`. Pass the readable absolute path
`<real path of the orca-pod skill dir>/../plan-blitz/SKILL.md`, or `not installed`
when there is no such file; the Planner then warns the user in one line and asks
for approval in plain text.

The skill catalog differs between roles on different providers: for a Claude Code
role pass names from `~/.claude/skills/` (and the project's `.claude/skills/`),
for Pi — from the Pi catalog, for Codex — from `~/.codex/skills/`,
`~/.agents/skills/` and Codex plugins; a common readable path to SKILL.md works
for all.
The mandatory stages of the pipeline itself (brainstorming, writing-plans, etc.)
are kept; this is not a reason to add domain-specific skills automatically.

## 2. First, one simple question

If the user has not yet given a set and has not asked for automatic selection, ask
in the Coordinator's visible terminal **before collecting the catalog and
researching the project** (in Claude Code — with one AskUserQuestion with the
options "not needed" / "pick for me" and a free answer through "Other"):

> Which additional skills should be used for Planner, Implementer, Reviewer
> and Chief Reviewer? You can list them per role, say "not needed", or
> "I don't know — pick for me". `using-superpowers` and `plan-blitz` are mandatory for Planner and stay in any case.

The answer determines what happens next:

- **Names per role** — use the specified sets, do not add your own
  recommendations. A role that is not named stays without additional skills.
  Clarify only an ambiguous name/purpose; find the exact readable source of the
  chosen skill.
- **"Not needed", "no skills", "add nothing"** — the additional sets are empty.
  Do not collect a catalog, do not pick a hidden "recommended minimum" and do not
  repeat the question. The mandatory using-superpowers of the Planner and the
  pipeline stay.
- **"I don't know", "pick for me"** — an instruction for the Coordinator to pick
  by the task and stack; go to step 3. If this was said for one role only, pick
  only for it.

A complete selection that has already been passed, or an explicit instruction to
pick on your own, does not require asking again. Silence is not an answer.

## 3. Automatic selection: only the task, the stack and the catalog

In this branch, read the task source and the applicable project instructions.
Determine the main stack from as few manifests as possible, without researching the
implementation:

- `pubspec.yaml` with Flutter → Flutter/Dart;
- `package.json` with react-native/expo → React Native/Expo;
- `package.json` with next → Next.js/React;
- for another stack — its main manifest and the necessary indicators.

In a monorepo the root manifest and the manifest of the app explicitly named in
the task are enough. Stop when the stack is clear. Do not read `src/`, dependency
graphs, Git history, architecture reports or unrelated configs for the sake of
choosing skills. Do not run the app, tests/lint/typecheck/build, probes or
subagents. If the stack or the task is not enough, briefly state the uncertainty;
do not replace it with deep research. Without a task, do not invent a
domain-specific selection.

Collect the **whole available catalog of names, descriptions and sources** of the
agent's skills, including applicable user, project and package skills. Do not
limit yourself to a few familiar names. For different providers, take into account
their available catalogs and readable sources, using only a documented read-only
method. The Coordinator's catalog does not prove that the same tools exist in
another role. Do not launch a role/child to discover the catalog and do not
install new packages.

Filter the catalog by **task + confirmed stack + role**. Read the full `SKILL.md`
only for a short list of candidates, to rule out incompatibility. "Collect all
available" means obtaining the catalog, not attaching or reading all the skills.
Choose a small useful set; an empty set is also fine:

- Planner — requirements/design, if the task needs it;
- Implementer — implementing the needed behavior on the confirmed stack;
- Reviewer — independent read-only batch review, without the right to change files or run a matrix;
- Chief Reviewer — read-only final-assessment skills compatible with its chief review.

Do not assign a skill merely because a dependency is present or a name matches.
Skills do not extend the permissions to write, to run checks, to perform Git
operations or to take external actions. When helpers are off, do not add skills that require delegation. Unknown
tool availability is a reason not to include a candidate automatically, not a new
bootstrap blocker.

Briefly show the stack and a "role → skill → why" table. The answer "I don't
know/pick for me" has already delegated the choice: there is no second mandatory
question about accepting the recommendations. If the user asked to agree on the
recommendations first, wait for the agreement.

## 4. Pass the choice to the roles

Pass the names and exact readable sources of the additional skills per role,
including explicit empty sets. State the mandatory `using-superpowers` of the
Planner separately, regardless of the chosen additional list. Do not add skills
"just in case" when passing. The helpers mechanism with use_subagents=true
remains part of the workflow, not something imposed by the additional selection.

Pass the task/stack context and the agreed requirements separately;
keep `TASK DESCRIPTION` verbatim. The Planner researches the project on its own,
saves the set and sources in the plan and passes them to Implementer/Reviewer in
the first full handoff. Do not change the agreed set silently in later revisions.
