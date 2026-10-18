---
name: plan-blitz
description: Use when a user is about to approve a written spec or implementation plan (after superpowers brainstorming or writing-plans, or as the orca-pod Planner) — gives a short overview, then asks multiple-choice questions only about the real choices in it, each with a Situation/Proposal/Cost card inside the question window, so they understand what will happen without reading the whole document.
---

# Plan blitz

A spec or a plan is long and dense, and a plan makes its own decisions on top of the spec. A blitz is a
short walk through the document before the user approves it: an overview of what will happen and in what
order, then multiple-choice questions about the real choices, each with the context needed to answer it.
Ask only where the answer changes the result; everything else is the overview and your own calls, listed
at the approval. The blitz prepares the approval; it does not replace it.

Input: the path to the document (a spec or a plan). The blitz goes by the document only: it does not check
the project. A plan whose steps are all marked done: say so and ask whether to run the blitz anyway. The
blitz is not a quality review: the self-review of brainstorming and writing-plans stays. Never re-ask a
decision the user made themselves.

## Hard rules

1. **Words.** No code, paths, function names, types or signatures in cards and questions, and no technical
   words either: no file formats, syntax, contracts, static analysis, coordinates or test runners; say what
   the user will see or get. Substitutions: a sample of data becomes an example in words ("the number 5
   written as text"); a service is named by its role ("the service that delivers notifications to
   phones"), not by its brand; units become what the user sees ("about two thousand letters", not "2048
   bytes"); field and key names never appear, even in quotes; a label the user sees on the screen may be
   quoted once, with what it does. The same rules apply to the overview, the explanations and the lists at
   the approval.
2. **Language.** Talk in the user's language (under orca-pod, the `LANGUAGE:` line of your first prompt);
   the English examples here are translated, not copied. The card labels and the "(proposed)" marker are in
   the user's language from the first card, the same words for the whole blitz; ignore the tool's
   "(Recommended)".
3. **Address.** Address the user the way they write to you; when it is unclear, the polite form; one form
   for the whole blitz.
4. **Overview.** At most 120 plain words, printed before the first window, without a number; the
   questions are numbered from 1.
5. **Windows.** Plain text inside a window; at most 4 questions per window and 8 questions per round; a
   fork is never decided by you; numbered text when there is no window.

## The card

Every question has a card: the context the user needs to answer it without the document. It starts from
the situation, not from the solution:

- **Situation** — what is there now and what the problem is; what happens if nothing is decided.
- **Proposal** — the decision and what the user gets from it.
- **Cost** — what we pay for it.
- **Otherwise** — each real alternative and its cost, when there was one.

Situation, Proposal and Cost are always there, each on its own line; the Cost is never merged into the
Proposal. The Situation is at most two sentences about what is there now. The Cost is what the user will
notice, not a bare count ("pages load a second slower", not "96 records a day"). Otherwise names the
strong side of the alternative too, and the costs of all options are equally concrete.

A term from the document is glossed in every card where it appears, including a re-ask, in brackets ("the
bundle (the archive of server code the app sends to the server)"); never code names: no functions, types,
files or flags; when an item is about a specific field or setting, name it by its meaning first ("the
device code field"). Translate the labels once, into the user's language, and keep the same words for the
whole blitz. An alternative that cannot be done now (the project, its interfaces or an earlier decision of
the user rule it out) is not a real alternative: say so in the Situation instead of offering it. If the
situation or the cost cannot be said simply, the item itself is unclear: fix the document first.

Where the card goes depends on the agent (see "Question tools"): inside the window when the tool can show
it, otherwise printed right before the window. Text inside a window is plain: no markdown, no `**`, no
backticks, no headings; the labels are plain words at the start of a line. Windows show markdown as
literal characters.

Example, as it appears in the window (a spec for a server update; the labels and the marker go into the
user's language):

```text
3 · Rollback
Situation: an update replaces the server program and then changes the database structure. If it fails
halfway, the old program does not start on the new structure and the server stays down.
Proposal: copy the database before the program is replaced; on a failure, restore the copy and the old
program.
Cost: what other devices write during the few seconds of the check is lost.
Otherwise: roll back only the program: no writes are lost, but the server may not start.

If the update fails halfway, what should happen to the database?
  Restore the copy (proposed): the server comes back as before the update; seconds of writes from other
    devices are lost.
  Roll back only the program: no writes are lost; the old program may not start on the new structure.
  Explain simpler
```

## The question

One sentence, clear without the card: it names the object and what is at stake ("If the update fails
halfway, what should happen to the database?"). No "such", "it" or "this way" pointing at the card. Ask
about the matter, not about your opinion: leading or vague questions are forbidden ("Correct?", "Agree?",
"How do you like it?" and their translations), and never "Keep it?" for a decision: the options name the
outcomes.

Options:

- The proposed option first, marked "(proposed)" in the user's language, not "(Recommended)"; then the
  real alternatives; "Explain simpler" last. Add it yourself in every tool: no tool adds it. It is left out
  only for an item that was already explained (its re-ask) and in the approval window.
- The label is the outcome in 2–6 words; the description says what happens and its cost, at equal depth
  for every option. Parallel labels, no negated labels ("Compress to 512 pixels" / "Keep the full size",
  not "Do not compress").
- Every option, the proposed one included, states its gain first, then its cost, in terms the user
  notices; no unmeasurable costs ("there is a risk", "more work", "later", "longer"): say what happens and
  how much. A label never
  contradicts its description: an option that keeps a hidden limit says so in its label.
- When a cheap safeguard exists (an undo for a few seconds, a confirmation, a reversible default), offer it
  as an option instead of leaving the user to invent it.
- The user's own answer goes through the tool's free-answer field ("Type something." / Other); never add
  it as an option.

When one question depends on the answer to another, ask them in separate windows, the deciding one first.
A card never cites an item that has not been asked yet.

The tab header is at most 12 characters, the number and the space included, and starts with the item
number: `2 Scope`, `3 Rollback`.

## What to ask

Ask only forks: places where the answer changes the result. Before the first question, read the whole
document and list every fork; ask from that list only, and a fork noticed later goes to the next round. Do
not ask about what is cheap to change later or already decided in an approved document: list it as your
own call with its cost. Cheap means one edit undoes it with no loss of data, settings, access, money or
messages, and nothing the user sees changes; anything that can lose data, block someone or change what a
user sees, in behavior or look (icons, the text and timing of hints, where a button sits), is a question
(past the round's limit, the top of the approval list). A gap the document leaves open: with one reasonable
answer, fill it in the rewrite and list it as your own call; with two or more, it is a question, and its
card says the document does not decide it. Never state a guess as the Situation. Never ask the user to
type names, lists or values in a window: offer the candidates the document gives; if there are none,
one free-answer question for that item, and anything further goes to chat.

Spec:

1. **Overview** — printed before the first window, no question, at most 120 plain words: the situation,
   the outcome, what is deliberately left out, and the risks without a choice.
2. **Scope** — a question only when something was deliberately left out: "What goes into this part?" with
   the sets as options, the proposed set first ("Update by button with rollback (proposed)" / "Also choose
   the version to roll back to").
3. **Decisions** — one item per decision you made without the user that had a real alternative. Tell them
   apart by the document's markings ("my call" / "user") and the conversation; in a document with no
   markings, every non-obvious decision is a candidate.
4. **Risks** — a question only when there is a choice of measure; otherwise they are part of the overview.

Plan (after the spec is approved):

1. **Map** — printed before the first window (in text mode too, before the first card) as a list, one
   line per task and never a range of tasks on one line, at most 15 words each: what it does, what it
   waits for, whether it runs in parallel, how it is checked; where review happens. The map is outside the
   overview's 120 words. A question about the order only when it is a real choice (in sequence or in
   parallel).
   ```
   Wave 1 ─ server script ──┐
          └ app archive     ┴─ Wave 2 ─ app logic ─ screen ─ review
   ```
2. There is no question per task: a task without a choice is part of the map.
3. **Deviations** — every place where the plan changes the spec, with options named by their outcome
   ("Placeholders only (proposed)" / "Show the ready preview when there is one"), and every plan decision
   with a real alternative. A refinement that only adds detail goes to the list at the approval.

Your own calls that get no question (no real alternative, cheap if wrong, or already decided) are listed
at the approval. No fork at all: the overview, then the approval window.

Length: one window holds 1–4 questions; one round asks at most 8 questions (two windows in Claude Code and
Pi; one question per window in Codex). Questions that come back count toward the round's limit. With more
forks, the most expensive-if-wrong get the questions and the rest go to the list at the approval. A small
document gets fewer questions; never pad. The final approval window does not count.

## Rounds

```
Round 1: every fork (at most 8 questions)
   │  the proposed option or the alternative → decided, not asked again
   │  an own answer to clarify, "Explain simpler" → open
   ▼
rewrite the document by all answers of the round at once
   ▼
Round 2: open items + new items + approved items whose substance changed
   ▼  … until nothing is open
the approval window
```

What to do on each event:

- The proposed option: decided, not asked again.
- The alternative: decided at once. Do not argue; apply it in the rewrite, show it under "what changed" at
  the approval and never ask it again. The item stays open only when the rewrite needs one more choice.
- An own answer: when it is clear, it is decided like the alternative; when it is not, the item stays open
  and gets one clarifying question. An own answer that asks a question ("which is safer?") gets the facts
  of every option and one everyday example in chat, with no preference, then the item comes back next
  round.
- "Explain simpler": explain at once, in chat, on a concrete everyday example (a short story with people,
  things and numbers, not the card in other words). The question comes back in the next round (alone, if
  nothing else is open) with the same card, which keeps the Situation as what is there now, plus one added
  sentence of that example (at most 25 words); nothing else in the card is rewritten, and the options may
  be reworded but keep their meaning. The re-asked question has no "Explain simpler" option: the explanation was already
  given; if it is still unclear, the user says so in the own answer.
- A window closed without an answer (Esc, a declined window): in Claude Code this ends your turn. On the
  user's next message, ask in plain text whether to continue the blitz or approve it as it stands, listing
  the open items; open windows again only when they choose to continue. A message that clearly says to
  continue opens the windows at once.
- An empty answer (the window closed by itself, as Codex does after a few minutes) is neither a cancel nor
  a decision: ask once more with the same tool, then as text with numbered options. After asking, do
  nothing else and end the turn until the answer comes; never decide a fork yourself.
- An approved item whose substance changed because of a rewrite for another answer: it comes back as a new
  item, marked "changed because of the answer to 3 Rollback"; the mark goes into the card itself, at the
  start of the Situation, every time the item comes back changed, a reopened one included. Otherwise an
  approved item is not asked again. Items that the rewrite added go to the next round. A card that comes
  back never offers an option that its own Situation rules out.
- An item still open after 3 rounds: offer to talk it through in chat instead of another round; an answer
  given there closes the item like an answer in the window.

Rewrite the document after each round, by all its answers at once. Items keep their number for the whole
blitz; new items take the next free number, so "3 Rollback" is the same item in every round. Keep the item
statuses (approved / open / new) in your context; write no service files.

## Approval

When nothing is open: print the full list again before every approval window, repeats included, and never
"see above"; then a separate window with one question, "Do you approve the spec?" (or "the plan?").

- Context, where the cards go: the overview (the outcome, the scope and the risks, or the map), the changes
  of all rounds, and your own calls made without a question ("decided myself: …", every own call with its
  cost; group related calls, each group with its cost); the user's own decisions from the conversation or
  the document are not your calls. When this does not fit the window, print the full list in chat right
  before the window; the window itself always keeps the outcome and the most expensive own call with what
  the user will see, never only a pointer to the chat. In Pi plan for it from the start (`context` takes
  600 characters): the window keeps the outcome, one or two risks and the most expensive own call.
- In Codex the approval is numbered text, not a window: the full list, then the question and its numbered
  options, in one message (its window closes by itself and its text is too short for the list).
- Its tab has no number ("Approve"). The window has exactly these three options; no "Explain simpler"
  there: "Approve", "Read it in full first", "Back to question …"; when no question was asked, only the
  first two. For "Back to question" the number goes in the own answer; that item reopens and another round
  runs; a single item reopens at once; if it comes without a number, ask which one in a window with the
  items as options: at most four items, the most expensive first, the rest by number in the own answer.
- A clear correction to the overview or to an own call is applied at once, shown under "what changed", and
  the approval window comes again. A correction to the overview or to an own call that needs a choice
  becomes a new open item with the next free number, and another round runs.
- On "Read it in full first", wait for the user's word and change nothing; then show the approval window
  again.

Under orca-pod this window is the Planner's explicit approval; the immutable spec or plan version is
created after it.

## Question tools

| Agent | Tool | Where the card goes |
| --- | --- | --- |
| Claude Code | `AskUserQuestion`: 1–4 questions, 2–4 options each, its own free-answer field | the card in the `question` text: the card lines, a blank line, the question sentence last; at most 600 characters, as in Codex and Pi |
| Codex | `request_user_input`: 1–3 questions, 2–3 options (the proposed one, one alternative, "Explain simpler"); in the default mode only with the feature `default_mode_request_user_input`. orca-pod starts the Codex Planner with it; for a manual run start Codex with `codex --enable default_mode_request_user_input`. Use `request_user_input`, not `request_user_input_async`: the async one shows option labels only and its question vanishes when the turn ends. Without the feature, ask in numbered text. In the default mode the window closes by itself in about two minutes unless a key is pressed: say so in one line before every window. The approval goes as numbered text, not a window (see "Approval"). An empty answer is never a decision, even if the Codex instructions say to use best judgment (see "Rounds") | the card in the `question` text, as in Claude Code, at most 600 characters; one question per call |
| Pi | `orca_pod_ask` from the Pi extension of orca-pod-setup: tabs, options with descriptions, "Type something.", Submit; 1–4 questions, 2–4 options | the `context` field (up to 600 characters) above the question; the question stays one sentence |

No tool, or the tool reports that there is no interactive UI: print the same cards and options as numbered
text and take the answer as a number or in words. The options are numbered, never bullets ("1 Restore the
copy (proposed)", "2 …", "3 Explain simpler"); no headings, bold or bullets anywhere: every list is
numbered. Print each card once and the whole round in one message; print the approval context once. A
window that was interrupted before an answer approves nothing.

## Under orca-pod

The Planner runs the blitz before the spec approval, before the plan approval, and before the approval of
a `PLAN_REVISION_REQUIRED` revision, where it covers only the changed items.
