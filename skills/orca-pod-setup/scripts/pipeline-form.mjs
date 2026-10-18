// Server of the orca-pod setup form (Pi tool orca_pod_setup and scripts/setup-form.mjs).
// UI lives in scripts/form/ (index.html, form.css, form.js, i18n.mjs); this module serves it, provides
// GET /data and validates Submit. Submit resolves the result in memory; no polling or status files.
// The form is bilingual (EN/RU). Texts live in form/i18n.mjs: the client picks the language and sends it as
// the `lang` field of the POST /generate body; validateServer answers in that language (English by default).
// The prefill warning is language-neutral ({ key, params }) and is rendered by the client.

import http from 'node:http';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { t } from './form/i18n.mjs';
// One config schema for the launcher and the form: the parser, the profile name rule and the subagent limit bounds.
import { isValidLanguage, LANGUAGE_DEFAULT, LANGUAGE_PATTERN, MAX_SUBAGENTS_DEFAULT, MAX_SUBAGENTS_LIMIT, parsePipelineYaml, PROFILE_NAME_PATTERN, ROLE_AGENTS } from '../../orca-pod/scripts/pipeline-config.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROLE_KEYS = ['planner', 'implementer', 'reviewer', 'chief_reviewer'];
// Reviewers are optional: without them the Implementer checks itself (the self mode in the pipeline skill).
const REQUIRED_ROLE_KEYS = ['planner', 'implementer'];

// Role agents (provider) that the launcher accepts. The model catalogs are in scripts/catalogs.mjs;
// the form shows only agents that have a catalog (see ENABLED_PROGRAMS in catalogs.mjs).
// A model key in the form: '<program>:<model value in the YAML>' (for Pi the value is 'provider/id').
export const PROGRAMS = { pi: 'Pi', 'claude-code': 'Claude Code', codex: 'Codex', omp: 'OMP' };
export const modelKeyOf = (m) => m.program + ':' + (m.program === 'pi' ? m.provider + '/' + m.id : m.id);
const keyProgram = (key) => { const s = String(key || ''); const i = s.indexOf(':'); return i < 0 ? '' : s.slice(0, i); };
const keyValue = (key) => { const s = String(key || ''); return s.slice(s.indexOf(':') + 1); };
const canonicalProgram = (value) => (value === 'claude' ? 'claude-code' : value || '');

const isMap = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value) => (typeof value === 'string' ? value.trim() : '');
const emptyPrefill = (defaultProvider = 'pi') => ({
  activeProfile: 'default',
  language: LANGUAGE_DEFAULT,
  profiles: [{ name: 'default', defaultProvider, maxSubagents: MAX_SUBAGENTS_DEFAULT, fullAccess: false, roles: {} }],
});

// There can be several profiles: the form shows all of them (tabs) and returns the whole file.
// Parsed by the same parser as the launcher's; the values are not validated (the form and the server do that).
export function prefill(source = '') {
  if (!source.trim()) return emptyPrefill();
  let doc;
  try { doc = parsePipelineYaml(source); }
  catch (error) {
    // Not a ready sentence: the client renders { key, params } in the UI language (form/i18n.mjs, 'prefill.parseError').
    return { ...emptyPrefill(), warning: { key: 'prefill.parseError', params: { message: error.message } } };
  }
  const rootProvider = canonicalProgram(text(doc.default_provider)) || 'pi';
  const profiles = [];
  for (const [name, rawProfile] of Object.entries(isMap(doc.profiles) ? doc.profiles : {})) {
    const profile = isMap(rawProfile) ? rawProfile : {};
    const rolesDoc = isMap(profile.roles) ? profile.roles : {};
    const roles = {};
    for (const role of ROLE_KEYS) {
      const block = isMap(rolesDoc[role]) ? rolesDoc[role] : null;
      const subagents = Object.entries(block && isMap(block.subagents) ? block.subagents : {}).map(([agent, raw]) => {
        const settings = isMap(raw) ? raw : {};
        return { name: agent, model: text(settings.model) || 'inherit', thinking: text(settings.thinking) || 'inherit' };
      });
      roles[role] = {
        present: Boolean(block), provider: canonicalProgram(text(block?.provider)), model: text(block?.model),
        thinking: text(block?.thinking), useSubagents: block?.use_subagents === true, subagents,
      };
    }
    // A non-numeric limit is replaced by the default; a number out of range is shown by the form as an error.
    const limit = Number(text(profile.max_subagents));
    profiles.push({
      name, defaultProvider: canonicalProgram(text(profile.default_provider)) || rootProvider,
      maxSubagents: text(profile.max_subagents) && Number.isFinite(limit) ? limit : MAX_SUBAGENTS_DEFAULT,
      fullAccess: profile.full_access === true, roles,
    });
  }
  // language is a root field: the value is not validated (the form shows an invalid tag in the list, Submit rejects it).
  // Read before the "no profiles" exit, or the form from scratch would silently reset the file's language to auto.
  const language = text(doc.language) || LANGUAGE_DEFAULT;
  if (!profiles.length) return { ...emptyPrefill(rootProvider), language };
  const active = text(doc.active_profile);
  return {
    activeProfile: profiles.some((profile) => profile.name === active) ? active : profiles[0].name,
    language, profiles,
  };
}

// ── server-side validation: the same rules as in the form ──
// Messages come from the srv.* keys of form/i18n.mjs in the language lang ('en' by default, the form sends its own language).
// Always returns an array of strings; keys and params do not leave the server.
export function validateServer(d, models, lang = 'en') {
  const say = (key, params) => t(lang, key, params);
  if (!isMap(d)) return [say('srv.notObject')];
  if (!Array.isArray(d.profiles) || !d.profiles.length) return [say('srv.noProfiles')];
  const byKey = new Map(models.map((m) => [modelKeyOf(m), m]));
  const errs = [];
  // No field (an old client) means auto, as in the launcher; if the field is there it must be auto or a language tag.
  if (d.language !== undefined && !isValidLanguage(d.language)) errs.push(say('srv.language'));
  const names = new Set();
  d.profiles.forEach((profile, index) => {
    const numbered = say('srv.profile.numbered', { n: index + 1 });
    if (!isMap(profile)) { errs.push(say('srv.profile.notObject', { label: numbered })); return; }
    const name = typeof profile.name === 'string' ? profile.name : '';
    const label = name ? say('srv.profile.named', { name }) : numbered;
    if (!name) errs.push(say('srv.profile.nameRequired', { label }));
    else if (!PROFILE_NAME_PATTERN.test(name)) errs.push(say('srv.profile.nameFormat', { label }));
    else if (names.has(name)) errs.push(say('srv.profile.nameTaken', { label }));
    names.add(name);
    const limit = profile.maxSubagents;
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_SUBAGENTS_LIMIT) errs.push(say('srv.profile.limit', { label, max: MAX_SUBAGENTS_LIMIT }));
    if (profile.fullAccess !== undefined && typeof profile.fullAccess !== 'boolean') errs.push(say('srv.profile.fullAccess', { label }));
    if (!PROGRAMS[profile.defaultProvider]) { errs.push(say('srv.profile.provider', { label, agent: profile.defaultProvider })); return; }
    const prefix = (name || say('srv.profile.prefix', { n: index + 1 })) + '/';
    errs.push(...validateRoles(profile, byKey, say).map((error) => prefix + error));
  });
  if (!names.has(d.activeProfile)) errs.push(say('srv.activeProfile', { name: d.activeProfile }));
  return errs;
}

function validateRoles(d, byKey, say) {
  const errs = [];
  for (const key of ROLE_KEYS) {
    const r = d.roles && d.roles[key];
    const role = { role: key };
    if (!r) { if (REQUIRED_ROLE_KEYS.includes(key)) errs.push(say('srv.role.required', role)); continue; }
    if (r.provider && !PROGRAMS[r.provider]) { errs.push(say('srv.role.unknownAgent', { ...role, agent: r.provider })); continue; }
    const program = r.provider || d.defaultProvider;
    const m = byKey.get(r.model);
    if (!m) { errs.push(say('srv.role.unknownModel', { ...role, model: r.model })); continue; }
    if (keyProgram(r.model) !== program) { errs.push(say('srv.role.modelUnavailable', { ...role, model: keyValue(r.model), agent: program })); continue; }
    if (!m.levels.includes(r.thinking)) errs.push(say('srv.role.thinking', { ...role, thinking: r.thinking, model: keyValue(r.model) }));
    if (typeof r.useSubagents !== 'boolean') errs.push(say('srv.role.useSubagents', role));
    if (!r.useSubagents) continue;
    if (!Array.isArray(r.subagents) || !r.subagents.length) { errs.push(say('srv.role.noSubagents', role)); continue; }
    const seen = new Set();
    for (const sa of r.subagents) {
      if (!sa || typeof sa.name !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(sa.name)) { errs.push(say('srv.sub.badName', role)); continue; }
      const sub = { ...role, name: sa.name };
      if (seen.has(sa.name)) errs.push(say('srv.sub.duplicate', sub));
      seen.add(sa.name);
      if (sa.name === 'lens-checker' && program !== 'pi') { errs.push(say('srv.sub.lensPi', role)); continue; }
      const em = sa.model === 'inherit' ? m : byKey.get(sa.model);
      if (!em) { errs.push(say('srv.sub.unknownModel', { ...sub, model: sa.model })); continue; }
      if (sa.model !== 'inherit' && keyProgram(sa.model) !== program) { errs.push(say('srv.sub.modelUnavailable', { ...sub, agent: program })); continue; }
      if (sa.model !== 'inherit' && em.roleOnly) { errs.push(say('srv.sub.aliasOnly', sub)); continue; }
      const ok = sa.thinking === 'inherit' ? em.levels.includes(r.thinking) : em.levels.includes(sa.thinking);
      if (!ok) errs.push(say('srv.sub.thinking', { ...sub, thinking: sa.thinking }));
    }
  }
  return errs;
}

export function buildYaml(d) {
  const L = [
    // The comments are file content, not UI: always English, whatever the form language.
    '# Generated by the orca-pod-setup form ' + new Date().toISOString().slice(0, 16).replace('T', ' '),
    '# active_profile — the default profile; with several profiles the Coordinator asks which one to use.',
    'active_profile: ' + d.activeProfile,
    '# language — the language of the roles: auto (the language of the user’s message) or a language tag: en, ru, pt-BR.',
    'language: ' + (d.language ?? LANGUAGE_DEFAULT), '', 'profiles:',
  ];
  d.profiles.forEach((p, index) => {
    if (index) L.push('');
    L.push('  ' + p.name + ':', '    default_provider: ' + p.defaultProvider, '    max_subagents: ' + p.maxSubagents);
    if (p.fullAccess === true) L.push('    full_access: true');
    L.push('    roles:');
    for (const key of ROLE_KEYS) {
      const r = p.roles[key];
      if (!r) continue; // an optional role that was not added
      L.push('      ' + key + ':');
      if (r.provider && r.provider !== p.defaultProvider) L.push('        provider: ' + r.provider);
      L.push('        model: ' + keyValue(r.model), '        thinking: ' + r.thinking, '        use_subagents: ' + (r.useSubagents ? 'true' : 'false'));
      if (r.useSubagents && r.subagents.length) {
        L.push('        subagents:');
        for (const sa of r.subagents) L.push('          ' + sa.name + ':', '            model: ' + (sa.model === 'inherit' ? 'inherit' : keyValue(sa.model)), '            thinking: ' + sa.thinking);
      }
    }
  });
  return L.join('\n') + '\n';
}

// Only the fields the pipeline uses — no extra request content.
function pickSettings(submitted) {
  return {
    activeProfile: submitted.activeProfile,
    language: submitted.language ?? LANGUAGE_DEFAULT,
    profiles: submitted.profiles.map((p) => {
      const roles = {};
      for (const role of ROLE_KEYS) {
        const r = p.roles[role];
        if (!r) continue;
        roles[role] = {
          provider: r.provider || '', model: r.model, thinking: r.thinking, useSubagents: r.useSubagents,
          subagents: r.useSubagents ? r.subagents.map((s) => ({ name: s.name, model: s.model, thinking: s.thinking })) : [],
        };
      }
      return { name: p.name, defaultProvider: p.defaultProvider, maxSubagents: p.maxSubagents, fullAccess: p.fullAccess === true, roles };
    }),
  };
}

// Form statics: the markup, the styles and the client live in scripts/form/, Bootstrap in vendor/.
// Files are read on every request: edits to the form show up without restarting the agent.
const FORM_DIR = path.join(HERE, 'form');
const STATIC_FILES = {
  '/bootstrap.css': ['text/css; charset=utf-8', path.join(HERE, 'vendor/bootstrap.min.css')],
  '/form.css': ['text/css; charset=utf-8', path.join(FORM_DIR, 'form.css')],
  '/form.js': ['text/javascript; charset=utf-8', path.join(FORM_DIR, 'form.js')],
  // form.js is an ES module and imports the dictionary; the server reads the same file (validateServer).
  '/i18n.mjs': ['text/javascript; charset=utf-8', path.join(FORM_DIR, 'i18n.mjs')],
};
const INDEX_FILE = path.join(FORM_DIR, 'index.html');
// Only the form's own files; data: is for the SVG arrows of Bootstrap selects.
const CONTENT_SECURITY_POLICY = "default-src 'none'; style-src 'self'; script-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/**
 * Start a form inside the Pi extension process or the standalone setup-form.mjs runner.
 * models contains only public { program, provider, id, levels } metadata from scripts/catalogs.mjs;
 * sources are human-readable catalog descriptions shown in the form.
 * result is resolved by Submit/Cancel/abort/deadline events, never by polling.
 * The extension owns opening the browser; the form does not write files.
 */
export async function startPipelineForm({ models, sources = [], currentYaml = '', targetPath = '', timeout = 900, signal, port = 0 }) {
  if (!Array.isArray(models) || !models.length) throw new Error('No models are available to configure the pipeline');
  if (!Number.isFinite(timeout) || timeout <= 0) throw new Error('timeout must be a positive number');
  if (signal?.aborted) return { url: '', result: Promise.resolve({ status: 'aborted', url: '' }), close() {} };

  const token = randomBytes(24).toString('hex');
  const programs = Object.keys(PROGRAMS).filter((program) => models.some((m) => m.program === program))
    .map((program) => ({ id: program, label: PROGRAMS[program], count: models.filter((m) => m.program === program).length }));
  const data = {
    models, programs, programLabels: PROGRAMS, sources, targetPath, roleAgents: ROLE_AGENTS, pre: prefill(currentYaml),
    limits: { maxSubagentsDefault: MAX_SUBAGENTS_DEFAULT, maxSubagentsLimit: MAX_SUBAGENTS_LIMIT },
    profileNamePattern: PROFILE_NAME_PATTERN.source,
    languagePattern: LANGUAGE_PATTERN.source,
  };
  let url = '';
  let allowedOrigins = new Set();
  const servers = [];
  let completed = false;
  let deadline;
  let resolveResult;
  const result = new Promise((resolve) => { resolveResult = resolve; });

  const finish = (outcome) => {
    if (completed) return;
    completed = true;
    clearTimeout(deadline);
    signal?.removeEventListener('abort', onAbort);
    // close() drains the accepted Submit/Cancel response before closing sockets.
    // Abort/deadline must also dispose incomplete requests, without touching Pi itself.
    for (const server of servers) {
      server.close();
      if (!['submitted', 'cancelled'].includes(outcome.status)) server.closeAllConnections();
    }
    resolveResult({ url, ...outcome });
  };
  const onAbort = () => finish({ status: 'aborted' });

  const handler = (req, res) => {
    const json = (code, value) => {
      res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(value));
    };
    let requestUrl;
    try { requestUrl = new URL(req.url || '/', 'http://' + (req.headers.host || '127.0.0.1')); }
    catch { return json(400, { error: 'Invalid URL' }); }
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(requestUrl.hostname)) return json(403, { error: 'Invalid host' });
    if (completed) return json(409, { error: 'The form is already finished' });
    // Statics hold no session data; the page, the data and the actions require the token.
    const staticFile = req.method === 'GET' && STATIC_FILES[requestUrl.pathname];
    if (staticFile) {
      res.writeHead(200, { 'Content-Type': staticFile[0], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      return res.end(readFileSync(staticFile[1]));
    }
    if (requestUrl.searchParams.get('t') !== token) return json(403, { error: 'Invalid session token' });
    if (req.method === 'GET' && ['/', '/index.html'].includes(requestUrl.pathname)) {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
        'Content-Security-Policy': CONTENT_SECURITY_POLICY, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
      });
      return res.end(readFileSync(INDEX_FILE));
    }
    if (req.method === 'GET' && requestUrl.pathname === '/data') return json(200, data);
    if (req.method !== 'POST' || !['/generate', '/cancel'].includes(requestUrl.pathname)) return json(404, { error: 'Not found' });
    if (req.headers.origin && !allowedOrigins.has(req.headers.origin)) return json(403, { error: 'Invalid origin' });
    if (!(req.headers['content-type'] || '').startsWith('application/json')) return json(415, { error: 'Expected application/json' });
    if (requestUrl.pathname === '/cancel') {
      req.resume();
      json(200, { status: 'cancelled' });
      finish({ status: 'cancelled' });
      return;
    }

    let bytes = 0;
    const chunks = [];
    let tooLarge = false;
    req.on('data', (chunk) => {
      if (tooLarge || completed) return;
      bytes += chunk.length;
      if (bytes > 1024 * 1024) {
        tooLarge = true;
        chunks.length = 0;
        json(413, { error: 'Request body too large' });
      } else chunks.push(chunk);
    });
    req.on('error', () => { chunks.length = 0; });
    req.on('end', () => {
      if (tooLarge || completed) return;
      try {
        const submitted = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        // The form sends its UI language (the lang field); an unknown or missing value means English.
        const errors = validateServer(submitted, models, submitted?.lang);
        if (errors.length) return json(400, { error: errors.join('; ') });
        const settings = pickSettings(submitted);
        const yaml = buildYaml(settings);
        json(200, { path: targetPath, yaml });
        finish({ status: 'submitted', settings, yaml });
      } catch (error) { json(400, { error: error.message || String(error) }); }
    });
  };

  // Loopback only. The link points to localhost; it can resolve to both 127.0.0.1 and ::1,
  // so the same port is listened on at both addresses (IPv6 if the ::1 loopback is available).
  const listen = (host, listenPort) => new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.requestTimeout = 30000;
    server.once('error', reject);
    server.listen(listenPort, host, () => { server.removeAllListeners('error'); resolve(server); });
  });
  servers.push(await listen('127.0.0.1', port));
  const boundPort = servers[0].address().port;
  try { servers.push(await listen('::1', boundPort)); } catch { /* the IPv6 loopback is unavailable — 127.0.0.1 is enough */ }
  allowedOrigins = new Set(['http://localhost:' + boundPort, 'http://127.0.0.1:' + boundPort, 'http://[::1]:' + boundPort]);
  url = 'http://localhost:' + boundPort + '/?t=' + token;
  for (const server of servers) server.on('error', (error) => finish({ status: 'error', error: error.message }));
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted) onAbort();
  else deadline = setTimeout(() => finish({ status: 'timeout' }), timeout * 1000);
  return { url, result, close: onAbort };
}
