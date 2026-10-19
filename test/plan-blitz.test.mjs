// Doc guard for the plan-blitz skill: SKILL.md is the whole implementation (instructions for the agent that runs
// the blitz), so a rule lost in an edit silently changes the blitz. Every rule below comes from the approved design.
// Run: node --test test/plan-blitz.test.mjs  (also part of `npm test`).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (file) => readFileSync(ROOT + file, "utf8");
const SKILL = read("skills/plan-blitz/SKILL.md");
const README = read("skills/plan-blitz/README.md");
/** Markdown wraps lines anywhere, so phrases are matched with whitespace collapsed. */
const flat = (text) => text.replace(/\s+/g, " ");

/** The text of a `## ` section whose heading matches the pattern. */
function section(pattern) {
  const start = SKILL.search(new RegExp(`^## .*${pattern}`, "im"));
  assert.notEqual(start, -1, `no "## …${pattern}" section`);
  const end = SKILL.indexOf("\n## ", start + 1);
  return flat(SKILL.slice(start, end === -1 ? undefined : end));
}

/** Asserts the words appear in this order in the text. */
function inOrder(text, words) {
  const positions = words.map((word) => text.indexOf(word));
  for (const [index, word] of words.entries()) assert.notEqual(positions[index], -1, `${word} is missing`);
  assert.deepEqual([...positions].sort((a, b) => a - b), positions, `${words.join(", ")} are out of order`);
}

test("frontmatter: name plan-blitz, description starts with \"Use when\"", () => {
  const front = /^---\n([\s\S]*?)\n---\n/.exec(SKILL);
  assert.ok(front, "SKILL.md has no frontmatter");
  assert.match(front[1], /^name:\s*plan-blitz\s*$/m);
  assert.match(front[1], /^description:\s*Use when\b/m);
});

// Revision 2: the card starts from the situation (what is now, what goes wrong without a decision), not from the solution.
test("the card has Situation, Proposal, Cost and Otherwise, in this order", () => {
  const card = section("card");
  inOrder(card, ["**Situation**", "**Proposal**", "**Cost**", "**Otherwise**"]);
  assert.doesNotMatch(card, /\*\*(What|How|Why)\*\*/, "the old What/How/Why labels are gone");
});

test("document terms only with a gloss at first use; never code names", () => {
  const card = section("card");
  assert.match(card, /gloss/i);
  assert.match(card, /never code names/i);
});

test("leading questions are forbidden", () => {
  const sentence = SKILL.split(/\n\s*\n/).map(flat).find((paragraph) => paragraph.includes("Correct?"));
  assert.ok(sentence, "no paragraph names \"Correct?\"");
  for (const banned of ["Correct?", "Agree?", "How do you like it?"]) assert.ok(sentence.includes(banned), banned);
  assert.match(sentence, /forbidden|never ask|do not ask/i);
});

test("the proposed option is marked (proposed), not (Recommended)", () => {
  assert.ok(SKILL.includes("(proposed)"));
  assert.match(flat(SKILL), /not .?\(Recommended\)/);
});

test("the question is one sentence clear without the card; never \"Keep it?\" for a decision", () => {
  const question = section("The question");
  assert.match(question, /clear without the card/i);
  assert.match(question, /never[^.]*"Keep it\?"|"Keep it\?"[^.]*never/i);
});

test("options: the proposed one first, Explain simpler last, each says what happens and its cost at equal depth", () => {
  const question = section("The question");
  assert.match(question, /proposed option first/i);
  assert.match(question, /"Explain simpler" last/i);
  assert.match(question, /what happens and its cost/i);
  assert.match(question, /equal depth/i);
});

// Revision 2: ask only where there is a real choice; the rest is an overview and the agent's own calls.
test("what to ask: only forks; spec Overview, Scope, Decisions, Risks; plan Map, Deviations; no question per task", () => {
  const ask = section("What to ask");
  assert.match(ask, /only forks/i);
  inOrder(ask, ["**Overview**", "**Scope**", "**Decisions**", "**Risks**"]);
  inOrder(ask, ["**Map**", "**Deviations**"]);
  assert.match(ask, /no question per task/i);
});

test("limits: 4 questions per window, 8 per round, 12-character header, 3 rounds", () => {
  for (const limit of [/\b4 questions\b/, /\b8 questions\b/, /\b12 characters\b/, /\b3 rounds\b/]) assert.match(flat(SKILL), limit);
});

test("rounds: approved items are not asked again; a changed approved item comes back; Esc stops the blitz", () => {
  const rounds = section("round");
  assert.match(rounds, /not asked again/i);
  assert.match(rounds, /changed because of the answer to/i);
  assert.match(rounds, /\bEsc\b/);
});

// "changed because of the answer to 3 Rollback" and "Back to question 3" only work when the numbers stay put.
test("rounds: items keep their number for the whole blitz; new items take the next free number", () => {
  const rounds = section("round");
  assert.match(rounds, /keep their number for the whole blitz/i);
  assert.match(rounds, /new items take the next free number/i);
});

test("approval: \"Back to question\" picked without a number makes the agent ask which one", () => {
  assert.match(section("approval"), /without a number, ask which/i);
});

test("approval: decisions taken without a question are listed there, each with its cost", () => {
  const approval = section("approval");
  assert.match(approval, /decided myself/i);
  assert.match(approval, /without a question/i);
});

test("approval window: Approve, Read it in full first, Back to question", () => {
  const approval = section("approval");
  inOrder(approval, ["Approve", "Read it in full first", "Back to question"]);
});

test("tools: AskUserQuestion, request_user_input with default_mode_request_user_input, orca_pod_ask, numbered text", () => {
  const tools = section("tool");
  for (const needle of ["AskUserQuestion", "request_user_input", "default_mode_request_user_input", "orca_pod_ask"]) {
    assert.ok(tools.includes(needle), needle);
  }
  assert.match(tools, /numbered text/i);
});

// Third live run: Codex showed the card in the question text fine, and a card in chat split the context in two.
test("the card lives in the window: question text in Claude Code and Codex, context in Pi", () => {
  const tools = section("tool");
  const codex = SKILL.split("\n").find((line) => line.startsWith("| Codex"));
  const claude = SKILL.split("\n").find((line) => line.startsWith("| Claude Code"));
  assert.match(claude, /card[^|]*in the `question` text/i);
  assert.match(codex, /card[^|]*in the `question` text/i);
  assert.match(codex, /600 characters/);
  assert.doesNotMatch(codex, /in chat right before the call/i);
  assert.match(tools, /`context`/);
});

test("README links back to the root README and to SKILL.md", () => {
  assert.ok(README.includes("](../../README.md)"));
  assert.ok(README.includes("](SKILL.md)"));
  for (const form of ["/plan-blitz ", "$plan-blitz ", "/skill:plan-blitz "]) assert.ok(README.includes(form), form);
});

// Final review of revision 2: the places where an empty "Keep it?" or a lost card could come back.
test("only changes of the spec are asked; a refinement that only adds detail goes to the list at the approval", () => {
  const ask = section("What to ask");
  assert.doesNotMatch(ask, /refines or changes the spec/);
  assert.match(ask, /a refinement that only adds detail goes to the list at the approval/i);
});

// Planner feedback 2026-10-18: a plan blitz with no questions looked like no blitz at all ("And where is the plan blitz?").
test("a document with no fork at all: the overview, then a line that says there are no forks, then the approval window", () => {
  const ask = section("What to ask");
  assert.match(ask, /No fork at all: the document line, the overview \(or the map\), then one line[^.]*says so[^.]*\), then the approval window/);
  assert.match(ask, /no forks and no deviations from the spec, so straight to the approval/i);
});

// Planner feedback 2026-10-18: the user could not find the spec the blitz asked about, and rule 1 read as "never show a path".
test("the document line: the absolute path before the overview, outside any window; rule 1 allows it and only it", () => {
  const ask = section("What to ask");
  assert.match(ask, /\*\*The document line\.\*\* Before the overview \(or the map\), outside any window/);
  assert.match(ask, /absolute path/);
  inOrder(flat(SKILL), ["The one exception is the document itself", "never into a card or a question"]);
  assert.match(section("Hard rules"), /printed before the first window right after the document line/);
});

test("the overview says the questions come from this document", () => {
  assert.match(section("What to ask"), /\*\*Overview\*\*.{0,400}the questions come from this document/i);
});

test("approval: the context and the \"Read it in full first\" option carry the document's path", () => {
  const approval = section("approval");
  assert.match(approval, /Context, where the cards go: the document line \(the absolute path\)/);
  assert.match(approval, /The description of "Read it in full first" gives the document's absolute path/);
});

test("rounds: a blitz log at the end of the document, one line per round, kept in the approved version", () => {
  const rounds = section("round");
  assert.match(rounds, /\*\*Blitz log\.\*\*/);
  assert.match(rounds, /one line per round with the items asked and what the answers changed/);
  assert.match(rounds, /stays in the approved version/);
  assert.match(rounds, /write no service files/);
});

test("plan deviations: everything the plan adds is walked through, an addition that changes what the user sees is a deviation", () => {
  const ask = section("What to ask");
  assert.match(ask, /walk through everything the plan adds to the spec, not only what it changes/i);
  assert.match(ask, /An addition that changes what the user sees, gets or can lose is a deviation/);
});

test("risks without a choice are in the overview and at the approval; corrections to the overview become open items", () => {
  assert.match(section("What to ask"), /\*\*Overview\*\*.{0,240}risks without a choice/i);
  const approval = section("approval");
  assert.match(approval, /risks/i);
  assert.match(approval, /correction to the overview or to an own call[^.]*new open item/i);
});

test("rounds: the chosen alternative is decided at once and not asked again", () => {
  const rounds = section("round");
  assert.match(rounds, /alternative: decided at once/i);
  assert.match(rounds, /stays open only when/i);
});

test("Pi approval that does not fit the context: the full list in chat right before the window", () => {
  assert.match(section("approval"), /does not fit[^.]*in chat right before the window/i);
});

test("Codex: one question per call, so its card stays right above the window", () => {
  assert.match(section("tool"), /one question per call/i);
});

// Second live run (2026-10-18): what each agent's window still got wrong.
// Run 5: the async window shows labels only and its question vanishes when the turn ends; without the feature, text.
test("Codex: request_user_input only, never the async one; without the feature, numbered text", () => {
  const tools = section("tool");
  assert.match(tools, /not `request_user_input_async`/);
  assert.match(tools, /without the feature[^.]*numbered text/i);
  assert.doesNotMatch(tools, /consequence of each option[^.]*into the card/i);
});

test("\"Explain simpler\" is added by the agent in every tool; no tool adds it", () => {
  assert.match(section("The question"), /no tool adds it/i);
});

test("Pi approval budget: outcome, one or two risks and the most expensive own call in the window; the rest in chat", () => {
  assert.match(section("approval"), /In Pi[^.]*the outcome, one or two risks and the most expensive own call/i);
});

test("\"Back to question\" without a number: ask which one in a window with the items as options", () => {
  assert.match(section("approval"), /without a number, ask which one in a window with the items as options/i);
});

test("small rules: labels translated once, the approval tab has no number, a field named by meaning first, dependent questions apart, each real alternative", () => {
  const card = section("card");
  const question = section("The question");
  assert.match(card, /translate the labels once/i);
  assert.match(card, /by its meaning first/i);
  assert.match(card, /each real alternative/i);
  assert.match(question, /depends on the answer to another[^.]*separate windows/i);
  assert.match(section("approval"), /tab has no number/i);
  assert.match(section("tool"), /one alternative/i);
});

// Third live run (2026-10-18): what the agents still had to guess.
test("an alternative that cannot be done now is not a real alternative: it goes into the Situation", () => {
  assert.match(section("card"), /cannot be done now[^.]*not a real alternative/i);
});

test("the no-code-names rule also covers the overview, the explanations and the lists at the approval", () => {
  assert.match(flat(SKILL), /same rules apply to the overview, the explanations and the lists at the approval/i);
});

test("the approval window has exactly its three options, no \"Explain simpler\"", () => {
  assert.match(section("approval"), /exactly these three options; no "Explain simpler" there/i);
});

test("questions that come back count toward the round's limit", () => {
  assert.match(section("What to ask"), /questions that come back count toward/i);
});

test("after \"Explain simpler\": the card in plainer words with an everyday example; options may be reworded", () => {
  const rounds = section("round");
  assert.match(rounds, /everyday example/i);
  assert.match(rounds, /options may be reworded/i);
});

test("after 3 rounds the chat answer closes the item like an answer in the window", () => {
  assert.match(section("round"), /closes the item like an answer in the window/i);
});

test("the list of own calls may group related calls, each group with its cost", () => {
  assert.match(section("approval"), /group related calls/i);
});

test("a plan whose steps are all marked done: say so and ask whether to run the blitz anyway", () => {
  assert.match(flat(SKILL), /all marked done[^.]*ask whether to run the blitz anyway/i);
});

// User feedback after the third run: no second "Explain simpler" after an explanation; explain on an example;
// no markdown inside windows (the windows show ** and backticks as they are).
test("the re-asked question has no \"Explain simpler\": the explanation was already given", () => {
  assert.match(section("round"), /re-asked question has no "Explain simpler"/i);
});

test("\"Explain simpler\" is answered on a concrete everyday example", () => {
  assert.match(section("round"), /on a concrete everyday example/i);
});

test("text inside a window is plain: no markdown; the card example is plain text", () => {
  const card = section("card");
  assert.match(card, /text inside a window is plain: no markdown/i);
  assert.doesNotMatch(card, /\*\*(Situation|Proposal|Cost|Otherwise):\*\*/, "the example must not teach ** inside a window");
});

// Fourth run (operator-driven, five agents) and four Haiku audits (2026-10-18): .handoff/plan-blitz-report-4/SYNTHESIS.md.
test("no technical words either; a document term is glossed in every card where it appears", () => {
  assert.match(flat(SKILL), /no technical words/i);
  assert.match(section("card"), /glossed in every card where it appears/i);
});

test("the card: Situation at most two sentences about what is there now; Cost is what the user will notice; never merged", () => {
  const card = section("card");
  assert.match(card, /at most two sentences about what is there now/i);
  assert.match(card, /what the user will notice, not a bare count/i);
  assert.match(card, /Cost is never merged into the Proposal/i);
});

test("Otherwise names the strong side of the alternative; costs equally concrete", () => {
  assert.match(section("card"), /strong side of the alternative/i);
});

test("a card never cites an item that has not been asked yet", () => {
  assert.match(section("The question"), /never cites an item that has not been asked yet/i);
});

test("options: a cheap safeguard when one exists; no negated labels", () => {
  const question = section("The question");
  assert.match(question, /cheap safeguard/i);
  assert.match(question, /no negated labels/i);
});

test("\"Explain simpler\" is left out only for an item that was already explained", () => {
  assert.match(section("The question"), /item that was already explained/i);
});

test("what to ask: skip what is cheap to change later or already decided; never ask the user to type names or lists", () => {
  const ask = section("What to ask");
  assert.match(ask, /cheap to change later or already decided/i);
  assert.match(ask, /never ask the user to type names, lists or values/i);
});

test("plan deviations: options named by their outcome, not by the document", () => {
  const ask = section("What to ask");
  assert.doesNotMatch(ask, /as the plan says \(proposed\) \/ as the spec said/);
  assert.match(ask, /named by their outcome/i);
});

test("the overview is at most 120 plain words; questions are numbered from 1", () => {
  assert.match(flat(SKILL), /at most 120 plain words/i);
  assert.match(flat(SKILL), /questions are numbered from 1/i);
});

test("a window closed without an answer: ask in plain text whether to continue or approve as it stands", () => {
  const rounds = section("round");
  assert.match(rounds, /closed without an answer[^.]*ends your turn/i);
  assert.match(rounds, /continue the blitz or approve it as it stands/i);
});

test("an empty answer is neither a cancel nor a decision; after asking, end the turn; never decide a fork yourself", () => {
  const rounds = section("round");
  assert.match(rounds, /empty answer[^.]*neither a cancel nor a decision/i);
  assert.match(rounds, /end the turn until the answer comes/i);
  assert.match(rounds, /never decide a fork yourself/i);
});

test("approval: changes of all rounds, every own call with its cost, the window again after Read it in full first", () => {
  const approval = section("approval");
  assert.match(approval, /changes of all rounds/i);
  assert.match(approval, /every own call with its cost/i);
  assert.match(approval, /show the approval window again/i);
  assert.match(approval, /at most four items, the most expensive first/i);
  assert.match(approval, /clear correction[^.]*applied at once/i);
});

test("text mode: numbered options, never bullets; the approval context once", () => {
  const tools = section("tool");
  assert.match(tools, /numbered, never bullets/i);
  assert.match(tools, /approval context once/i);
});

// Fifth run (operator-driven) and four Haiku audits (2026-10-18): .handoff/plan-blitz-report-5/SYNTHESIS.md.
test("hard rules come first, before the card", () => {
  assert.ok(SKILL.search(/^## Hard rules/m) !== -1, "no ## Hard rules section");
  assert.ok(SKILL.search(/^## Hard rules/m) < SKILL.search(/^## The card/m), "hard rules must come before the card");
});

test("plain words: data samples, services, units, field names and screen labels have explicit substitutions", () => {
  const hard = section("Hard rules");
  assert.match(hard, /a sample of data becomes an example in words/i);
  assert.match(hard, /a service is named by its role/i);
  assert.match(hard, /units become what the user sees/i);
  assert.match(hard, /field and key names never appear, even in quotes/i);
  assert.match(hard, /a label the user sees on the screen may be quoted once/i);
});

test("labels and the proposed marker are in the user's language from the first card", () => {
  const hard = section("Hard rules");
  assert.match(hard, /from the first card/i);
  assert.match(hard, /ignore the tool's "\(Recommended\)"/i);
});

test("the user is addressed the way they write, the polite form if unclear, one form for the whole blitz", () => {
  const hard = section("Hard rules");
  assert.match(hard, /address the user the way they write/i);
  assert.match(hard, /polite form/i);
  assert.match(hard, /one form for the whole blitz/i);
});

test("cheap means one edit undoes it with no loss; anything that can lose data, block someone or change what users see is a question", () => {
  const ask = section("What to ask");
  assert.match(ask, /one edit undoes it with no loss of data, settings, access, money or messages/i);
  assert.match(ask, /can lose data, block someone or change what a user sees[^.]*is a question/i);
});

test("every option, the proposed one included, states its gain and cost; no unmeasurable costs; labels never contradict descriptions", () => {
  const question = section("The question");
  assert.match(question, /every option, the proposed one included/i);
  assert.match(question, /no unmeasurable costs/i);
  assert.match(question, /label never contradicts its description/i);
});

test("the re-ask keeps the Situation as what is there now; the plan map is one line per task", () => {
  assert.match(section("round"), /keeps the Situation as what is there now/i);
  assert.match(section("What to ask"), /one line per task/i);
});

test("after a cut-off window, a message that clearly says to continue opens the windows at once", () => {
  assert.match(section("round"), /clearly says to continue opens the windows at once/i);
});

test("Codex: an empty answer is never a decision even if its own instructions say so; warn about the timer before the window", () => {
  const tools = section("tool");
  assert.match(tools, /even if the Codex instructions say to use best judgment/i);
  assert.match(tools, /closes by itself in about two minutes unless a key is pressed/i);
});

test("approval: print the full list again before every approval window; never \"see above\"", () => {
  const approval = section("approval");
  assert.match(approval, /print the full list again before every approval window/i);
  assert.match(approval, /never "see above"/i);
});

test("the blitz goes by the document only", () => {
  assert.match(flat(SKILL), /goes by the document only/i);
});

// Sixth run (operator-driven) and four Haiku audits (2026-10-18): .handoff/plan-blitz-report-6/SYNTHESIS.md.
// User decisions: everything a user sees is a question, the look included; Codex approves in numbered text.
test("cheap: nothing the user sees changes; a change in behavior or look is a question", () => {
  const ask = section("What to ask");
  assert.match(ask, /nothing the user sees changes/i);
  assert.match(ask, /behavior or look \(icons, the text and timing of hints, where a button sits\)/i);
});

test("approval: the window itself keeps the outcome and the most expensive own call, never only a pointer to the chat", () => {
  assert.match(section("approval"), /window itself always keeps the outcome and the most expensive own call[^.]*never only a pointer to the chat/i);
});

test("Codex approves in numbered text, not in a window", () => {
  assert.match(section("approval"), /In Codex the approval is numbered text, not a window/i);
  const codex = SKILL.split("\n").find((line) => line.startsWith("| Codex"));
  assert.match(codex, /approval[^|]*numbered text/i);
  assert.match(codex, /say so in one line before every window/i);
});

test("the re-ask keeps the same card plus one added sentence of the example; nothing else is rewritten", () => {
  const rounds = section("round");
  assert.match(rounds, /same card[^.]*one added sentence of that example \(at most 25 words\)/i);
  assert.match(rounds, /nothing else in the card is rewritten/i);
});

test("a gap with two or more reasonable answers is a question; a guess is never the Situation", () => {
  const ask = section("What to ask");
  assert.match(ask, /with one reasonable answer, fill it[^.]*own call/i);
  assert.match(ask, /with two or more, it is a question[^.]*does not decide it/i);
  assert.match(ask, /never state a guess as the Situation/i);
  assert.doesNotMatch(ask, /cannot answer is not a question for the user/i);
});

test("before the first question, list every fork of the whole document; a fork noticed later goes to the next round", () => {
  const ask = section("What to ask");
  assert.match(ask, /before the first question, read the whole document and list every fork/i);
  assert.match(ask, /noticed later goes to the next round/i);
});

test("options: the gain first, then the cost; \"later\" and \"longer\" are not measures", () => {
  const question = section("The question");
  assert.match(question, /gain first, then its cost/i);
  assert.match(question, /"later", "longer"/);
});

test("plan map: before the first card in text mode too; one line per task, no ranges, at most 15 words; outside the 120 words", () => {
  const ask = section("What to ask");
  assert.match(ask, /in text mode too/i);
  assert.match(ask, /never a range of tasks on one line/i);
  assert.match(ask, /at most 15 words/i);
  assert.match(ask, /outside the overview's 120 words/i);
});

test("text mode: no headings, bold or bullets; each card once; the whole round in one message", () => {
  const tools = section("tool");
  assert.match(tools, /no headings, bold or bullets/i);
  assert.match(tools, /each card once/i);
  assert.match(tools, /whole round in one message/i);
});

test("no question asked: the approval has only its first two options; the user's decisions are not own calls", () => {
  const approval = section("approval");
  assert.match(approval, /when no question was asked, only the first two/i);
  assert.match(approval, /user's own decisions[^.]*are not your calls/i);
});

test("a reopened card never offers an option its Situation rules out; a single item reopens at once", () => {
  assert.match(section("round"), /never offers an option that its own Situation rules out/i);
  assert.match(section("approval"), /a single item reopens at once/i);
});

test("the changed-item mark goes into the card itself every time the item comes back changed", () => {
  assert.match(section("round"), /mark goes into the card itself[^.]*every time the item comes back changed/i);
});

test("the tab header: 12 characters, the number and the space included", () => {
  assert.match(section("The question"), /12 characters, the number and the space included/i);
});

test("Claude Code: the card in the question text is at most 600 characters too", () => {
  const claude = SKILL.split("\n").find((line) => line.startsWith("| Claude Code"));
  assert.match(claude, /600 characters/);
});
