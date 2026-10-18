// The orca_pod_ask question window for Pi (the plan-blitz skill asks through it): tabs per question, options with
// descriptions, a free "Type something." answer, Submit, Esc. A port of Pi's examples/extensions/questionnaire.ts
// without multi-select. Nothing here imports Pi packages: index.js passes in the pi-tui kit
// ({ Editor, Key, matchesKey, visibleWidth, wrapTextWithAnsi }), so the logic is testable under node:test.

export const ASK_LIMITS = { questions: 4, minOptions: 2, options: 4, header: 12, context: 600 };
const OTHER_LABEL = 'Type something.';
const text = (value) => (typeof value === 'string' ? value.trim() : '');

/** Checks and trims the tool parameters: { ok: true, questions } or { ok: false, error }. */
export function normalizeAskParams(params) {
  const raw = Array.isArray(params?.questions) ? params.questions : [];
  if (raw.length < 1 || raw.length > ASK_LIMITS.questions) {
    return { ok: false, error: `${raw.length} questions (1-${ASK_LIMITS.questions} allowed)` };
  }
  const questions = [];
  for (const [index, item] of raw.entries()) {
    const where = `question ${index + 1}`;
    const question = text(item?.question);
    const header = text(item?.header);
    // The plan-blitz card (situation, proposal, cost) shown above the question; capped so the window fits the screen.
    const context = text(item?.context);
    const options = Array.isArray(item?.options) ? item.options : [];
    if (!question) return { ok: false, error: `${where}: empty question text` };
    if (!header) return { ok: false, error: `${where}: empty header` };
    if (header.length > ASK_LIMITS.header) {
      return { ok: false, error: `${where}: header "${header}" is ${header.length} characters (up to ${ASK_LIMITS.header})` };
    }
    if (context.length > ASK_LIMITS.context) {
      return { ok: false, error: `${where}: context is ${context.length} characters (up to ${ASK_LIMITS.context})` };
    }
    if (options.length < ASK_LIMITS.minOptions || options.length > ASK_LIMITS.options) {
      return { ok: false, error: `${where}: ${options.length} options (${ASK_LIMITS.minOptions}-${ASK_LIMITS.options} allowed)` };
    }
    const normalized = options.map((option) => ({ label: text(option?.label), description: text(option?.description) }));
    const labels = new Set();
    for (const { label } of normalized) {
      if (!label) return { ok: false, error: `${where}: an option without a label` };
      if (labels.has(label)) return { ok: false, error: `${where}: duplicate option "${label}"` };
      labels.add(label);
    }
    questions.push({ question, header, context, options: normalized });
  }
  return { ok: true, questions };
}

/** The text the agent gets back from the tool. */
export function askResultText({ answers = [], cancelled = false, reason, mode, error } = {}) {
  if (reason === 'invalid') {
    return `Invalid questions: ${error}. Limits: 1-${ASK_LIMITS.questions} questions, a header of up to ${ASK_LIMITS.header} characters, `
      + `a context of up to ${ASK_LIMITS.context} characters, ${ASK_LIMITS.minOptions}-${ASK_LIMITS.options} options each; shorten the context or split the questions into several calls.`;
  }
  if (reason === 'no-ui') return `No interactive terminal UI (mode ${mode}). Ask the same questions as numbered text instead.`;
  if (reason === 'aborted') return 'The questions were interrupted before an answer. Do not treat anything as approved.';
  if (cancelled) return 'The user cancelled the questions (Esc); nothing was answered. In a plan blitz: stop it and ask for approval in plain text.';
  return answers.map((answer) => `${answer.header}: ${answer.kind === 'text' ? 'wrote' : 'selected'} "${answer.label}"`).join('\n');
}

/**
 * The component for ctx.ui.custom. done({ answers, cancelled, reason? }) is called exactly once:
 * on Submit, Esc, or when `signal` aborts (ctx.ui.custom takes no signal, so the component listens itself).
 */
export function createAskComponent({ questions, tui, theme, kit, signal, done }) {
  const { Editor, Key, matchesKey, visibleWidth, wrapTextWithAnsi } = kit;
  const isMulti = questions.length > 1;
  const submitTab = questions.length;
  const answers = new Map(); // question index -> { header, kind, label }
  let tab = 0;
  let cursor = 0;
  let editing = false;
  let finished = false;
  let cachedLines;
  let cachedWidth;

  const editor = new Editor(tui, {
    borderColor: (s) => theme.fg('accent', s),
    selectList: {
      selectedPrefix: (s) => theme.fg('accent', s),
      selectedText: (s) => theme.fg('accent', s),
      description: (s) => theme.fg('muted', s),
      scrollInfo: (s) => theme.fg('dim', s),
      noMatch: (s) => theme.fg('warning', s),
    },
  });

  const onAbort = () => finish({ answers: [], cancelled: true, reason: 'aborted' });
  function finish(result) {
    if (finished) return;
    finished = true;
    signal?.removeEventListener('abort', onAbort);
    done(result);
  }
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted) onAbort();

  const refresh = () => { cachedLines = undefined; tui.requestRender(); };
  const allAnswered = () => questions.every((_, index) => answers.has(index));
  const ordered = () => questions.map((_, index) => answers.get(index));
  const rows = (index) => [...questions[index].options, { label: OTHER_LABEL, description: '', isOther: true }];

  function commit(answer) {
    answers.set(tab, { header: questions[tab].header, ...answer });
    if (!isMulti) return finish({ answers: ordered(), cancelled: false });
    tab = tab < questions.length - 1 ? tab + 1 : submitTab;
    cursor = 0;
    refresh();
  }

  editor.onSubmit = (value) => {
    const answer = value.trim();
    if (!answer) return; // an empty answer is never recorded: it must not read as approval
    editing = false;
    editor.setText('');
    commit({ kind: 'text', label: answer });
  };

  function handleInput(data) {
    if (finished) return;
    if (editing) {
      if (matchesKey(data, Key.escape)) {
        editing = false;
        editor.setText('');
      } else {
        editor.handleInput(data);
      }
      return refresh();
    }
    if (matchesKey(data, Key.escape)) return finish({ answers: [], cancelled: true });
    if (isMulti && (matchesKey(data, Key.tab) || matchesKey(data, Key.right))) {
      tab = (tab + 1) % (submitTab + 1);
      cursor = 0;
      return refresh();
    }
    if (isMulti && (matchesKey(data, Key.shift('tab')) || matchesKey(data, Key.left))) {
      tab = (tab + submitTab) % (submitTab + 1);
      cursor = 0;
      return refresh();
    }
    if (tab === submitTab) {
      if (matchesKey(data, Key.enter) && allAnswered()) finish({ answers: ordered(), cancelled: false });
      return;
    }
    const options = rows(tab);
    if (matchesKey(data, Key.up)) { cursor = Math.max(0, cursor - 1); return refresh(); }
    if (matchesKey(data, Key.down)) { cursor = Math.min(options.length - 1, cursor + 1); return refresh(); }
    if (matchesKey(data, Key.enter)) {
      const choice = options[cursor];
      if (!choice.isOther) return commit({ kind: 'option', label: choice.label });
      editing = true;
      editor.setText('');
      refresh();
    }
  }

  function render(width) {
    // Keyed by the width: a terminal resize only requests a render, it does not invalidate.
    if (cachedLines && cachedWidth === width) return cachedLines;
    const renderWidth = Math.max(1, width);
    const lines = [];
    const add = (prefix, value) => {
      const prefixWidth = visibleWidth(prefix);
      if (prefixWidth >= renderWidth) { lines.push(...wrapTextWithAnsi(prefix + value, renderWidth)); return; }
      wrapTextWithAnsi(value, renderWidth - prefixWidth)
        .forEach((line, index) => lines.push((index === 0 ? prefix : ' '.repeat(prefixWidth)) + line));
    };
    const renderOptions = () => rows(tab).forEach((option, index) => {
      const selected = index === cursor;
      const label = `${index + 1}. ${option.label}${option.isOther && editing ? ' ✎' : ''}`;
      add(selected ? theme.fg('accent', '> ') : '  ', theme.fg(selected || (option.isOther && editing) ? 'accent' : 'text', label));
      if (option.description) add('     ', theme.fg('muted', option.description));
    });

    lines.push(theme.fg('accent', '─'.repeat(renderWidth)));
    if (isMulti) {
      const tabs = questions.map((question, index) => {
        const answered = answers.has(index);
        const label = ` ${answered ? '■' : '□'} ${question.header} `;
        return index === tab ? theme.bg('selectedBg', theme.fg('text', label)) : theme.fg(answered ? 'success' : 'muted', label);
      });
      const submit = ' ✓ Submit ';
      tabs.push(tab === submitTab ? theme.bg('selectedBg', theme.fg('text', submit)) : theme.fg(allAnswered() ? 'success' : 'dim', submit));
      add(' ', ['←', ...tabs, '→'].join(' '));
      lines.push('');
    }
    if (tab === submitTab) {
      add(' ', theme.fg('accent', theme.bold('Ready to submit')));
      lines.push('');
      for (const [index, question] of questions.entries()) {
        const answer = answers.get(index);
        if (answer) add(' ', `${theme.fg('muted', `${question.header}: `)}${theme.fg('text', (answer.kind === 'text' ? '(wrote) ' : '') + answer.label)}`);
      }
      lines.push('');
      const missing = questions.filter((_, index) => !answers.has(index)).map((question) => question.header).join(', ');
      add(' ', missing ? theme.fg('warning', `Unanswered: ${missing}`) : theme.fg('success', 'Press Enter to submit'));
    } else {
      const { context } = questions[tab];
      if (context) {
        for (const line of context.split('\n')) add(' ', theme.fg('muted', line));
        lines.push('');
      }
      add(' ', theme.fg('text', questions[tab].question));
      lines.push('');
      renderOptions();
      if (editing) {
        lines.push('');
        add(' ', theme.fg('muted', 'Your answer:'));
        for (const line of editor.render(Math.max(1, renderWidth - 2))) lines.push(` ${line}`);
      }
    }
    lines.push('');
    const help = editing
      ? 'Enter to submit • Esc to go back'
      : isMulti ? 'Tab/←→ navigate • ↑↓ select • Enter confirm • Esc cancel' : '↑↓ navigate • Enter select • Esc cancel';
    add(' ', theme.fg('dim', help));
    lines.push(theme.fg('accent', '─'.repeat(renderWidth)));
    cachedLines = lines;
    cachedWidth = width;
    return lines;
  }

  return { render, invalidate: () => { cachedLines = undefined; }, handleInput };
}
