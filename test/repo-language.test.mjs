// Repo-wide language guard: the repository is English. No Cyrillic anywhere, except
//  (a) skills/orca-pod-setup/scripts/form/i18n.mjs — the Russian dictionary `MESSAGES.ru` of the setup form
//      (by design) plus the autonym `lang.name.ru` (the Russian name of Russian) in `MESSAGES.en`;
//  (b) lines carrying the marker `// ru-fixture` — a test that deliberately exercises Russian input;
//  (c) the Russian translations of the documentation: files named `*.ru.md` (README.ru.md) and `*.ru.svg` (the Russian
//      images in assets/), and the autonym of Russian (the language switch of README.md links to README.ru.md).
// Run: node --test test/repo-language.test.mjs  (also part of `npm test`).
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const CYRILLIC = /[\u0400-\u052F]/; // Cyrillic + Cyrillic Supplement
const MARKER = "// ru-fixture";
const AUTONYM = "\u0420\u0443\u0441\u0441\u043a\u0438\u0439"; // the autonym of Russian: the language switch link in README.md
const TRANSLATION = /(^|\/)[^/]+\.ru\.(md|svg)$/; // a Russian translation of a document or an image
const I18N = "skills/orca-pod-setup/scripts/form/i18n.mjs";
const SKIP_DIRS = new Set([".git", "node_modules", ".orca-pod"]); // the .orca-pod/ service folder is gitignored; the walk (no git) skips it too
const SKIP_PATHS = ["skills/orca-pod-setup/scripts/vendor"]; // vendored Bootstrap

const posix = (path) => path.split(sep).join("/");

function* walk(root, dir = root) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || SKIP_PATHS.includes(posix(relative(root, full)))) continue;
      yield* walk(root, full);
    } else if (entry.isFile()) {
      yield posix(relative(root, full));
    }
  }
}

/**
 * The files git would commit: tracked ones plus untracked ones that .gitignore does not hide (a pipeline run writes
 * Russian reports into the gitignored .orca-pod/). null when root is not the top of a git work tree.
 */
function gitFiles(root) {
  const top = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd: root, encoding: "utf8" });
  if (top.status !== 0 || realpathSync(top.stdout.trim()) !== realpathSync(root)) return null;
  const listed = spawnSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: root, maxBuffer: 256 * 1024 * 1024 });
  if (listed.status !== 0) return null;
  return [...new Set(listed.stdout.toString("utf8").split("\0").filter(Boolean))];
}

const underSkipped = (file) => file.split("/").some((part) => part === ".git" || part === "node_modules") || SKIP_PATHS.some((skipped) => file.startsWith(skipped + "/"));

/** Inside a git work tree: what git does not ignore. Otherwise a walk that skips .git, node_modules and .orca-pod. */
const repoFiles = (root) => (gitFiles(root) ?? [...walk(root)]).filter((file) => !underSkipped(file));

/** [{ file, line, raw }] for every line with Cyrillic in the text files of root, before the allowlist. */
function cyrillicLines(root) {
  const found = [];
  for (const file of repoFiles(root)) {
    let buffer;
    try { buffer = readFileSync(join(root, file)); } catch { continue; } // listed but gone, or not a file
    if (buffer.includes(0)) continue; // binary (fonts, images)
    buffer.toString("utf8").split("\n").forEach((text, index) => {
      if (CYRILLIC.test(text)) found.push({ file, line: index + 1, raw: text });
    });
  }
  return found;
}

/**
 * Cyrillic lines outside the allowlist: i18n.mjs as a file (its own tests below), Russian translations (*.ru.md, *.ru.svg),
 * lines with the // ru-fixture marker, and lines whose only Cyrillic is the autonym of Russian.
 */
const offendersOf = (root) => cyrillicLines(root).filter(({ file, raw }) =>
  file !== I18N && !TRANSLATION.test(file) && !raw.includes(MARKER) && CYRILLIC.test(raw.split(AUTONYM).join("")));

test("repo: no Cyrillic outside the allowlist (i18n.mjs, // ru-fixture lines)", () => {
  const offenders = offendersOf(ROOT);
  const report = offenders.map(({ file, line, raw }) => `  ${file}:${line}  ${raw.trim().slice(0, 100)}`).join("\n");
  assert.equal(offenders.length, 0, `Cyrillic found in ${offenders.length} line(s) of ${new Set(offenders.map((o) => o.file)).size} file(s):\n${report}`);
});

test("repo: the guard walks real files (sanity: it sees the setup form dictionary and this test)", () => {
  const files = repoFiles(ROOT);
  assert.ok(files.includes(I18N));
  assert.ok(files.includes("test/repo-language.test.mjs"));
  assert.ok(!files.some((file) => file.startsWith(".git/") || file.includes("node_modules/") || file.startsWith("skills/orca-pod-setup/scripts/vendor/")));
});

test("i18n.mjs: MESSAGES.en holds no Cyrillic except the lang.name.ru autonym", async () => {
  const { MESSAGES } = await import(new URL(`../${I18N}`, import.meta.url));
  const offenders = Object.entries(MESSAGES.en).filter(([key, value]) => CYRILLIC.test(String(value)) && key !== "lang.name.ru");
  assert.deepEqual(offenders.map(([key]) => key), []);
  assert.equal(MESSAGES.en["lang.name.ru"], "\u0420\u0443\u0441\u0441\u043a\u0438\u0439"); // the autonym of Russian
});

test("i18n.mjs: Cyrillic lines lie inside the `ru` dictionary or are the lang.name.ru autonym line (comments and code are English)", () => {
  const lines = readFileSync(join(ROOT, I18N), "utf8").split("\n");
  const start = lines.findIndex((line) => /^ {2}ru: \{\s*$/.test(line));
  assert.ok(start > 0, "the `ru: {` dictionary start was not found");
  const end = lines.findIndex((line, index) => index > start && /^ {2}\},?\s*$/.test(line));
  assert.ok(end > start, "the end of the `ru` dictionary was not found");
  const outside = lines
    .map((text, index) => ({ line: index + 1, text }))
    .filter(({ text, line }) => CYRILLIC.test(text) && (line - 1 <= start || line - 1 >= end) && !/^\s*'lang\.name\.ru':/.test(text));
  assert.deepEqual(outside.map(({ line, text }) => `${I18N}:${line}  ${text.trim().slice(0, 80)}`), []);
});

// ── which files are checked: what git does not ignore (a pipeline run writes Russian reports into the gitignored .orca-pod/) ──
const RUSSIAN = "\u043f\u0440\u0438\u0432\u0435\u0442"; // a Russian word, written with \u escapes

function withTempDir(run) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "orca-repo-language-test-")));
  try {
    return run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
const put = (root, file, text) => {
  mkdirSync(join(root, file, ".."), { recursive: true });
  writeFileSync(join(root, file), text);
};
const git = (root, ...args) => assert.equal(spawnSync("git", ["-C", root, ...args], { encoding: "utf8" }).status, 0, args.join(" "));
const names = (offenders) => offenders.map(({ file, line }) => `${file}:${line}`);

test("a git repository: gitignored files are not checked, a new unignored file with Cyrillic fails", () => withTempDir((root) => {
  git(root, "init", "-q");
  put(root, ".gitignore", ".orca-pod/\n");
  put(root, ".orca-pod/reports/x.md", `Verdict: ${RUSSIAN}\n`);
  put(root, "docs/ok.md", "plain English\n");
  assert.deepEqual(names(offendersOf(root)), []);
  put(root, "docs/x.md", `line one\n${RUSSIAN}\n`);
  assert.deepEqual(names(offendersOf(root)), ["docs/x.md:2"]);
  put(root, "docs/marked.md", `${RUSSIAN} // ru-fixture\n`);
  assert.deepEqual(names(offendersOf(root)), ["docs/x.md:2"], "a // ru-fixture line stays allowed");
}));

test("a git repository: tracked files are checked, a tracked file deleted from disk does not break the guard", () => withTempDir((root) => {
  git(root, "init", "-q");
  put(root, "tracked.md", `${RUSSIAN}\n`);
  put(root, "gone.md", "x\n");
  git(root, "add", ".");
  rmSync(join(root, "gone.md"));
  assert.deepEqual(names(offendersOf(root)), ["tracked.md:1"]);
}));

test("without git: the walk skips .git, node_modules and .orca-pod and checks the rest", () => withTempDir((root) => {
  put(root, ".orca-pod/reports/x.md", `${RUSSIAN}\n`);
  put(root, "node_modules/pkg/x.js", `// ${RUSSIAN}\n`);
  put(root, ".git/note", `${RUSSIAN}\n`);
  put(root, "skills/orca-pod-setup/scripts/vendor/b.css", `/* ${RUSSIAN} */\n`);
  put(root, "docs/x.md", `${RUSSIAN}\n`);
  assert.deepEqual(names(offendersOf(root)), ["docs/x.md:1"]);
}));

test("a folder inside another repository is walked, not listed by the parent's git (the root must be the work tree top)", () => withTempDir((parent) => {
  git(parent, "init", "-q");
  put(parent, ".gitignore", "sub/ignored.md\n");
  put(parent, "sub/ignored.md", `${RUSSIAN}\n`);
  assert.deepEqual(names(offendersOf(join(parent, "sub"))), ["ignored.md:1"]);
}));

test("Russian translations (*.ru.md, *.ru.svg) and the autonym of Russian are allowed; the same text anywhere else is not", () => withTempDir((root) => {
  put(root, "README.ru.md", `${RUSSIAN}\n`);
  put(root, "assets/hero.ru.svg", `<text>${RUSSIAN}</text>\n`);
  put(root, "README.md", `<a href="README.ru.md">${AUTONYM}</a>\n`);
  assert.deepEqual(names(offendersOf(root)), []);
  put(root, "docs/guide.md", `${RUSSIAN}\n`);
  put(root, "docs/guide.ru.txt", `${RUSSIAN}\n`);
  put(root, "README.md", `<a href="README.ru.md">${AUTONYM}</a> ${RUSSIAN}\n`);
  assert.deepEqual(names(offendersOf(root)).sort(), ["README.md:1", "docs/guide.md:1", "docs/guide.ru.txt:1"]);
}));
