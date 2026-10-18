import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { parseCodexCatalog, readCodexCatalog } from "./codex-models.mjs";

const FIXTURE = readFileSync(new URL("./fixtures/codex-debug-models.json", import.meta.url), "utf8");
const ok = (stdout) => () => ({ status: 0, stdout });
const failed = (message) => () => ({ status: 1, stdout: "", stderr: message });

function withCodexHome(cache, run) {
  const home = mkdtempSync(path.join(tmpdir(), "orca-codex-home-"));
  try {
    if (cache !== null) writeFileSync(path.join(home, "models_cache.json"), cache);
    return run(home);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

test("parse: 4 models, gpt-reserve is not visible, gpt-6-astra levels go up to ultra", () => {
  const models = parseCodexCatalog(FIXTURE);
  assert.deepEqual(models.map((model) => model.id), ["gpt-6-astra", "gpt-6-luna", "gpt-reserve", "gpt-5.6-luna"]);
  assert.equal(models.find((model) => model.id === "gpt-reserve").visible, false);
  assert.equal(models.find((model) => model.id === "gpt-6-luna").visible, true);
  assert.deepEqual(models.find((model) => model.id === "gpt-6-astra").levels, ["low", "medium", "high", "xhigh", "max", "ultra"]);
  assert.equal(models.find((model) => model.id === "gpt-6-astra").defaultLevel, "low");
});

test("read: debug models succeeds → source with the number of models", () => {
  const catalog = withCodexHome(null, (codexHome) => readCodexCatalog({ run: ok(FIXTURE), codexHome }));
  assert.equal(catalog.models.length, 4);
  assert.match(catalog.source, /^Codex: codex debug models — 4 models/);
});

test("read: debug models failed → cache, source names the reason", () => {
  const cache = JSON.stringify({ fetched_at: "2026-10-17T00:00:00Z", ...JSON.parse(FIXTURE) });
  const catalog = withCodexHome(cache, (codexHome) => readCodexCatalog({ run: failed("boom"), codexHome }));
  assert.equal(catalog.models.length, 4);
  assert.match(catalog.source, /models_cache\.json from 2026-10-17T00:00:00Z/);
  assert.match(catalog.source, /boom/);
});

test("read: debug models returned non-JSON → cache", () => {
  const catalog = withCodexHome(FIXTURE, (codexHome) => readCodexCatalog({ run: ok("not json"), codexHome }));
  assert.equal(catalog.models.length, 4);
  assert.match(catalog.source, /models_cache\.json/);
});

test("read: neither the command nor the cache → models is empty, source says unavailable", () => {
  const catalog = withCodexHome(null, (codexHome) => readCodexCatalog({ run: () => ({ error: new Error("spawn codex ENOENT") }), codexHome }));
  assert.deepEqual(catalog.models, []);
  assert.match(catalog.source, /unavailable/);
});

test("read: debug models output over 1 MiB is read without ENOBUFS (real spawnSync)", () => {
  const root = mkdtempSync(path.join(tmpdir(), "orca-codex-big-"));
  const savedPath = process.env.PATH;
  try {
    const catalog = JSON.parse(FIXTURE);
    // Real codex debug models output is ~62 KB per model (model_messages, base_instructions).
    for (const model of catalog.models) model.base_instructions = "x".repeat(700 * 1024);
    const big = path.join(root, "big.json");
    writeFileSync(big, JSON.stringify(catalog));
    const bin = path.join(root, "bin");
    mkdirSync(bin);
    writeFileSync(path.join(bin, "codex"), `#!/bin/sh\n/bin/cat ${JSON.stringify(big)}\n`, { mode: 0o755 });
    mkdirSync(path.join(root, "home"));
    process.env.PATH = bin;
    const result = readCodexCatalog({ codexHome: path.join(root, "home") });
    assert.match(result.source, /^Codex: codex debug models — 4 models/, result.source);
    assert.equal(result.authoritative, true);
  } finally {
    process.env.PATH = savedPath;
    rmSync(root, { recursive: true, force: true });
  }
});

test("read: authoritative — true for debug models, false for the cache and when the catalog is unavailable", () => {
  assert.equal(withCodexHome(null, (codexHome) => readCodexCatalog({ run: ok(FIXTURE), codexHome })).authoritative, true);
  const cache = JSON.stringify({ fetched_at: "2026-10-17T00:00:00Z", ...JSON.parse(FIXTURE) });
  assert.equal(withCodexHome(cache, (codexHome) => readCodexCatalog({ run: failed("boom"), codexHome })).authoritative, false);
  assert.equal(withCodexHome(null, (codexHome) => readCodexCatalog({ run: failed("boom"), codexHome })).authoritative, false);
});
