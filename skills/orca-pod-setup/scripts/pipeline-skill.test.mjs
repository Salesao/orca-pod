import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { findPipelineSkill, PIPELINE_MISSING } from "./pipeline-skill.mjs";

const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const SETUP_SKILL_DIR = path.dirname(SCRIPTS_DIR);
const PIPELINE_SKILL_DIR = path.resolve(SETUP_SKILL_DIR, "..", "orca-pod");

// The orca-pod-setup skill without the form assets: the scripts alone are enough to run setup-form.mjs.
function copySetupSkill(target) {
  mkdirSync(path.join(target, "scripts"), { recursive: true });
  cpSync(SCRIPTS_DIR, path.join(target, "scripts"), {
    recursive: true,
    filter: (source) => !source.endsWith(".test.mjs"),
  });
}

function withTmp(run) {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "orca-pipeline-skill-test-")));
  try {
    return run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function fakePipelineSkill(dir) {
  mkdirSync(path.join(dir, "scripts"), { recursive: true });
  writeFileSync(path.join(dir, "scripts", "config-location.mjs"), "export {};\n");
}

test("PIPELINE_MISSING: the exact text with the expected path and the install command", () => {
  assert.equal(
    PIPELINE_MISSING("/x/skills/orca-pod"),
    "orca-pod skill not found at /x/skills/orca-pod; orca-pod-setup needs it next to itself — install the skills: npx skills add Salesao/orca-pod -g -y -s orca-pod orca-pod-setup plan-blitz -a claude-code codex pi",
  );
});

test("findPipelineSkill: no orca-pod next to the skill → null", () => withTmp((root) => {
  const setup = path.join(root, "skills", "orca-pod-setup");
  mkdirSync(setup, { recursive: true });
  assert.equal(findPipelineSkill(setup), null);
}));

test("findPipelineSkill: orca-pod is there but without scripts/config-location.mjs → null", () => withTmp((root) => {
  const setup = path.join(root, "skills", "orca-pod-setup");
  mkdirSync(setup, { recursive: true });
  mkdirSync(path.join(root, "skills", "orca-pod", "scripts"), { recursive: true });
  assert.equal(findPipelineSkill(setup), null);
}));

test("findPipelineSkill: orca-pod next to the skill → its path", () => withTmp((root) => {
  const setup = path.join(root, "skills", "orca-pod-setup");
  mkdirSync(setup, { recursive: true });
  fakePipelineSkill(path.join(root, "skills", "orca-pod"));
  assert.equal(findPipelineSkill(setup), path.join(root, "skills", "orca-pod"));
}));

test("findPipelineSkill: an install through a link (claude → agents) looks for the sibling from the real path", () => withTmp((root) => {
  const real = path.join(root, "agents", "skills", "orca-pod-setup");
  const link = path.join(root, "claude", "skills", "orca-pod-setup");
  mkdirSync(real, { recursive: true });
  mkdirSync(path.dirname(link), { recursive: true });
  symlinkSync(real, link);
  fakePipelineSkill(path.join(root, "agents", "skills", "orca-pod"));
  // There is no orca-pod next to the link — it lies next to the real directory.
  assert.equal(findPipelineSkill(link), path.join(root, "agents", "skills", "orca-pod"));
}));

test("findPipelineSkill: a link to the skill and no sibling next to the link or the original → null", () => withTmp((root) => {
  const real = path.join(root, "agents", "skills", "orca-pod-setup");
  const link = path.join(root, "claude", "skills", "orca-pod-setup");
  mkdirSync(real, { recursive: true });
  mkdirSync(path.dirname(link), { recursive: true });
  symlinkSync(real, link);
  // orca-pod lies only next to the link: Node resolves imports from the real path, where it will not be.
  fakePipelineSkill(path.join(root, "claude", "skills", "orca-pod"));
  assert.equal(findPipelineSkill(link), null);
}));

test("setup-form.mjs from a lone copy of orca-pod-setup: exit 2, JSON status error with a clear message", () => withTmp((root) => {
  const setup = path.join(root, "skills", "orca-pod-setup");
  copySetupSkill(setup);
  const result = spawnSync(process.execPath, [path.join(setup, "scripts", "setup-form.mjs"), "--no-open"], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 2, result.stdout + result.stderr);
  const lines = result.stdout.trim().split("\n");
  assert.equal(lines.length, 1, "stdout holds exactly one JSON line: " + result.stdout);
  const outcome = JSON.parse(lines[0]);
  assert.equal(outcome.status, "error");
  assert.equal(outcome.error, PIPELINE_MISSING(path.join(root, "skills", "orca-pod")));
  assert.match(outcome.error, /npx skills add Salesao\/orca-pod -g -y -s orca-pod orca-pod-setup plan-blitz -a claude-code codex pi$/);
  assert.doesNotMatch(outcome.error, /--all/);
  assert.doesNotMatch(result.stderr, /ERR_MODULE_NOT_FOUND/);
}));

test("setup-form.mjs through a claude → agents link with orca-pod next to the original: the check passes, the scripts are loaded", () => withTmp((root) => {
  const real = path.join(root, "agents", "skills", "orca-pod-setup");
  const link = path.join(root, "claude", "skills", "orca-pod-setup");
  copySetupSkill(real);
  symlinkSync(PIPELINE_SKILL_DIR, path.join(root, "agents", "skills", "orca-pod"));
  mkdirSync(path.dirname(link), { recursive: true });
  symlinkSync(real, link);
  // An invalid --timeout is rejected only after the dynamic imports: so they worked.
  const result = spawnSync(process.execPath, [path.join(link, "scripts", "setup-form.mjs"), "--timeout", "0"], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  const outcome = JSON.parse(result.stdout.trim().split("\n").pop());
  assert.equal(outcome.status, "error");
  assert.match(outcome.error, /--timeout must be a positive number/);
}));
