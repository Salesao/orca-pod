// Codex model catalog: models, reasoning effort levels and visibility in the Codex picker.
// Shared module of the launcher (Codex role validation) and the orca-pod-setup form.
// The primary source is `codex debug models` (no AI request); the fallback is the internal cache
// <CODEX_HOME>/models_cache.json, which Codex refreshes itself and may keep incomplete.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/** models[] of the Codex catalog → { id, levels, defaultLevel, visible }; visible — the model is in the Codex picker. */
export function parseCodexCatalog(json) {
  const catalog = typeof json === "string" ? JSON.parse(json) : json;
  if (!catalog || !Array.isArray(catalog.models)) throw new Error("the catalog has no models list");
  return catalog.models
    .filter((model) => model && typeof model.slug === "string" && model.slug)
    .map((model) => ({
      id: model.slug,
      levels: (model.supported_reasoning_levels || []).map((level) => level && level.effort).filter(Boolean),
      defaultLevel: model.default_reasoning_level || null,
      visible: model.visibility === "list",
    }));
}

// debug models output is ~62 KB per model: the default maxBuffer (1 MiB) fits only ~16 models.
function runCommand(command, args, env) {
  return spawnSync(command, args, { encoding: "utf8", env, timeout: 20000, maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
}

function failureReason(result) {
  if (result.error) return result.error.message;
  if (result.status !== 0) return (String(result.stderr || "").trim().split("\n").pop() || "exit " + result.status);
  return null;
}

/**
 * authoritative — the catalog comes from debug models; the Codex cache may be incomplete, so "no such model" is not proven by it.
 * command and env — a codex found outside PATH (find-executable.mjs).
 */
export function readCodexCatalog({ run = runCommand, codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex"), command = "codex", env = process.env } = {}) {
  let reason;
  try {
    const result = run(command, ["debug", "models"], env);
    reason = failureReason(result);
    if (!reason) {
      const models = parseCodexCatalog(result.stdout);
      return { models, authoritative: true, source: "Codex: codex debug models — " + models.length + " models" };
    }
  } catch (error) {
    reason = error.message;
  }
  const cachePath = path.join(codexHome, "models_cache.json");
  try {
    const cache = JSON.parse(readFileSync(cachePath, "utf8"));
    const models = parseCodexCatalog(cache);
    return { models, authoritative: false, source: "Codex: models_cache.json from " + (cache.fetched_at || "unknown date") + " (debug models: " + reason + ")" };
  } catch (error) {
    return { models: [], authoritative: false, source: "Codex: catalog unavailable (debug models: " + reason + "; cache: " + error.message + ")" };
  }
}
