#!/usr/bin/env node
// Where orca-pod.yaml lives and how old config layouts are migrated.
// There is one config per repository: <main checkout>/.orca-pod/orca-pod.yaml; a linked
// worktree's own file in its .orca-pod/ wins. Git is optional: outside a repository the project folder is the
// current folder, or its nearest parent that already has .orca-pod/ (projectLocation).
// Shared module of the launcher, test-sandbox and the setup form.
// Old layouts are migrated automatically (migrateLegacyConfig):
//   v2: <root>/.orca-pipeline/ (with orca-pipeline.yaml and reports/) → <root>/.orca-pod/ as a whole,
//       orca-pipeline.yaml inside → orca-pod.yaml; this is done for a worktree and for the main checkout;
//   v1: <worktree>/orca-pipeline.yaml → the active .orca-pod/orca-pod.yaml.
//   node config-location.mjs migrate [--cwd <dir>]  — migration, one line per result: MOVED/IGNORED/SKIP, or OK <path>
//   node config-location.mjs where [--cwd <dir>]    — JSON configLocation (git: false outside a Git repository)

import { copyFileSync, cpSync, existsSync, lstatSync, mkdirSync, realpathSync, renameSync, rmSync, statSync, unlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const CONFIG_DIR = ".orca-pod";
export const CONFIG_FILE = "orca-pod.yaml";
export const LEGACY_DIR = ".orca-pipeline";
export const LEGACY_FILE = "orca-pipeline.yaml";

function gitOutput(cwd, args) {
  const result = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  if (result.error || result.status !== 0 || !result.stdout.trim()) throw new Error("cannot resolve the active worktree Git root");
  return result.stdout.trim();
}

/** Root of the current worktree and the shared Git directory (for a linked worktree — the main checkout's .git). */
export function gitLocation(cwd) {
  const worktreeRoot = gitOutput(cwd, ["rev-parse", "--show-toplevel"]);
  const commonDir = path.resolve(worktreeRoot, gitOutput(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"]));
  return { worktreeRoot, commonDir };
}

/**
 * The active config: the worktree's own file wins over the shared file of the main checkout.
 * The only place with this rule: configLocation uses it for activePath, and migrateLegacyConfig
 * uses it again after the move (the move may have created the worktree's own file).
 */
export function activeConfigPath({ worktreePath, sharedPath }) {
  return existsSync(worktreePath) ? worktreePath : sharedPath;
}

function isDirectory(file) {
  try {
    return statSync(file).isDirectory();
  } catch {
    return false;
  }
}

/**
 * The project folder outside Git: the nearest folder from cwd up that has .orca-pod/, otherwise cwd itself.
 * The search stops below the home folder and the filesystem root (their .orca-pod/ is not a project's), unless cwd is that folder.
 */
export function plainFolderRoot(cwd, home = os.homedir()) {
  const start = realpathSync(cwd);
  for (let directory = start; ; directory = path.dirname(directory)) {
    const isBoundary = directory === home || directory === path.dirname(directory);
    if (isBoundary && directory !== start) return start;
    if (isDirectory(path.join(directory, CONFIG_DIR))) return directory;
    if (isBoundary) return start;
  }
}

/** gitLocation inside a Git repository; outside it the plain project folder, with commonDir null and git false. */
export function projectLocation(cwd, { home = os.homedir() } = {}) {
  try {
    return { ...gitLocation(cwd), git: true };
  } catch {
    return { worktreeRoot: plainFolderRoot(cwd, home), commonDir: null, git: false };
  }
}

export function configLocation({ worktreeRoot, commonDir, git = true }) {
  // For submodule and bare layouts the shared directory is not <root>/.git: then the main checkout is the current one.
  // Without Git (commonDir null) there is no main checkout either.
  const mainRoot = commonDir && path.basename(commonDir) === ".git" ? path.dirname(commonDir) : worktreeRoot;
  const worktreePath = path.join(worktreeRoot, CONFIG_DIR, CONFIG_FILE);
  const sharedPath = path.join(mainRoot, CONFIG_DIR, CONFIG_FILE);
  return {
    git, worktreeRoot, mainRoot, worktreePath, sharedPath,
    activePath: activeConfigPath({ worktreePath, sharedPath }),
    // v1: a file in the worktree root. v2: an .orca-pipeline/ directory in the worktree and in the main checkout (no duplicates).
    legacyPath: path.join(worktreeRoot, LEGACY_FILE),
    legacyDirs: [...new Set([path.join(worktreeRoot, LEGACY_DIR), path.join(mainRoot, LEGACY_DIR)])],
  };
}

function lstatOrNull(file) {
  try {
    return lstatSync(file);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

/** A directory is moved as a whole; across devices (EXDEV) — by copying and removing the source. */
function moveDirectory(from, to, { rename, copyDirectory }) {
  try {
    rename(from, to);
  } catch (error) {
    if (error.code !== "EXDEV") throw error;
    try {
      copyDirectory(from, to);
    } catch (copyError) {
      rmSync(to, { recursive: true, force: true }); // a partially copied .orca-pod/ would later look like the active one
      throw copyError;
    }
    rmSync(from, { recursive: true, force: true });
  }
}

function moveFile(from, to, { rename, copyFile }) {
  mkdirSync(path.dirname(to), { recursive: true });
  try {
    rename(from, to);
  } catch (error) {
    if (error.code !== "EXDEV") throw error;
    try {
      copyFile(from, to);
    } catch (copyError) {
      rmSync(to, { force: true }); // a truncated orca-pod.yaml would later look like the active config
      throw copyError;
    }
    unlinkSync(from);
  }
}

/**
 * Moves old config layouts into .orca-pod/. Order of results: first each legacyDirs entry
 * (.orca-pipeline/ → the neighbouring .orca-pod/ as a whole, orca-pipeline.yaml inside → orca-pod.yaml if the name is free),
 * then the root orca-pipeline.yaml → the active path (recomputed after the directories are moved).
 * An existing new path is left alone (ignored); a symlink or an object of the wrong type is skipped (skipped).
 * Empty if there is nothing to move. After the move location.activePath is recomputed in place, so
 * consumers that read the config after migrateLegacyConfig see the active path, not the pre-move one.
 * rename, copyFile and copyDirectory exist for tests only (EXDEV and copy failures).
 */
export function migrateLegacyConfig(location, {
  rename = renameSync,
  copyFile = copyFileSync,
  copyDirectory = (from, to) => cpSync(from, to, { recursive: true, errorOnExist: true, force: false }),
} = {}) {
  const operations = { rename, copyFile, copyDirectory };
  const results = [];
  for (const from of location.legacyDirs) {
    const to = path.join(path.dirname(from), CONFIG_DIR);
    const legacy = lstatOrNull(from);
    if (!legacy) continue;
    if (!legacy.isDirectory()) {
      results.push({ status: "skipped", from, to, reason: "not a directory" });
    } else if (lstatOrNull(to)) {
      results.push({ status: "ignored", from, to });
    } else {
      moveDirectory(from, to, operations);
      const oldFile = path.join(to, LEGACY_FILE);
      const newFile = path.join(to, CONFIG_FILE);
      if (lstatOrNull(oldFile) && !lstatOrNull(newFile)) rename(oldFile, newFile);
      results.push({ status: "moved", from, to });
    }
  }
  const from = location.legacyPath;
  const legacyFile = lstatOrNull(from);
  if (legacyFile) {
    const to = activeConfigPath(location);
    if (!legacyFile.isFile()) results.push({ status: "skipped", from, to, reason: "not a regular file" });
    else if (lstatOrNull(to)) results.push({ status: "ignored", from, to });
    else {
      moveFile(from, to, operations);
      results.push({ status: "moved", from, to });
    }
  }
  location.activePath = activeConfigPath(location);
  return results;
}

export function migrationLine(result) {
  switch (result.status) {
    case "moved": return `MOVED ${result.from} → ${result.to}`;
    case "ignored": return `IGNORED ${result.from}: active is ${result.to}`;
    case "skipped": return `SKIP ${result.from}: ${result.reason ?? "not a regular file"}`;
    default: return null;
  }
}

/** Result lines joined by \n, or null if there was nothing to move. */
export function migrationText(results) {
  const lines = results.map(migrationLine).filter(Boolean);
  return lines.length ? lines.join("\n") : null;
}

function main(argv) {
  const [command, ...rest] = argv;
  let cwd = process.cwd();
  for (let index = 0; index < rest.length; index += 1) {
    if (rest[index] === "--cwd" && index + 1 < rest.length) cwd = rest[++index];
    else throw new Error("usage: config-location.mjs migrate|where [--cwd <dir>]");
  }
  const location = configLocation(projectLocation(cwd));
  if (command === "where") return console.log(JSON.stringify(location));
  if (command !== "migrate") throw new Error("usage: config-location.mjs migrate|where [--cwd <dir>]");
  console.log(migrationText(migrateLegacyConfig(location)) ?? `OK ${location.activePath}`);
}

// realpath: the skill is also connected through symlinks (~/.claude/skills, ~/.codex/skills), while import.meta.url is the real path.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`CONFIG LOCATION ERROR: ${error.message}`);
    process.exit(2);
  }
}
