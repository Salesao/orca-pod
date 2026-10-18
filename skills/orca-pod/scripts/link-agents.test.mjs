import assert from "node:assert/strict";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const SCRIPT = fileURLToPath(new URL("./link-agents.sh", import.meta.url));
const SKILL_DIR = realpathSync(path.resolve(path.dirname(SCRIPT), ".."));

function withHome(run) {
  const home = mkdtempSync(path.join(tmpdir(), "orca-link-agents-"));
  try {
    return run(home);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

function link(home) {
  const result = spawnSync("bash", [SCRIPT], { encoding: "utf8", env: { ...process.env, HOME: home } });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.split("\n").filter(Boolean);
}

const isLink = (file) => {
  try {
    return lstatSync(file).isSymbolicLink();
  } catch {
    return false;
  }
};
const claudeTarget = (home, name = "worker.md") => path.join(home, ".claude", "agents", name);
const piTarget = (home, name = "verifier.md") => path.join(home, ".pi", "agent", "agents", name);

test("link-agents: first run prints LINK for Claude Code and Pi agents, the repeat prints OK", () => withHome((home) => {
  const first = link(home);
  assert.ok(first.includes(`LINK  ${claudeTarget(home)} -> ${path.join(SKILL_DIR, "agents", "claude", "worker.md")}`), first.join("\n"));
  assert.ok(first.some((line) => line.startsWith(`LINK  ${piTarget(home)} -> `)), first.join("\n"));
  assert.equal(readlinkSync(claudeTarget(home)), path.join(SKILL_DIR, "agents", "claude", "worker.md"));
  const second = link(home);
  assert.ok(second.includes(`OK    ${claudeTarget(home)}`), second.join("\n"));
  assert.equal(second.filter((line) => !line.startsWith("OK ")).length, 0, second.join("\n"));
}));

test("link-agents: the Pi orca-* helpers are linked into ~/.pi/agent/agents", () => withHome((home) => {
  const lines = link(home);
  for (const name of ["orca-worker", "orca-reviewer", "orca-scout", "orca-oracle", "orca-evidence-auditor"]) {
    assert.ok(lines.includes(`LINK  ${piTarget(home, `${name}.md`)} -> ${path.join(SKILL_DIR, "agents", "pi", `${name}.md`)}`), `${name}\n${lines.join("\n")}`);
  }
}));

test("link-agents: an existing regular file is not replaced — SKIP with a reason", () => withHome((home) => {
  mkdirSync(path.dirname(claudeTarget(home)), { recursive: true });
  writeFileSync(claudeTarget(home), "mine\n");
  const lines = link(home);
  assert.ok(lines.includes(`SKIP  ${claudeTarget(home)} (existing file is not replaced)`), lines.join("\n"));
  assert.equal(readFileSync(claudeTarget(home), "utf8"), "mine\n");
}));

test("link-agents: a link that is not ours is not replaced — SKIP with its target", () => withHome((home) => {
  mkdirSync(path.dirname(claudeTarget(home)), { recursive: true });
  const elsewhere = path.join(home, "elsewhere.md");
  writeFileSync(elsewhere, "x\n");
  symlinkSync(elsewhere, claudeTarget(home));
  const lines = link(home);
  assert.ok(lines.includes(`SKIP  ${claudeTarget(home)} -> ${elsewhere} (a link that is not ours)`), lines.join("\n"));
  assert.equal(readlinkSync(claudeTarget(home)), elsewhere);
}));

test("link-agents: a live link that is not ours stays — SKIP, another installed skill version may still use it", () => withHome((home) => {
  mkdirSync(path.dirname(claudeTarget(home)), { recursive: true });
  const olderVersion = path.join(home, "older-version", "worker.md");
  mkdirSync(path.dirname(olderVersion), { recursive: true });
  writeFileSync(olderVersion, "older\n");
  symlinkSync(olderVersion, claudeTarget(home));
  const lines = link(home);
  assert.ok(lines.includes(`SKIP  ${claudeTarget(home)} -> ${olderVersion} (a link that is not ours)`), lines.join("\n"));
  assert.ok(!lines.some((line) => line.startsWith("RELINK")), lines.join("\n"));
  assert.equal(readlinkSync(claudeTarget(home)), olderVersion);
}));

test("link-agents: a dangling link that is not ours (removed older version) is relinked to ours — RELINK", () => withHome((home) => {
  mkdirSync(path.dirname(claudeTarget(home)), { recursive: true });
  const removed = path.join(home, "removed-version", "worker.md"); // the target does not exist
  symlinkSync(removed, claudeTarget(home));
  const ours = path.join(SKILL_DIR, "agents", "claude", "worker.md");
  const lines = link(home);
  assert.ok(lines.includes(`RELINK ${claudeTarget(home)} -> ${ours} (was dangling: ${removed})`), lines.join("\n"));
  assert.ok(!lines.some((line) => line.includes(claudeTarget(home)) && line.startsWith("SKIP")), lines.join("\n"));
  assert.equal(readlinkSync(claudeTarget(home)), ours);
  assert.equal(readFileSync(claudeTarget(home), "utf8"), readFileSync(ours, "utf8"));
  const second = link(home); // idempotent: now it is our live link
  assert.ok(second.includes(`OK    ${claudeTarget(home)}`), second.join("\n"));
  assert.equal(second.filter((line) => !line.startsWith("OK ")).length, 0, second.join("\n"));
}));

test("link-agents: a dangling link in the Pi directory is relinked too — RELINK", () => withHome((home) => {
  mkdirSync(path.dirname(piTarget(home)), { recursive: true });
  const removed = path.join(home, "removed-version", "verifier.md");
  symlinkSync(removed, piTarget(home));
  const ours = path.join(SKILL_DIR, "agents", "pi", "verifier.md");
  const lines = link(home);
  assert.ok(lines.includes(`RELINK ${piTarget(home)} -> ${ours} (was dangling: ${removed})`), lines.join("\n"));
  assert.equal(readlinkSync(piTarget(home)), ours);
}));

test("link-agents: our own broken link (agent removed from the skill) is deleted — UNLINK", () => withHome((home) => {
  mkdirSync(path.dirname(claudeTarget(home)), { recursive: true });
  const gone = claudeTarget(home, "gone.md");
  symlinkSync(path.join(SKILL_DIR, "agents", "claude", "gone.md"), gone);
  const lines = link(home);
  assert.ok(lines.includes(`UNLINK ${gone} (agent removed from the skill)`), lines.join("\n"));
  assert.equal(isLink(gone), false);
}));
