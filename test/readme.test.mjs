// Doc and packaging guard: the root README exists and is accurate, every relative link in every README resolves,
// and the facts a newcomer needs (the install command, the requirements, the invocation forms) are present.
// Packaging: package.json runs this folder's tests, LICENSE is MIT (c) 2026 Salesao, CI runs on Node 20+.
// Run: node --test test/readme.test.mjs  (also part of `npm test`).
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { PIPELINE_MISSING } from "../skills/orca-pod-setup/scripts/pipeline-skill.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (file) => readFileSync(join(ROOT, file), "utf8");
const posix = (path) => path.split(sep).join("/");

const ROOT_README = "README.md";
const SKILL_READMES = ["skills/orca-pod/README.md", "skills/orca-pod-setup/README.md", "skills/plan-blitz/README.md"];
const ALL_READMES = [ROOT_README, ...SKILL_READMES];

/** Every README.md (and translation such as README.ru.md) in the repository, outside .git, node_modules, .orca-pod. */
function findReadmes(dir = ROOT) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if ([".git", "node_modules", ".orca-pod", "vendor"].includes(entry.name)) continue;
      found.push(...findReadmes(join(dir, entry.name)));
    } else if (entry.isFile() && /^README(\.[a-z]{2})?\.md$/.test(entry.name)) {
      found.push(posix(relative(ROOT, join(dir, entry.name))));
    }
  }
  return found;
}

/** The README text with fenced code blocks removed (links inside examples are not links). */
const withoutCodeFences = (text) => text.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[ \t]*$/gm, "");

/** Markdown inline links and images: [text](target "title") -> target. Inline code spans are blanked first. */
function linkTargets(text) {
  const prose = withoutCodeFences(text).replace(/`[^`\n]*`/g, "``");
  return [...prose.matchAll(/!?\[[^\]\n]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)].map((match) => match[1]);
}

/** GitHub heading anchors of a markdown file: lower-case, punctuation dropped, spaces to hyphens, -1/-2 for duplicates. */
function anchorsOf(text) {
  const seen = new Map();
  const anchors = new Set();
  for (const line of withoutCodeFences(text).split("\n")) {
    const match = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (!match) continue;
    const base = match[1]
      .replace(/`/g, "")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s_-]/gu, "")
      .trim()
      .replace(/\s/g, "-");
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    anchors.add(count === 0 ? base : `${base}-${count}`);
  }
  return anchors;
}

const isExternal = (target) => /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("//");

/** The body of a "## Heading" section of a markdown text (up to the next "## " heading). */
function sectionOf(text, heading) {
  const start = new RegExp(`^## ${heading}\\s*$`, "m").exec(text);
  assert.ok(start, `no "## ${heading}" section`);
  const rest = text.slice(start.index + start[0].length);
  const next = /^## /m.exec(rest);
  return next ? rest.slice(0, next.index) : rest;
}

/** Fenced code blocks (bash or any) of a text, as lists of lines. */
const codeBlocks = (text) => [...text.matchAll(/^```[^\n]*\n([\s\S]*?)^```[ \t]*$/gm)].map((match) => match[1].split("\n").filter(Boolean));

function withHome(run) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "orca-readme-home-")));
  try {
    return run(home);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

const TARGETED_INSTALL = "npx skills add Salesao/orca-pod -g -y -s orca-pod orca-pod-setup plan-blitz -a claude-code codex pi";
const ALL_INSTALL = "npx skills add Salesao/orca-pod -g --all";
const REMOVE = "npx skills remove orca-pod orca-pod-setup plan-blitz -g -y";

/** Every markdown document of the skills plus the root README (the docs a newcomer can read). */
function markdownDocs(dir = join(ROOT, "skills")) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...markdownDocs(full));
    else if (entry.isFile() && entry.name.endsWith(".md")) found.push(posix(relative(ROOT, full)));
  }
  return dir === join(ROOT, "skills") ? [ROOT_README, ...found] : found;
}

// ── the root README ──────────────────────────────────────────────────────────────────────────────────────────

test("the root README.md exists and is not a stub", () => {
  assert.ok(existsSync(join(ROOT, ROOT_README)), "README.md is missing in the repository root");
  const text = read(ROOT_README);
  assert.ok(text.length > 4000, `README.md is too short (${text.length} chars)`);
  assert.match(text, /^# orca-pod\s*$|<h1[^>]*>[\s\S]*?alt="orca-pod"/m, "the first heading should be the project name (a text heading or the hero image inside <h1>)");
});

test("the README finder sees the root README and both skill READMEs", () => {
  const found = findReadmes();
  for (const readme of ALL_READMES) assert.ok(found.includes(readme), `${readme} was not found by the walk`);
});

test("every relative link in every README resolves to a file or folder (and an existing heading for #anchors)", () => {
  const problems = [];
  for (const readme of findReadmes()) {
    const base = dirname(join(ROOT, readme));
    for (const target of linkTargets(read(readme))) {
      if (isExternal(target)) continue;
      const [pathPart, fragment] = target.split("#");
      const resolved = pathPart === "" ? join(ROOT, readme) : resolve(base, decodeURIComponent(pathPart));
      if (!resolved.startsWith(ROOT)) {
        problems.push(`${readme}: ${target} leaves the repository`);
        continue;
      }
      if (!existsSync(resolved)) {
        problems.push(`${readme}: ${target} -> ${posix(relative(ROOT, resolved))} does not exist`);
        continue;
      }
      if (fragment && statSync(resolved).isFile() && resolved.endsWith(".md") && !anchorsOf(readFileSync(resolved, "utf8")).has(fragment.toLowerCase())) {
        problems.push(`${readme}: ${target} -> no heading for #${fragment} in ${posix(relative(ROOT, resolved))}`);
      }
    }
  }
  assert.deepEqual(problems, []);
});

test("the skill READMEs link back to the root README", () => {
  for (const readme of SKILL_READMES) {
    assert.ok(linkTargets(read(readme)).includes("../../README.md"), `${readme} should link to ../../README.md`);
    assert.ok(existsSync(resolve(ROOT, dirname(readme), "../../README.md")));
  }
});

test("the root README links to the three skill READMEs, their SKILL.md files, the settings reference and the LICENSE", () => {
  const targets = linkTargets(read(ROOT_README)).map((target) => target.split("#")[0]);
  for (const expected of [
    "skills/orca-pod/README.md",
    "skills/orca-pod-setup/README.md",
    "skills/orca-pod/SKILL.md",
    "skills/orca-pod-setup/SKILL.md",
    "skills/plan-blitz/README.md",
    "skills/plan-blitz/SKILL.md",
    "skills/orca-pod-setup/references/settings.md",
    "LICENSE",
  ]) {
    assert.ok(targets.includes(expected), `README.md should link to ${expected}`);
  }
});

test("Install: the primary command is the targeted one (both skills, claude-code + codex + pi, global, non-interactive); --all is an alternative with its footprint", () => {
  const text = read(ROOT_README);
  const install = sectionOf(text, "Install");
  const blocks = codeBlocks(install).map((lines) => lines.join("\n"));
  assert.equal(blocks[0], TARGETED_INSTALL, "the first command of the Install section should be the targeted install");
  assert.ok(blocks.includes(ALL_INSTALL), "the --all command should stay as an alternative");
  assert.ok(install.indexOf(TARGETED_INSTALL) < install.indexOf(ALL_INSTALL), "the targeted command comes first");
  assert.match(install, /both skills/i, "it should say that both skills are required");
  assert.match(install, /every (supported )?agent/i, "it should state that --all installs into every supported agent");
  assert.match(install, /about 79/, "it should state the footprint of --all (about 79 agents)");
  assert.match(install, /orca-pod\*? links|links[^\n]*each agent|each agent's skills folder/i, "it should say that --all creates orca-pod links in each agent's skills folder");
  assert.ok(text.includes("~/.agents/skills/"), "it should say where a global install puts the skills");
  assert.ok(text.includes("~/.claude/skills/"), "it should mention the links in ~/.claude/skills/");
});

test("the 'orca-pod skill not found' message points at the README's primary install command, not the --all one", () => {
  const primary = codeBlocks(sectionOf(read(ROOT_README), "Install"))[0][0];
  assert.equal(primary, TARGETED_INSTALL, "the first command in the README's Install section is the targeted one");
  const message = PIPELINE_MISSING("/x/skills/orca-pod");
  assert.ok(message.endsWith(`install the skills: ${primary}`), message);
  assert.doesNotMatch(message, /--all/);
});

test("Uninstall: npx skills remove; a symlink-only cleanup that prints before it deletes; the Pi extension link is removed only if it is a link", () => {
  const uninstall = sectionOf(read(ROOT_README), "Uninstall");
  const lines = codeBlocks(uninstall).flat();
  assert.ok(lines.includes(REMOVE), "the uninstall command is missing");
  assert.ok(!/\brm\s+-[a-z]*f/.test(uninstall), "no `rm -f` in the uninstall section");
  const homeFind = lines.filter((line) => line.startsWith('find "$HOME"'));
  assert.equal(homeFind.length, 2, "one find that prints and one that deletes");
  assert.ok(homeFind[0].endsWith("-print") && homeFind[1].endsWith("-delete"), "print first, then delete");
  assert.ok(lines.indexOf(homeFind[0]) < lines.indexOf(homeFind[1]));
  const helperFind = lines.filter((line) => line.startsWith("find ~/.claude/agents"));
  assert.equal(helperFind.length, 2, "the helper-link cleanup also prints first and then deletes");
  assert.ok(helperFind[0].endsWith("-print") && helperFind[1].endsWith("-delete"));
  assert.ok(lines.includes("[ -L ~/.pi/agent/extensions/orca-pod-setup ] && rm ~/.pi/agent/extensions/orca-pod-setup"));
});

test("Uninstall: the documented cleanup commands do what they say, in a throwaway HOME (links at depth 3-5 go, decoys and real folders stay)", () => withHome((home) => {
  const lines = codeBlocks(sectionOf(read(ROOT_README), "Uninstall")).flat();
  const run = (command) => spawnSync("sh", ["-c", command], { env: { ...process.env, HOME: home }, encoding: "utf8" });
  const link = (target, path) => { mkdirSync(dirname(join(home, path)), { recursive: true }); symlinkSync(target, join(home, path)); };
  const exists = (path) => existsSync(join(home, path)) || lstatSync(join(home, path), { throwIfNoEntry: false }) !== undefined;
  mkdirSync(join(home, ".agents/skills/orca-pod"), { recursive: true });
  mkdirSync(join(home, ".agents/skills/orca-pod-setup"), { recursive: true });
  mkdirSync(join(home, ".agents/skills/plan-blitz"), { recursive: true });
  const ours = [".claude/skills/orca-pod", ".claude/skills/orca-pod-setup", ".config/crush/skills/orca-pod", ".config/kimchi/harness/skills/orca-pod-setup", ".claude/skills/plan-blitz"];
  link("../../.agents/skills/orca-pod", ours[0]);
  link("../../.agents/skills/orca-pod-setup", ours[1]);
  link("../../../.agents/skills/orca-pod", ours[2]);
  link("../../../../.agents/skills/orca-pod-setup", ours[3]);
  link("../../.agents/skills/plan-blitz", ours[4]);
  link("../elsewhere/plan-blitz", ".other/skills/plan-blitz"); // a link named plan-blitz that is not ours
  link("../elsewhere/orca-pod", ".other/skills/orca-pod"); // a link named orca-pod that is not ours
  link("../../.agents/skills/orca-pod", ".claude/skills/another-skill"); // a link to our folder under another name
  mkdirSync(join(home, ".copy/skills/orca-pod"), { recursive: true }); // a real folder named orca-pod
  const [print, del] = lines.filter((line) => line.startsWith('find "$HOME"'));
  const printed = run(print);
  assert.equal(printed.status, 0, printed.stderr);
  assert.deepEqual(printed.stdout.split("\n").filter(Boolean).map((path) => path.replace(`${home}/`, "")).sort(), [...ours].sort());
  assert.ok(ours.every(exists), "printing deletes nothing");
  assert.equal(run(del).status, 0);
  assert.ok(ours.every((path) => !exists(path)), "our links are deleted");
  for (const kept of [".other/skills/orca-pod", ".other/skills/plan-blitz", ".claude/skills/another-skill", ".copy/skills/orca-pod", ".agents/skills/orca-pod", ".agents/skills/orca-pod-setup", ".agents/skills/plan-blitz"]) assert.ok(exists(kept), `${kept} must stay`);

  const helpers = [".claude/agents/scout.md", ".claude/agents/worker.md", ".pi/agent/agents/verifier.md"];
  for (const path of helpers) link(`${home}/.agents/skills/orca-pod/agents/${path.split("/").pop()}`, path);
  link("/somewhere/else/agents/mine.md", ".claude/agents/mine.md");
  const [helperPrint, helperDel] = lines.filter((line) => line.startsWith("find ~/.claude/agents"));
  assert.deepEqual(run(helperPrint).stdout.split("\n").filter(Boolean).map((path) => path.replace(`${home}/`, "")).sort(), [...helpers].sort());
  assert.equal(run(helperDel).status, 0);
  assert.ok(helpers.every((path) => !exists(path)) && exists(".claude/agents/mine.md"));

  const extension = lines.find((line) => line.startsWith("[ -L ~/.pi/agent/extensions/orca-pod-setup ]"));
  mkdirSync(join(home, ".pi/agent/extensions/orca-pod-setup"), { recursive: true }); // a real directory (a copy): must not be touched
  writeFileSync(join(home, ".pi/agent/extensions/orca-pod-setup/index.js"), "// copy\n");
  run(extension);
  assert.ok(exists(".pi/agent/extensions/orca-pod-setup/index.js"), "a real directory is not removed");
  rmSync(join(home, ".pi/agent/extensions/orca-pod-setup"), { recursive: true });
  link("../../../.agents/skills/orca-pod-setup/pi-extension", ".pi/agent/extensions/orca-pod-setup");
  run(extension);
  assert.ok(!exists(".pi/agent/extensions/orca-pod-setup"), "the link is removed");
}));

test("the README carries the requirement facts (Orca, Node, git, Claude Code, Codex, Pi, superpowers)", () => {
  const text = read(ROOT_README);
  const facts = {
    "the orca CLI": "`orca`",
    "the orca-cli skill install command": "orca skills install --skill orca-cli",
    "the orca-cli skill check command": "orca skills installed",
    "Node.js >= 18": "Node.js 18",
    git: "git",
    "Pi subagent package": "npm:pi-subagents",
    "Pi subagent package version": "0.78.0",
    "the conflicting Pi package": "pi-interactive-subagents",
    "the Codex rule": 'prefix_rule(pattern=["orca"], decision="allow")',
    "the Codex rules file": "~/.codex/rules/default.rules",
    "superpowers: using-superpowers": "using-superpowers",
    "superpowers: brainstorming": "brainstorming",
    "superpowers: writing-plans": "writing-plans",
  };
  const missing = Object.entries(facts).filter(([, needle]) => !text.includes(needle)).map(([name]) => name);
  assert.deepEqual(missing, []);
  assert.match(text, /pi-subagents[\s\S]{0,400}pi-interactive-subagents[\s\S]{0,200}conflict/i, "it should say the two Pi packages conflict");
  assert.match(text, /do(es)? not resume/i, "it should say an interrupted run is not resumed");
  assert.match(text, /new (run|invocation)/i, "it should say a new run is a new invocation");
  assert.match(text, /full_access/, "the Codex rule is not needed with full_access");
});

test("the README names the plan-blitz invocation forms and the question tool of each agent", () => {
  const text = read(ROOT_README);
  for (const needle of ["/plan-blitz ", "$plan-blitz ", "/skill:plan-blitz ", "AskUserQuestion", "request_user_input", "codex --enable default_mode_request_user_input", "orca_pod_ask"]) {
    assert.ok(text.includes(needle), `README.md should mention ${needle.trim()}`);
  }
});

test("the README names the three agents and the invocation form of each", () => {
  const text = read(ROOT_README);
  for (const needle of ["Claude Code", "Codex", "Pi", "/orca-pod ", "$orca-pod ", "/skill:orca-pod ", "/orca-pod-setup"]) {
    assert.ok(text.includes(needle), `README.md should mention ${needle.trim()}`);
  }
});

test("the README covers test mode, language, full access, config and troubleshooting", () => {
  const text = read(ROOT_README);
  for (const needle of [
    "/orca-pod test",
    "test check",
    "test reset",
    "~/orca-pod-test",
    "language: auto",
    "ROLE:",
    "full_access",
    ".orca-pod/orca-pod.yaml",
    ".orca-pipeline",
    "orca-pipeline.yaml",
    "active_profile",
    "default_provider",
    "profiles",
    "max_subagents",
    "use_subagents",
    "subagents",
    "roles",
    "runtime_access_denied",
    "Bypass Permissions",
    "trust",
    "MIT",
  ]) {
    assert.ok(text.includes(needle), `README.md should mention ${needle}`);
  }
  assert.match(text, /max_subagents[^\n]*1[–-]100|1[–-]100[^\n]*max_subagents/, "max_subagents range 1-100 should be stated");
  assert.match(text, /default[^\n]*\b6\b|\b6\b[^\n]*default/i, "the max_subagents default of 6 should be stated");
  assert.match(text, /warning/i, "full_access needs an explicit warning");
});

test("Language: under auto your own messages decide (the demo task of /orca-pod test is not your text); English only when you wrote nothing", () => {
  const language = sectionOf(read(ROOT_README), "Language").replace(/\s+/g, " ");
  assert.match(language, /demo task[^.]{0,80}not your (?:own )?(?:text|words)/i, "the README should say the demo task is not the user's text");
  assert.match(language, /your own messages[^.]{0,120}(?:decide|set)/i, "the README should say the user's own messages decide under auto");
  assert.match(language, /(?:only\s+)?(?:when|if)\s+you\s+(?:have\s+)?(?:wrote|written|write)\s+nothing[^.]{0,80}English|English[^.]{0,80}(?:when|if)\s+you\s+(?:have\s+)?(?:wrote|written)\s+nothing/i, "English only when the user wrote nothing");
  assert.doesNotMatch(language, /With no user text at all, for example a bare `\/orca-pod test`, it is English\./);
});

test("First run: the form starts with subagents off, so the README tells the user to turn them on (it must not say 'leave on')", () => {
  const firstRun = sectionOf(read(ROOT_README), "First run");
  assert.doesNotMatch(firstRun, /leave subagents on/i);
  const item = /^\d+\. [^\n]*use_subagents[\s\S]*?(?=^\d+\. |\n\n)/m.exec(firstRun);
  assert.ok(item, "the First run list should have an item about the use_subagents switch");
  assert.match(item[0], /turn(ed)? on|switch(ed)? on|enable/i);
  assert.match(item[0], /Implementer/);
  assert.match(item[0], /\boff\b/i, "it should say that the form starts with the switch off");
  // ground truth: the form really starts a role with useSubagents false
  const formJs = readFileSync(join(ROOT, "skills/orca-pod-setup/scripts/form/form.js"), "utf8");
  assert.match(formJs, /useSubagents: false/);
});

test(".orca-pod/ is described as ignored only when the project has a .gitignore (ensure-gitignore.sh never creates one)", () => {
  const readme = read(ROOT_README).replace(/\s+/g, " ");
  assert.match(readme, /added to `?\.gitignore`? when the project has one/i);
  assert.match(readme, /add `\.orca-pod\/` yourself before committing/i);
  const offenders = markdownDocs().filter((file) => /(?:folder|directory)\s+is\s+in\s+`?\.gitignore/i.test(read(file).replace(/\s+/g, " ")));
  assert.deepEqual(offenders, [], "no document may say the .orca-pod/ folder simply is in .gitignore");
  assert.match(readFileSync(join(ROOT, "skills/orca-pod-setup/scripts/ensure-gitignore.sh"), "utf8"), /SKIP\s+\$file not found/);
});

test("Troubleshooting: runtime_access_denied is fixed by the rule or the escalation Codex asks for, never by full_access or a sandbox bypass", () => {
  const troubleshooting = sectionOf(read(ROOT_README), "Troubleshooting");
  const found = troubleshooting.split(/^- \*\*/m).find((item) => item.includes("runtime_access_denied"));
  assert.ok(found, "no bullet about runtime_access_denied");
  const bullet = found.replace(/\s+/g, " ");
  assert.ok(!bullet.includes("full_access"), "full_access is the bypass; it must not be offered as the fix");
  assert.ok(bullet.includes('prefix_rule(pattern=["orca"], decision="allow")'));
  assert.match(bullet, /orca-pod-setup/);
  assert.match(bullet, /elevat|escalat|approve/i, "approving the escalation Codex asks for is the other legitimate way");
  assert.match(bullet, /do not work around the sandbox/i);
});

test("the README names only commands and paths that exist in the repository", () => {
  const text = read(ROOT_README);
  const paths = [...new Set([...text.matchAll(/`((?:skills|test|\.github)\/[A-Za-z0-9_./-]+)`/g)].map((match) => match[1]))];
  const missing = paths.filter((path) => !existsSync(join(ROOT, path.replace(/\/$/, ""))));
  assert.deepEqual(missing, []);
});

test("the old product names appear only as the legacy layout (paragraphs that say old / legacy / migrated)", () => {
  const paragraphs = read(ROOT_README).split(/\n\s*\n/).filter((paragraph) => /orca-pipeline|orca-raf-pipeline/.test(paragraph));
  const stray = paragraphs.filter((paragraph) => !/legacy|old |migrat|previous|former/i.test(paragraph));
  assert.deepEqual(stray, []);
});

test("the example config in the README passes the real validator (launch-provider.mjs --profiles)", () => {
  const block = /^```yaml\n([\s\S]*?)^```/m.exec(read(ROOT_README));
  assert.ok(block, "the README should contain a ```yaml example");
  const project = realpathSync(mkdtempSync(join(tmpdir(), "orca-readme-test-")));
  try {
    assert.equal(spawnSync("git", ["init", "-q"], { cwd: project }).status, 0, "git init");
    mkdirSync(join(project, ".orca-pod"));
    writeFileSync(join(project, ".orca-pod", "orca-pod.yaml"), block[1]);
    const result = spawnSync(process.execPath, [join(ROOT, "skills/orca-pod/scripts/launch-provider.mjs"), "--profiles"], { cwd: project, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const out = JSON.parse(result.stdout);
    assert.equal(out.activeProfile, "default");
    assert.equal(out.language, "auto");
    assert.deepEqual(out.profiles.map((profile) => [profile.name, profile.valid, profile.reviewMode, profile.maxSubagents]), [["default", true, "reviewer", 6]]);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});

// ── packaging ────────────────────────────────────────────────────────────────────────────────────────────────

test("package.json: the npm test glob runs the skill tests and test/*.test.mjs; Node >= 18; no dependencies", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.name, "orca-pod");
  assert.equal(pkg.license, "MIT");
  assert.match(pkg.scripts.test, /\bnode --test\b/);
  for (const glob of ["skills/orca-pod/scripts/*.test.mjs", "skills/orca-pod-setup/scripts/*.test.mjs", "test/*.test.mjs"]) {
    assert.ok(pkg.scripts.test.includes(glob), `npm test should include ${glob}`);
  }
  assert.equal(pkg.engines.node, ">=18");
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.devDependencies, undefined);
});

test("LICENSE is MIT, 2026 Salesao", () => {
  const text = read("LICENSE");
  assert.match(text, /^MIT License/);
  assert.match(text, /Copyright \(c\) 2026 Salesao/);
});

test("CI runs npm test on Node 20 or newer", () => {
  const workflow = read(".github/workflows/test.yml");
  const version = /node-version:\s*["']?(\d+)/.exec(workflow);
  assert.ok(version, "no node-version in the workflow");
  assert.ok(Number(version[1]) >= 20, `CI Node version is ${version[1]}`);
  assert.match(workflow, /run:\s*npm test/);
});

test(".gitignore keeps the service folders out of the repository", () => {
  const lines = read(".gitignore").split("\n").map((line) => line.trim());
  for (const entry of ["node_modules/", ".orca-pod/"]) assert.ok(lines.includes(entry), `.gitignore should list ${entry}`);
});

test("the three skills have the files `npx skills` needs: SKILL.md with name and description", () => {
  for (const skill of ["orca-pod", "orca-pod-setup", "plan-blitz"]) {
    const text = read(`skills/${skill}/SKILL.md`);
    const front = /^---\n([\s\S]*?)\n---\n/.exec(text);
    assert.ok(front, `skills/${skill}/SKILL.md has no frontmatter`);
    assert.match(front[1], new RegExp(`^name:\\s*${skill}\\s*$`, "m"));
    assert.match(front[1], /^description:\s*\S/m);
  }
});

test("README: Pi helpers orca-* and the tsserver troubleshooting entry", () => {
  const text = read(ROOT_README).replace(/\s+/g, " ");
  assert.match(text, /orca-worker/);
  assert.match(text, /\*\*Many `tsserver` processes in Pi\.\*\*/);
});

test("README: Pi helpers need a model that does not come from a provider extension", () => {
  assert.match(read(ROOT_README).replace(/\s+/g, " "), /a model from a provider extension \(for example pi-claude-bridge\)/);
});

// ── the design: hero, diagram, banners, language switch, assets ──────────────────────────────────────────────

const RU_README = "README.ru.md";
const ASSETS = "assets";
const SKILLS = ["orca-pod", "orca-pod-setup", "plan-blitz"];
/** [English README, its Russian translation] for the root and for every skill. */
const PAIRS = [[ROOT_README, RU_README], ...SKILLS.map((skill) => [`skills/${skill}/README.md`, `skills/${skill}/README.ru.md`])];
const AUTONYM_RE = "\\u0420\\u0443\\u0441\\u0441\\u043a\\u0438\\u0439"; // the autonym of Russian, as a regex source

/** Targets of HTML attributes (href, src, srcset) outside code fences. */
const htmlTargets = (text) => [...withoutCodeFences(text).matchAll(/\b(?:href|src|srcset)="([^"]+)"/g)].map((match) => match[1]);

/** Every local target (markdown links and HTML attributes) of a README without its fragment; anchors of the file itself are left out. */
const localFiles = (readme) => [...new Set([...linkTargets(read(readme)), ...htmlTargets(read(readme))]
  .filter((target) => !isExternal(target))
  .map((target) => target.split("#")[0])
  .filter(Boolean))].sort();

test("HTML links and images of every README resolve (files, and a heading for every #anchor)", () => {
  const problems = [];
  for (const readme of findReadmes()) {
    const text = read(readme);
    const own = anchorsOf(text);
    for (const target of htmlTargets(text)) {
      if (isExternal(target)) continue;
      const [pathPart, fragment] = target.split("#");
      const resolved = pathPart === "" ? join(ROOT, readme) : resolve(dirname(join(ROOT, readme)), decodeURIComponent(pathPart));
      if (!existsSync(resolved)) { problems.push(`${readme}: ${target} does not exist`); continue; }
      const anchors = pathPart === "" ? own : (resolved.endsWith(".md") ? anchorsOf(readFileSync(resolved, "utf8")) : null);
      if (fragment && anchors && !anchors.has(decodeURIComponent(fragment).toLowerCase())) problems.push(`${readme}: ${target} has no heading`);
    }
  }
  assert.deepEqual(problems, []);
});

test("every README has a Russian translation next to it, and the finder sees all of them", () => {
  const found = findReadmes();
  for (const [en, ru] of PAIRS) {
    assert.ok(found.includes(en), `${en} was not found by the walk`);
    assert.ok(found.includes(ru), `${ru} is missing: every README has a Russian translation`);
  }
});

test("the logo, the hero, the diagram and the skill banners exist in both languages", () => {
  const files = ["logo.svg", "logo-small.svg", "hero-dark.svg", "hero-light.svg", "pipeline.svg", ...SKILLS.map((skill) => `skill-${skill}.svg`)];
  for (const file of files) {
    assert.ok(existsSync(join(ROOT, ASSETS, file)), `assets/${file} is missing`);
    if (!file.startsWith("logo")) assert.ok(existsSync(join(ROOT, ASSETS, file.replace(".svg", ".ru.svg"))), `assets/${file.replace(".svg", ".ru.svg")} is missing`);
  }
});

test("the root READMEs show the hero and the diagram with alt text and switch with the colour theme", () => {
  for (const [readme, suffix] of [[ROOT_README, ""], [RU_README, ".ru"]]) {
    const text = read(readme);
    for (const asset of [`hero-dark${suffix}.svg`, `hero-light${suffix}.svg`, `pipeline${suffix}.svg`]) {
      assert.ok(text.includes(`${ASSETS}/${asset}`), `${readme} should use ${ASSETS}/${asset}`);
    }
    assert.match(text, /<img src="assets\/hero-light[^"]*"[^>]*alt="orca-pod"/, `${readme}: the hero image needs alt text`);
    assert.match(text, /<img src="assets\/pipeline[^"]*" alt="[^"]{40,}"/, `${readme}: the diagram needs a real description as alt text`);
    assert.match(text, /prefers-color-scheme: dark/, `${readme}: the hero switches with the colour theme`);
  }
});

test("each skill README opens with its banner (named after the skill, in its own language) inside <h1>", () => {
  for (const skill of SKILLS) {
    for (const [file, suffix] of [[`skills/${skill}/README.md`, ""], [`skills/${skill}/README.ru.md`, ".ru"]]) {
      const text = read(file);
      assert.ok(text.includes(`<h1 align="center"><img src="../../assets/skill-${skill}${suffix}.svg" alt="${skill}"></h1>`), `${file}: the banner is missing or wrong`);
    }
  }
});

test("the Russian skill READMEs link back to the Russian root README", () => {
  for (const skill of SKILLS) {
    assert.ok(linkTargets(read(`skills/${skill}/README.ru.md`)).includes("../../README.ru.md"), `skills/${skill}/README.ru.md should link to ../../README.ru.md`);
  }
});

test("assets: every SVG is self-contained (no scripts, no external references) and each Russian image mirrors its English twin", () => {
  const files = readdirSync(join(ROOT, ASSETS)).filter((file) => file.endsWith(".svg"));
  assert.ok(files.length >= 14);
  const countOf = (text, pattern) => (text.match(pattern) ?? []).length;
  for (const file of files) {
    const text = readFileSync(join(ROOT, ASSETS, file), "utf8");
    assert.match(text, /^<svg\b[^>]*\bviewBox="[^"]+"/, `${file} should start with <svg ... viewBox>`);
    assert.doesNotMatch(text, /<script|foreignObject|@import|<image\b|(?:xlink:)?href\s*=\s*["'](?!#)/i, `${file} must not use scripts, foreignObject, images or external references`);
    if (file.endsWith(".ru.svg")) {
      const twin = readFileSync(join(ROOT, ASSETS, file.replace(".ru.svg", ".svg")), "utf8");
      assert.equal(/viewBox="([^"]+)"/.exec(text)[1], /viewBox="([^"]+)"/.exec(twin)[1], `${file}: the viewBox differs from its English twin`);
      assert.equal(countOf(text, /<text\b/g), countOf(twin, /<text\b/g), `${file}: the number of text lines differs from its English twin`);
    }
  }
});

test("language switch: each README links to its translation and marks its own language", () => {
  for (const [en, ru] of PAIRS) {
    const enName = en.split("/").pop();
    const ruName = ru.split("/").pop();
    assert.match(read(en), new RegExp(`<b>English</b> · <a href="${ruName.replace(".", "\\.")}">${AUTONYM_RE}</a>`), `${en}: the language switch is missing`);
    assert.match(read(ru), new RegExp(`<a href="${enName.replace(".", "\\.")}">English</a> · <b>${AUTONYM_RE}</b>`), `${ru}: the language switch is missing`);
  }
  assert.match(read(RU_README), /<h1[^>]*>[\s\S]*?alt="orca-pod"/, "README.ru.md should keep the project name as its first heading");
});

test("every Russian README mirrors its English one: same sections, same commands, same inline code, same files linked", () => {
  for (const [en, ru] of PAIRS) {
    const enText = read(en);
    const ruText = read(ru);
    const headings = (text) => [...withoutCodeFences(text).matchAll(/^#{2,3} .+$/gm)].map((match) => match[0].split(" ")[0]);
    assert.deepEqual(headings(ruText), headings(enText), `${ru}: the sections (and their levels) differ from ${en}`);
    const tagged = (text) => [...text.matchAll(/^```(\w+)\n([\s\S]*?)^```[ \t]*$/gm)]
      .map((match) => `${match[1]}\n${match[2].split("\n").filter((line) => line.trim() && !/^\s*#/.test(line)).join("\n")}`);
    assert.deepEqual(tagged(ruText), tagged(enText), `${ru}: the bash/yaml blocks (comments aside) must be identical in both languages`);
    const spans = (text) => new Set([...withoutCodeFences(text).matchAll(/`([^`\n]+)`/g)].map((match) => match[1]));
    const inRussian = spans(ruText);
    const missing = [...spans(enText)].filter((span) => !inRussian.has(span));
    assert.deepEqual(missing, [], `${ru}: inline code of ${en} that the translation does not carry (commands and keys are not translated)`);
    const normalized = (readme) => [...new Set(localFiles(readme)
      .map((target) => target.replace(".ru.svg", ".svg").replace(".ru.md", ".md"))
      .filter((target) => !/^README\.md$/.test(target)))].sort();
    assert.deepEqual(normalized(ru), normalized(en), `${ru} and ${en} should link the same files`);
  }
});

test("the READMEs say that the pipeline writes and runs no tests unless the user asks", () => {
  assert.match(read(ROOT_README).replace(/\s+/g, " "), /\*\*No tests unless you ask\.\*\* The roles do not write, change or run tests and do not follow TDD/);
  assert.match(read("skills/orca-pod/README.md").replace(/\s+/g, " "), /It does not write, change or run tests and does not follow TDD unless you ask for tests/);
});
