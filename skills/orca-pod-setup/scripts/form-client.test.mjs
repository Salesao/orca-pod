import assert from "node:assert/strict";
import { test } from "node:test";
import { MESSAGES, t } from "./form/i18n.mjs";

// form/form.js is a browser module. Here it boots against a minimal fake DOM and a fake fetch, to check
// what the page shows when GET /data fails. Each case imports a fresh module instance (the query string).
// Any property is another stub, any call returns a stub; only the values the test reads (textContent) are stored.
const node = () => {
  const store = { textContent: "", dataset: {} };
  return new Proxy(function stub() {}, {
    get: (_, key) => (typeof key === "symbol" ? undefined : key in store ? store[key] : node()),
    set: (_, key, value) => { store[key] = value; return true; },
    apply: () => node(),
  });
};

async function bootPage({ languages, response }) {
  const elements = {};
  const globals = {
    location: { search: "?t=test-token" },
    document: {
      readyState: "complete",
      documentElement: {},
      getElementById: (id) => (elements[id] ??= node()),
      querySelectorAll: () => [],
      createElement: () => node(),
      addEventListener() {},
    },
    navigator: { languages, language: languages[0] },
    fetch: async () => response,
  };
  globals.window = globals;
  const saved = {};
  for (const [name, value] of Object.entries(globals)) {
    saved[name] = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  }
  try {
    await import("./form/form.js?case=" + Math.random());
    for (let waited = 0; !elements.loading?.textContent && waited < 2000; waited += 10) await new Promise((resolve) => setTimeout(resolve, 10));
    return elements.loading.textContent;
  } finally {
    for (const [name, descriptor] of Object.entries(saved)) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
}

const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

test("form.js boot: 409 from /data (the form has already finished) shows the localized text, not the server text", async () => {
  const shown = await bootPage({ languages: ["en-US"], response: reply(409, { error: "server text" }) });
  assert.equal(shown, t("en", "error.load", { message: "The form is already finished" }));
  assert.ok(!shown.includes("server text"), shown);
});

test("form.js boot: 409 from /data in the Russian UI shows the Russian text", async () => {
  const shown = await bootPage({ languages: ["ru-RU"], response: reply(409, { error: "server text" }) });
  assert.equal(shown, t("ru", "error.load", { message: MESSAGES.ru["error.formClosed"].replace(/\.$/, "") }));
});

test("form.js boot: any other error shows the server text, and a reply without text shows the status", async () => {
  assert.equal(await bootPage({ languages: ["en-US"], response: reply(403, { error: "Invalid session token" }) }),
    t("en", "error.load", { message: "Invalid session token" }));
  assert.equal(await bootPage({ languages: ["en-US"], response: reply(500, {}) }),
    t("en", "error.load", { message: t("en", "error.server", { status: 500 }) }));
});
