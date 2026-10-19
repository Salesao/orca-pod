import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { displayPath, envFor, findExecutable, usualBinDirs } from "./find-executable.mjs";

function withTemp(run) {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "orca-find-executable-")));
  try {
    return run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function stub(directory, name, mode = 0o755) {
  mkdirSync(directory, { recursive: true });
  const file = path.join(directory, name);
  writeFileSync(file, "#!/bin/sh\nexit 0\n");
  chmodSync(file, mode);
  return file;
}

test("PATH wins over the usual install folders", () => withTemp((root) => {
  const onPath = stub(path.join(root, "bin"), "claude");
  stub(path.join(root, "local"), "claude");
  assert.deepEqual(findExecutable("claude", { env: { PATH: path.join(root, "bin") }, dirs: [path.join(root, "local")] }), { file: onPath, onPath: true });
}));

test("a CLI only in a usual install folder is found there, onPath false", () => withTemp((root) => {
  const file = stub(path.join(root, "local"), "pi");
  assert.deepEqual(findExecutable("pi", { env: { PATH: path.join(root, "bin") }, dirs: [path.join(root, "empty"), path.join(root, "local")] }), { file, onPath: false });
}));

test("a file without the executable bit and a directory with the CLI's name are not CLIs", () => withTemp((root) => {
  stub(path.join(root, "bin"), "codex", 0o644);
  mkdirSync(path.join(root, "local", "codex"), { recursive: true });
  assert.equal(findExecutable("codex", { env: { PATH: path.join(root, "bin") }, dirs: [path.join(root, "local")] }), null);
}));

test("usualBinDirs: ORCA_POD_BIN_DIRS replaces the list; empty means PATH only", () => {
  assert.deepEqual(usualBinDirs({ env: { ORCA_POD_BIN_DIRS: "" } }), []);
  assert.deepEqual(usualBinDirs({ env: { ORCA_POD_BIN_DIRS: ["/a", "", "/b"].join(path.delimiter) } }), ["/a", "/b"]);
});

test("usualBinDirs: node's own folder first, then ~/.local/bin, ~/.claude/local, nvm versions newest first, Homebrew", () => withTemp((home) => {
  for (const version of ["v18.20.0", "v24.1.0", "v22.10.0"]) mkdirSync(path.join(home, ".nvm", "versions", "node", version, "bin"), { recursive: true });
  const dirs = usualBinDirs({ env: {}, home, nodeBin: "/node/bin" });
  assert.equal(dirs[0], "/node/bin");
  assert.ok(dirs.includes(path.join(home, ".local", "bin")));
  assert.ok(dirs.includes(path.join(home, ".claude", "local")));
  const nvm = dirs.filter((directory) => directory.includes(".nvm"));
  assert.deepEqual(nvm.map((directory) => path.basename(path.dirname(directory))), ["v24.1.0", "v22.10.0", "v18.20.0"]);
  assert.ok(dirs.includes("/opt/homebrew/bin"));
}));

test("envFor: a CLI found outside PATH gets its folder and node's folder in front of PATH; one on PATH keeps the env", () => {
  const env = { PATH: "/usr/bin:/bin", HOME: "/h" };
  assert.equal(envFor({ file: "/usr/bin/pi", onPath: true }, env), env);
  const outside = envFor({ file: "/h/.local/bin/pi", onPath: false }, env);
  assert.deepEqual(outside.PATH.split(path.delimiter).slice(0, 2), ["/h/.local/bin", path.dirname(process.execPath)]);
  assert.ok(outside.PATH.endsWith("/usr/bin:/bin"));
  assert.equal(outside.HOME, "/h");
});

test("displayPath shows the home folder as ~", () => {
  assert.equal(displayPath("/h/.local/bin/claude", "/h"), "~/.local/bin/claude");
  assert.equal(displayPath("/opt/homebrew/bin/claude", "/h"), "/opt/homebrew/bin/claude");
});
