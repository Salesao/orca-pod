<p align="right"><b>English</b> · <a href="README.ru.md">Русский</a></p>

<h1 align="center"><img src="../../assets/skill-plan-blitz.svg" alt="plan-blitz"></h1>

`plan-blitz` is an agent skill that walks you through a spec or an implementation plan before you approve it, so you
can decide without reading the whole document. It goes by the document only: it does not check your project, and it
is not a quality review. A blitz has four steps:

1. **Overview.** First a line with the document's path, so you can open it and check any card against it; then a
   short summary of what will happen. For a plan it comes with a map of the tasks: what each one does, what it waits
   for, whether it runs in parallel and how it is checked.
2. **Questions**, only where there is a real choice. Each comes with a card: the Situation (what is there now), the
   Proposal (the decision and what you get), the Cost (what you will notice) and, when there is a real alternative,
   Otherwise (that alternative and its cost). The first option is the proposal, marked "(proposed)"; "Explain
   simpler" comes last (a question asked again does not offer it) and explains the question in chat on an everyday
   example; you can also type your own answer.
   For a plan, every place where it changes the spec or adds something you will see is a question too. The wording
   is plain, without code or technical terms, and in your language. When there is no real choice, the blitz says so
   in one line and goes straight to the approval.
3. **More rounds.** Answers that change something are written into the document, and a blitz log at its end gets a
   line per round: what was asked and what changed. The next round asks only about what is still open, new or
   changed by an answer; a round holds at most 8 questions.
4. **Approval.** When nothing is open, the blitz lists the document's path and the decisions it made without asking,
   each with its cost, and asks you to approve: Approve, Read it in full first or, if there were questions, Back to a question (give its
   number), which reopens it for another round. The blitz prepares the approval and does not replace it.

You can run it yourself on a spec or plan file. In an [orca-pod](../orca-pod/README.md) run, the Planner (the role
that writes the spec and the plan) runs it on its own before the spec is approved, before the plan is approved and
again for a plan revision, where it covers only what changed.

| Agent | Command |
| --- | --- |
| Claude Code | `/plan-blitz <path to the spec or plan>` |
| Codex | `$plan-blitz <path>` |
| Pi | `/skill:plan-blitz <path>` |

Codex prefers `request_user_input` in Plan and `request_user_input_async` outside Plan. The agent waits for your actual reply. Pi uses the standalone package's `pi_task`, then an installed `orca_pod_ask`. Claude Code and Qoder can use `AskUserQuestion`, and OMP can use `ask`. When no permitted question window is available, use numbered text.

For Pi, orca-pod installation and setup ensure the required published pi-task package. To use plan-blitz
independently, run `pi install npm:pi-task`, then `/reload` in Pi. Installation errors must be reported explicitly.

Compare the plan with approved upstream documents. An answer that revises an approved outcome is saved in the upstream document and plan and approved once for both versions.

The rules are in [SKILL.md](SKILL.md). For installation, see the [repository README](../../README.md).
