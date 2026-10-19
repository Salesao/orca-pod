// Finds an agent CLI (pi, claude, codex, omp). Shared module of the launcher and the orca-pod-setup form.
// PATH first, then the usual install folders: an agent may run commands in a shell whose PATH lacks them
// (a non-interactive shell skips ~/.zshrc, where nvm and ~/.local/bin are often added), and the old local
// Claude Code install is only a shell alias to ~/.claude/local/claude.
// ORCA_POD_BIN_DIRS (folders joined by the path delimiter) replaces the usual folders; an empty value means PATH only.

import { readdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

function isExecutable(file) {
  try {
    const stat = statSync(file);
    return stat.isFile() && (stat.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

/** ~/.nvm/versions/node/<version>/bin, the newest version first. */
function nvmBinDirs(home) {
  const root = path.join(home, ".nvm", "versions", "node");
  let versions;
  try {
    versions = readdirSync(root);
  } catch {
    return [];
  }
  const numbers = (name) => name.replace(/^v/, "").split(".").map((part) => Number(part) || 0);
  const newerFirst = (a, b) => {
    const [x, y] = [numbers(a), numbers(b)];
    for (let index = 0; index < 3; index += 1) if (x[index] !== y[index]) return (y[index] ?? 0) - (x[index] ?? 0);
    return 0;
  };
  return versions.sort(newerFirst).map((version) => path.join(root, version, "bin"));
}

export function usualBinDirs({ env = process.env, home = os.homedir(), nodeBin = path.dirname(process.execPath) } = {}) {
  if (env.ORCA_POD_BIN_DIRS !== undefined) return env.ORCA_POD_BIN_DIRS.split(path.delimiter).filter(Boolean);
  return [
    nodeBin, // global npm packages of the node that runs this script (nvm, fnm, Homebrew)
    path.join(home, ".local", "bin"), // the native installers of Claude Code and Codex
    path.join(home, ".claude", "local"), // the old local Claude Code install, reached through a shell alias
    path.join(home, ".npm-global", "bin"),
    ...nvmBinDirs(home),
    path.join(home, ".volta", "bin"),
    path.join(home, ".bun", "bin"),
    path.join(home, "Library", "pnpm"),
    path.join(home, ".local", "share", "pnpm"),
    path.join(home, ".yarn", "bin"),
    path.join(home, ".local", "share", "mise", "shims"),
    path.join(home, ".asdf", "shims"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
  ];
}

/** { file, onPath }: the absolute path of the CLI and whether PATH has it; null when neither PATH nor the usual folders have it. */
export function findExecutable(command, { env = process.env, dirs = usualBinDirs({ env }) } = {}) {
  for (const directory of (env.PATH ?? "").split(path.delimiter).filter(Boolean)) {
    const file = path.join(directory, command);
    if (isExecutable(file)) return { file, onPath: true };
  }
  for (const directory of dirs) {
    const file = path.join(directory, command);
    if (isExecutable(file)) return { file, onPath: false };
  }
  return null;
}

/** The environment of a CLI found outside PATH: its folder and the folder of node go first (a `#!/usr/bin/env node` script needs node). */
export function envFor(found, env = process.env) {
  if (!found || found.onPath) return env;
  const front = [path.dirname(found.file), path.dirname(process.execPath)];
  const rest = (env.PATH ?? "").split(path.delimiter).filter(Boolean);
  return { ...env, PATH: [...new Set([...front, ...rest])].join(path.delimiter) };
}

/** For CATALOG lines and warnings: the home folder is shown as ~. */
export function displayPath(file, home = os.homedir()) {
  return file.startsWith(home + path.sep) ? "~" + file.slice(home.length) : file;
}
