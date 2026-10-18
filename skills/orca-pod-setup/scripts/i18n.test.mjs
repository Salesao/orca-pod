// Guards of the bilingual (EN/RU) setup form: dictionary parity, language choice, localized server
// errors, and "no hard-coded UI text" checks for index.html and form.js.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { MESSAGES, hasMessage, pickLanguage, t, tn } from "./form/i18n.mjs";
import { buildYaml, prefill, startPipelineForm, validateServer } from "./pipeline-form.mjs";
import { ROLE_AGENTS } from "../../orca-pod/scripts/pipeline-config.mjs";

const FORM_DIR = new URL("./form/", import.meta.url);
const read = (name) => readFileSync(new URL(name, FORM_DIR), "utf8");
const CYRILLIC = /[\u0400-\u04FF]/;
const PLACEHOLDER = /\{(\w+)\}/g;
const placeholders = (text) => [...new Set([...text.matchAll(PLACEHOLDER)].map((match) => match[1]))].sort();
const decodeEntities = (text) => text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const collapse = (text) => text.replace(/\s+/g, " ").trim();
// Language names are shown in their own language, so the English dictionary keeps the Russian one (the "ru-fixture" marker
// on the lines below: the Russian text is the expectation itself, see test/repo-language.test.mjs).
const ENDONYM_KEYS = new Set(["lang.name.ru"]);

test("en and ru have the same keys and the same {placeholders}", () => {
  const en = Object.keys(MESSAGES.en);
  const ru = Object.keys(MESSAGES.ru);
  assert.deepEqual(en.filter((key) => !ru.includes(key)), [], "keys missing from ru");
  assert.deepEqual(ru.filter((key) => !en.includes(key)), [], "keys missing from en");
  for (const key of en) {
    assert.equal(typeof MESSAGES.en[key], "string", key);
    assert.equal(typeof MESSAGES.ru[key], "string", key);
    assert.notEqual(MESSAGES.en[key].trim(), "", key + " is empty in en");
    assert.notEqual(MESSAGES.ru[key].trim(), "", key + " is empty in ru");
    assert.deepEqual(placeholders(MESSAGES.en[key]), placeholders(MESSAGES.ru[key]), "placeholders of " + key);
  }
  assert.ok(en.length > 150, "the dictionary covers the whole form, not a sample");
});

test("plural keys carry one form per plural category; other keys have no pipes", () => {
  for (const key of Object.keys(MESSAGES.en)) {
    if (key.startsWith("plural.")) {
      assert.equal(MESSAGES.en[key].split("|").length, 2, key + " en: one | other");
      assert.equal(MESSAGES.ru[key].split("|").length, 3, key + " ru: one | few | many");
      assert.ok(MESSAGES.en[key].includes("{n}") && MESSAGES.ru[key].includes("{n}"), key + " uses {n}");
    } else {
      assert.ok(!MESSAGES.en[key].includes("|") && !MESSAGES.ru[key].includes("|"), key + " must not contain |");
    }
  }
});

test("the English dictionary has no Cyrillic text (except language names) and no Russian numero sign", () => {
  for (const [key, value] of Object.entries(MESSAGES.en)) {
    if (!ENDONYM_KEYS.has(key)) assert.doesNotMatch(value, CYRILLIC, key);
    // U+2116 is outside the Cyrillic block but is Russian typography ("№1" -> "#1").
    assert.doesNotMatch(value, /\u2116/, key);
  }
});

test("the Russian dictionary has no untranslated English sentences", () => {
  const sameAsEnglish = Object.keys(MESSAGES.ru).filter((key) => MESSAGES.ru[key] === MESSAGES.en[key] && !CYRILLIC.test(MESSAGES.ru[key]) && /[a-z]{4,} [a-z]{3,}/i.test(MESSAGES.ru[key]));
  // Technical strings with a Latin-only value in both languages are fine (inherit (= {model}), Thinking, ...); sentences are not.
  assert.deepEqual(sameAsEnglish, [], "untranslated sentences in ru: " + sameAsEnglish.join(", "));
});

test("t: placeholders, unknown key, unknown language, missing parameter", () => {
  assert.equal(t("en", "role.add", { name: "Reviewer" }), "Add Reviewer");
  assert.equal(t("ru", "role.add", { name: "Reviewer" }), "Добавить Reviewer"); // ru-fixture
  assert.equal(t("en", "no.such.key"), "no.such.key");
  assert.equal(t("ru", "no.such.key", { a: 1 }), "no.such.key");
  assert.equal(t("de", "role.add", { name: "X" }), "Add X", "unknown language falls back to English");
  assert.equal(t(undefined, "role.add", { name: "X" }), "Add X");
  assert.equal(t("en", "role.add"), "Add {name}", "a missing parameter stays visible");
  assert.equal(t("en", "role.add", { name: "{x}" }), "Add {x}", "values are inserted literally");
  assert.equal(t("en", "toString"), "toString", "prototype names are not keys");
  assert.equal(t("__proto__", "role.add", { name: "X" }), "Add X");
  assert.equal(hasMessage("agent.scout"), true);
  assert.equal(hasMessage("agent.__proto__"), false);
  assert.equal(hasMessage("toString"), false);
});

test("tn: plural forms follow the language rules", () => {
  const ru = (n) => tn("ru", "plural.models", n);
  assert.deepEqual([1, 2, 4, 5, 11, 12, 14, 21, 22, 25, 101, 111].map(ru), [
    "1 модель", "2 модели", "4 модели", "5 моделей", "11 моделей", "12 моделей", "14 моделей", "21 модель", "22 модели", "25 моделей", "101 модель", "111 моделей", // ru-fixture
  ]);
  const en = (n) => tn("en", "plural.models", n);
  assert.deepEqual([0, 1, 2, 21].map(en), ["0 models", "1 model", "2 models", "21 models"]);
  assert.equal(tn("en", "no.such.plural", 3), "no.such.plural");
  assert.match(tn("ru", "plural.status.errors", 3), /^3 ошибки — /); // ru-fixture
  assert.match(tn("en", "plural.status.errors", 1), /^1 error — /);
});

test("pickLanguage: table from the brief", () => {
  const table = [
    ["ru", [], "ru"],
    ["pt-BR", ["ru"], "en"],
    ["auto", ["ru-RU"], "ru"],
    ["auto", ["de"], "en"],
    [undefined, [], "en"],
    // more cases around the same rules
    ["ru-RU", ["en"], "ru"],
    ["en", ["ru"], "en"],
    ["auto", ["de", "ru"], "en"],
    ["auto", ["ru", "en"], "ru"],
    ["auto", [], "en"],
    [undefined, ["ru"], "ru"],
    ["", ["ru"], "ru"],
    ["rue", ["ru"], "en"],
    ["zh-Hant-TW", ["ru"], "en"],
    ["auto", undefined, "en"],
  ];
  for (const [configLanguage, browserLanguages, expected] of table) {
    assert.equal(pickLanguage({ configLanguage, browserLanguages }), expected, JSON.stringify({ configLanguage, browserLanguages }));
  }
  assert.equal(pickLanguage(), "en");
  assert.equal(pickLanguage({}), "en");
});

test("wording: the texts name the real button, the name rule has its length, the YAML key hint is language-neutral", () => {
  for (const lang of ["en", "ru"]) {
    const button = MESSAGES[lang]["bar.submit"];
    assert.ok(MESSAGES[lang]["bar.status"].startsWith(button + " "), lang + " bar.status starts with the button label: " + MESSAGES[lang]["bar.status"]);
    assert.ok(MESSAGES[lang]["prefill.parseError"].includes(button), lang + " prefill.parseError names the button: " + MESSAGES[lang]["prefill.parseError"]);
    for (const key of Object.keys(MESSAGES[lang])) assert.ok(!/\bSubmit\b/.test(MESSAGES[lang][key]), lang + " " + key + " calls the button Submit");
    assert.match(MESSAGES[lang]["profile.name.help"], /\b64\b/, lang + " profile.name.help states the length limit");
  }
  assert.equal(MESSAGES.ru["profile.name.key"], MESSAGES.en["profile.name.key"], "YAML key hint is identical in both languages");
  assert.equal(MESSAGES.en["profile.name.key"], "profiles.<name>");
  assert.equal(MESSAGES.en["error.formClosed"], "The form is already finished.");
  assert.match(MESSAGES.en["v.language"], /\(found: “\{value\}”\)/);
  assert.doesNotMatch(MESSAGES.en["v.language"], /\bread\b/);
  assert.equal(MESSAGES.en["profile.name.help"], "Letters, digits, “.”, “_” or “-”, no spaces, up to 64 characters.");
  assert.equal(MESSAGES.ru["profile.name.help"], "Буквы, цифры, «.», «_» или «-», без пробелов, до 64 символов."); // ru-fixture
});

// ── validateServer: same bad input, two languages ──
const MODELS = [
  { program: "pi", provider: "zai", id: "glm-5.3-flash", levels: ["low", "medium", "high"] },
  { program: "claude-code", id: "opus", levels: ["low", "high"] },
  { program: "claude-code", id: "claude-opus-5-5", levels: ["low", "high"], roleOnly: true },
];
const role = (model, thinking, subagents = []) => ({ provider: "", model, thinking, useSubagents: subagents.length > 0, subagents });
const goodSettings = () => ({
  activeProfile: "main", language: "auto",
  profiles: [{ name: "main", defaultProvider: "pi", maxSubagents: 6, roles: { planner: role("pi:zai/glm-5.3-flash", "high"), implementer: role("pi:zai/glm-5.3-flash", "high") } }],
});

test("validateServer: the same bad input is answered in Russian for 'ru' and English for 'en' (and 'en' by default)", () => {
  const bad = {
    activeProfile: "missing", language: "Russian",
    profiles: [{ name: "my profile", defaultProvider: "pi", maxSubagents: 0, roles: {} }],
  };
  assert.deepEqual(validateServer(bad, MODELS, "ru"), [
    "language: нужен «auto» или тег языка вроде en, ru, pt-BR", // ru-fixture
    "профиль «my profile»: имя — буквы, цифры, «.», «_» или «-» без пробелов, до 64 символов", // ru-fixture
    "профиль «my profile»: субагентов одновременно — целое от 1 до 100", // ru-fixture
    "my profile/planner: обязательная роль не заполнена", // ru-fixture
    "my profile/implementer: обязательная роль не заполнена", // ru-fixture
    "active_profile: профиль «missing» не найден среди профилей", // ru-fixture
  ]);
  const english = [
    "language: “auto” or a language tag such as en, ru, pt-BR is required",
    "profile “my profile”: the name — letters, digits, “.”, “_” or “-”, no spaces, up to 64 characters",
    "profile “my profile”: concurrent subagents — an integer from 1 to 100",
    "my profile/planner: the required role is not filled in",
    "my profile/implementer: the required role is not filled in",
    "active_profile: profile “missing” was not found among the profiles",
  ];
  assert.deepEqual(validateServer(bad, MODELS, "en"), english);
  assert.deepEqual(validateServer(bad, MODELS), english, "English is the default");
  assert.deepEqual(validateServer(bad, MODELS, "de"), english, "unknown language: English");
  assert.deepEqual(validateServer(goodSettings(), MODELS, "ru"), []);
  assert.deepEqual(validateServer(goodSettings(), MODELS, "en"), []);
});

// The exact Russian text of the server messages whose English text pipeline-form.test.mjs checks.
const CHEAP = "\u0434\u0435\u0448\u0451\u0432\u044b\u0439"; // a Cyrillic profile name, written with \u escapes
const CODEX_MODELS = [
  ...MODELS,
  { program: "codex", provider: "codex", id: "gpt-6-luna", levels: ["low", "medium", "high", "xhigh", "max"] },
];
const withCheap = () => {
  const s = goodSettings();
  s.profiles.push({ name: CHEAP, defaultProvider: "claude-code", maxSubagents: 20, roles: { planner: role("claude-code:opus", "high"), implementer: role("claude-code:opus", "high") } });
  return s;
};
const codexSettings = (subagents) => ({
  activeProfile: "cx", language: "auto",
  profiles: [{ name: "cx", defaultProvider: "codex", maxSubagents: 6, roles: { planner: role("codex:gpt-6-luna", "high"), implementer: role("codex:gpt-6-luna", "high", subagents) } }],
});

for (const [label, build, expected] of [
  ["duplicate profile name", () => { const s = withCheap(); s.profiles[1].name = "main"; return s; }, [
    "профиль «main»: имя уже занято другим профилем", // ru-fixture
  ]],
  ["no profiles", () => { const s = goodSettings(); s.profiles = []; return s; }, [
    "Нужен хотя бы один профиль", // ru-fixture
  ]],
  ["full access is not boolean", () => { const s = goodSettings(); s.profiles[0].fullAccess = "yes"; return s; }, [
    "профиль «main»: полные права — да или нет (boolean)", // ru-fixture
  ]],
  ["unknown agent of the profile", () => { const s = withCheap(); s.profiles[1].defaultProvider = "gemini"; return s; }, [
    "профиль «" + CHEAP + "»: default_provider — неизвестный агент gemini", // ru-fixture
  ]],
  ["unknown model in a role", () => { const s = withCheap(); s.profiles[1].roles.implementer.model = "claude-code:missing"; return s; }, [
    CHEAP + "/implementer: неизвестная модель claude-code:missing", // ru-fixture
  ]],
  ["Codex helper thinking outside the helper model levels", () => codexSettings([{ name: "worker", model: "codex:gpt-6-luna", thinking: "ultra" }]), [
    "cx/implementer/worker: thinking ultra недоступен для модели субагента", // ru-fixture
  ]],
  ["Codex lens-checker", () => codexSettings([{ name: "lens-checker", model: "inherit", thinking: "inherit" }]), [
    "cx/implementer: lens-checker есть только в Pi (pi-lens)", // ru-fixture
  ]],
]) {
  test(`validateServer in Russian: ${label}`, () => {
    assert.deepEqual(validateServer(build(), CODEX_MODELS, "ru"), expected);
    assert.equal(validateServer(build(), CODEX_MODELS, "en").length, expected.length, "the English answer has the same number of messages");
  });
}

test("validateServer: an unnamed profile is prefixed by its number in the UI language (no numero sign in English)", () => {
  const unnamed = goodSettings();
  unnamed.profiles[0].name = "";
  unnamed.profiles[0].roles = {};
  unnamed.activeProfile = "main";
  const errors = (lang) => validateServer(unnamed, MODELS, lang);
  assert.deepEqual(errors("ru"), [
    "профиль №1: укажи имя", // ru-fixture
    "№1/planner: обязательная роль не заполнена", // ru-fixture
    "№1/implementer: обязательная роль не заполнена", // ru-fixture
    "active_profile: профиль «main» не найден среди профилей", // ru-fixture
  ]);
  assert.deepEqual(errors("en"), [
    "profile #1: enter a name",
    "#1/planner: the required role is not filled in",
    "#1/implementer: the required role is not filled in",
    "active_profile: profile “main” was not found among the profiles",
  ]);
  for (const message of errors("en")) assert.doesNotMatch(message, /\u2116|[\u0400-\u04FF]/, message);
});

test("validateServer: every server message exists in both languages, fills its placeholders and keeps the response shape (array of strings)", () => {
  const sub = (name, model = "inherit", thinking = "inherit") => ({ name, model, thinking });
  const mutations = [
    (s) => { s.profiles = "x"; },
    (s) => { s.profiles = []; },
    (s) => { s.profiles.push(null); },
    (s) => { s.profiles[0].name = ""; },
    (s) => { s.profiles[0].name = ""; s.profiles[0].roles = {}; },
    (s) => { s.profiles.push({ ...s.profiles[0] }); },
    (s) => { s.profiles[0].fullAccess = "yes"; },
    (s) => { s.profiles[0].defaultProvider = "gemini"; },
    (s) => { s.profiles[0].roles.planner = role("pi:nope/x", "high"); },
    (s) => { s.profiles[0].roles.planner.provider = "gemini"; },
    (s) => { s.profiles[0].roles.planner = role("claude-code:opus", "high"); },
    (s) => { s.profiles[0].roles.planner.thinking = "xhigh"; },
    (s) => { s.profiles[0].roles.planner.useSubagents = "yes"; },
    (s) => { s.profiles[0].roles.planner.useSubagents = true; s.profiles[0].roles.planner.subagents = []; },
    (s) => { s.profiles[0].roles.planner = role("pi:zai/glm-5.3-flash", "high", [sub("Bad Name")]); },
    (s) => { s.profiles[0].roles.planner = role("pi:zai/glm-5.3-flash", "high", [sub("scout"), sub("scout")]); },
    (s) => { s.profiles[0].roles.planner = role("pi:zai/glm-5.3-flash", "high", [sub("scout", "pi:nope/x")]); },
    (s) => { s.profiles[0].roles.planner = role("pi:zai/glm-5.3-flash", "high", [sub("scout", "claude-code:opus")]); },
    (s) => { s.profiles[0].roles.planner = role("pi:zai/glm-5.3-flash", "high", [sub("scout", "inherit", "ultra")]); },
    (s) => { s.language = "Russian"; s.profiles[0].maxSubagents = 0; s.profiles[0].name = "a b"; s.activeProfile = "zzz"; },
    (s) => {
      s.profiles[0].defaultProvider = "claude-code";
      s.profiles[0].roles.planner = role("claude-code:opus", "high", [sub("lens-checker")]);
      s.profiles[0].roles.implementer = role("claude-code:opus", "high", [sub("worker", "claude-code:claude-opus-5-5", "low")]);
    },
  ];
  const seen = new Set();
  for (const mutate of mutations) {
    const submitted = goodSettings();
    mutate(submitted);
    const ru = validateServer(submitted, MODELS, "ru");
    const en = validateServer(submitted, MODELS, "en");
    assert.ok(ru.length > 0, "mutation produces an error: " + mutate);
    assert.equal(en.length, ru.length);
    ru.forEach((text, index) => {
      assert.match(text, CYRILLIC, "Russian text expected: " + text);
      assert.doesNotMatch(en[index], CYRILLIC, "English text expected: " + en[index]);
      for (const message of [text, en[index]]) assert.doesNotMatch(message, /\{\w+\}/, "unfilled placeholder: " + message);
      assert.doesNotMatch(en[index], /\u2116/, "numero sign in an English message: " + en[index]);
      seen.add(en[index]);
    });
  }
  assert.ok(seen.size >= 20, "the mutations exercise many distinct server messages, got " + seen.size);
  assert.deepEqual(validateServer(null, MODELS, "ru"), ["Ожидается объект настроек"]); // ru-fixture
  assert.deepEqual(validateServer(null, MODELS, "en"), ["A settings object is expected"]);
});

test("every message key used in form.js exists; the dynamic key families exist too", () => {
  const source = read("form.js");
  // Any dotted identifier in quotes ('role.add', 'v.sub.pick', ...) must be a key: a typo would show the raw key in the UI.
  const dotted = new Set([...source.matchAll(/'([a-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_-]+)+)'/g)].map((match) => match[1]));
  assert.ok(dotted.size > 60, "form.js refers to its texts by key, found " + dotted.size);
  for (const key of dotted) assert.ok(hasMessage(key), "form.js uses an unknown key: " + key);
  // Keys passed straight to the translation helpers, including one-word keys.
  const called = [...source.matchAll(/\b(?:t|tr|msg|tn|hasMessage)\(\s*(?:lang,\s*)?'([^']+)'\s*[,)]/g)].map((match) => match[1]);
  for (const key of called) assert.ok(hasMessage(key), "form.js uses an unknown key: " + key);
  // Keys built at run time ('role.' + key + '.desc', 'review.text.' + mode, 'agent.' + name).
  for (const role of ["planner", "implementer", "reviewer", "chief_reviewer"]) assert.ok(hasMessage("role." + role + ".desc"), role);
  for (const role of ["reviewer", "chief_reviewer"]) assert.ok(hasMessage("role." + role + ".offDesc"), role);
  for (const mode of ["full", "reviewer", "chief", "self"]) assert.ok(hasMessage("review.text." + mode), mode);
  for (const name of new Set(Object.values(ROLE_AGENTS).flat())) assert.ok(hasMessage("agent." + name), "no description of subagent " + name);
});

// ── static text ──
test("index.html has no Cyrillic and every data-i18n key exists in MESSAGES.en", () => {
  const html = read("index.html");
  assert.doesNotMatch(html, CYRILLIC);
  const keys = [...html.matchAll(/\sdata-i18n="([^"]+)"/g)].map((match) => match[1]);
  assert.ok(keys.length > 25, "static text goes through data-i18n, found " + keys.length);
  for (const key of keys) assert.ok(Object.hasOwn(MESSAGES.en, key), "unknown data-i18n key: " + key);
  for (const [, pairs] of html.matchAll(/\sdata-i18n-attr="([^"]+)"/g)) {
    for (const pair of pairs.split(";")) {
      const [attribute, key] = pair.split(":");
      assert.ok(attribute && Object.hasOwn(MESSAGES.en, key), "bad data-i18n-attr pair: " + pair);
    }
  }
});

test("index.html default text is the English dictionary entry (the page reads right before form.js runs)", () => {
  const html = read("index.html");
  for (const [, tag, , key, , inner] of html.matchAll(/<([a-z0-9]+)\b([^>]*?)\sdata-i18n="([^"]+)"([^>]*)>([\s\S]*?)<\/\1>/g)) {
    assert.doesNotMatch(inner, /</, key + ": data-i18n elements hold only text");
    assert.equal(collapse(decodeEntities(inner)), collapse(MESSAGES.en[key]), key);
  }
  for (const [openTag] of html.matchAll(/<[a-z0-9]+\b[^>]*\sdata-i18n-attr="[^"]+"[^>]*>/g)) {
    const [, pairs] = openTag.match(/data-i18n-attr="([^"]+)"/);
    for (const pair of pairs.split(";")) {
      const [attribute, key] = pair.split(":");
      const value = openTag.match(new RegExp("\\s" + attribute + '="([^"]*)"'));
      if (value) assert.equal(decodeEntities(value[1]), MESSAGES.en[key], attribute + " of " + key);
    }
  }
});

test("index.html default text of the elements form.js renders matches the English dictionary", () => {
  const html = read("index.html");
  const textOf = (id) => collapse(decodeEntities(html.match(new RegExp('id="' + id + '"[^>]*>([^<]*)<'))[1]));
  assert.equal(textOf("bar-status"), MESSAGES.en["bar.status"]);
  assert.equal(textOf("submit-btn"), MESSAGES.en["bar.submit"]);
});

test("index.html loads form.js as a module and has the language toggle", () => {
  const html = read("index.html");
  assert.match(html, /<script type="module" src="\/form\.js"><\/script>/);
  assert.match(html, /<html lang="en"/);
  assert.match(html, /id="lang-toggle"/);
  assert.match(html, /data-lang="en"/);
  assert.match(html, /data-lang="ru"/);
});

test("form.js has no Cyrillic literals (and no comments in Russian)", () => {
  assert.doesNotMatch(read("form.js"), CYRILLIC);
});

test("form.js is an ES module that imports ./i18n.mjs and touches localStorage only inside try/catch helpers", () => {
  const source = read("form.js");
  assert.match(source, /^import \{[^}]*\bpickLanguage\b[^}]*\} from '\.\/i18n\.mjs';$/m);
  assert.doesNotMatch(source, /^\(\(\) => \{/m, "no IIFE wrapper: modules have their own scope");
  const helpers = [...source.matchAll(/^function (readStoredLanguage|storeLanguage)\(.*\) \{\n([\s\S]*?)\n\}$/gm)];
  assert.deepEqual(helpers.map((match) => match[1]).sort(), ["readStoredLanguage", "storeLanguage"]);
  for (const [, name, body] of helpers) assert.match(body, /\btry \{[\s\S]*localStorage[\s\S]*\} catch/, name + " wraps localStorage in try/catch");
  const total = source.match(/localStorage/g).length;
  const inHelpers = helpers.reduce((sum, [, , body]) => sum + (body.match(/localStorage/g) || []).length, 0);
  assert.equal(total, inHelpers, "no localStorage access outside the guarded helpers");
});

// ── server ──
test("prefill: the unparsable-file warning is a key + params, localized by the client", () => {
  const pre = prefill("active_profile: x\nprofiles:\n\tx:\n");
  assert.equal(pre.warning.key, "prefill.parseError");
  assert.match(pre.warning.params.message, /tabs/);
  assert.match(t("ru", pre.warning.key, pre.warning.params), /не разобран \(.*tabs.*\) — форма открыта с нуля/); // ru-fixture
  assert.match(t("en", pre.warning.key, pre.warning.params), /could not be parsed \(.*tabs.*\) — the form is opened from scratch/);
  assert.equal(prefill("").warning, undefined);
});

test("buildYaml: the generated comments are English whatever the UI language (file content)", () => {
  const yaml = buildYaml(goodSettings());
  const comments = yaml.split("\n").filter((line) => line.startsWith("#"));
  assert.equal(comments.length, 3);
  assert.doesNotMatch(comments.join("\n"), CYRILLIC);
  assert.match(comments[0], /^# Generated by the orca-pod-setup form \d{4}-\d\d-\d\d \d\d:\d\d$/);
  assert.match(comments[1], /^# active_profile — the default profile; /);
  assert.match(comments[2], /^# language — the language of the roles: auto /);
  assert.doesNotMatch(yaml, CYRILLIC, "nothing Russian in the YAML of an ASCII config");
});

test("server: /i18n.mjs is served as JavaScript, index.html loads form.js as a module, /generate answers in the requested language", async () => {
  const form = await startPipelineForm({ models: MODELS, timeout: 30 });
  try {
    const token = new URL(form.url).search;
    const base = new URL(form.url).origin;

    const dictionary = await fetch(base + "/i18n.mjs");
    assert.equal(dictionary.status, 200);
    assert.match(dictionary.headers.get("content-type"), /^text\/javascript/);
    assert.equal(await dictionary.text(), read("i18n.mjs"));

    const script = await fetch(base + "/form.js");
    assert.equal(script.status, 200);
    assert.match(script.headers.get("content-type"), /^text\/javascript/);

    const page = await fetch(base + "/" + token);
    assert.match(await page.text(), /<script type="module" src="\/form\.js"><\/script>/);
    assert.match(page.headers.get("content-security-policy"), /script-src 'self'/);

    const post = async (lang) => {
      const response = await fetch(base + "/generate" + token, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...goodSettings(), activeProfile: "missing", ...(lang === undefined ? {} : { lang }) }),
      });
      return { status: response.status, body: await response.json() };
    };
    const ru = await post("ru");
    assert.equal(ru.status, 400);
    assert.deepEqual(Object.keys(ru.body), ["error"], "response shape is unchanged");
    assert.equal(ru.body.error, "active_profile: профиль «missing» не найден среди профилей"); // ru-fixture
    for (const lang of ["en", undefined, "de", "__proto__", 5]) {
      const out = await post(lang);
      assert.equal(out.status, 400, String(lang));
      assert.equal(out.body.error, "active_profile: profile “missing” was not found among the profiles", String(lang));
    }
  } finally {
    form.close();
  }
});
