import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { buildYaml, prefill, startPipelineForm, validateServer } from "./pipeline-form.mjs";
import { MESSAGES } from "./form/i18n.mjs";
import { parsePipelineYaml, resolveProfile } from "../../orca-pod/scripts/pipeline-config.mjs";

const LAUNCHER_PATH = fileURLToPath(new URL("../../orca-pod/scripts/launch-provider.mjs", import.meta.url));
const SETUP_FORM_PATH = fileURLToPath(new URL("./setup-form.mjs", import.meta.url));

// A non-ASCII (Cyrillic) profile name, written with \u escapes: it must survive validateServer, buildYaml, prefill and the launcher.
const CHEAP = "\u0434\u0435\u0448\u0451\u0432\u044b\u0439";

// The form catalog in miniature: Pi models and Claude Code (an alias + a specific version for the role only).
const CLAUDE_LEVELS = ["low", "medium", "high", "xhigh", "max"];
const MODELS = [
  { program: "pi", provider: "zai", id: "glm-5.3-flash", levels: ["low", "medium", "high"] },
  { program: "pi", provider: "openai-codex", id: "gpt-5.6-sol", levels: ["low", "medium", "high", "xhigh"] },
  { program: "claude-code", id: "opus", levels: CLAUDE_LEVELS },
  { program: "claude-code", id: "sonnet", levels: CLAUDE_LEVELS },
  { program: "claude-code", id: "claude-opus-5-5", levels: CLAUDE_LEVELS, roleOnly: true },
  // Codex: models of different multi-agent generations; a helper started with agent_type runs on any of them.
  { program: "codex", provider: "codex", id: "gpt-6-luna", levels: ["low", "medium", "high", "xhigh", "max"] },
  { program: "codex", provider: "codex", id: "gpt-6-astra", levels: ["low", "medium", "high", "xhigh", "max", "ultra"] },
  { program: "codex", provider: "codex", id: "gpt-5.6-luna", levels: ["low", "medium", "high", "xhigh", "max"] },
];

function role(model, thinking, { provider = "", subagents = [] } = {}) {
  return { provider, model, thinking, useSubagents: subagents.length > 0, subagents };
}

function settings() {
  return {
    activeProfile: "sol-quality",
    language: "auto",
    profiles: [
      { name: "sol-quality", defaultProvider: "pi", maxSubagents: 6, roles: {
        planner: role("pi:openai-codex/gpt-5.6-sol", "xhigh", { subagents: [{ name: "scout", model: "inherit", thinking: "low" }] }),
        implementer: role("pi:zai/glm-5.3-flash", "high", { subagents: [{ name: "worker", model: "inherit", thinking: "inherit" }] }),
        reviewer: role("claude-code:opus", "max", { provider: "claude-code" }),
      } },
      { name: CHEAP, defaultProvider: "claude-code", maxSubagents: 20, roles: {
        planner: role("claude-code:claude-opus-5-5", "high"),
        implementer: role("claude-code:sonnet", "medium", { subagents: [{ name: "worker", model: "claude-code:sonnet", thinking: "low" }] }),
      } },
    ],
  };
}

function runLauncher(yaml, args) {
  const root = mkdtempSync(path.join(tmpdir(), "orca-form-test-"));
  try {
    const bin = path.join(root, "bin");
    mkdirSync(bin);
    mkdirSync(path.join(root, ".orca-pod"));
    writeFileSync(path.join(root, ".orca-pod", "orca-pod.yaml"), yaml);
    writeFileSync(path.join(bin, "git"), "#!/bin/sh\npwd -P\n", { mode: 0o755 });
    return spawnSync(process.execPath, [LAUNCHER_PATH, ...args], { cwd: root, env: { ...process.env, PATH: bin }, encoding: "utf8" });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("prefill: an empty file — one profile named default on Pi with the limit 6", () => {
  assert.deepEqual(prefill(""), { activeProfile: "default", language: "auto", profiles: [{ name: "default", defaultProvider: "pi", maxSubagents: 6, fullAccess: false, roles: {} }] });
});

test("prefill: the old format with a root default_provider", () => {
  const pre = prefill("active_profile: default\ndefault_provider: claude-code\nprofiles:\n  default:\n    roles:\n      planner:\n        model: opus\n        thinking: max\n");
  assert.equal(pre.activeProfile, "default");
  assert.equal(pre.profiles.length, 1);
  assert.deepEqual([pre.profiles[0].name, pre.profiles[0].defaultProvider, pre.profiles[0].maxSubagents], ["default", "claude-code", 6]);
  assert.deepEqual(pre.profiles[0].roles.planner, { present: true, provider: "", model: "opus", thinking: "max", useSubagents: false, subagents: [] });
  assert.equal(pre.profiles[0].roles.reviewer.present, false);
});

test("prefill: an unparseable file opens the form from scratch and explains why", () => {
  const pre = prefill("active_profile: x\nprofiles:\n\tx:\n");
  // The warning is a key + params that the client renders in its UI language (see i18n.test.mjs).
  assert.equal(pre.warning.key, "prefill.parseError");
  assert.match(pre.warning.params.message, /tabs/);
  assert.deepEqual(pre.profiles.map((profile) => profile.name), ["default"]);
});

test("prefill: all profiles, limits, own agents and subagents", () => {
  const pre = prefill(buildYaml(settings()));
  assert.equal(pre.activeProfile, "sol-quality");
  assert.deepEqual(pre.profiles.map((profile) => [profile.name, profile.defaultProvider, profile.maxSubagents]), [
    ["sol-quality", "pi", 6],
    [CHEAP, "claude-code", 20],
  ]);
  assert.equal(pre.profiles[0].roles.reviewer.provider, "claude-code");
  assert.equal(pre.profiles[0].roles.chief_reviewer.present, false);
  assert.deepEqual(pre.profiles[1].roles.implementer.subagents, [{ name: "worker", model: "sonnet", thinking: "low" }]);
});

test("prefill: no language field → auto; ru and pt-BR are read as they are", () => {
  const plain = "active_profile: default\nprofiles:\n  default:\n    roles:\n      planner:\n        model: opus\n        thinking: max\n";
  assert.equal(prefill(plain).language, "auto");
  assert.equal(prefill("language: ru\n" + plain).language, "ru");
  assert.equal(prefill("language: pt-BR\n" + plain).language, "pt-BR");
  assert.equal(prefill("language: auto\n" + plain).language, "auto");
  assert.equal(prefill("active_profile: x\nprofiles:\n\tx:\n").language, "auto", "an unparsed file — the form from scratch, language auto");
});

test("prefill: the language of a file without profiles is not lost (the form starts from scratch, Submit does not overwrite the language silently)", () => {
  for (const source of [
    "language: pt-BR\nactive_profile: x\nprofiles:\n",
    "language: ru\nprofiles:\n",
    "language: ru\nactive_profile: x\n",
    "language: pt-BR\n",
  ]) {
    const pre = prefill(source);
    assert.equal(pre.language, source.match(/^language: (\S+)/m)[1], JSON.stringify(source));
    assert.deepEqual(pre.profiles.map((profile) => profile.name), ["default"], "without profiles — one profile default");
    assert.equal(pre.activeProfile, "default");
  }
  assert.equal(prefill("active_profile: x\nprofiles:\n").language, "auto", "no field — auto");
});

test("validateServer: a correct set of profiles is accepted", () => {
  assert.deepEqual(validateServer(settings(), MODELS), []);
});

for (const [label, mutate, expected] of [
  ["duplicate name", (s) => { s.profiles[1].name = "sol-quality"; }, /“sol-quality”.*already used/],
  ["empty name", (s) => { s.profiles[1].name = ""; }, /profile #2/],
  ["name with a space", (s) => { s.profiles[1].name = "my profile"; }, /“my profile”.*the name/],
  ["active_profile not in the list", (s) => { s.activeProfile = "missing"; }, /active_profile.*“missing”/],
  ["no profiles", (s) => { s.profiles = []; }, /At least one profile/],
  ["limit 0", (s) => { s.profiles[0].maxSubagents = 0; }, /“sol-quality”.*from 1 to 100/],
  ["limit 101", (s) => { s.profiles[1].maxSubagents = 101; }, new RegExp("“" + CHEAP + "”.*from 1 to 100")],
  ["limit 6.5", (s) => { s.profiles[0].maxSubagents = 6.5; }, /from 1 to 100/],
  ["limit as a string", (s) => { s.profiles[0].maxSubagents = "6"; }, /from 1 to 100/],
  ["full access is not boolean", (s) => { s.profiles[0].fullAccess = "yes"; }, /“sol-quality”.*full access/],
  ["unknown agent of the profile", (s) => { s.profiles[1].defaultProvider = "gemini"; }, new RegExp("“" + CHEAP + "”.*default_provider")],
  ["language: an invalid tag", (s) => { s.language = "Russian"; }, /language/],
  ["language: capital letters", (s) => { s.language = "EN"; }, /language/],
  ["language: one letter", (s) => { s.language = "e"; }, /language/],
  ["language: an empty string", (s) => { s.language = ""; }, /language/],
  ["language: not a string", (s) => { s.language = 5; }, /language/],
  ["language: null", (s) => { s.language = null; }, /language/],
  ["a role error carries the profile name", (s) => { s.profiles[1].roles.implementer.model = "claude-code:missing"; }, new RegExp(CHEAP + "/implementer: unknown model")],
]) {
  test(`validateServer: ${label}`, () => {
    const submitted = settings();
    mutate(submitted);
    // English is the default language of validateServer; the Russian texts are covered by i18n.test.mjs.
    const errors = validateServer(submitted, MODELS);
    assert.ok(errors.some((error) => expected.test(error)), errors.join("\n"));
  });
}

test("roundtrip: the form YAML passes the launcher, the limits and agents of the profiles are kept", () => {
  const yaml = buildYaml(settings());
  const listed = runLauncher(yaml, ["--profiles"]);
  assert.equal(listed.status, 0, listed.stderr);
  const listing = JSON.parse(listed.stdout);
  assert.deepEqual(listing.profiles.map((profile) => [profile.name, profile.valid, profile.maxSubagents, profile.defaultProvider]), [
    ["sol-quality", true, 6, "pi"],
    [CHEAP, true, 20, "claude-code"],
  ]);
  assert.equal(listing.profiles[0].roles.reviewer.provider, "claude-code");
  const role = runLauncher(yaml, ["--role", "implementer", "--profile", CHEAP, "--validate"]);
  assert.equal(role.status, 0, role.stderr);
  assert.deepEqual(JSON.parse(role.stdout).subagentSettings.worker, { model: "sonnet", thinking: "low" });
});

test("language: correct values are accepted, a missing field means auto", () => {
  for (const language of ["auto", "en", "ru", "pt-BR", "fil", "zh-Hant-TW"]) {
    const submitted = settings();
    submitted.language = language;
    assert.deepEqual(validateServer(submitted, MODELS), [], language);
  }
  const legacy = settings();
  delete legacy.language;
  assert.deepEqual(validateServer(legacy, MODELS), []);
  assert.match(buildYaml(legacy), /^language: auto$/m);
});

test("buildYaml writes language right after active_profile, the launcher accepts the file", () => {
  for (const language of ["auto", "ru", "pt-BR"]) {
    const submitted = settings();
    submitted.language = language;
    const yaml = buildYaml(submitted);
    assert.equal(yaml.match(/^language: /gm)?.length, 1, yaml);
    assert.match(yaml, new RegExp("^active_profile: sol-quality\\n(?:#.*\\n)?language: " + language + "\\n", "m"), yaml);
    assert.ok(yaml.indexOf("language: ") < yaml.indexOf("profiles:"), "language is a root field, before profiles");
    assert.equal(parsePipelineYaml(yaml).language, language);
    assert.equal(resolveProfile(parsePipelineYaml(yaml)).language, language);
    const listed = runLauncher(yaml, ["--profiles"]);
    assert.equal(listed.status, 0, listed.stderr);
    assert.equal(JSON.parse(listed.stdout).language, language);
    const roles = runLauncher(yaml, ["--roles"]);
    assert.equal(roles.status, 0, roles.stderr);
    assert.equal(JSON.parse(roles.stdout).language, language);
  }
});

test("roundtrip keeps pt-BR: prefill → the form (/data) → Submit (/generate) → YAML → prefill and the launcher", async () => {
  const source = buildYaml({ ...settings(), language: "pt-BR" });
  assert.equal(prefill(source).language, "pt-BR");
  const form = await startPipelineForm({ models: MODELS, currentYaml: source, timeout: 30 });
  try {
    const token = new URL(form.url).search;
    const base = new URL(form.url).origin;
    const data = await (await fetch(base + "/data" + token)).json();
    assert.equal(data.pre.language, "pt-BR");
    assert.ok(new RegExp(data.languagePattern).test("pt-BR") && !new RegExp(data.languagePattern).test("Russian"), "the client receives the tag rule");
    // The client returns the selected value as it is: a tag outside the list stays.
    const response = await fetch(base + "/generate" + token, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...settings(), language: data.pre.language }),
    });
    const out = await response.json();
    assert.equal(response.status, 200, JSON.stringify(out));
    assert.match(out.yaml, /^language: pt-BR$/m);
    const outcome = await form.result;
    assert.equal(outcome.status, "submitted");
    assert.equal(outcome.settings.language, "pt-BR", "pickSettings keeps language");
    assert.equal(prefill(outcome.yaml).language, "pt-BR");
    const listed = runLauncher(outcome.yaml, ["--profiles"]);
    assert.equal(listed.status, 0, listed.stderr);
    assert.equal(JSON.parse(listed.stdout).language, "pt-BR");
  } finally {
    form.close();
  }
});

test("Submit with an invalid language is rejected by the server and does not finish the form", async () => {
  const form = await startPipelineForm({ models: MODELS, timeout: 30 });
  try {
    const token = new URL(form.url).search;
    const response = await fetch(new URL(form.url).origin + "/generate" + token, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...settings(), language: "Russian" }),
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /language/);
  } finally {
    form.close();
  }
});

test("full_access: buildYaml writes the field only when true, prefill and the launcher read it", () => {
  const submitted = settings();
  submitted.profiles[1].fullAccess = true;
  assert.deepEqual(validateServer(submitted, MODELS), []);
  const yaml = buildYaml(submitted);
  assert.equal(yaml.match(/^    full_access: true$/gm)?.length, 1, yaml);
  assert.doesNotMatch(yaml, /full_access: false/);
  assert.deepEqual(prefill(yaml).profiles.map((profile) => [profile.name, profile.fullAccess]), [["sol-quality", false], [CHEAP, true]]);
  const listed = runLauncher(yaml, ["--profiles"]);
  assert.equal(listed.status, 0, listed.stderr);
  assert.deepEqual(JSON.parse(listed.stdout).profiles.map((profile) => [profile.name, profile.fullAccess]), [["sol-quality", false], [CHEAP, true]]);
});

test("full_access: a profile without the fullAccess field is accepted by the server as off", () => {
  const submitted = settings();
  delete submitted.profiles[0].fullAccess;
  assert.deepEqual(validateServer(submitted, MODELS), []);
  assert.doesNotMatch(buildYaml(submitted), /full_access/);
});

function codexSettings(implementerSubagents) {
  return {
    activeProfile: "cx",
    profiles: [{ name: "cx", defaultProvider: "codex", maxSubagents: 6, roles: {
      planner: role("codex:gpt-6-astra", "ultra"),
      implementer: role("codex:gpt-6-luna", "high", { subagents: implementerSubagents }),
    } }],
  };
}

test("Codex: a helper on a model of another generation is accepted by the server", () => {
  assert.deepEqual(validateServer(codexSettings([{ name: "worker", model: "codex:gpt-5.6-luna", thinking: "low" }]), MODELS), []);
});

test("Codex: inherit and a compatible model are accepted, an effort outside the helper model's levels is not", () => {
  assert.deepEqual(validateServer(codexSettings([
    { name: "worker", model: "inherit", thinking: "inherit" },
    { name: "scout", model: "codex:gpt-6-astra", thinking: "ultra" },
  ]), MODELS), []);
  const errors = validateServer(codexSettings([{ name: "worker", model: "codex:gpt-6-luna", thinking: "ultra" }]), MODELS);
  assert.deepEqual(errors, ["cx/implementer/worker: thinking ultra is not available for the subagent model"]);
});

test("Codex: lens-checker is rejected", () => {
  const errors = validateServer(codexSettings([{ name: "lens-checker", model: "inherit", thinking: "inherit" }]), MODELS);
  assert.deepEqual(errors, ["cx/implementer: lens-checker exists only in Pi (pi-lens)"]);
});

test("buildYaml: a Codex profile with ultra passes parsePipelineYaml + resolveProfile", () => {
  const yaml = buildYaml(codexSettings([{ name: "worker", model: "codex:gpt-5.6-luna", thinking: "low" }]));
  assert.match(yaml, /default_provider: codex/);
  const resolved = resolveProfile(parsePipelineYaml(yaml));
  assert.deepEqual([resolved.resolvedRoles.planner.provider, resolved.resolvedRoles.planner.model, resolved.resolvedRoles.planner.thinking], ["codex", "gpt-6-astra", "ultra"]);
  assert.deepEqual(resolved.resolvedRoles.implementer.resolvedSubagentSettings.worker, { model: "gpt-5.6-luna", thinking: "low" });
});

test("the lens-checker description in the form: absent in Claude Code and Codex (the form/i18n.mjs dictionary, both locales)", () => {
  assert.match(MESSAGES.ru["agent.lens-checker"], /В Claude Code и Codex отсутствует/); // ru-fixture: the Russian dictionary text
  assert.match(MESSAGES.en["agent.lens-checker"], /Absent in Claude Code and Codex/);
});

test("setup-form.mjs: migrates the old layouts before reading the config, the migration field holds lines joined by \n", () => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "orca-setup-form-test-")));
  try {
    spawnSync("git", ["-C", root, "init", "-q"]);
    mkdirSync(path.join(root, ".orca-pipeline", "reports"), { recursive: true });
    writeFileSync(path.join(root, ".orca-pipeline", "orca-pipeline.yaml"), "active_profile: default\n");
    writeFileSync(path.join(root, "orca-pipeline.yaml"), "active_profile: old\n");
    // PATH holds only git and a claude stub: the claude-code catalog is the aliases, no network access; the form closes on the timeout.
    const bin = path.join(root, "..", path.basename(root) + "-bin");
    mkdirSync(bin);
    writeFileSync(path.join(bin, "claude"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    symlinkSync(spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim(), path.join(bin, "git"));
    let result;
    try {
      result = spawnSync(process.execPath, [SETUP_FORM_PATH, "--no-open", "--timeout", "1", "--programs", "claude-code"], {
        cwd: root, encoding: "utf8", env: { ...process.env, PATH: bin },
      });
    } finally {
      rmSync(bin, { recursive: true, force: true });
    }
    const outcome = JSON.parse(result.stdout.trim().split("\n").pop());
    assert.equal(outcome.status, "timeout", result.stdout + result.stderr);
    assert.equal(outcome.targetPath, path.join(root, ".orca-pod", "orca-pod.yaml"));
    assert.equal(typeof outcome.migration, "string");
    const lines = outcome.migration.split("\n");
    assert.deepEqual(lines.map((line) => line.split(" ")[0]), ["MOVED", "IGNORED"]);
    assert.ok(outcome.sourceHash, "the config is read from the new place");
    assert.match(result.stderr, /^MIGRATION MOVED /m);
    assert.match(result.stderr, /^MIGRATION IGNORED /m);
    assert.equal(existsSync(path.join(root, ".orca-pod", "reports")), true);
    assert.equal(existsSync(path.join(root, ".orca-pipeline")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function runSetupForm(cwd, root, { open = false, env = {} } = {}) {
  // PATH holds only git and a claude stub (see the test above): the catalog is the aliases, no network, the form closes on the timeout.
  const bin = path.join(root, path.basename(cwd) + "-bin");
  mkdirSync(bin);
  writeFileSync(path.join(bin, "claude"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  symlinkSync(spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim(), path.join(bin, "git"));
  const result = spawnSync(process.execPath, [SETUP_FORM_PATH, ...(open ? [] : ["--no-open"]), "--timeout", "1", "--programs", "claude-code"], {
    cwd, encoding: "utf8", env: { ...process.env, PATH: bin, ...env },
  });
  return { result, outcome: JSON.parse(result.stdout.trim().split("\n").pop()) };
}

test("setup-form.mjs in a linked worktree: after the migration targetPath is the worktree's own .orca-pod/orca-pod.yaml, not the shared one", () => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "orca-setup-form-wt-")));
  try {
    const main = path.join(root, "main");
    const worktree = path.join(root, "wt");
    mkdirSync(main);
    const git = (...args) => assert.equal(spawnSync("git", ["-C", main, "-c", "user.name=t", "-c", "user.email=t@t", ...args], { encoding: "utf8" }).status, 0);
    git("init", "-q");
    git("commit", "-q", "--allow-empty", "-m", "init");
    git("worktree", "add", "-q", worktree);
    mkdirSync(path.join(worktree, ".orca-pipeline"));
    writeFileSync(path.join(worktree, ".orca-pipeline", "orca-pipeline.yaml"), "active_profile: wt\n");
    const { result, outcome } = runSetupForm(worktree, root);
    assert.equal(outcome.status, "timeout", result.stdout + result.stderr);
    assert.match(outcome.migration, /^MOVED /);
    assert.equal(outcome.targetPath, path.join(worktree, ".orca-pod", "orca-pod.yaml"));
    assert.ok(outcome.sourceHash, "the already migrated worktree file is read");
    assert.equal(existsSync(path.join(main, ".orca-pod")), false, "the main checkout config is not created");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("startPipelineForm: server-side errors are English", async () => {
  await assert.rejects(startPipelineForm({ models: [] }), { message: "No models are available to configure the pipeline" });
  await assert.rejects(startPipelineForm({ models: MODELS, timeout: 0 }), { message: "timeout must be a positive number" });
});

test("a request after Cancel gets 409 with an English text (the client replaces it with its own localized text)", async () => {
  const form = await startPipelineForm({ models: MODELS, timeout: 30 });
  try {
    const url = new URL(form.url);
    // Two pipelined requests on one connection: Cancel finishes the form, the second request arrives after that.
    const request = (method, pathname, body = "") => `${method} ${pathname}${url.search} HTTP/1.1\r\nHost: localhost:${url.port}\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\n\r\n${body}`;
    const raw = await new Promise((resolve, reject) => {
      const socket = net.connect(Number(url.port), "127.0.0.1");
      let received = "";
      socket.setTimeout(3000, () => socket.destroy());
      socket.on("data", (chunk) => { received += chunk; if (received.includes("already finished")) socket.end(); });
      socket.on("close", () => resolve(received));
      socket.on("error", reject);
      socket.write(request("POST", "/cancel", "{}") + request("GET", "/data"));
    });
    assert.match(raw, /HTTP\/1\.1 409/);
    assert.match(raw, /\{"error":"The form is already finished"\}/);
    assert.equal((await form.result).status, "cancelled");
  } finally {
    form.close();
  }
});

function withProject(prefix, run, { git = true } = {}) {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), prefix)));
  try {
    const project = path.join(root, "project");
    mkdirSync(project);
    if (git) spawnSync("git", ["-C", project, "init", "-q"]);
    return run(project, root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("setup-form.mjs: outside a Git project → status error with an English message", () => withProject("orca-setup-form-nogit-", (project, root) => {
  const { outcome } = runSetupForm(project, root, { env: { GIT_CEILING_DIRECTORIES: root } });
  assert.equal(outcome.status, "error");
  assert.equal(outcome.error, "Open a Git project folder before configuring the pipeline");
}, { git: false }));

test("setup-form.mjs: a directory instead of orca-pod.yaml → status error with an English message", () => withProject("orca-setup-form-dir-", (project, root) => {
  mkdirSync(path.join(project, ".orca-pod", "orca-pod.yaml"), { recursive: true });
  const { outcome } = runSetupForm(project, root);
  assert.equal(outcome.status, "error");
  assert.equal(outcome.error, "orca-pod.yaml must be a regular file, not a directory or a link");
}));

test("setup-form.mjs: the browser cannot be opened → an English hint on stderr, the form URL is still printed", { skip: process.platform === "win32" }, () => withProject("orca-setup-form-open-", (project, root) => {
  // PATH holds no open/xdg-open, so the automatic opening fails.
  const { result, outcome } = runSetupForm(project, root, { open: true });
  assert.equal(outcome.status, "timeout", result.stdout + result.stderr);
  assert.match(result.stderr, /^FORM URL: http:\/\/localhost:\d+\/\?t=/m);
  assert.match(result.stderr, /^The browser did not open automatically — open the link manually\.$/m);
}));
