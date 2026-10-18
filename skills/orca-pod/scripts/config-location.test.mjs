import assert from "node:assert/strict";
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { activeConfigPath, configLocation, gitLocation, migrateLegacyConfig, migrationLine, migrationText } from "./config-location.mjs";

const YAML = "active_profile: default\n";

function withTemp(run) {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "orca-config-location-")));
  try {
    return run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function writeFile(file, text = YAML) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}

test("main checkout: activePath = <root>/.orca-pod/orca-pod.yaml", () => withTemp((root) => {
  const location = configLocation({ worktreeRoot: root, commonDir: path.join(root, ".git") });
  assert.equal(location.mainRoot, root);
  assert.equal(location.activePath, path.join(root, ".orca-pod", "orca-pod.yaml"));
  assert.equal(location.legacyPath, path.join(root, "orca-pipeline.yaml"));
  assert.deepEqual(location.legacyDirs, [path.join(root, ".orca-pipeline")]);
}));

test("linked worktree without its own config takes the shared config of the main checkout", () => withTemp((root) => {
  const main = path.join(root, "main");
  const worktree = path.join(root, "wt");
  const location = configLocation({ worktreeRoot: worktree, commonDir: path.join(main, ".git") });
  assert.equal(location.mainRoot, main);
  assert.equal(location.activePath, path.join(main, ".orca-pod", "orca-pod.yaml"));
  assert.equal(location.worktreePath, path.join(worktree, ".orca-pod", "orca-pod.yaml"));
  assert.equal(location.sharedPath, path.join(main, ".orca-pod", "orca-pod.yaml"));
  assert.equal(location.legacyPath, path.join(worktree, "orca-pipeline.yaml"));
  assert.deepEqual(location.legacyDirs, [path.join(worktree, ".orca-pipeline"), path.join(main, ".orca-pipeline")]);
}));

test("linked worktree with its own config takes its own", () => withTemp((root) => {
  const main = path.join(root, "main");
  const worktree = path.join(root, "wt");
  writeFile(path.join(worktree, ".orca-pod", "orca-pod.yaml"));
  const location = configLocation({ worktreeRoot: worktree, commonDir: path.join(main, ".git") });
  assert.equal(location.activePath, path.join(worktree, ".orca-pod", "orca-pod.yaml"));
}));

test("commonDir is not .git (submodule): mainRoot = worktreeRoot", () => withTemp((root) => {
  const location = configLocation({ worktreeRoot: path.join(root, "sub"), commonDir: path.join(root, ".git", "modules", "sub") });
  assert.equal(location.mainRoot, path.join(root, "sub"));
  assert.equal(location.legacyDirs.length, 1);
}));

const mainLocation = (root) => configLocation({ worktreeRoot: root, commonDir: path.join(root, ".git") });

test("v2 dir → moved, reports kept: .orca-pipeline/ moved whole into .orca-pod/, orca-pipeline.yaml → orca-pod.yaml", () => withTemp((root) => {
  writeFile(path.join(root, ".orca-pipeline", "orca-pipeline.yaml"), "old: 1\n");
  writeFile(path.join(root, ".orca-pipeline", "reports", "x.md"), "report\n");
  const location = mainLocation(root);
  const results = migrateLegacyConfig(location);
  assert.deepEqual(results, [{ status: "moved", from: path.join(root, ".orca-pipeline"), to: path.join(root, ".orca-pod") }]);
  assert.equal(readFileSync(path.join(root, ".orca-pod", "orca-pod.yaml"), "utf8"), "old: 1\n");
  assert.equal(readFileSync(path.join(root, ".orca-pod", "reports", "x.md"), "utf8"), "report\n");
  assert.equal(existsSync(path.join(root, ".orca-pod", "orca-pipeline.yaml")), false);
  assert.equal(existsSync(path.join(root, ".orca-pipeline")), false);
  assert.equal(existsSync(location.activePath), true);
}));

test("v2 dir without yaml (reports only) → moved, orca-pod.yaml does not appear", () => withTemp((root) => {
  writeFile(path.join(root, ".orca-pipeline", "reports", "x.md"), "report\n");
  const results = migrateLegacyConfig(mainLocation(root));
  assert.equal(results.length, 1);
  assert.equal(results[0].status, "moved");
  assert.equal(existsSync(path.join(root, ".orca-pod", "reports", "x.md")), true);
  assert.equal(existsSync(path.join(root, ".orca-pod", "orca-pod.yaml")), false);
}));

test("v2 dir: an orca-pod.yaml already inside it is not overwritten by the rename", () => withTemp((root) => {
  writeFile(path.join(root, ".orca-pipeline", "orca-pipeline.yaml"), "old: 1\n");
  writeFile(path.join(root, ".orca-pipeline", "orca-pod.yaml"), "kept: 2\n");
  const results = migrateLegacyConfig(mainLocation(root));
  assert.equal(results[0].status, "moved");
  assert.equal(readFileSync(path.join(root, ".orca-pod", "orca-pod.yaml"), "utf8"), "kept: 2\n");
  assert.equal(readFileSync(path.join(root, ".orca-pod", "orca-pipeline.yaml"), "utf8"), "old: 1\n");
}));

test("v2 dir and .orca-pod both exist → ignored, both untouched", () => withTemp((root) => {
  writeFile(path.join(root, ".orca-pipeline", "orca-pipeline.yaml"), "old: 1\n");
  writeFile(path.join(root, ".orca-pod", "orca-pod.yaml"), "new: 2\n");
  const results = migrateLegacyConfig(mainLocation(root));
  assert.deepEqual(results, [{ status: "ignored", from: path.join(root, ".orca-pipeline"), to: path.join(root, ".orca-pod") }]);
  assert.equal(readFileSync(path.join(root, ".orca-pipeline", "orca-pipeline.yaml"), "utf8"), "old: 1\n");
  assert.equal(readFileSync(path.join(root, ".orca-pod", "orca-pod.yaml"), "utf8"), "new: 2\n");
  assert.equal(existsSync(path.join(root, ".orca-pod", "orca-pipeline.yaml")), false);
}));

test("v2 dir is a symlink → skipped, symlink left in place", () => withTemp((root) => {
  writeFile(path.join(root, "elsewhere", "orca-pipeline.yaml"));
  symlinkSync(path.join(root, "elsewhere"), path.join(root, ".orca-pipeline"));
  const results = migrateLegacyConfig(mainLocation(root));
  assert.equal(results.length, 1);
  assert.equal(results[0].status, "skipped");
  assert.equal(results[0].reason, "not a directory");
  assert.equal(results[0].from, path.join(root, ".orca-pipeline"));
  assert.equal(lstatSync(path.join(root, ".orca-pipeline")).isSymbolicLink(), true);
  assert.equal(existsSync(path.join(root, ".orca-pod")), false);
}));

test("v2 dir is a regular file → skipped", () => withTemp((root) => {
  writeFile(path.join(root, ".orca-pipeline"), "not a dir\n");
  const results = migrateLegacyConfig(mainLocation(root));
  assert.equal(results[0].status, "skipped");
  assert.equal(readFileSync(path.join(root, ".orca-pipeline"), "utf8"), "not a dir\n");
}));

test("v2 dir: EXDEV on directory rename → recursive copy and source removal", () => withTemp((root) => {
  writeFile(path.join(root, ".orca-pipeline", "orca-pipeline.yaml"), "old: 1\n");
  writeFile(path.join(root, ".orca-pipeline", "reports", "v1", "x.md"), "report\n");
  const rename = (from, to) => {
    if (from === path.join(root, ".orca-pipeline")) throw Object.assign(new Error("cross-device"), { code: "EXDEV" });
    return renameSync(from, to);
  };
  const results = migrateLegacyConfig(mainLocation(root), { rename });
  assert.equal(results[0].status, "moved");
  assert.equal(readFileSync(path.join(root, ".orca-pod", "orca-pod.yaml"), "utf8"), "old: 1\n");
  assert.equal(readFileSync(path.join(root, ".orca-pod", "reports", "v1", "x.md"), "utf8"), "report\n");
  assert.equal(existsSync(path.join(root, ".orca-pipeline")), false);
}));

test("root file: copy failure on EXDEV → partially copied target removed, source intact, error rethrown", () => withTemp((root) => {
  writeFile(path.join(root, "orca-pipeline.yaml"), "old: 1\n");
  const rename = () => { throw Object.assign(new Error("cross-device"), { code: "EXDEV" }); };
  const copyFile = (from, to) => {
    writeFileSync(to, "old"); // truncated copy
    throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
  };
  const location = mainLocation(root);
  assert.throws(() => migrateLegacyConfig(location, { rename, copyFile }), /disk full/);
  assert.equal(existsSync(location.activePath), false);
  assert.equal(readFileSync(location.legacyPath, "utf8"), "old: 1\n");
  // A retry without the failure completes the move: a truncated file does not pass for the active config.
  assert.equal(migrateLegacyConfig(location, { rename, copyFile: copyFileSync })[0].status, "moved");
  assert.equal(readFileSync(location.activePath, "utf8"), "old: 1\n");
}));

test("v2 dir: directory copy failure on EXDEV → partially copied .orca-pod removed, source intact", () => withTemp((root) => {
  writeFile(path.join(root, ".orca-pipeline", "orca-pipeline.yaml"), "old: 1\n");
  const rename = () => { throw Object.assign(new Error("cross-device"), { code: "EXDEV" }); };
  const copyDirectory = (from, to) => {
    mkdirSync(to);
    writeFileSync(path.join(to, "orca-pipeline.yaml"), "ol");
    throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
  };
  assert.throws(() => migrateLegacyConfig(mainLocation(root), { rename, copyDirectory }), /disk full/);
  assert.equal(existsSync(path.join(root, ".orca-pod")), false);
  assert.equal(readFileSync(path.join(root, ".orca-pipeline", "orca-pipeline.yaml"), "utf8"), "old: 1\n");
}));

test("activePath after the move: a linked worktree's own config wins over the shared one (location is updated in place)", () => withTemp((root) => {
  const main = path.join(root, "main");
  const worktree = path.join(root, "wt");
  writeFile(path.join(worktree, ".orca-pipeline", "orca-pipeline.yaml"), "wt: 1\n");
  const location = configLocation({ worktreeRoot: worktree, commonDir: path.join(main, ".git") });
  assert.equal(location.activePath, path.join(main, ".orca-pod", "orca-pod.yaml"), "before the move the shared path is active");
  migrateLegacyConfig(location);
  assert.equal(location.activePath, path.join(worktree, ".orca-pod", "orca-pod.yaml"));
  assert.equal(activeConfigPath(location), location.activePath);
  assert.equal(readFileSync(location.activePath, "utf8"), "wt: 1\n");
}));

test("activePath after moving a linked worktree's root file stays the shared one (the file went to main)", () => withTemp((root) => {
  const main = path.join(root, "main");
  const worktree = path.join(root, "wt");
  writeFile(path.join(worktree, "orca-pipeline.yaml"), "v1: 1\n");
  const location = configLocation({ worktreeRoot: worktree, commonDir: path.join(main, ".git") });
  migrateLegacyConfig(location);
  assert.equal(location.activePath, path.join(main, ".orca-pod", "orca-pod.yaml"));
}));

test("root v1 file → moved to .orca-pod/orca-pod.yaml", () => withTemp((root) => {
  writeFile(path.join(root, "orca-pipeline.yaml"), "old: 1\n");
  const location = mainLocation(root);
  const results = migrateLegacyConfig(location);
  assert.deepEqual(results, [{ status: "moved", from: location.legacyPath, to: path.join(root, ".orca-pod", "orca-pod.yaml") }]);
  assert.equal(readFileSync(location.activePath, "utf8"), "old: 1\n");
  assert.equal(existsSync(location.legacyPath), false);
}));

test("v2 dir + root file → [moved(dir), ignored(file)]: the file does not overwrite the moved config", () => withTemp((root) => {
  writeFile(path.join(root, ".orca-pipeline", "orca-pipeline.yaml"), "v2: 1\n");
  writeFile(path.join(root, "orca-pipeline.yaml"), "v1: 1\n");
  const location = mainLocation(root);
  const results = migrateLegacyConfig(location);
  assert.deepEqual(results, [
    { status: "moved", from: path.join(root, ".orca-pipeline"), to: path.join(root, ".orca-pod") },
    { status: "ignored", from: location.legacyPath, to: path.join(root, ".orca-pod", "orca-pod.yaml") },
  ]);
  assert.equal(readFileSync(location.activePath, "utf8"), "v2: 1\n");
  assert.equal(readFileSync(location.legacyPath, "utf8"), "v1: 1\n");
  assert.deepEqual(migrationText(results).split("\n").map((line) => line.split(" ")[0]), ["MOVED", "IGNORED"]);
}));

test("root file + .orca-pod already exists → ignored, both files untouched", () => withTemp((root) => {
  writeFile(path.join(root, "orca-pipeline.yaml"), "old: 1\n");
  writeFile(path.join(root, ".orca-pod", "orca-pod.yaml"), "new: 2\n");
  const location = mainLocation(root);
  const results = migrateLegacyConfig(location);
  assert.deepEqual(results.map((result) => result.status), ["ignored"]);
  assert.equal(readFileSync(location.legacyPath, "utf8"), "old: 1\n");
  assert.equal(readFileSync(location.activePath, "utf8"), "new: 2\n");
}));

test("root file is a symlink → skipped, symlink left in place", () => withTemp((root) => {
  writeFile(path.join(root, "elsewhere.yaml"));
  symlinkSync(path.join(root, "elsewhere.yaml"), path.join(root, "orca-pipeline.yaml"));
  const location = mainLocation(root);
  const results = migrateLegacyConfig(location);
  assert.deepEqual(results.map((result) => result.status), ["skipped"]);
  assert.equal(results[0].reason, "not a regular file");
  assert.equal(lstatSync(location.legacyPath).isSymbolicLink(), true);
  assert.equal(existsSync(location.activePath), false);
}));

test("root file is a directory → skipped", () => withTemp((root) => {
  mkdirSync(path.join(root, "orca-pipeline.yaml"));
  const location = mainLocation(root);
  assert.deepEqual(migrateLegacyConfig(location).map((result) => result.status), ["skipped"]);
  assert.equal(lstatSync(location.legacyPath).isDirectory(), true);
}));

test("root file: EXDEV on rename → copy and source removal", () => withTemp((root) => {
  writeFile(path.join(root, "orca-pipeline.yaml"), "old: 1\n");
  const rename = () => { throw Object.assign(new Error("cross-device"), { code: "EXDEV" }); };
  const location = mainLocation(root);
  assert.equal(migrateLegacyConfig(location, { rename })[0].status, "moved");
  assert.equal(readFileSync(location.activePath, "utf8"), "old: 1\n");
  assert.equal(existsSync(location.legacyPath), false);
}));

test("linked worktree: worktree's .orca-pipeline → worktree's .orca-pod, main's → main's", () => withTemp((root) => {
  const main = path.join(root, "main");
  const worktree = path.join(root, "wt");
  writeFile(path.join(worktree, ".orca-pipeline", "orca-pipeline.yaml"), "wt: 1\n");
  writeFile(path.join(main, ".orca-pipeline", "orca-pipeline.yaml"), "main: 1\n");
  writeFile(path.join(main, ".orca-pipeline", "reports", "x.md"), "report\n");
  const location = configLocation({ worktreeRoot: worktree, commonDir: path.join(main, ".git") });
  const results = migrateLegacyConfig(location);
  assert.deepEqual(results, [
    { status: "moved", from: path.join(worktree, ".orca-pipeline"), to: path.join(worktree, ".orca-pod") },
    { status: "moved", from: path.join(main, ".orca-pipeline"), to: path.join(main, ".orca-pod") },
  ]);
  assert.equal(readFileSync(path.join(worktree, ".orca-pod", "orca-pod.yaml"), "utf8"), "wt: 1\n");
  assert.equal(readFileSync(path.join(main, ".orca-pod", "orca-pod.yaml"), "utf8"), "main: 1\n");
  assert.equal(readFileSync(path.join(main, ".orca-pod", "reports", "x.md"), "utf8"), "report\n");
  assert.equal(existsSync(path.join(worktree, ".orca-pipeline")), false);
  assert.equal(existsSync(path.join(main, ".orca-pipeline")), false);
}));

test("moving a linked worktree's root file goes to the shared config of the main checkout", () => withTemp((root) => {
  const main = path.join(root, "main");
  const worktree = path.join(root, "wt");
  writeFile(path.join(worktree, "orca-pipeline.yaml"), "tracked: 1\n");
  const location = configLocation({ worktreeRoot: worktree, commonDir: path.join(main, ".git") });
  const results = migrateLegacyConfig(location);
  assert.equal(results.length, 1);
  assert.equal(results[0].status, "moved");
  assert.equal(results[0].to, path.join(main, ".orca-pod", "orca-pod.yaml"));
  assert.equal(readFileSync(results[0].to, "utf8"), "tracked: 1\n");
  assert.equal(existsSync(path.join(worktree, "orca-pipeline.yaml")), false);
}));

test("repeated migration → empty array, migrationText = null", () => withTemp((root) => {
  writeFile(path.join(root, ".orca-pipeline", "orca-pipeline.yaml"));
  writeFile(path.join(root, "orca-pipeline.yaml"));
  assert.equal(migrateLegacyConfig(mainLocation(root)).length, 2);
  // The root v1 file remained (ignored): the repeat reports it again but no longer touches the directory.
  assert.deepEqual(migrateLegacyConfig(mainLocation(root)).map((result) => result.status), ["ignored"]);
  rmSync(path.join(root, "orca-pipeline.yaml"));
  const again = migrateLegacyConfig(mainLocation(root));
  assert.deepEqual(again, []);
  assert.equal(migrationText(again), null);
}));

test("migrationLine: moved → the line starts with MOVED and contains both paths", () => {
  const line = migrationLine({ status: "moved", from: "/p/orca-pipeline.yaml", to: "/p/.orca-pod/orca-pod.yaml" });
  assert.match(line, /^MOVED /);
  assert.ok(line.includes("/p/orca-pipeline.yaml") && line.includes("/p/.orca-pod/orca-pod.yaml"));
  assert.match(migrationLine({ status: "ignored", from: "/a", to: "/b" }), /^IGNORED /);
  assert.match(migrationLine({ status: "skipped", from: "/a", reason: "not a directory" }), /^SKIP \/a: not a directory$/);
  assert.match(migrationLine({ status: "skipped", from: "/a" }), /^SKIP \/a: not a regular file$/);
});

test("migrationText: lines joined by \\n, empty array → null", () => {
  assert.equal(migrationText([]), null);
  assert.equal(
    migrationText([{ status: "moved", from: "/a", to: "/b" }, { status: "ignored", from: "/c", to: "/d" }]),
    "MOVED /a → /b\nIGNORED /c: active is /d",
  );
});

test("gitLocation: main checkout and linked worktree of a real repository", () => withTemp((root) => {
  const main = path.join(root, "main");
  mkdirSync(main);
  const git = (cwd, ...args) => {
    const result = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  };
  git(main, "init", "-q");
  git(main, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "init");
  git(main, "worktree", "add", "-q", path.join(root, "wt"));
  const fromMain = configLocation(gitLocation(main));
  const fromWorktree = configLocation(gitLocation(path.join(root, "wt")));
  assert.equal(fromMain.mainRoot, main);
  assert.equal(fromWorktree.worktreeRoot, path.join(root, "wt"));
  assert.equal(fromWorktree.mainRoot, main);
  assert.equal(fromWorktree.activePath, path.join(main, ".orca-pod", "orca-pod.yaml"));
}));

test("CLI migrate prints one line per result", () => withTemp((root) => {
  spawnSync("git", ["-C", root, "init", "-q"]);
  writeFile(path.join(root, ".orca-pipeline", "orca-pipeline.yaml"), "v2: 1\n");
  writeFile(path.join(root, "orca-pipeline.yaml"));
  const cli = new URL("./config-location.mjs", import.meta.url).pathname;
  const result = spawnSync(process.execPath, [cli, "migrate", "--cwd", root], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const lines = result.stdout.trim().split("\n");
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^MOVED /);
  assert.match(lines[1], /^IGNORED /);
  assert.equal(readFileSync(path.join(root, ".orca-pod", "orca-pod.yaml"), "utf8"), "v2: 1\n");
  assert.equal(existsSync(path.join(root, ".orca-pipeline")), false);
}));

test("CLI migrate: root file → MOVED, repeat → OK <activePath>", () => withTemp((root) => {
  spawnSync("git", ["-C", root, "init", "-q"]);
  writeFile(path.join(root, "orca-pipeline.yaml"));
  const cli = new URL("./config-location.mjs", import.meta.url).pathname;
  const result = spawnSync(process.execPath, [cli, "migrate", "--cwd", root], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^MOVED /);
  assert.equal(existsSync(path.join(root, ".orca-pod", "orca-pod.yaml")), true);
  const again = spawnSync(process.execPath, [cli, "migrate", "--cwd", root], { encoding: "utf8" });
  assert.equal(again.stdout.trim(), `OK ${path.join(root, ".orca-pod", "orca-pod.yaml")}`);
}));

test("CLI also works through a symlink to the skill directory (~/.claude/skills)", () => withTemp((root) => {
  spawnSync("git", ["-C", root, "init", "-q"]);
  const linkedScripts = path.join(root, "linked-scripts");
  symlinkSync(path.dirname(new URL("./config-location.mjs", import.meta.url).pathname), linkedScripts);
  const result = spawnSync(process.execPath, [path.join(linkedScripts, "config-location.mjs"), "where", "--cwd", root], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).mainRoot, root);
}));
