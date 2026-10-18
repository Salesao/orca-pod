import assert from "node:assert/strict";
import { test } from "node:test";
import { askResultText, createAskComponent, normalizeAskParams } from "../pi-extension/ask.js";

// pi-extension/ask.js is the orca_pod_ask question window (plan-blitz in Pi) without Pi imports: index.js passes in
// the pi-tui kit. Here a fake kit stands in for it, so the keys, answers and abort handling run under node:test.

class FakeEditor {
  constructor() { this.text = ""; this.onSubmit = undefined; }
  setText(text) { this.text = text; }
  getText() { return this.text; }
  handleInput(data) {
    if (data === "enter") this.onSubmit?.(this.text);
    else this.text += data;
  }
  render() { return [`| ${this.text}`]; }
  invalidate() {}
}

const kit = {
  Editor: FakeEditor,
  Key: { enter: "enter", escape: "escape", tab: "tab", up: "up", down: "down", left: "left", right: "right", shift: (key) => `shift+${key}` },
  matchesKey: (data, key) => data === key,
  visibleWidth: (text) => text.length,
  // Cuts at the width, so the lines depend on it (a cache that ignores the width shows stale lines).
  wrapTextWithAnsi: (text, width) => text.match(new RegExp(`.{1,${Math.max(1, width)}}`, "g")) ?? [""],
};
const theme = { fg: (_color, text) => text, bg: (_color, text) => text, bold: (text) => text };

const ROLLBACK = {
  question: "What should happen to the database if the update fails?",
  header: "3 Rollback",
  options: [
    { label: "Restore the copy (proposed)", description: "The server comes back; seconds of writes are lost" },
    { label: "Leave the database", description: "Nothing is lost; the old program may not start" },
  ],
};
const MAP = {
  question: "Keep the order of work?",
  header: "1 Map",
  options: [
    { label: "Keep", description: "Tasks 1-6 in order" },
    { label: "Change (I'll say how)", description: "Another order" },
  ],
};

/** A component over the given questions; `calls` collects every done(...) result. */
function open(questions, signal) {
  const calls = [];
  const tui = { renders: 0, requestRender() { this.renders++; } };
  const component = createAskComponent({ questions, tui, theme, kit, signal, done: (result) => calls.push(result) });
  const press = (...keys) => { for (const key of keys) component.handleInput(key); };
  return { component, calls, press };
}

const option = (n) => ({ label: `Option ${n}`, description: "" });
const question = (overrides = {}) => ({ question: "Q?", header: "H", options: [option(1), option(2)], ...overrides });

test("normalizeAskParams: 1-4 questions, 2-4 options, a header of up to 12 characters, unique labels", () => {
  const cases = [
    [{ questions: [1, 2, 3, 4, 5].map(() => question()) }, /1-4/],
    [{ questions: [] }, /1-4/],
    [{ questions: [question({ options: [option(1)] })] }, /2-4/],
    [{ questions: [question({ options: [1, 2, 3, 4, 5].map(option) })] }, /2-4/],
    [{ questions: [question({ header: "1234567890123" })] }, /12/],
    [{ questions: [question({ options: [option(1), option(1)] })] }, /duplicate/],
  ];
  for (const [params, limit] of cases) {
    const result = normalizeAskParams(params);
    assert.equal(result.ok, false, JSON.stringify(params));
    assert.match(result.error, limit);
  }
  const ok = normalizeAskParams({ questions: [question({ header: " 3 Rollback ", options: [{ label: " Keep " }, option(2)] })] });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.questions, [{ question: "Q?", header: "3 Rollback", context: "", options: [{ label: "Keep", description: "" }, option(2)] }]);
});

test("one question: the first answer submits it", () => {
  const { calls, press } = open([ROLLBACK]);
  press("down", "enter");
  assert.deepEqual(calls, [{ answers: [{ header: "3 Rollback", kind: "option", label: "Leave the database" }], cancelled: false }]);
});

test("two questions: Submit waits for every answer, then returns them in question order", () => {
  const { calls, press } = open([MAP, ROLLBACK]);
  press("tab", "enter"); // answers 3 Rollback, moves to Submit
  press("enter");
  assert.deepEqual(calls, [], "Submit with 1 Map unanswered does nothing");
  press("tab", "enter"); // back to 1 Map (wraps), answers it, moves to 3 Rollback
  press("tab", "enter");
  assert.deepEqual(calls, [{
    answers: [
      { header: "1 Map", kind: "option", label: "Keep" },
      { header: "3 Rollback", kind: "option", label: "Restore the copy (proposed)" },
    ],
    cancelled: false,
  }]);
});

test("Type something.: an empty answer is not recorded and the editor stays open; text is returned as written", () => {
  const { component, calls, press } = open([ROLLBACK]);
  press("down", "down", "enter"); // the third row is "Type something."
  press("enter");
  assert.deepEqual(calls, []);
  assert.ok(component.render(80).some((line) => line.includes("Your answer:")), "the editor is still open");
  press("keep the old db", "enter");
  assert.deepEqual(calls, [{ answers: [{ header: "3 Rollback", kind: "text", label: "keep the old db" }], cancelled: false }]);
});

test("Esc cancels the window", () => {
  const { calls, press } = open([MAP, ROLLBACK]);
  press("enter", "escape");
  assert.deepEqual(calls, [{ answers: [], cancelled: true }]);
});

test("an abort closes the window once, also when the signal was aborted before it opened", () => {
  const later = new AbortController();
  const first = open([ROLLBACK], later.signal);
  later.abort();
  first.press("enter");
  assert.deepEqual(first.calls, [{ answers: [], cancelled: true, reason: "aborted" }]);

  const before = new AbortController();
  before.abort();
  const second = open([ROLLBACK], before.signal);
  second.press("enter");
  assert.deepEqual(second.calls, [{ answers: [], cancelled: true, reason: "aborted" }]);
});

test("render shows the tabs, the options with descriptions, Type something. and Submit; the cache follows the width", () => {
  const { component } = open([MAP, ROLLBACK]);
  const text = component.render(200).join("\n");
  for (const needle of ["1 Map", "3 Rollback", "Keep the order of work?", "Keep", "Tasks 1-6 in order", "Change (I'll say how)", "Type something.", "Submit"]) {
    assert.ok(text.includes(needle), needle);
  }
  const narrow = component.render(20);
  const wide = component.render(80);
  assert.notDeepEqual(wide, narrow);
  assert.ok(narrow.every((line) => line.length <= 20), "narrow lines fit 20 columns");
});

test("askResultText: answers, Esc, interruption, no UI and invalid questions", () => {
  assert.equal(askResultText({ answers: [
    { header: "1 Map", kind: "option", label: "Keep" },
    { header: "3 Rollback", kind: "text", label: "keep the old db" },
  ] }), '1 Map: selected "Keep"\n3 Rollback: wrote "keep the old db"');
  // The tool is general (any Pi agent may ask through it), so the Esc text names the blitz only as one case.
  assert.equal(askResultText({ answers: [], cancelled: true }),
    "The user cancelled the questions (Esc); nothing was answered. In a plan blitz: stop it and ask for approval in plain text.");
  assert.equal(askResultText({ answers: [], cancelled: true, reason: "aborted" }),
    "The questions were interrupted before an answer. Do not treat anything as approved.");
  assert.equal(askResultText({ reason: "no-ui", mode: "print" }),
    "No interactive terminal UI (mode print). Ask the same questions as numbered text instead.");
  assert.equal(askResultText({ reason: "invalid", error: "5 questions (1-4 allowed)" }),
    "Invalid questions: 5 questions (1-4 allowed). Limits: 1-4 questions, a header of up to 12 characters, a context of up to 600 characters, 2-4 options each; shorten the context or split the questions into several calls.");
});

// Revision 2: the card (situation, proposal, cost) goes inside the window as `context`, above the question.
const CARD = "Situation: a failed update leaves the server down.\nProposal: restore the database copy.\nCost: seconds of writes are lost.";

test("normalizeAskParams: context is trimmed, \"\" when absent, and capped at 600 characters", () => {
  const kept = normalizeAskParams({ questions: [question({ context: `  ${CARD}  ` })] });
  assert.equal(kept.ok, true);
  assert.equal(kept.questions[0].context, CARD);
  assert.equal(normalizeAskParams({ questions: [question()] }).questions[0].context, "");
  const long = normalizeAskParams({ questions: [question({ context: "x".repeat(601) })] });
  assert.equal(long.ok, false);
  assert.match(long.error, /context is 601 characters \(up to 600\)/);
  assert.equal(normalizeAskParams({ questions: [question({ context: "x".repeat(600) })] }).ok, true);
});

test("render: the context sits between the tab bar and the question, line by line", () => {
  const { component } = open([{ ...ROLLBACK, context: CARD }, MAP]);
  const lines = component.render(80);
  const tabs = lines.findIndex((line) => line.includes("3 Rollback"));
  const situation = lines.findIndex((line) => line.includes("Situation: a failed update leaves the server down."));
  const cost = lines.findIndex((line) => line.includes("Cost: seconds of writes are lost."));
  const stem = lines.findIndex((line) => line.includes(ROLLBACK.question));
  assert.ok(tabs >= 0 && tabs < situation && situation < cost && cost < stem, JSON.stringify(lines));
});

test("render: a narrow window wraps the context within the width", () => {
  const { component } = open([{ ...ROLLBACK, context: CARD }]);
  const lines = component.render(20);
  assert.ok(lines.every((line) => line.length <= 20), JSON.stringify(lines));
  assert.ok(lines.join("").includes("Situation"), "the context is shown");
});

test("render: a question without context looks exactly as before", () => {
  const { component } = open([MAP, ROLLBACK]);
  const rule = "─".repeat(200);
  assert.deepEqual(component.render(200), [
    rule, " ←  □ 1 Map   □ 3 Rollback   ✓ Submit  →", "", " Keep the order of work?", "",
    "> 1. Keep", "     Tasks 1-6 in order", "  2. Change (I'll say how)", "     Another order", "  3. Type something.", "",
    " Tab/←→ navigate • ↑↓ select • Enter confirm • Esc cancel", rule,
  ]);
});
