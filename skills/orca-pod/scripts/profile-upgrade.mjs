#!/usr/bin/env node
import * as fs from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { MAX_PROFILES, parsePipelineYaml } from './pipeline-config.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const isMapping = (value) => value !== null && typeof value === 'object';

export function planProfileReduction(source) {
  const entries = [];
  const document = parsePipelineYaml(source, { onEntry: (entry) => entries.push(entry) });
  const { active_profile: active, profiles } = document;
  if (profiles === undefined) return { changed: false, sourceHash: hash(source), nextText: source, kept: [], archived: [] };
  if (!isMapping(profiles)) throw new Error('profiles must be a YAML mapping');
  const blocks = entries.filter(({ parent }) => parent === profiles);
  if (typeof active !== 'string' || !Object.hasOwn(profiles, active)) {
    throw new Error(`active_profile ${JSON.stringify(active)} is not declared`);
  }
  const names = blocks.map(({ key }) => key);
  const selected = new Set([active, ...names.filter((name) => name !== active).slice(0, MAX_PROFILES - 1)]);
  const kept = names.filter((name) => selected.has(name));
  const archived = names.filter((name) => !selected.has(name));
  const sourceHash = hash(source);
  if (archived.length === 0) return { changed: false, sourceHash, nextText: source, kept, archived };

  const lines = source.split(/(?<=\n)/);
  const followingRoot = entries.find(({ parent, index }) => parent === document && index > blocks.at(-1).index);
  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    const { index, key, indent } = blocks[i];
    if (selected.has(key)) continue;
    let end = blocks[i + 1]?.index ?? followingRoot?.index ?? lines.length;
    while (end > index + 1 && (/^\s*$/.test(lines[end - 1]) ||
      new RegExp(`^ {0,${indent}}#`).test(lines[end - 1]))) end -= 1;
    lines.splice(index, end - index);
  }
  const nextText = lines.join('');
  const next = parsePipelineYaml(nextText);
  const expected = Object.assign(Object.create(null), document, {
    profiles: Object.assign(Object.create(null), Object.fromEntries(kept.map((name) => [name, profiles[name]]))),
  });
  if (!isDeepStrictEqual(next, expected)) throw new Error('profile reduction would alter retained settings');
  return { changed: true, sourceHash, nextText, kept, archived };
}

export function upgradeProfiles(file, { fsOps = fs } = {}) {
  const original = fsOps.lstatSync(file);
  if (!original.isFile()) throw new Error('orca-pod.yaml must be a regular file, not a directory or a link');
  const bytes = fsOps.readFileSync(file);
  const source = bytes.toString('utf8');
  if (!Buffer.from(source).equals(bytes)) throw new Error('orca-pod.yaml must be UTF-8');
  const { changed, nextText, sourceHash, kept, archived } = planProfileReduction(source);
  if (!changed) return { status: 'unchanged', kept, archived };

  const lock = `${file}.profile-upgrade.lock`;
  const suffix = randomUUID();
  const backupPath = `${file}.backup-${suffix}`;
  const pending = `${file}.pending-${suffix}`;
  const descriptor = fsOps.openSync(lock, 'wx', 0o600);
  try {
    const verifyOriginal = () => {
      const current = fsOps.lstatSync(file);
      if (!current.isFile() || current.ino !== original.ino || current.dev !== original.dev ||
          hash(fsOps.readFileSync(file)) !== sourceHash) {
        throw new Error(`orca-pod.yaml changed during profile upgrade; original configuration was not replaced (${backupPath})`);
      }
    };
    verifyOriginal();
    const options = { flag: 'wx', mode: original.mode & 0o777, flush: true };
    fsOps.writeFileSync(backupPath, bytes, options);
    fsOps.writeFileSync(pending, nextText, options);
    verifyOriginal();
    fsOps.renameSync(pending, file);
    return { status: 'upgraded', backupPath, kept, archived };
  } finally {
    fsOps.closeSync(descriptor);
    fsOps.rmSync(pending, { force: true });
    fsOps.rmSync(lock, { force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [flag, file, ...extra] = process.argv.slice(2);
    if (flag !== '--file' || !file || !isAbsolute(file) || extra.length) throw new Error('usage: profile-upgrade.mjs --file <absolute-path>');
    console.log(JSON.stringify(upgradeProfiles(file)));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}
