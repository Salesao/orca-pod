# Changelog

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
