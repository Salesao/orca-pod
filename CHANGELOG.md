# Changelog

## 0.2.1 - 2026-10-21

### Fixed

- **The Implementer no longer reviews its own code when there are reviewers.** In the `full`, `reviewer` and
  `chief` modes it could audit a finished stage with `verifier` subagents before the review request, which
  duplicated the review and delayed it. Now it runs only the plan's checks and sends one review request; the
  `verifier` self-check is only for the `self` mode, and a Codex Implementer gets `orca_verifier` only in that mode.

## 0.2.0 - 2026-10-19

### Fixed

- **`orca-pod-setup` with Pi before 0.74.** The Pi extension failed to load with
  `Cannot find module '@earendil-works/pi-ai'`: Pi 0.73 and older name their packages `@mariozechner/*`. The
  extension now loads each Pi package by either name, the question window works without `ctx.mode`, and the model
  catalogs read the old Pi too (its model list on stderr, the RPC without `--no-mcp`, the built-in Anthropic
  catalog without `ModelRuntime`).
- **Model catalogs when an agent's CLI is not on `PATH`.** The setup form and the launcher also look in the usual
  install folders (`~/.local/bin`, `~/.claude/local`, the running `node`'s folder, nvm, Volta, Bun, pnpm,
  Homebrew) and run the CLI by its absolute path; `ORCA_POD_BIN_DIRS` replaces that list.
- **Clear reasons in the `CATALOG` lines.** A crashed Pi reported only `Node.js v24…`; the line now names the error,
  and a sandbox refusal says to run the form with elevated permissions. A refused local port says the same.
- **Codex runs the setup scripts with elevated permissions from the first call** instead of failing in the sandbox
  first.

### Changed

- **Git is optional for the project.** Without a Git repository the config and the reports live in the project
  folder (the current folder, or its nearest parent with `.orca-pod/`), setup skips the `.gitignore` step, and the
  review reads the changed files from the Implementer's list instead of a diff. Git is still needed by the
  installer and by test mode.
- **The spec and the plan are easy to find.** The Planner prints `SPEC WRITTEN:` and `PLAN WRITTEN:` with the
  absolute path. `plan-blitz` opens with the document's path, shows it again at the approval, keeps a blitz log at
  the end of the document, says so in one line when there are no forks, and checks everything a plan adds to the
  spec before deciding there are no deviations.

## 0.1.0 - 2026-10-18

First public release: agent skills for [Orca](https://www.onorca.dev) that run one coding task through a team of AI
agents. They work with Claude Code, Codex and Pi.

### Added

- **`orca-pod`** runs a task through Planner, Implementer, and optional Reviewer and Chief Reviewer roles, each in its
  own Orca terminal with its own agent, model and thinking level. Independent steps run in parallel through helper
  subagents. The run ends with `FINAL_APPROVED`, `SELF_VERIFIED` or `BLOCKED`. A built-in test mode runs the whole flow
  on a demo task in a sandbox.
- **`orca-pod-setup`** writes the project's `.orca-pod/orca-pod.yaml` (profiles, roles, subagents) through a browser
  form in English or Russian.
- **`plan-blitz`** walks you through a spec or a plan before you approve it, with multiple-choice questions only where
  there is a real choice.
- README in English and Russian, with a logo, a pipeline diagram and a banner for each skill.
- Tests for the skills, the READMEs (including English and Russian parity) and the repository language rule.
