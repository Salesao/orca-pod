# Provider compatibility, 2026-11-11

Form-defined helpers store a one-line `description` and multiline `instructions`
in the project YAML. Codex materializes a temporary TOML, Claude Code/Qoder use
session `--agents`, Pi registers the definition through the existing runtime
extension, and OMP loads an ephemeral `--extension` root containing `agents/`.
An installed OMP 18.18.7 smoke discovered that root and its custom description;
one native child selected by its session-specific name returned a token present
only in its configured instructions (`CUSTOM_ROLE_OK_72A9`). The first attempt
omitted the native selector and was blocked by the specialization guard; the
explicit selector succeeded. Adapter tests cover all five providers. This
follow-up did not repeat live child requests in the other four providers.

The launcher resolves model, effort, effective helper selection and access per
role. An installed executable alone does not establish runtime authorization.
Catalog reads do not submit prompts.

| Provider | Installed versions exercised | Catalog and reasoning | Launch and delegation | Questions |
| --- | --- | --- | --- | --- |
| Codex | 0.166.0 | `codex debug models`, with the existing cache fallback | Coordinator role reported Full Access. Disabled roles use `--disable multi_agent`. Configured definitions carry model and effort, and max depth is 1. Built-ins can remain visible in enabled sessions. | Real Plan `request_user_input` returned Beta in Orca. |
| Pi | 1.4.0, pi-subagents 0.81.0 | Session registry or `pi --list-models` plus RPC metadata | Pi uses host permissions. Native foreground delegation uses the parent's provider registry, with ambient extensions excluded. The guard removes known delegation tools and blocks their calls when disabled. | Installed standalone `pi_task` accepted Beta, free text, Esc and coexisted with legacy `orca_pod_ask`. |
| Claude Code | 2.1.322 help | Existing alias/Anthropic catalog and documented effort flags | Verified flags in CLI help and exercised command construction. `--agents` receives only selected definitions. `--disallowed-tools Agent` disables Agent. Additional host agents may remain visible in enabled sessions. | `AskUserQuestion` is the documented window. No live Claude Code question or child was needed for the new-provider integration tests. |
| Qoder | 1.1.81 initial terminal, 1.1.86 subsequent probe | `qodercli --list-models`; 1.1.81 returned names with IDs and 1.1.86 returned bare names; neither listing exposes per-model effort levels, so the launcher uses `default` | Interactive Reviewer reached YOLO after the operator confirmed folder trust. Native `scout` completed one bounded test. Selected definitions use `--agents`; the adapter denies discovered unselected Agent names. | Native `AskUserQuestion` returned Beta and Delta on repeat. |
| OMP | 18.18.7 | `omp models --json` supplies exact selectors and optional thinking arrays. `default` omits the thinking flag. | `--approval-mode=yolo`, a session-local policy extension and native `task`. A selected `orca-scout` and a separately configured singleton `custom-smoke` each completed a bounded test from native project definitions. | Interactive `ask` returned Beta in its tool result. |

Pi's isolated test used an extension-registered provider named
`arbitrary-smoke-provider` backed by a loopback fixture. The actual child
request used the configured model and had only the selected `read` tool. The
parent retained the Lens fixture tool. With delegation disabled the parent
request had neither the native delegation tool nor the role's helper tool.
The fixture sent no external model request. Provider extensions that require
their own child session hooks may fail the first compatibility check. Such a
route is handled inline without further fan-out. Actual Lens CLI options are
detected from installed help. Other automatic behavior depends on local
extensions and remains outside the launcher’s control.

The Codex adapter uses Orca TUI readiness, `/plan`, fresh `/status` output after its read cursor, and the matching rendered screen.
The same session accepts raw Shift+Tab to reach Default. The bounded save
checks exact expected hashes, writes the named Markdown files, verifies the
bytes, re-enters Plan and only then delivers the continuation. The smoke used
a disposable Orca worktree. `/status` showed Full Access and the selected
GPT-6.1 Terra high in Plan. The approved session-local Stop hook received the Planner’s final Plan response, saved the named file through Default, and delivered the continuation after returning to Plan. The Planner made no tool call to request the save. Only the specific hook was trusted for the smoke.
Workspace trust or a host control failure blocks delivery. The adapter never
selects the Codex action that starts implementation.

The Qoder sandbox with an empty config directory displayed the expected sign-in
screen. The successful authenticated Qoder probe used only the disposable
worktree and the operator-approved trust prompt. The first OMP tool-list
experiment showed that help lists tools unavailable in some configurations.
The OMP guard removes `task` through the session registry and blocks unselected
native spawns. The final setup discovery returned 11 Qoder models and 18 OMP models. No provider package or account was installed or reconfigured for the project.

Primary references: [Codex commands](https://learn.chatgpt.com/docs/developer-commands?surface=cli),
[Codex 0.166 configuration schema](https://github.com/openai/codex/blob/rust-v0.166.0/codex-rs/core/config.schema.json),
[Pi extensions](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md),
[pi-subagents extension API](https://github.com/nicobailon/pi-subagents/blob/main/docs/extension-api.md),
[Qoder CLI](https://docs.qoder.com/cli/cli-reference),
[Qoder native agents](https://docs.qoder.com/cli/subagent),
[OMP CLI](https://github.com/can1357/oh-my-pi/blob/main/docs/cli-reference.md),
[OMP task agents](https://github.com/can1357/oh-my-pi/blob/main/docs/task-agent-discovery.md).
