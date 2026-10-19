import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { claudeCodeCatalog, codexCatalog, discoverCatalogs, failureReason, piCatalog } from "./catalogs.mjs";

// The catalog texts the form shows: optgroup labels and "source" lines. They are English (the form translates only its own UI).
// findExecutable() reads process.env.PATH at call time, so each test sets PATH to a directory with stub executables.
// An empty ORCA_POD_BIN_DIRS turns off the usual install folders: the real CLIs of this machine are not found.
process.env.ORCA_POD_BIN_DIRS = "";
const SYSTEM_PATH = "/usr/bin:/bin";
const NOT_FOUND = "not found (neither in PATH nor in the usual install folders)";

async function withPath(stubs, run) {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "orca-catalogs-test-")));
  const previous = process.env.PATH;
  try {
    const bin = path.join(root, "bin");
    mkdirSync(bin);
    for (const [name, body] of Object.entries(stubs)) {
      writeFileSync(path.join(bin, name), "#!/bin/sh\n" + body + "\n");
      chmodSync(path.join(bin, name), 0o755);
    }
    process.env.PATH = bin + ":" + SYSTEM_PATH;
    return await run(root);
  } finally {
    process.env.PATH = previous;
    rmSync(root, { recursive: true, force: true });
  }
}

const ANTHROPIC = [
  { id: "claude-opus-5-5", levels: ["low", "medium", "high", "xhigh", "max"] },
  { id: "claude-opus-4-8", levels: ["low", "medium", "high"] },
  { id: "claude-sonnet-5", levels: ["low", "medium"] },
  { id: "claude-sonnet-4-5-20250929", levels: ["low"] }, // a dated snapshot is not shown
];

test("claudeCodeCatalog: without claude in PATH — an English source line, no models", async () => {
  await withPath({}, async () => {
    assert.deepEqual(await claudeCodeCatalog({ anthropicModels: ANTHROPIC }), { program: "claude-code", models: [], source: "Claude Code: claude " + NOT_FOUND });
  });
});

test("claudeCodeCatalog: English optgroup labels and source line; aliases first, specific versions are role-only", async () => {
  await withPath({ claude: "exit 0" }, async () => {
    const catalog = await claudeCodeCatalog({ anthropicModels: ANTHROPIC });
    assert.equal(catalog.source, "Claude Code: aliases + 3 versions from the Anthropic catalog in Pi (as in claude-bridge); effort per model");
    const aliases = catalog.models.filter((model) => !model.roleOnly);
    const pinned = catalog.models.filter((model) => model.roleOnly);
    assert.deepEqual([...new Set(aliases.map((model) => model.group))], ["Claude Code · alias — latest version"]);
    assert.deepEqual([...new Set(pinned.map((model) => model.group))], ["Claude Code · specific version"]);
    assert.deepEqual(pinned.map((model) => model.id), ["claude-opus-5-5", "claude-opus-4-8", "claude-sonnet-5"]);
    assert.equal(aliases.find((model) => model.id === "opus").label, "opus → claude-opus-5-5");
    assert.equal(aliases.find((model) => model.id === "haiku").label, "haiku"); // no version known: the plain alias
    // The groups sort alphabetically in the form: the aliases come before the specific versions.
    assert.ok([...new Set(catalog.models.map((model) => model.group))].sort()[0].includes("alias"));
  });
});

test("claudeCodeCatalog: no Anthropic catalog — aliases only, the reason is English", async () => {
  await withPath({ claude: "exit 0" }, async () => {
    const plain = await claudeCodeCatalog({ anthropicModels: [] });
    assert.equal(plain.source, "Claude Code: aliases only, effort low..max");
    // anthropicModels not given: the catalog is read through the Pi SDK, and there is no pi in PATH here.
    const noPi = await claudeCodeCatalog();
    assert.equal(noPi.source, "Claude Code: aliases only, effort low..max (Anthropic catalog from Pi unavailable: package @earendil-works/pi-coding-agent or @mariozechner/pi-coding-agent not found)");
    assert.equal(noPi.models.length, 4);
  });
});

test("codexCatalog: without codex in PATH — an English source line", async () => {
  await withPath({}, async () => {
    assert.deepEqual(codexCatalog(), { program: "codex", models: [], source: "Codex: codex " + NOT_FOUND });
  });
});

test("piCatalog: without pi in PATH — an English source line", async () => {
  await withPath({}, async (root) => {
    assert.deepEqual(await piCatalog({ cwd: root }), { program: "pi", models: [], source: "Pi: pi " + NOT_FOUND });
  });
});

test("piCatalog: pi --list-models works, the RPC does not — levels are approximate, the source says so in English", async () => {
  const stub = [
    'if [ "$1" = "--list-models" ]; then',
    '  echo "provider model context max-out thinking images"',
    '  echo "zai glm-5.3-flash 200K 32K yes no"',
    '  echo "zai glm-5.3-lite 200K 32K no no"',
    "  exit 0",
    "fi",
    "exit 1",
  ].join("\n");
  await withPath({ pi: stub }, async (root) => {
    const catalog = await piCatalog({ cwd: root });
    assert.equal(catalog.source, "Pi: pi --list-models — 2 models; thinking: 0 exact from RPC, 2 approximate (Pi itself limits an unsupported level)");
    assert.deepEqual(catalog.models.map((model) => [model.id, model.levels.length]), [["glm-5.3-flash", 7], ["glm-5.3-lite", 1]]);
  });
});

test("piCatalog: neither pi --list-models nor the RPC works — the reason is English", async () => {
  await withPath({ pi: 'echo boom >&2\nexit 3' }, async (root) => {
    const catalog = await piCatalog({ cwd: root });
    assert.deepEqual(catalog.models, []);
    assert.equal(catalog.source, "Pi: pi --list-models unavailable (pi exited with code 3: boom)");
  });
});

test("discoverCatalogs: a known Pi registry gets an English source line", async () => {
  await withPath({}, async (root) => {
    const piModels = [{ program: "pi", provider: "zai", id: "glm-5.3-flash", levels: ["low", "high"] }];
    const { models, sources } = await discoverCatalogs({ cwd: root, piModels, programs: ["pi"] });
    assert.equal(models.length, 1);
    assert.deepEqual(sources, ["Pi: registry of the current Pi session — 1 models"]);
  });
});

test("claudeCodeCatalog: claude only in a usual install folder — found, the source names the folder", async () => {
  await withPath({}, async (root) => {
    const folder = path.join(root, "local");
    mkdirSync(folder);
    writeFileSync(path.join(folder, "claude"), "#!/bin/sh\nexit 0\n");
    chmodSync(path.join(folder, "claude"), 0o755);
    process.env.ORCA_POD_BIN_DIRS = folder;
    try {
      const catalog = await claudeCodeCatalog({ anthropicModels: [] });
      assert.equal(catalog.source, "Claude Code: aliases only, effort low..max [" + path.join(folder, "claude") + ", not in PATH]");
      assert.equal(catalog.models.length, 4);
    } finally {
      process.env.ORCA_POD_BIN_DIRS = "";
    }
  });
});

// A live Codex sandbox run: pi cannot take its lock file in ~/.pi/agent, and node's last stderr line is its version.
const SANDBOX_CRASH = [
  "Warning: errors loading models.json:",
  "Availability refresh: EPERM: operation not permitted, mkdir '/home/u/.pi/agent/auth.json.lock'",
  "node:internal/process/promises:394",
  "    triggerUncaughtException(err, true /* fromPromise */);",
  "[Error: EPERM: operation not permitted, mkdir '/home/u/.pi/agent/auth.json.lock'] {",
  "  code: 'EPERM',",
  "}",
  "",
  "Node.js v24.21.0",
].join("\n");

test("failureReason: a node crash gives its error line, not the node version; EPERM is named as a sandbox", () => {
  assert.equal(failureReason(SANDBOX_CRASH),
    "Availability refresh: EPERM: operation not permitted, mkdir '/home/u/.pi/agent/auth.json.lock' — no write access (sandbox?): run the form with elevated permissions");
  assert.equal(failureReason("boom"), "boom");
  assert.equal(failureReason("TypeError: x is not a function\n    at y\nNode.js v22.1.0"), "TypeError: x is not a function");
});

test("piCatalog: pi crashes in a sandbox — the source line says why and what to do", async () => {
  const stub = "cat >&2 <<'EOF'\n" + SANDBOX_CRASH + "\nEOF\nexit 1";
  await withPath({ pi: stub }, async (root) => {
    const catalog = await piCatalog({ cwd: root });
    assert.deepEqual(catalog.models, []);
    assert.match(catalog.source, /^Pi: pi --list-models unavailable \(pi exited with code 1: Availability refresh: EPERM: .* — no write access \(sandbox\?\): run the form with elevated permissions\)$/);
  });
});

test("piCatalog: Pi before 0.74 prints the model table to stderr — it is read from there", async () => {
  const stub = [
    'if [ "$1" = "--list-models" ]; then',
    '  echo "provider model context max-out thinking images" >&2',
    '  echo "deepseek deepseek-v4-flash 1M 384K yes no" >&2',
    "  exit 0",
    "fi",
    "exit 1",
  ].join("\n");
  await withPath({ pi: stub }, async (root) => {
    const catalog = await piCatalog({ cwd: root });
    assert.deepEqual(catalog.models.map((model) => model.id), ["deepseek-v4-flash"]);
  });
});

test("piCatalog: an older Pi without --no-mcp — the RPC is started again without the flag", async () => {
  // --list-models fails here, so the models can only come from the RPC answer.
  const stub = [
    'case " $* " in *" --no-mcp "*) echo "Error: Unknown option: --no-mcp" >&2; exit 1;; esac',
    '[ "$1" = "--list-models" ] && exit 1',
    "read request",
    'echo \'{"type":"response","command":"get_available_models","success":true,"data":{"models":[{"provider":"deepseek","id":"deepseek-v4-flash","reasoning":true}]}}\'',
    "sleep 5",
  ].join("\n");
  await withPath({ pi: stub }, async (root) => {
    const catalog = await piCatalog({ cwd: root });
    assert.deepEqual(catalog.models.map((model) => model.id), ["deepseek-v4-flash"]);
    assert.match(catalog.source, /^Pi: RPC get_available_models — 1 models; /);
  });
});
