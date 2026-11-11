import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseStopSave, preparePlanner, readCurrentCodexStatus, savePlannerDocuments } from './codex-planner-mode.mjs';

function terminal({ canEnter = true, canReturn = true } = {}) {
  let mode = 'Default';
  let entries = 0;
  const events = [];
  return {
    events,
    async wait() { events.push('idle'); },
    async status() { return { mode, session: 'session' }; },
    async enterPlan() { events.push('enter Plan'); if (canEnter && (++entries === 1 || canReturn)) mode = 'Plan'; },
    async exitPlan() { events.push('exit Plan'); mode = 'Default'; },
    async send(prompt) { events.push(prompt); },
  };
}

test('first task is sent once and only after verified Plan, including taskless preparation', async () => {
  const session = terminal();
  await preparePlanner(session);
  await preparePlanner(session, 'Task');
  assert.deepEqual(session.events, ['idle', 'enter Plan', 'idle', 'idle', 'Task']);
  const blocked = terminal({ canEnter: false });
  await assert.rejects(preparePlanner(blocked, 'Task'), /verify Plan/);
  assert.ok(!blocked.events.includes('Task'));
});

test('save writes only after verified Default and resumes only after verified Plan', async () => {
  const session = terminal();
  await preparePlanner(session);
  await savePlannerDocuments(session, async () => {
    assert.equal((await session.status()).mode, 'Default');
    session.events.push('write exact documents');
  }, 'Begin blitz');
  assert.deepEqual(session.events.slice(-7), ['idle', 'exit Plan', 'idle', 'write exact documents', 'enter Plan', 'idle', 'PLANNING DOCUMENTS SAVED. Plan mode verified. Begin blitz']);
  const blocked = terminal({ canReturn: false });
  await preparePlanner(blocked);
  await assert.rejects(savePlannerDocuments(blocked, () => {}, 'Begin blitz'), /verify Plan/);
  assert.ok(!blocked.events.includes('Begin blitz'));
});

test('a stale rendered Plan status cannot replace fresh status evidence', async () => {
  const session = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const prior = { source: 'screen', tail: ['Collaboration mode: Plan', 'Session: ' + session] };
  let requested = false;
  const call = async (_command, args) => {
    if (args.includes('--cursor')) {
      assert.equal(args[args.indexOf('--cursor') + 1], '123');
      return { terminal: { tail: ['Old prompt repaint only.'] } };
    }
    if (args.includes('--screen')) return { terminal: prior };
    return { terminal: { nextCursor: 123, tail: prior.tail } };
  };
  await assert.rejects(readCurrentCodexStatus(call, () => { requested = true; }, () => {}), /fresh Codex/);
  assert.ok(requested);
  const fresh = { source: 'stream', tail: ['Collaboration mode: Default', 'Session: ' + session] };
  const mismatch = async (_command, args) => args.includes('--cursor') ? { terminal: fresh } : call(_command, args);
  await assert.rejects(readCurrentCodexStatus(mismatch, () => {}, () => {}), /rendered Orca terminal/);
});

test('only the host Stop hook binds a final planning-save payload to its Codex session', () => {
  const session = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const request = { documents: [{ path: 'docs/superpowers/plans/smoke.md', content: 'draft', expectedHash: null }], continuation: 'Blitz' };
  const input = { hook_event_name: 'Stop', session_id: session, last_assistant_message: 'ORCA_POD_PLANNING_SAVE\n' + JSON.stringify(request) };
  assert.deepEqual(parseStopSave(input), { request, session });
  assert.equal(parseStopSave({ ...input, stop_hook_active: true }), null);
  assert.equal(parseStopSave({ ...input, last_assistant_message: 'Ordinary answer' }), null);
  assert.throws(() => parseStopSave({ ...input, last_assistant_message: input.last_assistant_message.replace('docs/superpowers/plans/smoke.md', 'src/application.mjs') }), /allowed path/);
});
