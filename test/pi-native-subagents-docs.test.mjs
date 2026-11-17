import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const file = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Pi helper instructions describe native background delegation and shared-folder boundaries', async () => {
  const text = await file('skills/orca-pod/references/subagents.md');
  assert.match(text, /subagent\(\{\s*agent:/);
  assert.match(text, /async:\s*true/);
  assert.match(text, /parent[^.]*independent[^.]*while[^.]*child/i);
  assert.match(text, /wait[^.]*all[^.]*children[^.]*before[^.]*review[^.]*handoff/i);
  assert.match(text, /not technically enforced/i);
  assert.match(text, /snapshot[^.]*8[^.]*children/i);
  assert.match(text, /snapshot[^.]*20[^.]*runs/i);
  assert.doesNotMatch(text, /orca_pod_helpers|blocks background\/workflow routes/);
});

test('pipeline role instructions require independent assignments and completion before handoff', async () => {
  const text = await file('skills/orca-pod/SKILL.md');
  assert.match(text, /parent[^.]*independent[^.]*while[^.]*children/i);
  assert.match(text, /wait[^.]*all[^.]*children[^.]*before[^.]*review[^.]*handoff/i);
  assert.match(text, /not technically enforced/i);
});
