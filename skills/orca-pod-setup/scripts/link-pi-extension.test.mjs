import assert from "node:assert/strict";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

// link-pi-extension.sh runs against a throwaway HOME and a PATH that holds (or lacks) a fake `pi`.
const SCRIPT = fileURLToPath(new URL("./link-pi-extension.sh", import.meta.url));
const SKILL_DIR = realpathSync(path.resolve(path.dirname(SCRIPT), ".."));
const SOURCE_DIR = path.join(SKILL_DIR, "pi-extension");
const SYSTEM_PATH = "/usr/bin:/bin";

function withSandbox(run) {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "orca-link-pi-ext-")));
  try {
    const home = path.join(root, "home");
    const bin = path.join(root, "bin");
    mkdirSync(home);
    mkdirSync(bin);
    writeFileSync(path.join(bin, "pi"), "#!/bin/sh\nexit 0\n");
    chmodSync(path.join(bin, "pi"), 0o755);
    return run({ home, bin, target: path.join(home, ".pi", "agent", "extensions", "orca-pod-setup") });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function link({ home, bin }) {
  const pathEnv = bin ? `${bin}:${SYSTEM_PATH}` : SYSTEM_PATH;
  const result = spawnSync("/bin/bash", [SCRIPT], { encoding: "utf8", env: { ...process.env, HOME: home, PATH: pathEnv } });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.split("\n").filter(Boolean);
}

test("link-pi-extension: without pi in PATH → SKIP and nothing is linked", (t) => withSandbox(({ home, target }) => {
  if (existsSync("/usr/bin/pi") || existsSync("/bin/pi")) return t.skip("a system-wide pi is installed");
  assert.deepEqual(link({ home }), ["SKIP  pi not found (no pi in PATH, no ~/.pi/agent), the form extension is not linked"]);
  assert.equal(existsSync(target), false);
}));

test("link-pi-extension: pi not in the shell's PATH but ~/.pi/agent exists → Pi is installed, LINK", (t) => withSandbox(({ home, target }) => {
  if (existsSync("/usr/bin/pi") || existsSync("/bin/pi")) return t.skip("a system-wide pi is installed");
  mkdirSync(path.join(home, ".pi", "agent"), { recursive: true });
  assert.equal(link({ home })[0], `LINK  ${target} -> ${SOURCE_DIR}`);
  assert.equal(readlinkSync(target), SOURCE_DIR);
}));

test("link-pi-extension: first run → LINK and a /reload hint, the repeat → OK", () => withSandbox((box) => {
  const first = link(box);
  assert.equal(first[0], `LINK  ${box.target} -> ${SOURCE_DIR}`);
  assert.equal(first[1], "      In Pi run /reload so that the orca_pod_setup tool appears");
  assert.equal(first.length, 2);
  assert.equal(readlinkSync(box.target), SOURCE_DIR);
  assert.deepEqual(link(box), [`OK    ${box.target}`]);
}));

test("link-pi-extension: a link that is not ours is not replaced → SKIP", () => withSandbox((box) => {
  const elsewhere = path.join(path.dirname(box.target), "elsewhere");
  mkdirSync(elsewhere, { recursive: true });
  symlinkSync(elsewhere, box.target);
  assert.deepEqual(link(box), [`SKIP  ${box.target} -> ${elsewhere} (a link that is not ours)`]);
  assert.equal(readlinkSync(box.target), elsewhere);
}));

test("link-pi-extension: an old copy of the extension instead of a link → STALE with the fix command", () => withSandbox((box) => {
  mkdirSync(box.target, { recursive: true });
  writeFileSync(path.join(box.target, "index.js"), "// pi.registerTool({ name: 'orca_pod_setup' })\n");
  const lines = link(box);
  assert.equal(lines.length, 2, lines.join("\n"));
  assert.match(lines[0], new RegExp(`^STALE ${box.target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} — `));
  assert.ok(lines[0].includes("a copy of the extension instead of a link"), lines[0]);
  assert.ok(lines[1].includes(`Fix: rm -r '${box.target}' && '${SKILL_DIR}/scripts/link-pi-extension.sh'`) && lines[1].includes("/reload"), lines[1]);
  assert.equal(lstatSync(box.target).isDirectory(), true); // the copy is left in place
}));

test("link-pi-extension: any other existing directory is not replaced → SKIP", () => withSandbox((box) => {
  mkdirSync(box.target, { recursive: true });
  writeFileSync(path.join(box.target, "index.js"), "// someone else's extension\n");
  assert.deepEqual(link(box), [`SKIP  ${box.target} (existing directory is not replaced)`]);
  assert.equal(lstatSync(box.target).isDirectory(), true);
}));
