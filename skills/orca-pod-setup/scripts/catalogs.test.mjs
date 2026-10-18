import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { claudeCodeCatalog, codexCatalog, discoverCatalogs, piCatalog } from "./catalogs.mjs";

// The catalog texts the form shows: optgroup labels and "source" lines. They are English (the form translates only its own UI).
// onPath() reads process.env.PATH at call time, so each test sets PATH to a directory with stub executables.
const SYSTEM_PATH = "/usr/bin:/bin";

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
    assert.deepEqual(await claudeCodeCatalog({ anthropicModels: ANTHROPIC }), { program: "claude-code", models: [], source: "Claude Code: claude not found in PATH" });
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
    assert.equal(noPi.source, "Claude Code: aliases only, effort low..max (Anthropic catalog from Pi unavailable: package @earendil-works/pi-coding-agent not found)");
    assert.equal(noPi.models.length, 4);
  });
});

test("codexCatalog: without codex in PATH — an English source line", async () => {
  await withPath({}, async () => {
    assert.deepEqual(codexCatalog(), { program: "codex", models: [], source: "Codex: codex not found in PATH" });
  });
});

test("piCatalog: without pi in PATH — an English source line", async () => {
  await withPath({}, async (root) => {
    assert.deepEqual(await piCatalog({ cwd: root }), { program: "pi", models: [], source: "Pi: pi not found in PATH" });
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
