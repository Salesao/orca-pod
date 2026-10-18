// Client of the orca-pod-setup form. Data: GET /data?t=<token>; Submit/Cancel: POST.
// Validation mirrors the server (pipeline-form.mjs validateServer): the server is the source of truth.
// ES module. Every text the user sees comes from i18n.mjs by key (English and Russian); this file holds none.
// Texts that must follow a language switch are kept as deferred messages (msg) and rendered when shown.
import { hasMessage, pickLanguage, t, tn } from './i18n.mjs';

const TOKEN = new URLSearchParams(location.search).get('t') || '';
const LANGUAGE_STORAGE_KEY = 'orca-pod.language';
// Role descriptions are texts 'role.<key>.desc' (and 'role.<key>.offDesc' for optional roles) in i18n.mjs.
const ROLES = [
  { key: 'planner', name: 'Planner' },
  { key: 'implementer', name: 'Implementer' },
  { key: 'reviewer', name: 'Reviewer', optional: true },
  { key: 'chief_reviewer', name: 'Chief Reviewer', optional: true },
];
// Review mode by the set of reviewers: the same values as launch-provider.mjs --roles. Text: 'review.text.<mode>'.
const REVIEW_TITLES = { full: 'review.title.full', reviewer: 'review.title.single', chief: 'review.title.single', self: 'review.title.self' };

let lang = 'en';
let D = null;
let loadError = null;
let busy = false;
let busyKey = null; // status text key of the running request
let busySpinner = false;
let status = null; // { text: () => string, isError } of the action bar; null = the default text
let summaryErrors = []; // items shown in the error summary
let modelIndex = new Map();
const rowRefresh = {};
// Profiles: { uid, name, defProv, maxSubagents, roles }. Role functions work with the current profile
// through state/defProv; switching a tab changes these references and redraws the role cards.
let profiles = [];
let current = 0;
let defaultUid = null;
let nextUid = 1;
let state = {};
let defProv = 'pi';
let nameRe = /^\S+$/u;
let languageRe = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
let limitMax = 100;
let limitDefault = 6;
let lastErrors = [];

// ── language ──
const tr = (key, params) => t(lang, key, params);
const isMsg = (value) => value !== null && typeof value === 'object' && typeof value.key === 'string';
// Deferred message: kept in state (notes, errors) and rendered on show, so a language switch re-renders it.
// Parameter values may themselves be messages.
const msg = (key, params = {}) => ({ key, params });
function renderMsg({ key, params = {} }) {
  const filled = {};
  for (const [name, value] of Object.entries(params)) filled[name] = isMsg(value) ? renderMsg(value) : value;
  return t(lang, key, filled);
}
// The language choice is remembered per origin; the port changes on every launch, so it survives page reloads only.
function readStoredLanguage() {
  try {
    const value = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return value === 'en' || value === 'ru' ? value : null;
  } catch {
    return null; // storage is blocked or unavailable
  }
}
function storeLanguage(value) {
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, value);
  } catch {
    // storage is unavailable: the choice then lasts until the page is reloaded
  }
}
const browserLanguages = () => (navigator.languages && navigator.languages.length ? [...navigator.languages] : [navigator.language]);
// Stored choice (the toggle) beats the config language, which beats the browser language.
const detectLanguage = (configLanguage) => readStoredLanguage() || pickLanguage({ configLanguage, browserLanguages: browserLanguages() });

// ── DOM helpers ──
const $ = (id) => document.getElementById(id);
function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (typeof v === 'boolean' && k in node) node[k] = v;
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const child of children.flat()) if (child != null && child !== false) node.append(child);
  return node;
}
function icon(name, cls = 'icon') {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', cls);
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(ns, 'use');
  use.setAttribute('href', '#i-' + name);
  svg.append(use);
  return svg;
}
function fillSelect(select, items, value) {
  select.replaceChildren(...items.map(([v, label, disabled]) => h('option', { value: v, text: label, disabled: !!disabled })));
  if (value != null) select.value = value;
}

// Static text of index.html: data-i18n="key" sets the text, data-i18n-attr="attribute:key;attribute:key" sets attributes.
function applyStaticText() {
  document.documentElement.lang = lang;
  for (const node of document.querySelectorAll('[data-i18n]')) node.textContent = tr(node.dataset.i18n);
  for (const node of document.querySelectorAll('[data-i18n-attr]')) {
    for (const pair of node.dataset.i18nAttr.split(';')) {
      const [attribute, key] = pair.split(':').map((part) => part.trim());
      node.setAttribute(attribute, tr(key));
    }
  }
  for (const button of document.querySelectorAll('#lang-toggle [data-lang]')) button.setAttribute('aria-pressed', String(button.dataset.lang === lang));
}
// "Settings will be saved to {path} — ...": the path is an element, so the message is cut at the placeholder.
function renderMeta() {
  const [before, after = ''] = tr('app.meta', { path: '\u0000' }).split('\u0000');
  $('app-meta').replaceChildren(before, $('target-path'), after);
}

// ── catalog helpers: model key '<program>:<YAML value>' ──
const modelKey = (m) => m.program + ':' + (m.program === 'pi' ? m.provider + '/' + m.id : m.id);
const progOf = (key) => { const s = key || ''; const i = s.indexOf(':'); return i < 0 ? '' : s.slice(0, i); };
const progLabel = (prog) => (D.programLabels && D.programLabels[prog]) || prog;
const effProg = (key) => state[key].provider || defProv;
const findModel = (key) => modelIndex.get(key) || null;
const levelsOf = (key) => { const m = findModel(key); return m ? m.levels : []; };
const shortModel = (key) => { const v = (key || '').slice((key || '').indexOf(':') + 1); const i = v.indexOf('/'); return i < 0 ? v : v.slice(i + 1); };
const effModel = (st, s) => (!s.model || s.model === 'inherit') ? st.model : s.model;
const agentsFor = (key) => D.roleAgents[key].filter((a) => effProg(key) === 'pi' || a !== 'lens-checker');
const takenNames = (key) => state[key].subagents.map((s) => s.name).filter(Boolean);
const agentInfo = (name) => (hasMessage('agent.' + name) ? tr('agent.' + name) : '');
function pickLevel(levels, preferred) {
  if (levels.includes(preferred)) return preferred;
  if (levels.includes('high')) return 'high';
  return levels.length ? levels[levels.length - 1] : '';
}
function resolveModel(value, prog) {
  if (!value || value === 'inherit' || !prog) return '';
  if (findModel(prog + ':' + value)) return prog + ':' + value;
  if (prog === 'pi' && !value.includes('/')) {
    const hits = D.models.filter((m) => m.program === 'pi' && m.id === value);
    if (hits.length === 1) return modelKey(hits[0]);
  }
  return '';
}
const modelCountLabel = (n) => tn(lang, 'plural.models', n);
function programOptions() {
  return [['', tr('provider.default', { agent: progLabel(defProv) })]].concat(
    D.programs.map((p) => [p.id, p.label + ' · ' + modelCountLabel(p.count)]));
}
// forSubagent: specific versions (roleOnly) are not available to subagents: the Agent tool accepts only aliases.
function fillModelSelect(select, head, value, prog, forSubagent = false) {
  const groups = new Map();
  for (const m of D.models) {
    if (m.program !== prog || (forSubagent && m.roleOnly)) continue;
    const name = m.group || (m.program === 'pi' ? 'Pi · ' + m.provider : progLabel(m.program));
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(m);
  }
  const nodes = head.map(([v, label]) => h('option', { value: v, text: label }));
  if (!groups.size) nodes.push(h('option', { disabled: true, text: tr('model.none', { agent: progLabel(prog) }) }));
  for (const name of [...groups.keys()].sort()) {
    nodes.push(h('optgroup', { label: name }, groups.get(name).map((m) => h('option', { value: modelKey(m), text: m.label || m.id }))));
  }
  select.replaceChildren(...nodes);
  select.value = value;
}

// ── field scaffold with label, help and inline error ──
function field({ id, label, yamlKey, control, help, helpEl, cols }) {
  control.id = id;
  const helpNode = helpEl || (help != null ? h('div', { class: 'form-text', id: id + '-help', text: help }) : null);
  if (helpNode) helpNode.id = id + '-help';
  control.setAttribute('aria-describedby', [helpNode ? id + '-help' : null, id + '-err'].filter(Boolean).join(' '));
  return h('div', { class: cols },
    h('label', { class: 'form-label', for: id }, label, yamlKey ? h('span', { class: 'label-key', text: yamlKey }) : null),
    control,
    h('div', { class: 'invalid-feedback', id: id + '-err' }),
    helpNode);
}
function setError(id, message) {
  const control = $(id);
  if (!control) return;
  control.classList.add('is-invalid');
  control.setAttribute('aria-invalid', 'true');
  control.closest('.form-switch-row')?.classList.add('is-invalid');
  const err = $(id + '-err');
  if (err) err.textContent = message;
}
function clearError(id) {
  const control = $(id);
  if (!control) return;
  control.classList.remove('is-invalid');
  control.removeAttribute('aria-invalid');
  control.closest('.form-switch-row')?.classList.remove('is-invalid');
  const err = $(id + '-err');
  if (err) err.textContent = '';
}
function clearAllErrors() {
  document.querySelectorAll('[aria-invalid="true"]').forEach((node) => clearError(node.id));
  $('error-summary').hidden = true;
  summaryErrors = [];
  setStatus(null);
}
// text: a function returning the message (re-evaluated on a language switch) or null for the default text.
function setStatus(text, isError = false) {
  status = text ? { text, isError: !!isError } : null;
  renderStatus();
}
function renderStatus() {
  const bar = $('bar-status');
  bar.textContent = status ? status.text() : tr('bar.status');
  bar.classList.toggle('is-error', !!(status && status.isError));
}

// ── role state ──
function initState(key, preRoles) {
  const p = (preRoles && preRoles[key]) || null;
  const optional = ROLES.find((role) => role.key === key).optional;
  // Required roles are always on; optional ones only if the current YAML has them.
  const st = state[key] = { enabled: !optional || !!(p && p.present), provider: '', model: '', thinking: '', useSubagents: false, subagents: [], notes: [] };
  if (!p || !p.present) return;
  st.provider = (p.provider && p.provider !== defProv) ? p.provider : '';
  const prog = effProg(key);
  st.model = resolveModel(p.model, prog);
  if (p.model && !st.model) st.notes.push(msg('note.modelMissing', { model: p.model, agent: progLabel(prog) }));
  st.thinking = p.thinking || '';
  if (st.model && st.thinking && !levelsOf(st.model).includes(st.thinking)) {
    const next = pickLevel(levelsOf(st.model), 'high');
    st.notes.push(msg('note.thinkingReset', { thinking: st.thinking, model: shortModel(st.model), next }));
    st.thinking = next;
  }
  st.useSubagents = !!p.useSubagents;
  const seen = new Set();
  for (const s of p.subagents || []) {
    if (seen.has(s.name)) { st.notes.push(msg('note.subagentDuplicate', { name: s.name })); continue; }
    seen.add(s.name);
    let model = 'inherit';
    if (s.model && s.model !== 'inherit') {
      model = resolveModel(s.model, prog);
      if (!model) { st.notes.push(msg('note.subagentModelMissing', { name: s.name, model: s.model })); model = 'inherit'; }
      else if (findModel(model).roleOnly) { st.notes.push(msg('note.subagentAlias', { name: s.name, agent: progLabel(prog), model: s.model })); model = 'inherit'; }
    }
    st.subagents.push({ name: s.name, model, thinking: s.thinking || 'inherit' });
  }
}
function defaultHelper(key, name) {
  const levels = state[key].model ? levelsOf(state[key].model) : [];
  const light = (name === 'scout' || name === 'lens-checker') && levels.includes('low');
  return { name, model: 'inherit', thinking: light ? 'low' : 'inherit' };
}
function setUse(key, on) {
  const st = state[key];
  st.useSubagents = on;
  if (on && !st.subagents.length) st.subagents.push(defaultHelper(key, agentsFor(key)[0]));
}

// ── role card ──
function showNotes(key) {
  $(key + '-notes').replaceChildren(...state[key].notes.map((n) => h('div', { class: 'note' }, icon('alert'), h('span', { text: renderMsg(n) }))));
}
function clearNotes(key) { state[key].notes = []; showNotes(key); }
function updateBadge(key) {
  const badge = $(key + '-badge');
  const own = !!state[key].provider;
  const agent = progLabel(effProg(key));
  badge.textContent = own ? agent : tr('provider.badgeDefault', { agent });
  badge.classList.toggle('prog-badge-default', !own);
}
function syncRoleThinking(key) {
  const st = state[key];
  const select = $(key + '-think');
  const help = $(key + '-think-help');
  const levels = st.model ? levelsOf(st.model) : [];
  if (!levels.length) {
    fillSelect(select, [['', tr('think.first')]], '');
    select.disabled = true;
    st.thinking = '';
    help.textContent = tr('think.helpNone');
    return;
  }
  select.disabled = false;
  st.thinking = pickLevel(levels, st.thinking);
  fillSelect(select, levels.map((l) => [l, l]), st.thinking);
  help.textContent = tr('think.helpLevels', { levels: levels.join(', ') });
}
// The role's agent changed (its own or the default): incompatible models are reset.
function applyProgram(key) {
  const st = state[key];
  const prog = effProg(key);
  if (st.model && progOf(st.model) !== prog) {
    st.notes = [msg('note.modelUnavailable', { model: shortModel(st.model), agent: progLabel(prog) })];
    st.model = '';
  }
  st.subagents = st.subagents.filter((s) => prog === 'pi' || s.name !== 'lens-checker');
  st.subagents.forEach((s) => { if (s.model && s.model !== 'inherit' && (progOf(s.model) !== prog || findModel(s.model)?.roleOnly)) s.model = 'inherit'; });
  fillModelSelect($(key + '-model'), [['', tr('model.pick')]], st.model, prog);
  showNotes(key);
  updateBadge(key);
  syncRoleThinking(key);
  renderHelpers(key);
}

function reviewMode() {
  const reviewer = state.reviewer.enabled, chief = state.chief_reviewer.enabled;
  return reviewer && chief ? 'full' : reviewer ? 'reviewer' : chief ? 'chief' : 'self';
}
function updateReviewMode() {
  const mode = reviewMode();
  const impl = state.implementer;
  const hasVerifier = impl && impl.useSubagents && impl.subagents.some((s) => s.name === 'verifier');
  const hint = mode === 'self' && !hasVerifier ? ' ' + tr('review.selfHint') : '';
  $('review-mode').replaceChildren(
    h('strong', { text: tr('review.heading', { title: tr(REVIEW_TITLES[mode]) }) + ' ' }),
    h('span', { text: tr('review.text.' + mode) + hint }));
}
// Inserts or replaces a role card: an enabled one is the full form, a disabled optional one is a placeholder.
function mountRole(role) {
  const card = state[role.key].enabled ? buildRole(role) : buildRoleOff(role);
  const existing = $('card-' + role.key);
  if (existing) existing.replaceWith(card); else $('roles').append(card);
  if (state[role.key].enabled) {
    updateBadge(role.key);
    syncRoleThinking(role.key);
    showNotes(role.key);
    renderHelpers(role.key);
  }
  updateReviewMode();
}
function buildRoleOff(role) {
  const { key, name } = role;
  return h('section', { class: 'role-card role-card-off', id: 'card-' + key, 'data-role': key, 'aria-labelledby': 'title-' + key },
    h('div', { class: 'role-off-text' },
      h('h2', { class: 'role-title', id: 'title-' + key }, icon(key), name, h('span', { class: 'role-optional', text: tr('role.off.badge') })),
      h('p', { class: 'role-desc', text: tr('role.' + key + '.offDesc') })),
    h('button', { type: 'button', class: 'btn btn-outline-secondary btn-icon-text', id: key + '-enable', onclick: () => {
      state[key].enabled = true;
      mountRole(role);
      $(key + '-prog').focus();
    } }, icon('plus'), h('span', { text: tr('role.add', { name }) })));
}

function buildRole(role) {
  const { key, name, optional } = role;
  const st = state[key];

  const progSelect = h('select', { class: 'form-select', onchange: () => {
    st.provider = progSelect.value; clearError(key + '-prog'); clearNotes(key); applyProgram(key);
  } });
  fillSelect(progSelect, programOptions(), st.provider);
  if (st.provider && !D.programs.some((p) => p.id === st.provider)) {
    progSelect.append(h('option', { value: st.provider, text: tr('provider.noCatalog', { agent: progLabel(st.provider) }) }));
    progSelect.value = st.provider;
  }

  const modelSelect = h('select', { class: 'form-select mono', onchange: () => {
    st.model = modelSelect.value; clearError(key + '-model'); clearNotes(key); syncRoleThinking(key); refreshHelpers(key);
  } });
  fillModelSelect(modelSelect, [['', tr('model.pick')]], st.model, effProg(key));

  const thinkSelect = h('select', { class: 'form-select', onchange: () => {
    st.thinking = thinkSelect.value; clearError(key + '-think'); refreshHelpers(key);
  } });

  const useLabel = () => tr(st.useSubagents ? 'subagents.on' : 'subagents.off');
  const useInput = h('input', { class: 'form-check-input', type: 'checkbox', role: 'switch', checked: st.useSubagents, onchange: () => {
    setUse(key, useInput.checked); useState.textContent = useLabel();
    clearError(key + '-use'); renderHelpers(key);
  } });
  useInput.id = key + '-use';
  const useState = h('span', { class: 'use-state', 'aria-hidden': 'true', text: useLabel() });
  const useCol = h('div', { class: 'col-12 col-sm-6 col-lg-3' },
    h('label', { class: 'form-label', for: key + '-use' }, tr('subagents.title'), h('span', { class: 'label-key', text: 'use_subagents' })),
    h('div', { class: 'form-switch-row form-switch' }, useInput, useState),
    h('div', { class: 'invalid-feedback', id: key + '-use-err' }));
  useInput.setAttribute('aria-describedby', key + '-use-err');

  const addButton = h('button', { type: 'button', class: 'btn btn-outline-secondary btn-sm btn-icon-text', id: key + '-add', onclick: () => {
    const free = agentsFor(key).filter((a) => !takenNames(key).includes(a));
    if (!free.length) return;
    st.subagents.push(defaultHelper(key, free[0]));
    renderHelpers(key);
    $(key + '-sa' + (st.subagents.length - 1) + '-agent')?.focus();
  } }, icon('plus'), h('span', { text: tr('subagents.add') }));

  return h('section', { class: 'role-card', id: 'card-' + key, 'data-role': key, 'aria-labelledby': 'title-' + key },
    h('div', { class: 'role-head' },
      h('h2', { class: 'role-title', id: 'title-' + key }, icon(key), name),
      h('span', { class: 'role-key', text: key }),
      h('span', { class: 'prog-badge', id: key + '-badge' }),
      optional ? h('button', { type: 'button', class: 'btn btn-outline-secondary btn-sm', onclick: () => {
        state[key].enabled = false;
        mountRole(role);
        $(key + '-enable').focus();
      } }, tr('role.remove')) : null),
    h('p', { class: 'role-desc', text: tr('role.' + key + '.desc') }),
    h('div', { class: 'notes', id: key + '-notes', role: 'status' }),
    h('div', { class: 'row g-3' },
      field({ id: key + '-prog', label: tr('field.agent'), yamlKey: 'provider', control: progSelect, cols: 'col-12 col-sm-6 col-lg-3' }),
      field({ id: key + '-model', label: tr('field.model'), yamlKey: 'model', control: modelSelect, cols: 'col-12 col-sm-6 col-lg-3' }),
      field({ id: key + '-think', label: tr('field.thinking'), yamlKey: 'thinking', control: thinkSelect, help: '', cols: 'col-12 col-sm-6 col-lg-3' }),
      useCol),
    h('div', { class: 'helpers', id: key + '-helpers', hidden: !st.useSubagents, 'aria-labelledby': key + '-helpers-title' },
      h('h3', { class: 'helpers-title', id: key + '-helpers-title', text: tr('subagents.title') }),
      h('div', { id: key + '-sa-list' }),
      h('div', { class: 'helpers-actions' }, addButton, h('span', { class: 'helpers-hint', id: key + '-add-hint' }))));
}

// ── helpers ──
function updateAddState(key) {
  const st = state[key];
  const free = agentsFor(key).filter((a) => !takenNames(key).includes(a));
  const blocked = st.useSubagents && !free.length;
  $(key + '-add').disabled = blocked;
  $(key + '-add-hint').textContent = blocked ? tr('subagents.allAdded') : '';
}
function refreshAgentOptions(key) {
  const taken = takenNames(key);
  state[key].subagents.forEach((s, i) => {
    const select = $(key + '-sa' + i + '-agent');
    if (!select) return;
    for (const option of select.options) option.disabled = !!option.value && option.value !== s.name && taken.includes(option.value);
  });
  updateAddState(key);
  if (key === 'implementer') updateReviewMode(); // the verifier hint of the self mode
}
function refreshHelpers(key) {
  (rowRefresh[key] || []).forEach((refresh) => refresh());
  refreshAgentOptions(key);
}
function renderHelpers(key) {
  const st = state[key];
  $(key + '-helpers').hidden = !st.useSubagents;
  const list = $(key + '-sa-list');
  rowRefresh[key] = [];
  const rows = st.useSubagents
    ? (st.subagents.length
      ? st.subagents.map((s, i) => buildHelperRow(key, s, i))
      : [h('p', { class: 'helpers-empty', text: tr('subagents.empty') })])
    : [];
  list.replaceChildren(...rows);
  refreshHelpers(key);
}
function buildHelperRow(key, s, i) {
  const st = state[key];
  const base = key + '-sa' + i;
  const removeLabel = () => tr('subagent.removeLabel', { who: s.name || tr('common.number', { n: i + 1 }) });

  const desc = h('div', { class: 'form-text', text: agentInfo(s.name) });
  const agentSelect = h('select', { class: 'form-select mono', onchange: () => {
    s.name = agentSelect.value;
    desc.textContent = agentInfo(s.name);
    removeButton.setAttribute('aria-label', removeLabel());
    clearError(base + '-agent');
    refreshAgentOptions(key);
  } });
  const agents = agentsFor(key);
  const options = [['', tr('subagent.pick')]].concat(agents.map((a) => [a, a]));
  if (s.name && !agents.includes(s.name)) options.push([s.name, tr('subagent.notInRole', { name: s.name })]);
  fillSelect(agentSelect, options, s.name);

  const modelSelect = h('select', { class: 'form-select mono', onchange: () => {
    s.model = modelSelect.value; clearError(base + '-model'); refresh();
  } });
  fillModelSelect(modelSelect, [['inherit', 'inherit']], (s.model && s.model !== 'inherit') ? s.model : 'inherit', effProg(key), true);

  const thinkSelect = h('select', { class: 'form-select', onchange: () => {
    s.thinking = thinkSelect.value; clearError(base + '-think');
  } });

  const removeButton = h('button', { type: 'button', class: 'btn btn-outline-danger btn-icon', title: tr('subagent.remove'), 'aria-label': removeLabel(), onclick: () => {
    st.subagents.splice(i, 1);
    renderHelpers(key);
    $(key + '-add').focus();
  } }, icon('close'));

  function refresh() {
    const inheritOption = modelSelect.options[0];
    inheritOption.textContent = st.model ? tr('inherit.model', { model: shortModel(st.model) }) : tr('inherit.noModel');
    const model = effModel(st, s);
    const levels = model ? levelsOf(model) : [];
    if (!levels.length) {
      fillSelect(thinkSelect, [['inherit', tr('think.first'), true]], 'inherit');
      thinkSelect.disabled = true;
      s.thinking = 'inherit';
      return;
    }
    thinkSelect.disabled = false;
    const inheritOk = !!st.thinking && levels.includes(st.thinking);
    const level = st.thinking || '—';
    const items = [['inherit', tr(inheritOk ? 'inherit.thinking' : 'inherit.thinkingBad', { level }), !inheritOk]]
      .concat(levels.map((l) => [l, l]));
    const valid = s.thinking === 'inherit' ? inheritOk : levels.includes(s.thinking);
    if (!valid) s.thinking = inheritOk ? 'inherit' : pickLevel(levels, 'low');
    fillSelect(thinkSelect, items, s.thinking);
  }
  rowRefresh[key].push(refresh);

  return h('div', { class: 'helper-row' },
    h('div', { class: 'row g-3' },
      field({ id: base + '-agent', label: tr('field.subagent'), control: agentSelect, helpEl: desc, cols: 'col-12 col-lg-5' }),
      field({ id: base + '-model', label: tr('field.model'), control: modelSelect, cols: 'col-12 col-sm-6 col-lg-3' }),
      field({ id: base + '-think', label: tr('field.thinking'), control: thinkSelect, cols: 'col-8 col-sm-4 col-lg-3' }),
      h('div', { class: 'col-4 col-sm-2 col-lg-1 helper-remove' },
        h('span', { class: 'form-label d-block', 'aria-hidden': 'true', text: ' ' }),
        removeButton)));
}

// ── profiles ──
const currentProfile = () => profiles[current];
const isDefault = (profile) => profile.uid === defaultUid;
const validLimit = (value) => Number.isInteger(value) && value >= 1 && value <= limitMax;
// Profiles with the same name (until the error is fixed) are told apart by the tab number.
function profileLabelMsg(profile, index) {
  if (!profile.name) return msg('profile.label.unnamed', { n: index + 1 });
  const duplicate = profiles.some((other, i) => i !== index && other.name === profile.name);
  return msg(duplicate ? 'profile.label.duplicate' : 'profile.label.named', { n: index + 1, name: profile.name });
}
const profileLabel = (profile, index) => renderMsg(profileLabelMsg(profile, index));
const profileTitle = (profile) => tr('profile.label.named', { name: profile.name || tr('profile.untitled') });
// Runs fn over profile index without redrawing: roles read this profile's state/defProv.
function withProfile(index, fn) {
  const saved = [state, defProv];
  state = profiles[index].roles;
  defProv = profiles[index].defProv;
  try { return fn(); } finally { [state, defProv] = saved; }
}
function setDefProv(value) {
  defProv = value;
  currentProfile().defProv = value;
}
function makeProfile(pre) {
  const profile = { uid: nextUid++, name: pre.name, defProv: pre.defaultProvider || (D.programs[0] && D.programs[0].id) || 'pi', maxSubagents: pre.maxSubagents ?? limitDefault, fullAccess: pre.fullAccess === true, roles: {} };
  const saved = [state, defProv];
  state = profile.roles;
  defProv = profile.defProv;
  try { for (const role of ROLES) initState(role.key, pre.roles); } finally { [state, defProv] = saved; }
  return profile;
}
function uniqueName(base) {
  const stem = nameRe.test(base) ? base.slice(0, 60) : 'profile';
  const taken = new Set(profiles.map((p) => p.name));
  for (let n = 2; ; n += 1) if (!taken.has(stem + '-' + n)) return stem + '-' + n;
}
function renderTabs(focusSelected = false) {
  const failed = new Set(lastErrors.map((e) => e.uid));
  const tabs = profiles.map((profile, index) => {
    const selected = index === current;
    return h('button', {
      type: 'button', role: 'tab', class: 'profile-tab' + (failed.has(profile.uid) ? ' has-error' : ''), id: 'tab-' + profile.uid,
      'aria-selected': selected ? 'true' : 'false', 'aria-controls': 'profile-panel', tabindex: selected ? '0' : '-1',
      onclick: () => selectProfile(index, true),
    },
    h('span', { class: 'profile-tab-name', text: profile.name || tr('profile.untitled') }),
    isDefault(profile) ? h('span', { class: 'profile-tab-default', text: tr('profile.tab.default') }) : null,
    failed.has(profile.uid) ? h('span', { class: 'profile-tab-error', text: tr('profile.tab.error') }) : null);
  });
  $('profile-tabs').replaceChildren(...tabs);
  $('profile-panel').setAttribute('aria-labelledby', 'tab-' + currentProfile().uid);
  if (focusSelected) $('tab-' + currentProfile().uid).focus();
}
function fillDefaultProvider() {
  const items = D.programs.map((p) => [p.id, p.label + ' · ' + modelCountLabel(p.count)]);
  if (!D.programs.some((p) => p.id === defProv)) items.push([defProv, tr('provider.noCatalog', { agent: progLabel(defProv) })]);
  fillSelect($('default-provider'), items, defProv);
}
function renderProfileFields() {
  const profile = currentProfile();
  $('profile-settings-title').textContent = profileTitle(profile);
  $('profile-name').value = profile.name;
  $('max-subagents').value = Number.isFinite(profile.maxSubagents) ? String(profile.maxSubagents) : '';
  renderFullAccess(profile);
  fillDefaultProvider();
  const sw = $('profile-default');
  sw.checked = isDefault(profile);
  sw.disabled = isDefault(profile);
  $('profile-default-state').textContent = tr(isDefault(profile) ? 'profile.default.yes' : 'profile.default.no');
  $('profile-delete').disabled = profiles.length < 2;
  $('profile-delete-hint').textContent = profiles.length < 2 ? tr('profile.delete.hint') : '';
  for (const id of ['profile-name', 'max-subagents']) clearError(id);
}
function renderFullAccess(profile) {
  $('full-access').checked = profile.fullAccess;
  $('full-access-block').classList.toggle('is-on', profile.fullAccess);
  $('full-access-state').textContent = tr(profile.fullAccess ? 'fullAccess.on' : 'fullAccess.off');
}
// Switches the tab: roles of the current profile are redrawn, errors of the last Submit are marked again.
function selectProfile(index, focusTab = false) {
  current = Math.max(0, Math.min(index, profiles.length - 1));
  state = currentProfile().roles;
  defProv = currentProfile().defProv;
  renderProfileFields();
  $('roles').replaceChildren();
  for (const role of ROLES) mountRole(role);
  renderTabs(focusTab);
  for (const e of lastErrors) if (e.uid === currentProfile().uid && e.id) setError(e.id, errorText(e));
}
function addProfile() {
  const source = currentProfile();
  const copy = { uid: nextUid++, name: uniqueName(source.name), defProv: source.defProv, maxSubagents: source.maxSubagents, fullAccess: source.fullAccess, roles: JSON.parse(JSON.stringify(source.roles)) };
  for (const st of Object.values(copy.roles)) st.notes = [];
  profiles.push(copy);
  selectProfile(profiles.length - 1);
  $('profile-name').focus();
  $('profile-name').select();
}
function deleteProfile() {
  if (profiles.length < 2) return;
  const profile = currentProfile();
  if (!window.confirm(tr('profile.delete.confirm', { profile: profileLabel(profile, current) }))) return;
  profiles.splice(current, 1);
  if (isDefault(profile)) defaultUid = profiles[0].uid;
  // The error summary refers to the previous set of profiles: hidden until the next Submit.
  clearAllErrors();
  lastErrors = [];
  selectProfile(Math.min(current, profiles.length - 1), true);
}
function onTabKey(event) {
  const moves = { ArrowRight: current + 1, ArrowLeft: current - 1, Home: 0, End: profiles.length - 1 };
  if (!(event.key in moves)) return;
  event.preventDefault();
  selectProfile((moves[event.key] + profiles.length) % profiles.length, true);
}

// ── validation (mirror of server rules) ──
// Errors are { uid, id, prefix, msg }: messages, rendered by errorText in the current language.
// Errors of all profiles are collected; fields are marked only on the current tab.
const errorText = (e) => (e.prefix ? renderMsg(e.prefix) + ' · ' : '') + renderMsg(e.msg);
function collectErrors() {
  const errs = [];
  const names = new Map();
  const many = profiles.length > 1;
  // The language is shared by all profiles: the error has no uid and the field is marked at once.
  const language = $('language').value;
  if (language !== 'auto' && !languageRe.test(language)) {
    const error = { uid: null, id: 'language', prefix: null, msg: msg('v.language', { value: language }) };
    errs.push(error);
    setError('language', errorText(error));
  }
  profiles.forEach((profile, index) => {
    const prefix = many ? profileLabelMsg(profile, index) : null;
    const add = (id, key, params) => errs.push({ uid: profile.uid, id, prefix, msg: msg(key, params) });
    if (!profile.name) add('profile-name', 'v.profile.nameRequired');
    else if (!nameRe.test(profile.name)) add('profile-name', 'v.profile.nameFormat');
    else if (names.has(profile.name)) add('profile-name', 'v.profile.nameTaken', { n: names.get(profile.name) + 1 });
    else names.set(profile.name, index);
    if (!validLimit(profile.maxSubagents)) add('max-subagents', 'v.profile.limit', { max: limitMax });
    withProfile(index, () => collectRoleErrors(add));
  });
  for (const e of errs) if (e.uid === currentProfile().uid && e.id) setError(e.id, errorText(e));
  return errs;
}
function collectRoleErrors(add) {
  for (const { key, name } of ROLES) {
    const st = state[key];
    if (!st.enabled) continue;
    const prog = effProg(key);
    if (!st.model || !findModel(st.model)) add(key + '-model', 'v.role.modelPick', { role: name, agent: progLabel(prog) });
    else if (progOf(st.model) !== prog) add(key + '-model', 'v.role.modelUnavailable', { role: name, agent: progLabel(prog) });
    else if (!levelsOf(st.model).includes(st.thinking)) add(key + '-think', 'v.role.thinking', { role: name, thinking: st.thinking });
    if (!st.useSubagents) continue;
    if (!st.subagents.length) { add(key + '-use', 'v.role.noSubagents', { role: name }); continue; }
    const seen = new Set();
    st.subagents.forEach((s, i) => {
      const base = key + '-sa' + i;
      const who = s.name ? msg('common.quoted', { value: s.name }) : msg('common.number', { n: i + 1 });
      const label = msg('v.sub.label', { role: name, who });
      if (!s.name) add(base + '-agent', 'v.sub.pick', { label });
      else if (seen.has(s.name)) add(base + '-agent', 'v.sub.twice', { label });
      else if (s.name === 'lens-checker' && prog !== 'pi') add(base + '-agent', 'v.sub.lensPi', { label });
      if (s.name) seen.add(s.name);
      if (s.model && s.model !== 'inherit' && progOf(s.model) !== prog) add(base + '-model', 'v.sub.modelUnavailable', { label, agent: progLabel(prog) });
      else if (s.model && s.model !== 'inherit' && findModel(s.model)?.roleOnly) add(base + '-model', 'v.sub.aliasOnly', { label });
      const levels = levelsOf(effModel(st, s));
      const ok = s.thinking === 'inherit' ? (!!st.thinking && levels.includes(st.thinking)) : levels.includes(s.thinking);
      if (!ok) add(base + '-think', 'v.sub.thinking', { label });
    });
  }
}
function renderErrorSummary() {
  $('error-summary-list').replaceChildren(...summaryErrors.map((e) => h('li', {},
    e.id ? h('a', { href: '#' + e.id, text: errorText(e), onclick: (event) => {
      event.preventDefault();
      const index = profiles.findIndex((p) => p.uid === e.uid);
      if (e.uid != null && index < 0) return; // the profile is already deleted
      if (index >= 0 && index !== current) selectProfile(index);
      const target = $(e.id);
      target?.scrollIntoView({ block: 'center' });
      target?.focus({ preventScroll: true });
    } }) : h('span', { text: errorText(e) }))));
}
function showErrorSummary(errs) {
  summaryErrors = errs;
  renderErrorSummary();
  const summary = $('error-summary');
  summary.hidden = false;
  summary.scrollIntoView({ block: 'start' });
  summary.focus({ preventScroll: true });
  setStatus(() => tn(lang, 'plural.status.errors', errs.length), true);
}
// An error that belongs to no field: shown in the summary only.
const plainError = (key, params) => ({ uid: null, id: null, prefix: null, msg: msg(key, params) });

// ── submit / cancel ──
function setBusy(on, key, spinner = true) {
  busy = on;
  busyKey = on ? key : null;
  busySpinner = on && spinner;
  $('cancel-btn').disabled = on;
  $('submit-btn').disabled = on;
  renderSubmitButton();
  if (on) setStatus(() => tr(key));
}
function renderSubmitButton() {
  const submit = $('submit-btn');
  submit.setAttribute('aria-busy', busySpinner ? 'true' : 'false');
  submit.replaceChildren(...(busySpinner
    ? [h('span', { class: 'spinner-border spinner-border-sm me-2', 'aria-hidden': 'true' }), h('span', { text: tr(busyKey) })]
    : [h('span', { text: tr('bar.submit') })]));
}
function showScreen(id, titleId) {
  $('form-screen').hidden = true;
  $('action-bar').hidden = true;
  $(id).hidden = false;
  window.scrollTo(0, 0);
  $(titleId).focus();
}
async function post(path, body) {
  const response = await fetch(path + '?t=' + encodeURIComponent(TOKEN), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const out = await response.json().catch(() => ({}));
  // 409: the form has already finished (the server text is not localized, so it is replaced here).
  if (!response.ok) throw new Error(response.status === 409 ? tr('error.formClosed') : out.error || tr('error.server', { status: response.status }));
  return out;
}
async function submit() {
  if (busy) return;
  clearAllErrors();
  lastErrors = collectErrors();
  renderTabs();
  if (lastErrors.length) { showErrorSummary(lastErrors); return; }
  const payload = {
    activeProfile: profiles.find(isDefault).name,
    language: $('language').value,
    // The server answers validation errors in the UI language.
    lang,
    profiles: profiles.map((profile) => {
      const roles = {};
      for (const { key } of ROLES) {
        const st = profile.roles[key];
        if (!st.enabled) continue; // an optional role that was not added does not go to the YAML
        roles[key] = {
          provider: st.provider || '', model: st.model, thinking: st.thinking, useSubagents: st.useSubagents,
          subagents: st.useSubagents ? st.subagents.map((s) => ({ name: s.name, model: s.model || 'inherit', thinking: s.thinking })) : [],
        };
      }
      return { name: profile.name, defaultProvider: profile.defProv, maxSubagents: profile.maxSubagents, fullAccess: profile.fullAccess === true, roles };
    }),
  };
  setBusy(true, 'status.generating');
  try {
    const out = await post('/generate', payload);
    $('done-path').textContent = out.path;
    $('yaml-pre').textContent = out.yaml;
    showScreen('done-screen', 'done-title');
  } catch (error) {
    setBusy(false);
    showErrorSummary([plainError('error.generate', { message: error.message })]);
  }
}
async function cancel() {
  if (busy) return;
  if (!window.confirm(tr('confirm.cancel'))) return;
  setBusy(true, 'status.cancelling', false);
  try {
    await post('/cancel', {});
    showScreen('cancel-screen', 'cancel-title');
  } catch (error) {
    setBusy(false);
    showErrorSummary([plainError('error.cancel', { message: error.message })]);
  }
}
async function copyYaml() {
  const text = $('yaml-pre').textContent;
  const button = $('copy-btn').querySelector('span');
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = tr('copy.copied');
    $('copy-status').textContent = tr('copy.status.copied');
  } catch {
    const range = document.createRange();
    range.selectNodeContents($('yaml-pre'));
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    button.textContent = tr('copy.selected');
    $('copy-status').textContent = tr('copy.status.selected');
  }
  setTimeout(() => { button.textContent = tr('done.copy'); }, 2000);
}

// ── language switch ──
// Redraws everything that depends on the language without touching the form state: profiles, roles and the
// values of the fields live in `profiles` / the language select, deferred messages are rendered again.
function setLanguage(next, { persist = true } = {}) {
  lang = next === 'ru' ? 'ru' : 'en';
  if (persist) storeLanguage(lang);
  applyStaticText();
  renderMeta();
  renderSubmitButton();
  renderStatus();
  if (loadError) showLoadError();
  if (D) renderLocalized();
}
function renderFormNotes() {
  const notes = [];
  if (D.pre.warning) notes.push(typeof D.pre.warning === 'string' ? D.pre.warning : renderMsg(D.pre.warning));
  if (!D.models.length) notes.push(tr('form.noModels'));
  $('form-notes').replaceChildren(...notes.map((text) => h('div', { class: 'note', role: 'alert' }, icon('alert'), h('span', { text }))));
}
// Roles language field (the root `language` of the YAML). A tag outside the list stays as one more option.
function fillLanguageSelect() {
  const initial = D.pre.language || 'auto';
  const items = [['auto', tr('language.option.auto')], ['en', tr('lang.name.en')], ['ru', tr('lang.name.ru')]];
  if (!items.some(([value]) => value === initial)) items.push([initial, initial]);
  fillSelect($('language'), items, $('language').value || initial);
}
function renderLocalized() {
  $('max-subagents-help').textContent = tr('profile.max.help', { max: limitMax, defaultValue: limitDefault });
  renderFormNotes();
  fillLanguageSelect();
  if (!$('error-summary').hidden) renderErrorSummary();
  selectProfile(current);
  // The error of the shared language field belongs to no profile, so selectProfile does not mark it again.
  for (const e of lastErrors) if (e.uid == null && e.id && $(e.id).classList.contains('is-invalid')) setError(e.id, errorText(e));
}

// ── init ──
function render(data) {
  D = data;
  modelIndex = new Map(D.models.map((m) => [modelKey(m), m]));
  if (D.targetPath) $('target-path').textContent = D.targetPath;

  if (D.profileNamePattern) nameRe = new RegExp(D.profileNamePattern, 'u');
  if (D.languagePattern) languageRe = new RegExp(D.languagePattern);
  if (D.limits) ({ maxSubagentsLimit: limitMax, maxSubagentsDefault: limitDefault } = D.limits);
  const maxInput = $('max-subagents');
  maxInput.max = String(limitMax);
  $('sources').replaceChildren(...(D.sources || []).map((s) => h('li', { text: s })));

  $('language').addEventListener('change', () => clearError('language'));
  $('language').disabled = false;

  profiles = D.pre.profiles.map(makeProfile);
  const active = profiles.find((p) => p.name === D.pre.activeProfile) || profiles[0];
  defaultUid = active.uid;
  current = profiles.indexOf(active);

  $('default-provider').addEventListener('change', () => {
    setDefProv($('default-provider').value);
    for (const { key } of ROLES) {
      if (!state[key].enabled) continue;
      $(key + '-prog').options[0].textContent = tr('provider.default', { agent: progLabel(defProv) });
      if (!state[key].provider) { clearNotes(key); applyProgram(key); }
    }
  });
  $('profile-name').addEventListener('input', () => {
    currentProfile().name = $('profile-name').value.trim();
    $('profile-settings-title').textContent = profileTitle(currentProfile());
    clearError('profile-name');
    renderTabs();
  });
  maxInput.addEventListener('input', () => {
    currentProfile().maxSubagents = maxInput.value.trim() === '' ? NaN : Number(maxInput.value);
    clearError('max-subagents');
  });
  $('full-access').addEventListener('change', () => {
    currentProfile().fullAccess = $('full-access').checked;
    renderFullAccess(currentProfile());
  });
  $('profile-default').addEventListener('change', () => {
    defaultUid = currentProfile().uid;
    renderProfileFields();
    renderTabs();
  });
  $('profile-add').addEventListener('click', addProfile);
  $('profile-delete').addEventListener('click', deleteProfile);
  $('profile-tabs').addEventListener('keydown', onTabKey);
  $('profile-add').disabled = false;

  // The config language takes part in the choice now that it is known (a stored toggle choice still wins).
  setLanguage(detectLanguage(D.pre.language), { persist: false });

  $('submit-btn').addEventListener('click', submit);
  $('cancel-btn').addEventListener('click', cancel);
  $('copy-btn').addEventListener('click', copyYaml);
  $('submit-btn').disabled = false;
  $('cancel-btn').disabled = false;
  $('form-screen').setAttribute('aria-busy', 'false');
}

function showLoadError() {
  const loading = $('loading');
  if (!loading) return;
  loading.removeAttribute('data-i18n'); // the text below must survive applyStaticText
  loading.setAttribute('role', 'alert');
  // The message may end with a period of its own; the template adds one.
  loading.textContent = tr('error.load', { message: loadError.message.replace(/\.+$/, '') });
}

async function boot() {
  for (const button of document.querySelectorAll('#lang-toggle [data-lang]')) {
    button.addEventListener('click', () => setLanguage(button.dataset.lang));
  }
  // Until /data arrives the config language is unknown: stored choice, otherwise the browser language.
  setLanguage(detectLanguage(undefined), { persist: false });
  try {
    const response = await fetch('/data?t=' + encodeURIComponent(TOKEN), { cache: 'no-store' });
    const data = await response.json();
    // 409: the form has already finished (the server text is not localized, so it is replaced here, as in post()).
    if (!response.ok) throw new Error(response.status === 409 ? tr('error.formClosed') : data.error || tr('error.server', { status: response.status }));
    render(data);
  } catch (error) {
    loadError = error;
    showLoadError();
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
