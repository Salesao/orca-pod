import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

// The contracts are instructions for the role agents: a missing handle or implicit delivery breaks a run.
const CONTRACTS = readFileSync(new URL("../references/handoff-contracts.md", import.meta.url), "utf8");
const SKILL = readFileSync(new URL("../SKILL.md", import.meta.url), "utf8");
const PROTOCOL = readFileSync(new URL("../references/review-protocol.md", import.meta.url), "utf8");
const SUBAGENTS = readFileSync(new URL("../references/subagents.md", import.meta.url), "utf8");
const SELECTION = readFileSync(new URL("../references/skill-selection.md", import.meta.url), "utf8");

function section(title) {
  const start = CONTRACTS.indexOf(`## ${title}`);
  assert.notEqual(start, -1, title);
  const end = CONTRACTS.indexOf("\n## ", start + 1);
  return CONTRACTS.slice(start, end === -1 ? undefined : end);
}

test("the first Implementer contract names its own handle", () => {
  const terminals = section("First Implementer contract").split("\n").find((line) => line.startsWith("TERMINALS:"));
  assert.match(terminals, /Implementer handle=<[^>]+> \(yours/);
});

test("the first Planner prompt names its own handle", () => {
  const terminals = section("First Planner prompt").split("\n").find((line) => line.startsWith("TERMINALS:"));
  assert.match(terminals, /Planner handle=<[^>]+> \(yours/);
});

// Waiting for children by timer cost hours of a run and gave no information (sleep 150…660 s between waves).
const WAIT_LINE = "Children: launch them, then wait for completion — Pi and Claude Code: return control, the notification wakes you; Codex: wait_agent; never sleep, timers or status polling.";

test("the first role prompts carry the waiting line", () => {
  for (const title of ["First Planner prompt", "First Implementer contract", "First REVIEW_REQUEST", "Reviewer → Chief Reviewer"]) {
    assert.ok(section(title).includes(WAIT_LINE), title);
  }
});

test("SKILL.md and subagents.md: wait for children by notification, not by sleep or polling", () => {
  const flat = SKILL.replace(/\s+/g, " ");
  assert.match(flat, /\*\*Waiting for children\.\*\* Launch the children, then wait for completion/);
  assert.match(flat, /in Codex wait with `wait_agent` \(a loop with `timeout_ms` is fine\)/);
  assert.match(flat, /Do not use `sleep`, timers or polling/);
  assert.match(flat, /`bg_wait` \(Pi\) is only for work without its own notification/);
  const sub = SUBAGENTS.replace(/\s+/g, " ");
  assert.match(sub, /return control: native completion wakes you — no `sleep`, no polling of `status`, no `bg_wait` for these children/);
  assert.match(sub, /wait for the notifications of all; do not `sleep` or poll/);
  assert.match(sub, /`wait_agent` in a loop until all return[^.]*not `sleep`/);
});

test("the first role prompts start with a ROLE line", () => {
  for (const title of ["First Planner prompt", "First Implementer contract", "First REVIEW_REQUEST", "Reviewer → Chief Reviewer"]) {
    assert.match(section(title), /^ROLE: /m, title);
  }
});

test("REVIEW_REQUEST requires sending the verdict to Implementer via orca terminal send", () => {
  assert.match(section("First REVIEW_REQUEST"), /send it to Implementer[^\n]*orca terminal send/);
});

test("SKILL.md: a reply in your own terminal is not delivered; without a handle — BLOCKED with the payload", () => {
  const delivery = SKILL.slice(SKILL.indexOf("## Delivery between terminals"), SKILL.indexOf("## Terminal setup"));
  assert.match(delivery, /in your own terminal is not delivered/);
  assert.match(delivery, /its own handle/i);
});

test("FINAL_READY: skill path and explicit delivery of the verdict to Implementer via orca terminal send", () => {
  const finalReady = section("Reviewer → Chief Reviewer");
  assert.match(finalReady, /SKILL: /);
  assert.match(finalReady, /send it to Implementer[^\n]*orca terminal send/);
});

test("Chief Reviewer → Implementer: the verdict is delivered with the orca terminal send command", () => {
  assert.match(section("Chief Reviewer → Implementer"), /orca terminal send/);
});

test("REVIEW_REQUEST addresses the mode's addressee, not only Reviewer", () => {
  assert.match(section("First REVIEW_REQUEST"), /You are <Reviewer\|Chief Reviewer>/);
});

test("SKILL.md, Chief Reviewer section: the verdict goes to Implementer by handle via orca terminal send", () => {
  const chief = SKILL.slice(SKILL.indexOf("## Chief Reviewer: chief final review"), SKILL.indexOf("## Review reports"));
  assert.match(chief, /orca terminal send/);
});

test("SKILL.md, profile selection: full_access from a tracked or moved config requires confirmation", () => {
  const choice = SKILL.slice(SKILL.indexOf("### Profile selection"), SKILL.indexOf("## Subagents: policy and limits"));
  assert.match(choice, /configTracked/);
  assert.match(choice, /MOVED/);
  assert.match(choice, /confirm/);
});

test("SKILL.md, test mode: Coordinator in Codex — prepare outside the working folder requires elevated privileges or --add-dir", () => {
  const testMode = SKILL.slice(SKILL.indexOf("## Test mode"), SKILL.indexOf("## Planning"));
  assert.match(testMode, /--add-dir/);
  assert.match(testMode, /elevated/);
});

function skillSection(title) {
  const start = SKILL.indexOf(`## ${title}`);
  assert.notEqual(start, -1, title);
  const end = SKILL.indexOf("\n## ", start + 1);
  return SKILL.slice(start, end === -1 ? undefined : end);
}

// A ```text code block starting with marker (Coordinator service blocks).
function skillBlock(marker) {
  const start = SKILL.indexOf("```text\n" + marker);
  assert.notEqual(start, -1, marker);
  return SKILL.slice(start, SKILL.indexOf("\n```", start + 1));
}

test("LANGUAGE: <tag> — in the first Planner prompt, first Implementer contract, first REVIEW_REQUEST and FINAL_READY", () => {
  for (const title of ["First Planner prompt", "First Implementer contract", "First REVIEW_REQUEST", "Reviewer → Chief Reviewer"]) {
    assert.match(section(title), /^LANGUAGE: <tag>$/m, title);
  }
});

test("SKILL.md: the language section — the language field, auto, an explicit tag wins, no user text — en", () => {
  const language = skillSection("Language: LANGUAGE");
  assert.match(language, /`language`/);
  assert.match(language, /`auto`/);
  assert.match(language, /explicit\s+tag\s+wins/i);
  assert.match(language, /no\s+user\s+text[\s\S]{0,200}`en`/i);
  assert.match(language, /`LANGUAGE: <tag>`/);
});

test("SKILL.md: a role talks to people in LANGUAGE, while protocol tokens and report labels are always English", () => {
  const language = skillSection("Language: LANGUAGE");
  assert.match(language, /with\s+people\s+in\s+`LANGUAGE`/);
  assert.match(language, /always\s+in\s+English/i);
  for (const token of ["`Verdict:`", "`R<n>`", "`PIPELINE CONFIG RESOLVED`", "`PLANNER DISPATCHED`"]) {
    assert.ok(language.includes(token), token);
  }
});

test("SKILL.md: the invariant 'Russian in all visible messages' is replaced by the LANGUAGE rule", () => {
  assert.doesNotMatch(SKILL, /Russian in all visible/i);
  assert.doesNotMatch(SKILL, /reports in Russian/i);
  const invariants = skillSection("Invariants");
  assert.match(invariants, /in `LANGUAGE`/);
});

test("service blocks PIPELINE CONFIG RESOLVED and PLANNER DISPATCHED: English labels and a Language line", () => {
  for (const marker of ["PIPELINE CONFIG RESOLVED", "PLANNER DISPATCHED"]) {
    const block = skillBlock(marker);
    assert.match(block, /^Language: /m, marker);
    assert.match(block, /^Profile: /m, marker);
    assert.match(block, /^Review mode: /m, marker);
    assert.doesNotMatch(block, /^(PROFILE|REVIEW MODE|REVIEW REPORTS|FILE):/m, marker);
  }
  assert.match(skillBlock("PIPELINE CONFIG RESOLVED"), /^File: /m);
  assert.match(skillBlock("PIPELINE CONFIG RESOLVED"), /^Review reports: /m);
});

test("review-protocol §7: the report template has English labels, the verdict is a Verdict: line", () => {
  const start = PROTOCOL.indexOf("```markdown\n# Review");
  assert.notEqual(start, -1, "the report template starts with '# Review <stage>'");
  const template = PROTOCOL.slice(start, PROTOCOL.indexOf("\n```", start + 1));
  assert.match(template, /^- Verdict: APPROVED \| CHANGES_REQUESTED \| PLAN_REVISION_REQUIRED \| BLOCKED$/m);
  assert.match(template, /^- planVersion: <v>; stage: <stage>; attempt: <N>\/<limit>; date: <YYYY-MM-DD>$/m);
  assert.match(template, /^- Lanes: /m);
  assert.match(template, /^## New findings of this round$/m);
  assert.match(template, /^## Registry$/m);
  assert.match(template, /^\| id \| category \| TODO \| path \| status \| summary \|$/m);
  assert.match(template, /^## Checks$/m);
  assert.doesNotMatch(template, /[\u0400-\u04FF]/);
});

test("review-protocol §7 and SKILL.md: report labels are English under any LANGUAGE, check reads Verdict:", () => {
  const reports = PROTOCOL.slice(PROTOCOL.indexOf("## 7. Reports"), PROTOCOL.indexOf("## 8."));
  assert.match(reports, /under any `LANGUAGE`/);
  assert.match(reports, /`Verdict:`/);
  assert.match(SKILL, /`Verdict: SELF_VERIFIED`/);
  assert.match(skillSection("Test mode: `test`"), /`Verdict:`/);
});

test("contracts: a role talks to people in LANGUAGE and passes the line on", () => {
  assert.match(section("First Planner prompt"), /in LANGUAGE[\s\S]*with the same LANGUAGE line/);
  assert.match(section("First Implementer contract"), /in LANGUAGE[^\n]*same LANGUAGE in the first REVIEW_REQUEST/);
  assert.match(section("First REVIEW_REQUEST"), /in LANGUAGE[^\n]*`Verdict:`[^\n]*in English/);
  assert.match(section("Reviewer → Chief Reviewer"), /in LANGUAGE[^\n]*`Verdict:`[^\n]*in English/);
});

test("review-protocol §7: verdicts are listed by report type (stage, chief/final, self-check)", () => {
  const reports = PROTOCOL.slice(PROTOCOL.indexOf("## 7. Reports"), PROTOCOL.indexOf("## 8."));
  assert.match(reports, /`<stage>-attempt<N>\.md`[^\n]*`APPROVED \| CHANGES_REQUESTED \| PLAN_REVISION_REQUIRED \| BLOCKED`/);
  assert.match(reports, /`chief-attempt<N>\.md`[^\n]*`final-attempt<N>\.md`[^\n]*`FINAL_APPROVED \| CHANGES_REQUESTED \| PLAN_REVISION_REQUIRED \| BLOCKED`/);
  assert.match(reports, /`self-check-<stage>-attempt<N>\.md`[^\n]*`SELF_VERIFIED \| CHANGES_REQUESTED`/);
});

test("the 'request changes' verdict is spelled CHANGES_REQUESTED in every skill file (never CHANGES_REQUIRED)", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (!/\.test\.mjs$/.test(entry)) files.push(full);
    }
  };
  walk(root);
  assert.ok(files.length > 10);
  for (const file of files) assert.doesNotMatch(readFileSync(file, "utf8"), /CHANGES_REQUIRED/, path.relative(root, file));
  assert.match(SKILL, /`Verdict: SELF_VERIFIED` or\s+`Verdict: CHANGES_REQUESTED`/);
});

test("SKILL.md: under auto the RAF file text also sets the language; en only when there is no user text at all", () => {
  const language = skillSection("Language: LANGUAGE");
  assert.match(language, /RAF file[\s\S]{0,160}as an inline description/);
  assert.match(language, /no\s+user\s+text\s+at\s+all[\s\S]{0,200}`\/orca-pod test`[\s\S]{0,200}`en`/);
  assert.doesNotMatch(language, /only\s+(?:a\s+)?RAF\s+path/i);
  assert.doesNotMatch(language, /RAF file[^\n]*(?:does\s+not\s+count|do\s+not\s+count|is\s+not)/i);
});

test("SKILL.md: TASK.md (the skill's own demo task) is not user text; under auto the user's own messages in the Coordinator session decide, en only with no user-written text at all", () => {
  const flat = (text) => text.replace(/\s+/g, " ");
  const rule = flat(skillSection("Language: LANGUAGE"));
  const step = flat(skillSection("Test mode: `test`"));
  for (const [name, text] of [["Language rule 3", rule], ["Test mode step 6", step]]) {
    assert.match(text, /`TASK\.md`[^.]{0,80}(?:is\s+|are\s+)?not\s+user\s+text/i, `${name}: TASK.md is not user text`);
    assert.match(text, /user's own messages in this Coordinator session[^.]{0,120}\(for example, the answer to the profile question\)/i, `${name}: the user's own messages decide`);
    assert.match(text, /\bonly\s+(?:when|if)\s+(?:there\s+(?:is|are)\s+)?(?:no|none)\b[^.]{0,80}`en`/i, `${name}: en only when the user wrote nothing`);
  }
  assert.match(step, /explicit tag from the config wins/i, "Test mode step 6: an explicit config tag wins");
  assert.match(rule, /explicit\s+tag\s+wins/i);
  // the old wording said a bare test has no user text because TASK.md is the demo task, so auto was always en
  assert.doesNotMatch(step, /in a bare `test` there is no user text/i);
  assert.doesNotMatch(rule, /`TASK\.md` is the skill's own demo task\): `LANGUAGE` is `en`/);
});

test("SKILL.md: the .orca-pod/ folder goes into .gitignore only when the project already has one (the script never creates it); without one the user adds it before committing", () => {
  const flat = (text) => text.replace(/\s+/g, " ");
  const config = flat(skillSection("Required project configuration"));
  const reports = flat(skillSection("Review reports"));
  const invariants = flat(SKILL.slice(SKILL.indexOf("`.orca-pod/` is the pipeline's service folder"), SKILL.indexOf("- Do not compute SHA/digest")));
  for (const [name, text] of [["Required project configuration", config], ["Review reports", reports], ["Invariants", invariants]]) {
    assert.match(text, /only\s+(?:when|if)\s+(?:the\s+project\s+already\s+has\s+(?:one|a\s+`\.gitignore`)|a\s+`\.gitignore`\s+already\s+exists)/i, `${name}: the .gitignore line is conditional`);
    assert.match(text, /(?:never|does\s+not)\s+creates?\b[^.]{0,40}(?:file|one|it)|does\s+not\s+create\s+the\s+file/i, `${name}: the script never creates a .gitignore`);
  }
  for (const [name, text] of [["Required project configuration", config], ["Review reports", reports]]) {
    assert.match(text, /without\s+(?:one|a\s+`\.gitignore`)[^.]{0,120}not\s+ignored[^.]{0,120}(?:add|before\s+committing)/i, `${name}: without a .gitignore the folder is not ignored and the user adds it before committing`);
  }
  assert.doesNotMatch(config, /The folder is added to `\.gitignore` when the project has one, so the file does not go into git\./);
  assert.doesNotMatch(reports, /`ensure-gitignore\.sh` adds the `\.orca-pod\/` folder to the project's `\.gitignore`\./);
});

test("the caught-defect description in SKILL.md and review-protocol §7 matches the code: an R<n> BLOCKER/MAJOR finding line with chunk", () => {
  const reports = PROTOCOL.slice(PROTOCOL.indexOf("## 7. Reports"), PROTOCOL.indexOf("## 8."));
  const testMode = skillSection("Test mode: `test`");
  for (const text of [reports, testMode]) {
    const flat = text.replace(/\s+/g, " ");
    assert.match(flat, /by the finding line/);
    assert.match(flat, /`R<n>`/);
    assert.match(flat, /`BLOCKER`\/`MAJOR`/);
    assert.match(flat, /`chunk`/);
    assert.match(flat, /`AC-C2`/);
  }
});

// Fix round 1 (translation review): token, wording and helper-language expectations.

test("FINAL_READY names the reports directory with the same token as the other prompts: Review reports", () => {
  assert.match(section("Reviewer → Chief Reviewer"), /Review reports: <dir>/);
});

test("SKILL.md: the verbatim TASK DESCRIPTION token is spelled out in Planning; concurrent-subagents field is worded the same in both service blocks", () => {
  assert.match(skillSection("Planning").replace(/\s+/g, " "), /verbatim TASK DESCRIPTION/);
  assert.match(skillBlock("PIPELINE CONFIG RESOLVED"), /^Concurrent subagents: up to <maxSubagents> per role/m);
  assert.match(skillBlock("PLANNER DISPATCHED"), /concurrent subagents: up to <maxSubagents> per role/);
});

test("skill-selection: skills do not extend the permissions to write, run checks, do Git operations or take external actions", () => {
  const flat = SELECTION.replace(/\s+/g, " ");
  assert.match(flat, /Skills do not extend the permissions to write, to run checks, to perform Git operations or to take external actions/);
});

test("helper requests carry a LANGUAGE line (child task template and lane template)", () => {
  const childTemplate = SUBAGENTS.slice(SUBAGENTS.indexOf("## 5. "));
  assert.match(childTemplate, /^LANGUAGE: <tag>$/m);
  const laneTemplate = PROTOCOL.slice(PROTOCOL.indexOf("## 8. "));
  assert.match(laneTemplate, /^LANGUAGE: <tag>$/m);
});

test("helper agents (Claude Code, Pi, Codex) answer in the task's LANGUAGE, otherwise in the language of the request", () => {
  const agentsRoot = fileURLToPath(new URL("../agents/", import.meta.url));
  let checked = 0;
  for (const dir of ["claude", "pi", "codex"]) {
    for (const entry of readdirSync(path.join(agentsRoot, dir))) {
      if (entry === "lens-checker.md") continue; // fixed machine-readable output, no prose
      const flat = readFileSync(path.join(agentsRoot, dir, entry), "utf8").replace(/\s+/g, " ");
      assert.match(flat, /`LANGUAGE:` line[^.]{0,60}otherwise in the language of the request/, `${dir}/${entry}`);
      assert.doesNotMatch(flat, /Russian by default/, `${dir}/${entry}`);
      checked += 1;
    }
  }
  assert.equal(checked, 20);
});

// Pi helpers of the pipeline without the user's extensions: an empty `extensions:` keeps pi-lens (and its tsserver) out of the child.
const PI_ORCA_AGENTS = { worker: true, reviewer: false, scout: false, oracle: false, "evidence-auditor": false }; // key → writes
const PI_ORCA_THINKING = { worker: "high", reviewer: "high", scout: "low", oracle: "high", "evidence-auditor": "high" }; // the bundled defaults; the role's :level suffix wins

test("Pi orca-* helpers: exactly the five pipeline helpers, without extensions and without pi-lens", () => {
  const piDir = fileURLToPath(new URL("../agents/pi/", import.meta.url));
  const orca = readdirSync(piDir).filter((f) => f.startsWith("orca-")).sort();
  assert.deepEqual(orca, Object.keys(PI_ORCA_AGENTS).map((k) => `orca-${k}.md`).sort());
  for (const [key, writes] of Object.entries(PI_ORCA_AGENTS)) {
    const text = readFileSync(path.join(piDir, `orca-${key}.md`), "utf8");
    const front = text.split("\n---\n")[0];
    assert.match(front, new RegExp(`^name: orca-${key}$`, "m"), key);
    assert.match(front, /^extensions:$/m, `${key}: bare empty extensions:`);
    assert.match(front, /^systemPromptMode: replace$/m, key);
    assert.match(front, new RegExp(`^thinking: ${PI_ORCA_THINKING[key]}$`, "m"), `${key}: thinking`);
    assert.match(front, /^inheritProjectContext: true$/m, key);
    const tools = front.match(/^tools: (.+)$/m)[1].split(/,\s*/);
    assert.ok(!tools.includes("lens_diagnostics"), key);
    assert.equal(tools.includes("edit") && tools.includes("write"), writes, `${key}: edit/write`);
  }
});

test("subagents.md: Pi runs the five pipeline helpers as orca-* and has a pi-lens budget section", () => {
  const flat = SUBAGENTS.replace(/\s+/g, " ");
  assert.match(flat, /In Pi `worker`, `reviewer`, `scout`, `oracle` and `evidence-auditor` are the skill's agents `orca-<key>`/);
  for (const key of Object.keys(PI_ORCA_AGENTS)) assert.match(SUBAGENTS, new RegExp("`agents/pi/orca-" + key + "\\.md`"), key);
  const budget = SUBAGENTS.slice(SUBAGENTS.indexOf("## 2a. Pi: pi-lens budget"), SUBAGENTS.indexOf("## 3. "));
  assert.match(budget, /at most one child at a time/);
  assert.match(budget.replace(/\s+/g, " "), /use the bundled agent of the same name one at a time \(it takes the pi-lens slot; its task must forbid writing outside the scope\) or work inline; `evidence-auditor` — only inline/);
  const piSection = SUBAGENTS.slice(SUBAGENTS.indexOf("## 2. Pi"), SUBAGENTS.indexOf("## 2a."));
  assert.doesNotMatch(piSection, /agent: "(worker|reviewer|scout|oracle|evidence-auditor)"/);
});

test("SKILL.md: the pi-lens budget, one verifier in Pi; review-protocol: one lens-checker", () => {
  const flat = SKILL.replace(/\s+/g, " ");
  assert.match(flat, /\*\*pi-lens budget \(Pi\)\.\*\* pi-lens and its tsserver \([^)]*\) live in the role's session and in \*\*at most one child at a time\*\*/);
  assert.match(flat, /verifier — up to 3 of them \(in Pi — 1, the pi-lens budget\)/);
  assert.match(flat, /in Pi only one — the pi-lens budget/);
  assert.match(PROTOCOL.replace(/\s+/g, " "), /type-lane \(Pi only, if `lens-checker` is available\): \*\*one\*\* `lens-checker`/);
});

test("review-protocol: dirty-before-start files rule is an imperative; report writers match the table (self mode: Implementer)", () => {
  const flat = PROTOCOL.replace(/\s+/g, " ");
  assert.match(flat, /Do not attribute files that were dirty before the start \(the list from the request\) to the batch without evidence/);
  assert.match(flat, /re-login or re-opening a screen/);
  assert.doesNotMatch(flat, /Only the Reviewer and the Chief Reviewer write them/);
  assert.match(flat, /Reviewer and the Chief Reviewer write review reports; in `self` mode the Implementer writes self-check reports/);
});

test("SKILL.md wording: confirmation is a must, orca-cli fallback, option list, registry check, own terminals, lens_diagnostics fallback", () => {
  const flat = SKILL.replace(/\s+/g, " ");
  assert.match(flat, /Full access from someone else's config must be confirmed/);
  assert.match(flat, /If the skill is missing, do not stop: use `--help` of the discovered executable/);
  assert.match(flat, /More than 4 valid — the full list as text; the options hold the active one and the next two, and the rest are entered by name through "Other"/);
  assert.match(flat, /create your own role terminals right away in the exact workspace/);
  assert.match(flat, /without the agent, run `lens_diagnostics` yourself; without the tool \(Claude Code\), skip it/);
  assert.doesNotMatch(flat, /registry verification/i);
  assert.match(flat, /registry check/);
  assert.doesNotMatch(PROTOCOL, /registry verification/i);
});

// plan-blitz: the Planner walks the user through the spec and the plan in rounds of questions before each approval.
/** Asserts that the needles occur in this order, each searched after the previous one. */
function inSequence(text, needles) {
  let from = 0;
  for (const needle of needles) {
    const at = text.indexOf(needle, from);
    assert.notEqual(at, -1, `"${needle}" after position ${from}`);
    from = at + needle.length;
  }
}

test("the first Planner prompt: plan-blitz is a required Planner skill, with its path or not installed", () => {
  const prompt = section("First Planner prompt");
  assert.ok(prompt.split("\n").includes("REQUIRED PLANNER SKILLS: using-superpowers — <absolute path SKILL.md>; plan-blitz — <absolute path SKILL.md | not installed>."));
  assert.ok(prompt.replace(/\s+/g, " ").includes(
    "Before each approval (spec, plan, revision) run plan-blitz (Pi: /skill:plan-blitz; Claude Code: Skill plan-blitz; Codex: $plan-blitz; otherwise read it by path); if it is not installed, warn the user in one line and ask for approval in plain text."));
});

test("SKILL.md, Planning: plan-blitz after the self-review before the spec approval, after the cross-review before the plan approval", () => {
  const flat = skillSection("Planning").replace(/\s+/g, " ");
  inSequence(flat, ["SELF-REVIEW: fixed <list>", "plan-blitz over the spec", "user approval", "Then writing-plans"]);
  inSequence(flat, ["Inline cross-review of the plan", "plan-blitz over the plan", "user approval", "Implementer contract"]);
});

test("SKILL.md: a missing plan-blitz is a warning and approval in plain text, not a stop; the Coordinator looks next to orca-pod", () => {
  assert.match(skillSection("Planning").replace(/\s+/g, " "), /plan-blitz is `not installed`[^.]*warn the user in one line and ask for approval in plain text; this is not a stop/);
  const coordinator = skillSection("Coordinator skill selection").replace(/\s+/g, " ");
  assert.ok(coordinator.includes("<real path of the skill dir>/../plan-blitz/SKILL.md"), coordinator);
  assert.match(coordinator, /`not installed`[^.]*one warning line to the user, not a stop/);
  assert.match(skillSection("Test mode").replace(/\s+/g, " "), /`using-superpowers` and `plan-blitz` stay/);
});

test("SKILL.md, Return to Planner: plan-blitz covers only the changed items of the revision", () => {
  assert.match(skillSection("Return to Planner").replace(/\s+/g, " "), /plan-blitz over the changed items only/);
});

// The blitz rewrites the document between rounds, so the immutable version can only be written after the approval.
test("SKILL.md, Return to Planner: the revision is approved through plan-blitz first, the immutable versions come after", () => {
  inSequence(skillSection("Return to Planner").replace(/\s+/g, " "), ["plan-blitz over the changed items only", "then creates new immutable spec/plan versions"]);
});

test("skill-selection §1: plan-blitz is a required Planner skill next to using-superpowers", () => {
  const flat = SELECTION.slice(SELECTION.indexOf("## 1."), SELECTION.indexOf("\n## 2.")).replace(/\s+/g, " ");
  assert.match(flat, /`plan-blitz`/);
  assert.match(flat, /not installed/);
});

// Tests written and run without the user asking only slowed runs down: the pipeline touches tests only on request.
const EXPECTED = readFileSync(new URL("../assets/test/EXPECTED.md", import.meta.url), "utf8");

test("SKILL.md: tests only on the user's request, static checks, the plan's tests: line", () => {
  const flat = SKILL.replace(/\s+/g, " ");
  assert.match(flat, /\*\*Tests only on request\.\*\* The pipeline does not write, change or run tests and does not follow TDD unless the user asked for tests/);
  assert.match(flat, /This overrides the TDD steps of `writing-plans` and the `test-driven-development` skill/);
  assert.match(flat, /`tests: not requested` or `tests: requested — <the user's words>`/);
  assert.match(flat, /test commands only with `tests: requested`/);
  assert.match(flat, /the report lists tests as skipped — not requested/);
  assert.doesNotMatch(flat, /existing tests\/lint\/typecheck\/build/);
  assert.doesNotMatch(flat, /Propose changes to existing tests/);
});

test("contracts: the Planner prompt carries the tests rule, the Implementer contract a TESTS line", () => {
  assert.match(section("First Planner prompt").replace(/\s+/g, " "), /Tests only on request \(the skill's Invariants\)/);
  const implementer = section("First Implementer contract");
  assert.match(implementer, /^TESTS: <not requested \| requested — the user's words> \(the plan's tests: line\)$/m);
  assert.match(implementer.replace(/\s+/g, " "), /no TDD — this overrides the test-driven-development skill/);
});

test("child tasks carry a Tests line; worker helpers (Claude Code, Pi, Codex) follow it", () => {
  const childTemplate = SUBAGENTS.slice(SUBAGENTS.indexOf("## 5. "));
  assert.match(childTemplate, /^Tests: not requested — do not write, change or run them \| <the requested tests>\.$/m);
  for (const file of ["claude/worker.md", "pi/orca-worker.md", "codex/worker.toml"]) {
    const flat = readFileSync(new URL(`../agents/${file}`, import.meta.url), "utf8").replace(/\s+/g, " ");
    assert.match(flat, /Do not write, change or run tests and do not follow TDD unless the task's `Tests:` line names tests the user asked for; then write only those\./, file);
  }
});

test("review-protocol: a missing test is not a finding while the plan says tests: not requested", () => {
  assert.match(PROTOCOL.replace(/\s+/g, " "), /A missing or not updated test is not a finding while the plan says `tests: not requested`/);
});

test("test mode: TASK.md asks for tests, so the plan says tests: requested", () => {
  assert.match(SKILL.replace(/\s+/g, " "), /`TASK.md` asks for tests \(item 6\), so the plan says `tests: requested`/);
  assert.match(EXPECTED, /`tests: requested` \(TASK\.md item 6\)/);
});
