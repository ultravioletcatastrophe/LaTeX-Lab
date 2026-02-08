const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackend } = require('./helpers/load-katex-backend.cjs');

const toPlain = (value) => JSON.parse(JSON.stringify(value));

test('normalizeMacros coerces values to strings and unwraps arrays', () => {
  const { hooks } = loadBackend();
  const normalized = toPlain(hooks.normalizeMacros({
    '\\A': ['x', 'ignored'],
    '\\B': 42
  }));
  assert.deepEqual(normalized, { '\\A': 'x', '\\B': '42' });
});

test('parseMacrosInput parses a standard newcommand', () => {
  const { hooks } = loadBackend();
  const result = toPlain(hooks.parseMacrosInput('\\newcommand{\\RR}{\\mathbb{R}}'));
  assert.deepEqual(result, {
    macros: { '\\RR': '\\mathbb{R}' },
    errors: []
  });
});

test('parseMacrosInput strips LaTeX comments before parsing', () => {
  const { hooks } = loadBackend();
  const input = '% heading\n\\newcommand{\\V}{\\mathbf{#1}} % trailing comment\n';
  const result = toPlain(hooks.parseMacrosInput(input));
  assert.deepEqual(result, {
    macros: { '\\V': '\\mathbf{#1}' },
    errors: []
  });
});

test('parseMacrosInput reports unmatched braces', () => {
  const { hooks } = loadBackend();
  const result = toPlain(hooks.parseMacrosInput('\\newcommand{\\x}{abc'));
  assert.equal(result.macros, null);
  assert.ok(result.errors.some(err => err.reason === 'Unmatched braces'));
});

test('parseMacrosInput reports trailing non-whitespace after command block', () => {
  const { hooks } = loadBackend();
  const result = toPlain(hooks.parseMacrosInput('\\newcommand{\\x}{abc}\ntrailing'));
  assert.ok(result.errors.some(err => err.reason === 'Unexpected trailing characters' && err.line === 2));
});

test('parseMacrosInput does not false-positive on \\newcommand text inside macro body', () => {
  const { hooks } = loadBackend();
  const result = toPlain(hooks.parseMacrosInput('\\newcommand{\\foo}{\\text{\\newcommand}}'));
  assert.deepEqual(result, {
    macros: { '\\foo': '\\text{\\newcommand}' },
    errors: []
  });
});

test('macros save with comment-only content keeps MACROS as an object (not null)', () => {
  const app = loadBackend();
  app.hooks.setMacrosText('% comment only input');
  app.hooks.triggerMacrosSave();
  assert.deepEqual(toPlain(app.hooks.getMACROS()), {});
  assert.equal(app.alerts.length, 0);
});

test('invalid macros input triggers parse alert', () => {
  const app = loadBackend();
  app.hooks.setMacrosText('\\newcommand{\\oops}{');
  app.hooks.triggerMacrosSave();
  assert.ok(app.alerts.some(message => /Could not parse \\newcommand on line/i.test(message)));
});

test('clampInt enforces min/max and handles invalid values', () => {
  const { hooks } = loadBackend();
  assert.equal(hooks.clampInt('7', 1, 10), 7);
  assert.equal(hooks.clampInt('100', 1, 10), 10);
  assert.equal(hooks.clampInt('-5', 1, 10), 1);
  assert.equal(hooks.clampInt('not-a-number', 1, 10), 1);
});

test('matrix helper text uses placeholders only in preview', () => {
  const { hooks } = loadBackend();
  const preview = hooks.matrixPreviewText(2, 2, 'pmatrix');
  const insert = hooks.matrixInsertText(2, 2, 'pmatrix');
  assert.match(preview, /◻/);
  assert.doesNotMatch(insert, /◻/);
  assert.match(preview, /\\begin\{pmatrix\}/);
  assert.match(insert, /\\end\{pmatrix\}/);
});

test('arrayColSpec builds expected specs for border styles', () => {
  const { hooks } = loadBackend();
  assert.equal(hooks.arrayColSpec('c', 3, 'none'), 'ccc');
  assert.equal(hooks.arrayColSpec('l', 3, 'outer'), '|lll|');
  assert.equal(hooks.arrayColSpec('r', 3, 'all'), '|r|r|r|');
});

test('buildTableString includes expected hlines for all-borders tables', () => {
  const { hooks } = loadBackend();
  const output = hooks.buildTableString(2, 2, 'c', 'all', '◻');
  assert.match(output, /^\\begin\{array\}\{\|c\|c\|\}/);
  assert.equal((output.match(/\\hline/g) || []).length, 3);
});

test('buildTableString omits hlines when borders are none', () => {
  const { hooks } = loadBackend();
  const output = hooks.buildTableString(2, 2, 'c', 'none', '');
  assert.match(output, /^\\begin\{array\}\{cc\}/);
  assert.equal((output.match(/\\hline/g) || []).length, 0);
});

test('compressState + decompressState roundtrip structured state', () => {
  const { hooks } = loadBackend();
  const state = {
    t: 'Hello Ω\n$$x^2$$',
    m: 1,
    d: 0,
    s: 512,
    x: { '\\FBF': '\\mathrm{FBF}', '\\RR': '\\mathbb{R}' }
  };
  const token = hooks.compressState(state);
  const restored = toPlain(hooks.decompressState(token));
  assert.deepEqual(restored, state);
});

test('decompressState returns null on invalid token', () => {
  const { hooks } = loadBackend();
  assert.equal(hooks.decompressState('not-a-valid-token'), null);
});

test('b64encode/b64decode roundtrip unicode safely', () => {
  const { hooks } = loadBackend();
  const input = 'unicode Ω + 😀 + math ∫_0^1 x^2 dx';
  const encoded = hooks.b64encode(input);
  const decoded = hooks.b64decode(encoded);
  assert.equal(decoded, input);
});

test('normalizeStateToken trims and converts spaces to plus', () => {
  const { hooks } = loadBackend();
  assert.equal(hooks.normalizeStateToken('  a b  c  '), 'a+b++c');
  assert.equal(hooks.normalizeStateToken(123), '');
});

test('getStateTokenFromHash reads state from hash params', () => {
  const { hooks } = loadBackend();
  assert.equal(hooks.getStateTokenFromHash('#state=abc%2B123'), 'abc+123');
  assert.equal(hooks.getStateTokenFromHash('#foo=1&state=a+b&bar=2'), 'a+b');
  assert.equal(hooks.getStateTokenFromHash('#foo=1&bar=2'), '');
});

test('setStateTokenOnUrl preserves existing hash params', () => {
  const { hooks } = loadBackend();
  const url = new URL('https://example.test/page#foo=1');
  hooks.setStateTokenOnUrl(url, 'tok123');
  const params = new URLSearchParams(url.hash.replace(/^#/, ''));
  assert.equal(params.get('foo'), '1');
  assert.equal(params.get('state'), 'tok123');
});

test('isAtBottom correctly detects bottom threshold', () => {
  const { hooks } = loadBackend();
  assert.equal(hooks.isAtBottom({ scrollHeight: 100, scrollTop: 0, clientHeight: 100 }), true);
  assert.equal(hooks.isAtBottom({ scrollHeight: 1000, scrollTop: 200, clientHeight: 200 }), false);
});

test('clampSplitWidth/applySplitWidth enforce desktop min and max widths', () => {
  const app = loadBackend({ mobile: false });
  const { hooks } = app;
  assert.equal(hooks.clampSplitWidth(100), 240);
  assert.equal(hooks.clampSplitWidth(5000), 960);
  assert.equal(hooks.applySplitWidth(100), 240);
  assert.equal(app.elements.get('leftPane').style.flex, '0 0 240px');
  assert.equal(app.elements.get('preview').style.flex, '1 1 auto');
});

test('clampSplitWidth/applySplitWidth return null on mobile layout', () => {
  const { hooks } = loadBackend({ mobile: true });
  assert.equal(hooks.clampSplitWidth(400), null);
  assert.equal(hooks.applySplitWidth(400), null);
});

test('modeDescriptionText uses desktop copy without forced line breaks', () => {
  const { hooks } = loadBackend({ mobile: false });
  assert.equal(hooks.modeDescriptionText('classic'), 'Each new line is rendered as display math.');
  assert.equal(hooks.modeDescriptionText('mixed'), 'Type text with $inline$ and $$display$$ math.');
});

test('modeDescriptionText uses mobile copy with line breaks', () => {
  const { hooks } = loadBackend({ mobile: true });
  assert.equal(hooks.modeDescriptionText('classic'), 'Each new line is rend-\nered as display math.');
  assert.equal(hooks.modeDescriptionText('mixed'), 'Type text with $inline$\nand $$display$$ math.');
});

test('room URL takes precedence over saved room on load (collab)', () => {
  const app = loadBackend({
    collab: true,
    shareStateLink: false,
    search: '?room=url-room',
    localStorageData: {
      'latexlab.trystero.collab.room.v1': 'saved-room'
    },
    confirmResult: false
  });
  app.runWindowEvent('load');
  assert.equal(app.hooks.getRoomInputValue(), 'url-room');
});

test('saved room is restored when URL has no room (collab)', () => {
  const app = loadBackend({
    collab: true,
    shareStateLink: false,
    localStorageData: {
      'latexlab.trystero.collab.room.v1': 'saved-room'
    },
    confirmResult: false
  });
  app.runWindowEvent('load');
  assert.equal(app.hooks.getRoomInputValue(), 'saved-room');
});
