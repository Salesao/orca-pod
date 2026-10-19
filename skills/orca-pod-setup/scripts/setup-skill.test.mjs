import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

// SKILL.md is an instruction for the agent: it cannot justify a question asked before the roles are chosen.
const SKILL = readFileSync(new URL("../SKILL.md", import.meta.url), "utf8");

test("the question about the orca rule for Codex comes after the YAML is saved (step 4), and accounts for full_access", () => {
  const rule = SKILL.indexOf('prefix_rule(pattern=["orca"]');
  const save = SKILL.indexOf("## 4. Save the file and validate");
  const summary = SKILL.indexOf("## 5. Summary");
  assert.ok(rule > save && rule < summary, `the rule is at position ${rule}, step 4 at ${save}, step 5 at ${summary}`);
  assert.match(SKILL.slice(save, summary), /full_access/);
});

// A live Codex run: link-agents.sh and link-pi-extension.sh failed with "Operation not permitted" before the retry, and
// Pi listed no models inside the sandbox (it takes lock files in ~/.pi/agent).
test("the form from Codex: the link scripts and the form run with elevated permissions from the first call", () => {
  const scriptPath = SKILL.slice(SKILL.indexOf("### Claude Code and Codex"), SKILL.indexOf("## 4. Save the file and validate")).replace(/\s+/g, " ");
  assert.match(scriptPath, /Codex sandbox/);
  assert.match(scriptPath, /elevated permissions from the first call/);
  assert.match(scriptPath, /no write access \(sandbox\?\)/);
  const links = SKILL.slice(SKILL.indexOf("## 2. Connect the helper agents"), SKILL.indexOf("## 3. Choose the path")).replace(/\s+/g, " ");
  assert.match(links, /In Codex run this script, `link-pi-extension.sh` below and `setup-form.mjs` \(step 3\) with elevated permissions from the first call/);
});

// ── guards over all the setup docs ──

const SKILL_DIR = fileURLToPath(new URL("..", import.meta.url));
const DOCS = ["SKILL.md", "README.md", "references/settings.md", "references/discovery-and-recommendations.md"];
const readDoc = (name) => readFileSync(path.join(SKILL_DIR, name), "utf8");
const flat = (text) => text.replace(/\s+/g, " ");

test("the setup docs are English: no Cyrillic in any of them (the Russian translation README.ru.md is a separate file; the language switch carries the autonym of Russian)", () => {
  const AUTONYM = "\u0420\u0443\u0441\u0441\u043a\u0438\u0439"; // the autonym of Russian: the link to README.ru.md
  for (const name of DOCS) {
    const lines = readDoc(name).split("\n");
    const bad = lines.map((line, i) => [i + 1, line]).filter(([, line]) => /[\u0400-\u052F]/.test(line.split(AUTONYM).join("")));
    assert.deepEqual(bad, [], `${name} still has Cyrillic text`);
  }
});

test("SKILL.md keeps the five numbered steps in order", () => {
  const titles = [
    "## 1. Find the project config",
    "## 2. Connect the helper agents",
    "## 3. Choose the path for the current agent",
    "## 4. Save the file and validate",
    "## 5. Summary",
  ];
  const positions = titles.map((title) => SKILL.indexOf(title));
  assert.ok(positions.every((p) => p >= 0), `a step title is missing: ${positions}`);
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
});

test("SKILL.md: both form paths continue only if status is submitted", () => {
  assert.equal(SKILL.match(/only if `status: submitted`/g)?.length, 2);
  assert.match(flat(SKILL), /On `cancelled`, `timeout`, `aborted` or an error the configuration does not change/);
});

test("SKILL.md: the Codex rule is added only after an explicit yes", () => {
  const text = flat(SKILL);
  assert.match(text, /Add the line only after the user says "yes"/);
  assert.match(text, /on "no", say that Codex roles will ask for confirmation of `orca` commands/);
});

test("SKILL.md: the Pi form is a tool call, not a shell command, and is never polled", () => {
  const text = flat(SKILL);
  assert.match(text, /This is a \*\*Pi tool, not a shell command\*\*/);
  assert.match(text, /In Pi do not run `pipeline-form\.mjs`\/`setup-form\.mjs` through Bash/);
  assert.match(text, /Do not use `sleep`, polling, `--detach`, `--wait` or `result\.json`/);
});

test("SKILL.md: the Codex sandbox is never bypassed, the Claude Code form runs in the background", () => {
  const text = flat(SKILL);
  assert.match(text, /Do not bypass the sandbox/);
  assert.match(text, /Claude Code — \*\*in the background\*\* \(Bash `run_in_background: true`/);
});

test("SKILL.md: the file is rewritten only after the SHA-256 of the source is compared", () => {
  const text = flat(SKILL);
  assert.match(text, /compare the SHA-256 with `sourceHash`/);
  assert.match(text, /If it does not match, show the difference and ask what to do/);
});

test("SKILL.md: what not to do", () => {
  const tail = flat(SKILL.slice(SKILL.indexOf("## What not to do")));
  assert.match(tail, /Do not run roles, providers, Orca Run or subagents/);
  assert.match(tail, /Do not edit the YAML by hand instead of using the form, except on an explicit, narrowly scoped request/);
  assert.match(tail, /Do not write tests and do not run checks beyond `--profiles`\/`--validate`\/`--resolve`/);
});

test("settings.md: full_access only at the user's explicit request, never as a way around confirmations", () => {
  const text = flat(readDoc("references/settings.md"));
  assert.match(text, /Set `full_access: true` only at the user's explicit request/);
  assert.match(text, /do not enable it yourself or offer it as a way around confirmations/);
});

test("settings.md: the only YAML limit is max_subagents of the profile, no budget fields", () => {
  const text = flat(readDoc("references/settings.md"));
  assert.match(text, /The only limit in the YAML is the profile's `max_subagents`/);
  assert.match(text, /Do not add `budget`, `max_calls` or `max_parallel`/);
  assert.match(text, /an integer from 1 to 100, 6 if the field is absent/);
});

test("discovery-and-recommendations.md: no auth probes, no silent fallback to another model", () => {
  const text = flat(readDoc("references/discovery-and-recommendations.md"));
  assert.match(text, /Do not run separate auth\/model probes/);
  assert.match(text, /Do not silently switch to another model when the one you need is missing/);
  assert.match(text, /Do not run `codex exec` and do not start an app-server just to get a list/);
});

// ── fix round 1 ──

const RESOLVE_CHECK = "checks that the CLI is on PATH or in the usual install folders and, for Codex roles, that the model and thinking are in the Codex catalog";

test("--resolve is described the same way everywhere: CLI on PATH plus the Codex catalog, no auth or access check", () => {
  const skill = flat(SKILL);
  assert.ok(skill.includes(`\`--resolve\` ${RESOLVE_CHECK}; it does not check authorization or access to the model.`));
  const readme = flat(readDoc("README.md"));
  assert.equal(readme.split(RESOLVE_CHECK).length - 1, 2, "README describes --resolve in two places");
  assert.doesNotMatch(readme, /only looks for the CLI|only checks that the CLI/);
  assert.doesNotMatch(skill, /only checks that the CLI exists/);
});

test("settings.md has a root `language` row; the form language rule names ru and ru-*", () => {
  const settings = flat(readDoc("references/settings.md"));
  const row = settings.match(/\| `language` \|([^|]*)\|/)?.[1] ?? "";
  assert.ok(row, "the Main fields table has no `language` row");
  for (const needle of ["root", "`auto`", "^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$", "`pt-BR`", "explicit tag wins", "English when there is no user text", "rejects", "`ru` or `ru-*`", "the browser's first language", "any other explicit tag", "EN/RU switch", "overrides both"]) {
    assert.ok(row.includes(needle), `the language row does not mention ${needle}`);
  }
  assert.match(flat(SKILL), /\(`ru` or `ru-\*` — Russian, any other tag — English\)/);
});

test("SKILL.md What not to do: never set full_access yourself or offer it to get past a refusal", () => {
  const tail = flat(SKILL.slice(SKILL.indexOf("## What not to do")));
  assert.match(tail, /Do not set `full_access: true` yourself or offer it as a way around a sandbox or confirmation refusal — only at the user's explicit request \(see \[references\/settings\.md\]\(references\/settings\.md\)\)/);
});

test("SKILL.md: translation fixes (levels approximate, Generate YAML, 10 minutes, closed code span)", () => {
  const text = flat(SKILL);
  assert.match(text, /if the RPC is unavailable, the levels are approximate/);
  assert.doesNotMatch(text, /\bSubmit(ting)?\b/, "the button is called \"Generate YAML\", not Submit");
  assert.match(text, /Clicking "Generate YAML" resolves the tool's pending Promise/);
  assert.match(text, /validates the form when "Generate YAML" is pressed/);
  assert.match(text, /foreground Bash is limited to 10 minutes/);
  assert.ok(text.includes('Look for `prefix_rule(pattern=["orca"])` in `~/.codex/rules/*.rules`'));
});

test("settings.md: helpers heading and the subagents-block rule", () => {
  const text = flat(readDoc("references/settings.md"));
  assert.ok(text.includes("## Helpers: settings per role"));
  assert.match(text, /A `subagents` block is accepted even when `use_subagents: false` \(a stub for later\); an empty `subagents:` block is rejected\./);
});

test("discovery-and-recommendations.md: the models section of pi-subagents and child agents wording", () => {
  const text = flat(readDoc("references/discovery-and-recommendations.md"));
  assert.match(text, /read its native skill and its models section \(`guide` topic `models`\)/);
  assert.match(text, /For child agents \(subagents\) — only an alias or `inherit`/);
});

test("README: --resolve catalog warning is an entry of the `warnings` array of the JSON output", () => {
  const text = flat(readDoc("README.md"));
  assert.match(text, /an unavailable catalog adds an entry to the `warnings` array of the JSON output/);
  assert.doesNotMatch(text, /gives a warning line/);
});

test("README: form language precedence, Codex rule step title, Codex runs the form as an ordinary command", () => {
  const text = flat(readDoc("README.md"));
  assert.match(text, /6\. Asks whether to add the Codex rule\./);
  assert.match(text, /Codex runs it as an ordinary command and waits for it/);
  assert.match(text, /A language chosen with the EN\/RU switch is remembered in this browser during the form session and takes precedence over both/);
});

// Relative links between the docs of the two skills must resolve (files and #anchors).
// Links that leave skills/ (the repository README) are not checked here.
const slug = (heading) => heading.toLowerCase().replace(/[`*]/g, "").replace(/[^\p{L}\p{N}\s-]/gu, "").trim().replace(/\s/g, "-");
const anchorsOf = (file) => new Set([...readFileSync(file, "utf8").matchAll(/^#{1,6} +(.+)$/gm)].map((m) => slug(m[1])));

test("relative links between the docs resolve to existing files and headings", () => {
  const skillsRoot = path.resolve(SKILL_DIR, "..");
  const problems = [];
  for (const name of DOCS) {
    const from = path.join(SKILL_DIR, name);
    for (const [, target] of readDoc(name).matchAll(/\]\(([^)\s]+)\)/g)) {
      if (/^[a-z]+:/i.test(target)) continue;
      const [file, anchor] = target.split("#");
      const resolved = file ? path.resolve(path.dirname(from), file) : from;
      if (path.relative(skillsRoot, resolved).startsWith("..")) continue;
      if (!existsSync(resolved)) { problems.push(`${name}: ${target} — no such file`); continue; }
      if (anchor && !anchorsOf(resolved).has(anchor)) problems.push(`${name}: ${target} — no such heading`);
    }
  }
  assert.deepEqual(problems, []);
});

// README: the file tree must list real files and the setup-specific requirements must be there.
const README = readDoc("README.md");

function allFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    if (entry.isDirectory()) out.push(...allFiles(path.join(dir, entry.name)));
    else out.push(entry.name);
  }
  return out;
}

test("README: every file named in the layout tree exists", () => {
  const tree = README.match(/```\n(orca-pod-setup\/\n[\s\S]*?)```/)?.[1];
  assert.ok(tree, "the layout tree is missing");
  const existing = new Set(allFiles(SKILL_DIR));
  const missing = [...tree.matchAll(/[├└]── (\S+)/g)].map((m) => m[1]).filter((n) => !n.endsWith("/") && !existing.has(path.posix.basename(n)));
  assert.deepEqual(missing, []);
});

test("README: setup-specific requirements and the link to the repository README", () => {
  const text = flat(README);
  assert.match(text, /\]\(\.\.\/\.\.\/README\.md\)/);
  for (const needle of ["orca_pod_setup", "scripts/link-pi-extension.sh", "link-agents.sh", "pi --list-models", "prefix_rule(pattern=[\"orca\"], decision=\"allow\")", "/reload"]) {
    assert.ok(text.includes(needle), `README does not mention ${needle}`);
  }
});

test("link-agents docs: RELINK replaces a dangling link, only regular files and live links of others are kept — no blanket 'does not replace'", () => {
  const readme = flat(README);
  assert.match(readme, /do not replace existing regular files or other people's live links and write `SKIP` instead; `link-agents\.sh` replaces a dangling link \(`RELINK`\)/);
  assert.doesNotMatch(readme, /do not replace existing files and other people's links/);
  const skill = flat(SKILL);
  const step2 = skill.slice(skill.indexOf("## 2. Connect the helper agents"), skill.indexOf("## 3. Choose the path"));
  assert.match(step2, /Run \(idempotent, does not replace existing regular files or live links of others, relinks dangling ones\)/);
  assert.doesNotMatch(step2, /does not replace existing files\)/);
  assert.match(step2, /Show the `SKIP` and `RELINK` lines to the\s+user/);
  assert.match(step2, /RELINK[^.]*changes a link on the user's machine/);
});

const ENSURE_GITIGNORE = fileURLToPath(new URL("./ensure-gitignore.sh", import.meta.url));

function withGitRepo(gitignore, run) {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "orca-gitignore-test-")));
  try {
    spawnSync("git", ["-C", root, "init", "-q"]);
    if (gitignore !== null) writeFileSync(path.join(root, ".gitignore"), gitignore);
    const result = spawnSync("bash", [ENSURE_GITIGNORE, root], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return run(result.stdout, () => readFileSync(path.join(root, ".gitignore"), "utf8"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("ensure-gitignore.sh adds .orca-pod/ to an existing .gitignore, with an English comment line", () => withGitRepo("node_modules/\n", (out, read) => {
  assert.match(out, /^ADDED \.orca-pod\//);
  assert.deepEqual(read().split("\n").filter((line) => line && !line.startsWith("#")), ["node_modules/", ".orca-pod/"]);
  assert.ok(read().split("\n").includes("# orca-pod: config and review reports"), read());
}));

test("ensure-gitignore.sh: .orca-pod/ is already there → OK, the file does not change", () => withGitRepo("a\n.orca-pod/\n", (out, read) => {
  assert.match(out.trim(), /^OK    \.orca-pod\/ is already ignored \(.*\.gitignore\)$/);
  assert.equal(read(), "a\n.orca-pod/\n");
}));

test("ensure-gitignore.sh: the old .orca-pipeline/ line stays, .orca-pod/ is added", () => withGitRepo(".orca-pipeline/\n", (out, read) => {
  assert.match(out, /^ADDED \.orca-pod\//);
  const lines = read().split("\n");
  assert.ok(lines.includes(".orca-pipeline/") && lines.includes(".orca-pod/"));
}));

test("ensure-gitignore.sh: no .gitignore → SKIP, the file is not created", () => withGitRepo(null, (out) => {
  assert.match(out.trim(), /^SKIP  .*\.gitignore not found, \.orca-pod\/ not added$/);
}));

test("ensure-gitignore.sh: not a Git repository → SKIP, nothing is written", () => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "orca-gitignore-nogit-")));
  try {
    const result = spawnSync("bash", [ENSURE_GITIGNORE, root], { encoding: "utf8", env: { ...process.env, GIT_CEILING_DIRECTORIES: path.dirname(root) } });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), "SKIP  not a Git repository, .gitignore not changed");
    assert.equal(existsSync(path.join(root, ".gitignore")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("setup docs: Pi runs worker/reviewer/scout/oracle/evidence-auditor as the skill's orca-* agents without pi-lens", () => {
  for (const text of [flat(SKILL), flat(readDoc("references/settings.md"))]) {
    assert.match(text, /`orca-<name>`|`orca-\*`/);
    assert.match(text, /without pi-lens/);
  }
  assert.doesNotMatch(flat(SKILL), /The bundled pi-subagents agents \(scout, worker, reviewer/);
});

test("settings.md: the orca-* helpers cannot use a model from a provider extension", () => {
  assert.match(flat(readDoc("references/settings.md")), /a model from a provider extension \(for example pi-claude-bridge\)/);
});
