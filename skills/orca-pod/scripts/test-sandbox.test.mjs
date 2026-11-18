import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";

import { catchesChunkDefect, reportVerdict } from "./test-sandbox.mjs";

const SANDBOX_SCRIPT = fileURLToPath(new URL("./test-sandbox.mjs", import.meta.url));
const SANDBOX_SEED = fileURLToPath(new URL("../assets/test/sandbox/", import.meta.url));

// Lines marked "ru-fixture" are Russian on purpose: report prose follows the user's language (SKILL.md, "Language: LANGUAGE"),
// while the labels and tokens the parsers read stay English.

test("prepare puts the config into .orca-pod/orca-pod.yaml", () => {
  const root = mkdtempSync(path.join(tmpdir(), "orca-sandbox-test-"));
  try {
    const config = path.join(root, "c.yaml");
    writeFileSync(config, "active_profile: default\n");
    const dir = path.join(root, "sb");
    const result = spawnSync(process.execPath, [SANDBOX_SCRIPT, "prepare", "--dir", dir, "--config", config], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).config, "copied");
    assert.equal(readFileSync(path.join(dir, ".orca-pod", "orca-pod.yaml"), "utf8"), "active_profile: default\n");
    assert.equal(existsSync(path.join(dir, "orca-pod.yaml")), false);
    assert.equal(existsSync(path.join(dir, ".orca-pipeline")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("prepare does not commit .orca-pod/ — also when resetting an old sandbox where the config was committed", () => {
  const root = mkdtempSync(path.join(tmpdir(), "orca-sandbox-test-"));
  try {
    const config = path.join(root, "c.yaml");
    writeFileSync(config, "active_profile: default\n");
    const dir = path.join(root, "sb");
    const prepare = () => spawnSync(process.execPath, [SANDBOX_SCRIPT, "prepare", "--dir", dir, "--config", config], { encoding: "utf8" });
    const tracked = () => spawnSync("git", ["-C", dir, "ls-files", ".orca-pod"], { encoding: "utf8" }).stdout.trim();
    assert.equal(prepare().status, 0);
    assert.equal(tracked(), "");
    // A sandbox of the previous version: the config got into the baseline commit.
    spawnSync("git", ["-C", dir, "add", "-f", ".orca-pod"]);
    spawnSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "old"]);
    assert.notEqual(tracked(), "");
    const again = prepare();
    assert.equal(again.status, 0, again.stderr);
    assert.equal(tracked(), "");
    assert.equal(readFileSync(path.join(dir, ".orca-pod", "orca-pod.yaml"), "utf8"), "active_profile: default\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("reportVerdict: labels in English, prose in Russian — the verdict is read from Verdict:", () => {
  const report = [
    "# Review all — attempt 1",
    "- planVersion: v1; stage: all; attempt: 1/3; date: 2026-10-17",
    "- Verdict: CHANGES_REQUESTED",
    "- Lanes: A → src/text → ок; chunk → src/data → есть дефект", // ru-fixture
    "",
    "Вердикт по существу: блокирующее замечание R1 в chunk.", // ru-fixture
  ].join("\n");
  assert.equal(reportVerdict(report), "CHANGES_REQUESTED");
});

test("reportVerdict: an English report; a line without a list marker; no label — null", () => {
  assert.equal(reportVerdict("# Review all — attempt 2\n- Verdict: APPROVED\n\n## Registry\n"), "APPROVED");
  assert.equal(reportVerdict("Verdict: FINAL_APPROVED\n"), "FINAL_APPROVED");
  assert.equal(reportVerdict("# Review\nNo verdict here, only APPROVED in prose\n"), null);
  assert.equal(reportVerdict("Вердикт: APPROVED\n"), null); // ru-fixture: a Russian label is not a Verdict: label
});

test("reportVerdict: the first Verdict: label is taken, a mention in prose does not count", () => {
  const report = "## Notes\nearlier it was Verdict: CHANGES_REQUESTED\n- Verdict: APPROVED\n- Verdict: BLOCKED\n";
  assert.equal(reportVerdict(report), "APPROVED");
});

test("reportVerdict: label formats — bold, numbering, heading, case, bold value; the result is a bare token", () => {
  const forms = [
    "- **Verdict:** APPROVED",
    "**Verdict:** APPROVED",
    "**Verdict**: APPROVED",
    "1. Verdict: APPROVED",
    "### Verdict: APPROVED",
    "- verdict: APPROVED",
    "- Verdict: **APPROVED**",
    "* Verdict: `APPROVED`",
    "  - **Verdict**: **APPROVED**  ",
  ];
  for (const form of forms) assert.equal(reportVerdict("# Review all — attempt 2\n" + form + "\n\n## Registry\n"), "APPROVED", form);
});

test("reportVerdict: the value is exactly one known verdict token, otherwise null", () => {
  for (const token of ["APPROVED", "CHANGES_REQUESTED", "PLAN_REVISION_REQUIRED", "BLOCKED", "FINAL_APPROVED", "SELF_VERIFIED"]) {
    assert.equal(reportVerdict(`- Verdict: ${token}\n`), token, token);
  }
  // An unchosen template, an enumeration, an unknown token, a token with an explanation, an outdated spelling.
  for (const bad of [
    "- Verdict: APPROVED | CHANGES_REQUESTED | PLAN_REVISION_REQUIRED | BLOCKED",
    "- Verdict: FINAL_APPROVED | CHANGES_REQUESTED | PLAN_REVISION_REQUIRED | BLOCKED",
    "- Verdict: SELF_VERIFIED | CHANGES_REQUESTED",
    "- Verdict: APPROVED, CHANGES_REQUESTED",
    "- Verdict: MAYBE",
    "- Verdict: APPROVED (after fixes)",
    "- Verdict: CHANGES_REQUIRED",
    "- Verdict:",
  ]) assert.equal(reportVerdict(bad + "\n"), null, bad);
});

test("reportVerdict: the first label decides — an unchosen template does not fall through to the next line", () => {
  assert.equal(reportVerdict("- Verdict: APPROVED | BLOCKED\n- Verdict: APPROVED\n"), null);
});

test("catchesChunkDefect: the finding line has id R<n>, BLOCKER/MAJOR, chunk and AC-C2/2.5/integer; prose around it in any language", () => {
  assert.equal(catchesChunkDefect("R1 [BLOCKER] CHK-01 src/data/chunk.js:4 — размер 2.5 принимается молча, нарушен AC-C2"), true); // ru-fixture
  assert.equal(catchesChunkDefect("- R1 [MAJOR] CHK-01 src/data/chunk.js:4 — accepts non-integer size"), true);
  assert.equal(catchesChunkDefect("| R1 | BLOCKER | CHK-01 | src/data/chunk.js | OPEN | violates AC-C2 |"), true);
  assert.equal(catchesChunkDefect("# Review all — attempt 1\n- Verdict: CHANGES_REQUESTED\n\n1. r1 [blocker] CHK-01 chunk AC-C2\n"), false);
  // Without chunk — no; Russian words for "non-integer"/"integer" without AC-C2, 2.5 or integer — no.
  assert.equal(catchesChunkDefect("R1 [BLOCKER] CHK-02 src/index.js:3 — the splitting function does not check the size, violates AC-C2"), false);
  assert.equal(catchesChunkDefect("R1 [BLOCKER] CHK-01 src/data/chunk.js:4 — принимает нецелый размер, нужно целое число"), false); // ru-fixture: Russian words alone do not match
});

test("catchesChunkDefect: timings and mentions outside a finding line do not count (Checks: 2.5 s, chunk.js reviewed)", () => {
  assert.equal(catchesChunkDefect("## Checks\nnode --test: 28 pass, 2.5 s; src/data/chunk.js reviewed\n"), false);
  assert.equal(catchesChunkDefect("R2 [BLOCKER] TRN-01 src/text/truncate.js:9 — AC-A2\nChecked chunk: integer size ok, 2.5 s\n"), false);
  assert.equal(catchesChunkDefect("chunk accepts non-integer size — violates AC-C2"), false);
});

test("catchesChunkDefect: a non-blocking line (MINOR/NIT) does not count as a caught defect", () => {
  assert.equal(catchesChunkDefect("R3 [MINOR] CHK-01 src/data/chunk.js:4 — AC-C2: the error message for 2.5 is imprecise"), false);
  assert.equal(catchesChunkDefect("| R3 | NIT | CHK-01 | src/data/chunk.js | ACCEPTED_RISK | integer in the error text |"), false);
});

test("catchesChunkDefect: a finding in the review-protocol §2 format — the criterion is on an indented continuation line", () => {
  const block = [
    "R1 [BLOCKER] CHK-01 src/data/chunk.js:4 — fractional size is accepted",
    "  scenario: chunk([1,2,3], 2.5) → [[1,2],[3]]; probability=h; impact=h",
    "  criterion: AC-C2; fix: throw RangeError; confidence=h",
  ].join("\n");
  assert.equal(catchesChunkDefect(block), true);
  // A continuation without indentation or after an empty line is no longer part of the finding.
  assert.equal(catchesChunkDefect("R1 [BLOCKER] CHK-01 src/data/chunk.js:4 — fractional size\nAC-C2 here by mistake without indentation\n"), false);
  assert.equal(catchesChunkDefect("R1 [BLOCKER] CHK-01 src/data/chunk.js:4 — fractional size\n\n  AC-C2 after an empty line\n"), false);
});

test("importing the module does not start the CLI; a direct run (and through a symlink) works", () => {
  const root = mkdtempSync(path.join(tmpdir(), "orca-sandbox-test-"));
  try {
    const imported = spawnSync(process.execPath, ["--input-type=module", "-e", `await import(${JSON.stringify(pathToFileURL(SANDBOX_SCRIPT).href)}); console.log("imported");`], { encoding: "utf8" });
    assert.equal(imported.status, 0, imported.stderr);
    assert.equal(imported.stdout.trim(), "imported");
    assert.equal(imported.stderr, "");

    const missing = path.join(root, "no-sandbox");
    const direct = spawnSync(process.execPath, [SANDBOX_SCRIPT, "check", "--dir", missing], { encoding: "utf8" });
    assert.equal(direct.status, 1, direct.stderr);
    assert.match(direct.stdout, /^FAIL\s+sandbox/m);

    const link = path.join(root, "link-test-sandbox.mjs");
    symlinkSync(SANDBOX_SCRIPT, link);
    const viaLink = spawnSync(process.execPath, [link, "check", "--dir", missing], { encoding: "utf8" });
    assert.equal(viaLink.status, 1, viaLink.stderr);
    assert.match(viaLink.stdout, /^FAIL\s+sandbox/m);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("check: the verdict and the caught defect are read from English labels, not from Russian words", () => {
  const root = mkdtempSync(path.join(tmpdir(), "orca-sandbox-test-"));
  try {
    const dir = path.join(root, "sb");
    const prepared = spawnSync(process.execPath, [SANDBOX_SCRIPT, "prepare", "--dir", dir], { encoding: "utf8" });
    assert.equal(prepared.status, 0, prepared.stderr);
    const reports = path.join(dir, ".orca-pod", "reports", "v1");
    mkdirSync(reports, { recursive: true });
    writeFileSync(path.join(reports, "all-attempt1.md"), [
      "# Review all — attempt 1",
      "- Verdict: CHANGES_REQUESTED",
      "R1 [BLOCKER] chunk: размер 2.5 принимается молча — нарушен AC-C2", // ru-fixture
    ].join("\n"));
    writeFileSync(path.join(reports, "all-attempt2.md"), [
      "# Review all — attempt 2",
      "- Verdict: APPROVED",
      "In the first round it was CHANGES_REQUESTED; R1 → CLOSED.",
    ].join("\n"));
    writeFileSync(path.join(reports, "chief-attempt1.md"), "# Review chief — attempt 1\n- Verdict: FINAL_APPROVED\n");
    const result = spawnSync(process.execPath, [SANDBOX_SCRIPT, "check", "--dir", dir], { encoding: "utf8", timeout: 120000 });
    const line = (name) => result.stdout.split("\n").find((l) => l.includes(name)) || "";
    assert.match(line("attempt 1: CHANGES_REQUESTED"), /^PASS/);
    assert.match(line("attempt 1: chunk defect caught"), /^PASS/);
    assert.match(line("last Reviewer round: APPROVED"), /^PASS/);
    assert.match(line("final: FINAL_APPROVED"), /^PASS/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function historyFixture(t, roles) {
  const root = mkdtempSync(path.join(tmpdir(), "orca-review-history-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const config = path.join(root, "config.yaml");
  writeFileSync(config, [
    "active_profile: demo", "profiles:", "  demo:", "    default_provider: pi", "    roles:",
    ...["planner", "implementer", ...roles].flatMap((role) => [
      "      " + role + ":", "        model: demo", "        thinking: high",
    ]),
  ].join("\n") + "\n");
  const dir = path.join(root, "sandbox");
  const prepared = spawnSync(process.execPath, [SANDBOX_SCRIPT, "prepare", "--dir", dir, "--config", config]);
  assert.equal(prepared.status, 0, prepared.stderr.toString());
  const plan = path.join(dir, ".orca-pod", "reports", "v1");
  mkdirSync(plan, { recursive: true });
  return {
    plan, dir,
    suiteEvidence(artifact) {
      writeFileSync(path.join(plan, artifact + ".patch"), "");
      writeFileSync(path.join(plan, artifact + ".log"), "# pass 1\n# fail 0\n");
      return [
        "## Checks", "| command | exit_code | evidence_ref | snapshot | Outcome/reason |", "| --- | --- | --- | --- | --- |",
        `| node --test | 0 | ${artifact}.log | ${artifact}.patch | passed |`,
      ].join("\n");
    },
    report(name, body) { writeFileSync(path.join(plan, name), body + "\n"); },
    check(stage) {
      const result = spawnSync(process.execPath, [SANDBOX_SCRIPT, "check", "--dir", dir], { encoding: "utf8" });
      const line = result.stdout.split("\n").find((entry) => entry.includes(stage + " review attempts per cycle"));
      assert.ok(line, result.stdout + result.stderr);
      return line;
    },
  };
}

test("check: a scoped user continuation after legacy Chief BLOCKED advances the artifact and resets only the cycle attempt", (t) => {
  const fixture = historyFixture(t, ["reviewer", "chief_reviewer"]);
  fixture.report("all-attempt1.md", "Verdict: APPROVED");
  fixture.report("chief-attempt1.md", "Verdict: CHANGES_REQUESTED");
  const registry = (c1, c2) => [
    "## Registry", "| id | category | escalated_to | superseded_by | final_status |", "| --- | --- | --- | --- | --- |",
    "| R1 | MAJOR | C1 | — | " + c1 + " |", "| C1 | MAJOR | — | — | " + c1 + " |", "| C2 | BLOCKER | — | — | " + c2 + " |",
  ].join("\n");
  const blocked = "Verdict: BLOCKED\n" + registry("OPEN", "PARTIAL");
  fixture.report("chief-attempt2.md", blocked);
  const authorization = [
    "USER_AUTHORIZED_CONTINUATION [plan=v1, stage=chief, cycle=2, authorized_by=user, scope=C1 C2]",
    "previous_report: " + path.join(fixture.plan, "chief-attempt2.md"),
    "decision_ref: user message 8",
  ].join("\n");
  const third = [
    "- planVersion: v1; stage: chief; cycle: 2; attempt: 1/2; artifact: 3",
    "Verdict: CHANGES_REQUESTED", authorization, registry("CLOSED", "PARTIAL"),
  ].join("\n");
  const fourth = [
    "- planVersion: v1; stage: chief; cycle: 2; attempt: 2/2; artifact: 4",
    "Verdict: FINAL_APPROVED", registry("CLOSED", "CLOSED"), fixture.suiteEvidence("chief-attempt4"),
  ].join("\n");
  fixture.report("chief-attempt3.md", third);
  fixture.report("chief-attempt4.md", fourth);
  assert.match(fixture.check("chief"), /^PASS/);
  for (const [before, after] of [
    [authorization, ""], ["authorized_by=user", "authorized_by=reviewer"],
    ["chief-attempt2.md", "chief-attempt1.md"], ["scope=C1 C2", "scope=C3"],
    ["scope=C1 C2", "scope=C1"], ["decision_ref: user message 8", ""],
    ["attempt: 1/2", "attempt: 3/2"], ["artifact: 3", "artifact: 2"],
    ["R1 | MAJOR | C1 | — | CLOSED", "R1 | MAJOR | C1 | — | ACCEPTED_RISK"],
    ["R1 | MAJOR | C1 |", "R1 | MAJOR | C99 |"],
  ]) {
    fixture.report("chief-attempt3.md", third.replace(before, after));
    assert.match(fixture.check("chief"), /^FAIL/, before + " → " + after);
  }
  fixture.report("chief-attempt3.md", third);
  fixture.report("chief-attempt2.md", blocked.replace("Verdict: BLOCKED", "Verdict: CHANGES_REQUESTED"));
  assert.match(fixture.check("chief"), /^FAIL/);
  fixture.report("chief-attempt2.md", blocked);
  rmSync(path.join(fixture.plan, "chief-attempt3.md"));
  assert.match(fixture.check("chief"), /^FAIL/);
  rmSync(path.join(fixture.plan, "chief-attempt4.md"));
  fixture.report("chief-attempt3.md", third.replace("1/2", "1/1").replace("CHANGES_REQUESTED", "FINAL_APPROVED")
    .replace(registry("CLOSED", "PARTIAL"), registry("CLOSED", "CLOSED")) + "\n" + fixture.suiteEvidence("chief-attempt3"));
  assert.match(fixture.check("chief"), /^PASS/);
});

test("check: the sole reviewer shares the last-stage budget and accepts a legacy final-attempt1 companion", (t) => {
  const fixture = historyFixture(t, ["reviewer"]);
  fixture.report("all-attempt1.md", "Verdict: CHANGES_REQUESTED");
  fixture.report("all-attempt2.md", "Verdict: APPROVED");
  fixture.report("final-attempt1.md", "Verdict: CHANGES_REQUESTED");
  fixture.report("final-attempt2.md", "Verdict: FINAL_APPROVED");
  assert.match(fixture.check("all"), /^PASS/);
  fixture.report("final-attempt2.md", "Verdict: CHANGES_REQUESTED");
  fixture.report("final-attempt3.md", "Verdict: FINAL_APPROVED");
  assert.match(fixture.check("all"), /^FAIL/);
  for (const n of [1, 2, 3]) rmSync(path.join(fixture.plan, "final-attempt" + n + ".md"));
  const modern = (n, verdict) => `- planVersion: v1; stage: all; cycle: 1; attempt: ${n}/3; artifact: ${n}\nVerdict: ${verdict}`;
  fixture.report("final-attempt2.md", modern(2, "CHANGES_REQUESTED"));
  const final = modern(3, "FINAL_APPROVED") + "\n" + fixture.suiteEvidence("final-attempt3");
  fixture.report("final-attempt3.md", final);
  assert.match(fixture.check("all"), /^PASS/);
  fixture.report("final-attempt3.md", final.replace("3/3", "2/3"));
  assert.match(fixture.check("all"), /^FAIL/);
});

test("check: modern terminal success carries output and a real snapshot for the planned suite", (t) => {
  const fixture = historyFixture(t, ["reviewer", "chief_reviewer"]);
  const header = (stage) => `- planVersion: v1; stage: ${stage}; cycle: 1; attempt: 1/${stage === "chief" ? 2 : 3}; artifact: 1\n`;
  fixture.report("all-attempt1.md", header("all") + "Verdict: APPROVED");
  fixture.report("chief-attempt1.md", "Verdict: FINAL_APPROVED");
  assert.match(fixture.check("all"), /^PASS/); // Stage can have no planned command.
  assert.match(fixture.check("chief"), /FAIL.*missing cycle\/artifact/);
  const result = (evidence) => {
    fixture.report("chief-attempt1.md", header("chief") + "Verdict: FINAL_APPROVED\n" + evidence);
    return fixture.check("chief");
  };
  const checks = fixture.suiteEvidence("all-attempt1"); // Chief references the Reviewer's run.
  for (const invalid of [
    "", "## Checks\nAll tests passed.", checks.replace("0", "skipped"), checks.replace("0", "1"),
    checks.replace("all-attempt1.patch", "missing.patch"), checks.replace("all-attempt1.log", "missing.log"),
    checks.replace("node --test", "tsc --noEmit"),
  ]) assert.match(result(invalid), /^FAIL/, invalid);
  assert.match(result(checks), /^PASS/);
  const commit = spawnSync("git", ["-C", fixture.dir, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
  const baseline = checks.replace("all-attempt1.patch", "HEAD=" + commit);
  assert.match(result(baseline), /^PASS/);
  assert.match(result(checks.replace("all-attempt1.patch", "HEAD=" + "0".repeat(40))), /^FAIL/);
  writeFileSync(path.join(fixture.dir, "unreviewed.txt"), "worktree differs from HEAD\n");
  assert.match(result(baseline), /^FAIL/);
});

test("check: self-check budgets are per stage and a new stage starts at artifact 1", (t) => {
  const fixture = historyFixture(t, []);
  for (const stage of ["S1", "S2"]) {
    fixture.report(`self-check-${stage}-attempt1.md`, "Verdict: CHANGES_REQUESTED");
    fixture.report(`self-check-${stage}-attempt2.md`, "Verdict: SELF_VERIFIED");
    assert.match(fixture.check(stage), /^PASS/);
  }
  rmSync(path.join(fixture.plan, "self-check-S2-attempt1.md"));
  assert.match(fixture.check("S2"), /^FAIL/);
});

test("prepare: an existing directory without the marker is refused — TEST SANDBOX ERROR", () => {
  const root = mkdtempSync(path.join(tmpdir(), "orca-sandbox-test-"));
  try {
    const dir = path.join(root, "not-a-sandbox");
    mkdirSync(dir);
    writeFileSync(path.join(dir, "keep.txt"), "mine\n");
    const result = spawnSync(process.execPath, [SANDBOX_SCRIPT, "prepare", "--dir", dir], { encoding: "utf8" });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /^TEST SANDBOX ERROR: .* exists and is not a sandbox \(no \.orca-pod-sandbox\) — pass a different --dir$/m);
    assert.equal(readFileSync(path.join(dir, "keep.txt"), "utf8"), "mine\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("prepare: a missing --config file is refused — TEST SANDBOX ERROR", () => {
  const root = mkdtempSync(path.join(tmpdir(), "orca-sandbox-test-"));
  try {
    const result = spawnSync(process.execPath, [SANDBOX_SCRIPT, "prepare", "--dir", path.join(root, "sb"), "--config", path.join(root, "nope.yaml")], { encoding: "utf8" });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /^TEST SANDBOX ERROR: config not found: .*nope\.yaml$/m);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("check: a missing sandbox → FAIL line and an English summary line", () => {
  const root = mkdtempSync(path.join(tmpdir(), "orca-sandbox-test-"));
  try {
    const missing = path.join(root, "no-sandbox");
    const result = spawnSync(process.execPath, [SANDBOX_SCRIPT, "check", "--dir", missing], { encoding: "utf8" });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, new RegExp(`^FAIL\\s+sandbox — ${missing.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} not found — run prepare$`, "m"));
    assert.match(result.stdout, /^Summary: FAIL — 1 checks, FAIL 1, WARN 0$/m);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// A reference solution of the demo task (TASK.md): the check probes must accept it with the English outputs.
const REFERENCE_SOLUTION = {
  "src/text/truncate.js": [
    "export function truncate(text, max, ellipsis = '…') {",
    "  if (typeof text !== 'string') throw new TypeError('text must be a string');",
    "  if (!Number.isInteger(max) || max < 1) throw new RangeError('max must be an integer >= 1');",
    "  const chars = [...text];",
    "  if (chars.length <= max) return text;",
    "  return chars.slice(0, Math.max(0, max - [...ellipsis].length)).join('') + ellipsis;",
    "}",
  ],
  "src/time/duration.js": [
    "export function formatDuration(ms) {",
    "  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) throw new RangeError('ms must be a finite number >= 0');",
    "  const total = Math.floor(ms / 1000);",
    "  const parts = [[Math.floor(total / 86400), 'd'], [Math.floor(total / 3600) % 24, 'h'], [Math.floor(total / 60) % 60, 'm'], [total % 60, 's']];",
    "  const first = parts.findIndex(([value]) => value > 0);",
    "  return (first === -1 ? [[0, 's']] : parts.slice(first)).map(([value, unit]) => value + unit).join(' ');",
    "}",
  ],
  "src/data/chunk.js": [
    "export function chunk(array, size) {",
    "  if (!Array.isArray(array)) throw new TypeError('array must be an array');",
    "  if (!Number.isInteger(size) || size < 1) throw new RangeError('size must be an integer >= 1');",
    "  const parts = [];",
    "  for (let index = 0; index < array.length; index += size) parts.push(array.slice(index, index + size));",
    "  return parts;",
    "}",
  ],
  "src/report.js": [
    "import { truncate } from './text/truncate.js';",
    "import { formatDuration } from './time/duration.js';",
    "export function buildReport(entries, { width = 40 } = {}) {",
    "  const lines = entries.map(({ title, durationMs }) => truncate(title, width) + ' — ' + formatDuration(durationMs));",
    "  lines.push('Total: ' + formatDuration(entries.reduce((sum, entry) => sum + entry.durationMs, 0)));",
    "  return lines.join('\\n');",
    "}",
  ],
  "src/index.js": [
    "export { slugify } from './text/slugify.js';",
    "export { truncate } from './text/truncate.js';",
    "export { formatDuration } from './time/duration.js';",
    "export { chunk } from './data/chunk.js';",
    "export { buildReport } from './report.js';",
  ],
};

test("check: the AC probes accept a reference solution with the English demo outputs", () => {
  const root = mkdtempSync(path.join(tmpdir(), "orca-sandbox-test-"));
  try {
    const dir = path.join(root, "sb");
    const prepared = spawnSync(process.execPath, [SANDBOX_SCRIPT, "prepare", "--dir", dir], { encoding: "utf8" });
    assert.equal(prepared.status, 0, prepared.stderr);
    for (const [file, lines] of Object.entries(REFERENCE_SOLUTION)) {
      mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
      writeFileSync(path.join(dir, file), lines.join("\n") + "\n");
    }
    const result = spawnSync(process.execPath, [SANDBOX_SCRIPT, "check", "--dir", dir], { encoding: "utf8", timeout: 120000 });
    const line = (name) => result.stdout.split("\n").find((l) => l.includes(name)) || "";
    for (const name of [
      "file src/text/truncate.js", "file src/time/duration.js", "file src/data/chunk.js", "file src/report.js",
      "export slugify", "export truncate", "export formatDuration", "export chunk", "export buildReport",
      "AC-A1 short string unchanged", "AC-A2 length ≤ max and emoji intact", "AC-A3 max=0 → RangeError",
      'AC-B1 3723000 → "1h 2m 3s"', 'AC-B1 0 → "0s"', 'AC-B2 90061000 → "1d 1h 1m 1s"', "AC-B3 -1 → RangeError",
      "AC-C1 chunk([1..5], 2)", "AC-C2 size=2.5 → RangeError (test defect fixed)", "AC-C3 not an array → TypeError",
      'AC-D2 empty report → "Total: 0s"', "AC-D1 total line",
      "node --test in the sandbox",
    ]) assert.match(line(name), /^PASS/, name + "\n" + result.stdout);
    assert.match(result.stdout, /^WARN\s+test for truncate/m);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("demo task: TASK.md quotes the outputs the check probes; the project is orca-pod-sandbox", () => {
  const task = readFileSync(path.join(SANDBOX_SEED, "TASK.md"), "utf8");
  for (const quoted of ['`"1h 2m 3s"`', '`"0s"`', '`"1m 5s"`', '`"1d 1h 1m 1s"`', "`Total: <formatDuration of the sum>`", "`Total: 0s`"]) assert.ok(task.includes(quoted), quoted);
  assert.match(task, /`orca-pod-sandbox`/);
  assert.equal(JSON.parse(readFileSync(path.join(SANDBOX_SEED, "package.json"), "utf8")).name, "orca-pod-sandbox");
  assert.match(readFileSync(path.join(SANDBOX_SEED, "README.md"), "utf8"), /^# orca-pod-sandbox$/m);
});
