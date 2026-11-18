import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildIndex, collectCorpus } from './memory-index.mjs';

test('a reader can open a new review report while the memory index is frozen', (t) => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'orca-memory-reader-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const indexDir = path.join(cwd, '.orca-pod/memory/.index');
  mkdirSync(indexDir, { recursive: true });
  const index = buildIndex(collectCorpus(cwd));
  index.generatedAt = '2025-01-01T00:00:00.000Z';
  const saved = JSON.stringify(index);
  writeFileSync(path.join(indexDir, 'index.json'), saved);
  const report = '.orca-pod/reports/v2/chief-attempt2.md';
  mkdirSync(path.dirname(path.join(cwd, report)), { recursive: true });
  writeFileSync(path.join(cwd, report), '# Chief review\nVerdict: BLOCKED\n');

  const script = fileURLToPath(new URL('./memory-query.mjs', import.meta.url));
  const query = (...args) => JSON.parse(execFileSync(process.execPath, [script, ...args], { cwd }));
  const result = query('search', 'Chief');
  assert.equal(result.status, 'STALE');
  assert.equal(result.snapshot.generatedAt, index.generatedAt);
  assert.ok(result.snapshot.ageSeconds > 0);
  assert.deepEqual(result.freshness.added, [report]);
  const current = query('show', 'file:' + report);
  assert.equal(current.result.indexed, false);
  assert.equal(current.result.current, true);
  assert.match(current.result.text, /Verdict: BLOCKED/);
  assert.equal(readFileSync(path.join(indexDir, 'index.json'), 'utf8'), saved);
});
