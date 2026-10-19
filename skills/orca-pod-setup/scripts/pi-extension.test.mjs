import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";

// pi-extension/index.js is loaded by Pi with Pi's own packages. Here it runs against stubs of them,
// with the real form scripts, to check the text the tool returns to the agent. SKILL.md tells the agent how to react to it.
const SETUP_SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PIPELINE_SKILL_DIR = path.resolve(SETUP_SKILL_DIR, "..", "orca-pod");

const write = (file, text) => { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, text); };
// An empty ORCA_POD_BIN_DIRS: claude and codex are looked up only in the test's PATH, never in this machine's install folders.
process.env.ORCA_POD_BIN_DIRS = "";

/** A skills/ layout in a temp dir: a copy of the extension (so the stubs below are found), real scripts and the real sibling skill. */
function installExtension(root, scope) {
  const skills = path.join(root, "skills");
  const setup = path.join(skills, "orca-pod-setup");
  cpSync(path.join(SETUP_SKILL_DIR, "pi-extension"), path.join(setup, "pi-extension"), { recursive: true });
  symlinkSync(path.join(SETUP_SKILL_DIR, "scripts"), path.join(setup, "scripts"));
  symlinkSync(PIPELINE_SKILL_DIR, path.join(skills, "orca-pod"));
  const stubs = path.join(setup, "node_modules", scope);
  const manifest = JSON.stringify({ type: "module", exports: "./index.js" });
  write(path.join(stubs, "pi-ai", "package.json"), manifest);
  write(path.join(stubs, "pi-ai", "index.js"),
    "const make = (kind) => (...args) => ({ kind, args });\n" +
    "export const Type = new Proxy({}, { get: (_, kind) => make(String(kind)) });\n" +
    "export const getSupportedThinkingLevels = () => ['low', 'medium', 'high'];\n");
  write(path.join(stubs, "pi-coding-agent", "package.json"), manifest);
  write(path.join(stubs, "pi-coding-agent", "index.js"), "export const defineTool = (tool) => tool;\n");
  write(path.join(stubs, "pi-tui", "package.json"), manifest);
  write(path.join(stubs, "pi-tui", "index.js"),
    "export class Editor { constructor() { this.text = ''; } setText(text) { this.text = text; } handleInput() {} render() { return []; } }\n" +
    "export const Key = { enter: 'enter', escape: 'escape', tab: 'tab', up: 'up', down: 'down', left: 'left', right: 'right', shift: (key) => 'shift+' + key };\n" +
    "export const matchesKey = (data, key) => data === key;\n" +
    "export const visibleWidth = (text) => text.length;\n" +
    "export const wrapTextWithAnsi = (text) => [text];\n");
  return pathToFileURL(path.join(setup, "pi-extension", "index.js")).href;
}

/** Runs run({ tool, tools, ctx, project, root }) with the extension registered (tool = orca_pod_setup); PATH holds only git (no claude/codex catalogs). */
// scope: the npm scope of Pi's packages — @earendil-works since Pi 0.74, @mariozechner before it.
async function withExtension(run, { git = true, execCode = 0, registryError = null, scope = "@earendil-works" } = {}) {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "orca-pi-ext-test-")));
  const previous = { PATH: process.env.PATH, ceiling: process.env.GIT_CEILING_DIRECTORIES };
  try {
    const moduleUrl = installExtension(root, scope);
    const bin = path.join(root, "bin");
    mkdirSync(bin);
    symlinkSync(spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim(), path.join(bin, "git"));
    const project = path.join(root, "project");
    mkdirSync(project);
    if (git) spawnSync("git", ["-C", project, "init", "-q"]);
    process.env.PATH = bin;
    process.env.GIT_CEILING_DIRECTORIES = root;
    const handlers = {};
    const pi = {
      tools: {},
      on: (event, handler) => { handlers[event] = handler; },
      registerTool(tool) { this.tools[tool.name] = tool; },
      exec: async () => ({ code: execCode, killed: false }),
    };
    await (await import(moduleUrl)).default(pi);
    const ctx = {
      cwd: project,
      modelRegistry: {
        refresh: async () => {},
        getError: () => registryError,
        getAvailable: () => [{ provider: "zai", id: "glm-5.3-flash" }],
        getAll: () => [],
      },
    };
    return await run({ tool: pi.tools.orca_pod_setup, tools: pi.tools, ctx, project, root, handlers });
  } finally {
    process.env.PATH = previous.PATH;
    if (previous.ceiling === undefined) delete process.env.GIT_CEILING_DIRECTORIES;
    else process.env.GIT_CEILING_DIRECTORIES = previous.ceiling;
    rmSync(root, { recursive: true, force: true });
  }
}

/** Starts the tool and waits for its first update (the form is open); returns the pending result, the updates and the form URL. */
async function startTool(tool, ctx, params = { timeout: 30, no_open: true }, signal) {
  const updates = [];
  const result = tool.execute("call-1", params, signal, (update) => updates.push(update), ctx);
  result.catch(() => {}); // a rejection is asserted by the caller
  for (let waited = 0; !updates.length && waited < 10000; waited += 20) await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(updates.length, "the tool did not report an open form");
  const url = updates.at(-1).content[0].text.match(/http:\/\/localhost:\d+\/\?t=\w+/)?.[0];
  return { result, updates, url };
}

const post = (url, endpoint, body) => {
  const { origin, search } = new URL(url);
  return fetch(origin + endpoint + search, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
};

const role = () => ({ provider: "", model: "pi:zai/glm-5.3-flash", thinking: "high", useSubagents: false, subagents: [] });
const submission = () => ({
  activeProfile: "default", language: "auto",
  profiles: [{ name: "default", defaultProvider: "pi", maxSubagents: 6, roles: { planner: role(), implementer: role() } }],
});

test("the tool is registered as orca_pod_setup with an English prompt snippet and description (the real button name, the active config)", () => withExtension(({ tool }) => {
  assert.equal(tool.name, "orca_pod_setup");
  assert.equal(tool.promptSnippet, "Configure orca-pod.yaml through the browser form; the answer returns directly to the agent.");
  assert.equal(tool.description,
    "Open the existing Orca pipeline configuration form in a browser. “Generate YAML” returns the chosen settings and YAML directly to this tool call, like pi-interview. " +
    "No shell server, polling, sleep or result files. Resolve the project folder (the Git root; outside Git the current folder) and prefill the active orca-pod.yaml (the linked worktree’s own file if there is one, otherwise the shared one). " +
    "Does not write that file or launch pipeline roles. After submitted, follow the orca-pod-setup skill to save the config and validate it. Cancellation must not generate default settings.");
}));

test("Submit: the result text tells the agent to re-read the file, compare the SHA-256, save the YAML and run --profiles", () => withExtension(async ({ tool, ctx, project }) => {
  const { result, updates, url } = await startTool(tool, ctx);
  assert.equal(updates[0].content[0].text.split("\n")[0], "The form is open. Waiting for “Generate YAML” — the answer arrives directly, without file polling.");
  assert.equal((await post(url, "/generate", submission())).status, 200);
  const done = await result;
  assert.equal(done.details.status, "submitted");
  const lines = done.content[0].text.split("\n");
  assert.deepEqual(lines.slice(0, 5), [
    "The user submitted the Orca pipeline settings from the browser form.",
    "Target file: " + path.join(project, ".orca-pod", "orca-pod.yaml"),
    "SHA-256 of the source file: (there was no file)",
    "Default profile (active_profile): default",
    "Profile default: default_provider=pi; concurrent subagents up to 6",
  ]);
  assert.deepEqual(lines.slice(5, 7), [
    "  planner: pi | pi:zai/glm-5.3-flash | high | use_subagents=false",
    "  implementer: pi | pi:zai/glm-5.3-flash | high | use_subagents=false",
  ]);
  assert.deepEqual(lines.slice(7, 11), [
    "",
    "The configuration is NOT saved yet; the pipeline roles were NOT started.",
    "Continue the orca-pod-setup skill: re-read the target file and compare the SHA-256 (if it does not match, show the difference and ask the user what to do), show “was → now” per profile, write the whole YAML (comments in the old file are not carried over — say so if there were any) and run launch-provider.mjs --profiles — all profiles must be valid.",
    "",
  ]);
  assert.equal(lines[11], "```yaml");
  assert.ok(lines.includes("active_profile: default") && lines.at(-1) === "```", done.content[0].text);
}));

test("Cancel, timeout and abort: English reason, the configuration is unchanged, no YAML from defaults", () => withExtension(async ({ tool, ctx }) => {
  const tail = " The configuration is unchanged. Do not create a YAML from default values.";
  const cancelled = await startTool(tool, ctx);
  assert.equal((await post(cancelled.url, "/cancel", {})).status, 200);
  const cancelledDone = await cancelled.result;
  assert.equal(cancelledDone.details.status, "cancelled");
  assert.equal(cancelledDone.content[0].text, "The user cancelled the form." + tail);

  const timedOut = await tool.execute("call-2", { timeout: 1, no_open: true }, undefined, () => {}, ctx);
  assert.equal(timedOut.details.status, "timeout");
  assert.equal(timedOut.content[0].text, "The wait for the form timed out." + tail);

  const controller = new AbortController();
  const aborted = await startTool(tool, ctx, { timeout: 30, no_open: true }, controller.signal);
  controller.abort();
  const abortedDone = await aborted.result;
  assert.equal(abortedDone.details.status, "aborted");
  assert.equal(abortedDone.content[0].text, "The setup was interrupted." + tail);
}));

test("old config layouts are migrated first; the result text opens with the English migration note, whatever the outcome", () => withExtension(async ({ tool, ctx, project }) => {
  write(path.join(project, "orca-pipeline.yaml"), "active_profile: old\n");
  const { result, url } = await startTool(tool, ctx);
  await post(url, "/cancel", {});
  const done = await result;
  const lines = done.content[0].text.split("\n");
  assert.equal(lines[0], "Config migration:");
  assert.match(lines[1], /^MOVED /);
  assert.equal(lines[2], "— tell the user briefly (one line per result).");
  assert.equal(lines[3], "The user cancelled the form. The configuration is unchanged. Do not create a YAML from default values.");
  assert.match(done.details.migration, /^MOVED /);
}));

test("the browser cannot be opened: the update says so in English and repeats the link", () => withExtension(async ({ tool, ctx }) => {
  const { result, updates, url } = await startTool(tool, ctx, { timeout: 30 });
  for (let waited = 0; updates.length < 2 && waited < 5000; waited += 20) await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(updates[1].content[0].text.split("\n")[0], "The browser could not be opened automatically. Open this link manually:");
  assert.ok(updates[1].content[0].text.endsWith(url));
  await post(url, "/cancel", {});
  await result;
}, { execCode: 1 }));

test("errors thrown to the agent are English: second form, broken models.json", async () => {
  await withExtension(async ({ tool, ctx }) => {
    const first = await startTool(tool, ctx);
    await assert.rejects(tool.execute("call-2", { no_open: true }, undefined, () => {}, ctx), { message: "A pipeline setup form is already open in this session" });
    await post(first.url, "/cancel", {});
    await first.result;
  });
  await withExtension(async ({ tool, ctx }) => {
    await assert.rejects(tool.execute("call-1", { no_open: true }, undefined, () => {}, ctx), { message: "Pi could not load the model settings; check models.json" });
  }, { registryError: new Error("bad json") });
});

test("a directory instead of orca-pod.yaml is refused with an English error", () => withExtension(async ({ tool, ctx, project }) => {
  mkdirSync(path.join(project, ".orca-pod", "orca-pod.yaml"), { recursive: true });
  await assert.rejects(tool.execute("call-1", { no_open: true }, undefined, () => {}, ctx), { message: "orca-pod.yaml must be a regular file, not a directory or a link" });
}));

// orca_pod_ask (plan-blitz in Pi): the window itself is tested in ask-tool.test.mjs; here — the registration and execute().
const ASK = { questions: [{ question: "Keep the order of work?", header: "1 Map", options: [{ label: "Keep" }, { label: "Change" }] }] };

test("the extension registers both tools: orca_pod_setup and orca_pod_ask", () => withExtension(({ tools }) => {
  assert.deepEqual(Object.keys(tools).sort(), ["orca_pod_ask", "orca_pod_setup"]);
}));

test("orca_pod_ask outside the TUI (print, rpc) tells the agent to ask in numbered text", () => withExtension(async ({ tools, ctx }) => {
  for (const mode of ["print", "rpc"]) {
    const result = await tools.orca_pod_ask.execute("call-1", ASK, undefined, () => {}, { ...ctx, mode });
    assert.equal(result.content[0].text, `No interactive terminal UI (mode ${mode}). Ask the same questions as numbered text instead.`);
  }
}));

test("orca_pod_ask with 5 questions returns the limits instead of opening a window", () => withExtension(async ({ tools, ctx }) => {
  const ui = { custom: () => assert.fail("no window for invalid questions") };
  const result = await tools.orca_pod_ask.execute("call-1", { questions: Array(5).fill(ASK.questions[0]) }, undefined, () => {}, { ...ctx, mode: "tui", ui });
  assert.match(result.content[0].text, /^Invalid questions: 5 questions \(1-4 allowed\)\. Limits: /);
}));

test("orca_pod_ask: a session_shutdown while the window is open ends the call as interrupted", () => withExtension(async ({ tools, ctx, handlers }) => {
  let opened = false;
  const theme = { fg: (_color, text) => text, bg: (_color, text) => text, bold: (text) => text };
  const ui = { custom: (factory) => new Promise((resolve) => { factory({ requestRender() {} }, theme, {}, resolve); opened = true; }) };
  const pending = tools.orca_pod_ask.execute("call-1", ASK, undefined, () => {}, { ...ctx, mode: "tui", ui });
  for (let waited = 0; !opened && waited < 2000; waited += 10) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(opened, "the window did not open");
  handlers.session_shutdown();
  const result = await pending;
  assert.equal(result.content[0].text, "The questions were interrupted before an answer. Do not treat anything as approved.");
}));

test("outside a Git repository the form opens for the current folder; the submitted result says so", () => withExtension(async ({ tool, ctx, project }) => {
  const { result, url } = await startTool(tool, ctx);
  assert.equal((await post(url, "/generate", submission())).status, 200);
  const outcome = await result;
  assert.equal(outcome.details.git, false);
  assert.equal(outcome.details.targetPath, path.join(project, ".orca-pod", "orca-pod.yaml"));
  assert.match(outcome.content[0].text, /^Not a Git repository: the config goes into this folder; tell the user the path in one line\.$/m);
}, { git: false }));

// A user's Pi 0.73.1 failed to load the extension: "Cannot find module '@earendil-works/pi-ai'". Pi before 0.74 has only
// the @mariozechner/* packages and its extension context has hasUI but no mode.
test("Pi before 0.74 (@mariozechner/* packages, no ctx.mode): both tools register, the form opens, the question window uses hasUI", () => withExtension(async ({ tools, ctx }) => {
  assert.deepEqual(Object.keys(tools).sort(), ["orca_pod_ask", "orca_pod_setup"]);
  const { result, url } = await startTool(tools.orca_pod_setup, ctx);
  await post(url, "/cancel", {});
  assert.equal((await result).details.status, "cancelled");
  const { mode, ...oldCtx } = ctx;
  const noUi = await tools.orca_pod_ask.execute("call-1", ASK, undefined, () => {}, { ...oldCtx, hasUI: false });
  assert.equal(noUi.content[0].text, "No interactive terminal UI (mode without UI). Ask the same questions as numbered text instead.");
  const answers = [{ header: "1 Map", kind: "option", label: "Keep" }];
  const ui = { custom: () => Promise.resolve({ answers, cancelled: false }) };
  const answered = await tools.orca_pod_ask.execute("call-2", ASK, undefined, () => {}, { ...oldCtx, hasUI: true, ui });
  assert.equal(answered.content[0].text, '1 Map: selected "Keep"');
}, { scope: "@mariozechner" }));
