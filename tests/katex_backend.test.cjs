const test = require('node:test');
const assert = require('node:assert/strict');
const { loadBackend } = require('./helpers/load-katex-backend.cjs');

const toPlain = (value) => JSON.parse(JSON.stringify(value));

function createFakeRoom(initialPeers = {}) {
  const peers = { ...initialPeers };
  const sent = [];
  let onStateHandler = null;
  let onJoinHandler = null;
  let onLeaveHandler = null;

  return {
    sent,
    leaveCalled: false,
    makeAction() {
      return [
        (payload) => sent.push(toPlain(payload)),
        (handler) => {
          onStateHandler = handler;
          return () => {
            if (onStateHandler === handler) onStateHandler = null;
          };
        }
      ];
    },
    onPeerJoin(handler) {
      onJoinHandler = handler;
      return () => {
        if (onJoinHandler === handler) onJoinHandler = null;
      };
    },
    onPeerLeave(handler) {
      onLeaveHandler = handler;
      return () => {
        if (onLeaveHandler === handler) onLeaveHandler = null;
      };
    },
    getPeers() {
      return { ...peers };
    },
    leave() {
      this.leaveCalled = true;
    },
    emitState(payload, peerId = payload?.from) {
      if (typeof onStateHandler === 'function') onStateHandler(payload, peerId);
    },
    emitJoin(peerId, peerInfo = {}) {
      peers[String(peerId)] = peerInfo;
      if (typeof onJoinHandler === 'function') onJoinHandler(String(peerId));
    },
    emitLeave(peerId) {
      delete peers[String(peerId)];
      if (typeof onLeaveHandler === 'function') onLeaveHandler(String(peerId));
    }
  };
}

function createFakeJoinRoom(initialPeers = {}) {
  const calls = [];
  const rooms = [];
  const joinRoom = async (_config, roomName) => {
    calls.push(String(roomName));
    const room = createFakeRoom(initialPeers);
    room.roomName = String(roomName);
    rooms.push(room);
    return room;
  };
  return { joinRoom, calls, rooms };
}

function dispatchKeydown(element, key, extra = {}) {
  element.dispatchEvent({
    type: 'keydown',
    key,
    ...extra
  });
}

function getPresenceNames(app) {
  const presenceList = app.elements.get('presenceList');
  if (!presenceList) return [];
  const names = [];
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    const classes = String(node.className || '').split(/\s+/).filter(Boolean);
    if (classes.includes('presence-name')) {
      names.push(String(node.textContent || ''));
    }
    (node.children || []).forEach(visit);
  };
  visit(presenceList);
  return names;
}

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

test('render classic mode routes non-empty lines to katex.render and keeps blank lines as <br>', () => {
  const app = loadBackend();
  app.hooks.setMode('classic');
  app.hooks.setMACROS({ '\\RR': '\\mathbb{R}' });
  app.hooks.setEditorValue('x^2\n\n\\RR');
  app.hooks.render();

  assert.equal(app.katexRenderCalls.length, 2);
  assert.equal(app.katexRenderCalls[0][0], 'x^2');
  assert.equal(app.katexRenderCalls[1][0], '\\RR');
  assert.deepEqual(toPlain(app.katexRenderCalls[0][2].macros), { '\\RR': '\\mathbb{R}' });
  assert.equal(app.katexRenderCalls[0][2].displayMode, true);
  assert.deepEqual(toPlain(app.hooks.getPreviewNodeIds()), ['div', 'br', 'div']);
  assert.equal(app.renderMathCalls.length, 0);
});

test('render mixed mode routes lines through renderMathInElement with expected delimiters', () => {
  const app = loadBackend();
  app.hooks.setMode('mixed');
  app.hooks.setMACROS({ '\\NN': '\\mathbb{N}' });
  app.hooks.setEditorValue('Line $x$\n\n$$y$$');
  app.hooks.render();

  assert.equal(app.renderMathCalls.length, 2);
  assert.equal(app.renderMathCalls[0][0].textContent, 'Line $x$');
  assert.equal(app.renderMathCalls[1][0].textContent, '$$y$$');
  assert.deepEqual(toPlain(app.renderMathCalls[0][1].macros), { '\\NN': '\\mathbb{N}' });
  assert.deepEqual(toPlain(app.renderMathCalls[0][1].delimiters), [
    { left: '$$', right: '$$', display: true },
    { left: '$', right: '$', display: false }
  ]);
  assert.deepEqual(toPlain(app.hooks.getPreviewNodeIds()), ['div', 'br', 'div']);
  assert.equal(app.katexRenderCalls.length, 0);
});

test('render mixed mode keeps escaped dollar signs as literal text outside math delimiters', () => {
  let sourceAtRender = '';
  const app = loadBackend({
    renderMathInElementImpl: (element) => {
      sourceAtRender = element.textContent;
    }
  });
  app.hooks.setMode('mixed');
  app.hooks.setEditorValue('Cost: \\$5 and \\$x\\$ plus $a+\\$b$');
  app.hooks.render();

  assert.equal(app.renderMathCalls.length, 1);
  assert.equal(sourceAtRender.includes('\\$b'), true);
  assert.equal(app.renderMathCalls[0][0].textContent, 'Cost: $5 and $x$ plus $a+\\$b$');
});

test('render falls back to error text when katex.render throws', () => {
  const app = loadBackend({
    katexRenderImpl: (line) => {
      if (line === 'bad') throw new Error('boom');
    }
  });
  app.hooks.setMode('classic');
  app.hooks.setEditorValue('bad');
  app.hooks.render();
  assert.equal(app.hooks.getPreviewTexts()[0], 'boom');
});

test('render stick-to-bottom behavior differs by desktop vs first mobile render', () => {
  const desktopApp = loadBackend({ mobile: false });
  const desktopPreview = desktopApp.elements.get('preview');
  desktopApp.hooks.setMode('classic');
  desktopApp.hooks.setEditorValue('x');
  desktopPreview.clientHeight = 400;
  desktopPreview.scrollHeight = 1000;
  desktopPreview.scrollTop = 599;
  desktopApp.hooks.render();
  assert.equal(desktopPreview.scrollTop, 600);

  const mobileApp = loadBackend({ mobile: true });
  const mobilePreview = mobileApp.elements.get('preview');
  mobileApp.hooks.setMode('classic');
  mobileApp.hooks.setEditorValue('x');
  mobilePreview.clientHeight = 400;
  mobilePreview.scrollHeight = 1000;
  mobilePreview.scrollTop = 599;
  mobileApp.hooks.render();
  assert.equal(mobilePreview.scrollTop, 599);
  assert.equal(mobileApp.hooks.getPreviewChildCount(), 1);
  mobilePreview.scrollTop = 599;
  mobileApp.hooks.render();
  assert.equal(mobilePreview.scrollTop, 600);
});

test('mobile keyboard-open preview lock clamps to visual viewport height', () => {
  const app = loadBackend({ mobile: true });
  const editor = app.elements.get('editor');
  const preview = app.elements.get('preview');

  app.window.innerHeight = 900;
  app.window.visualViewport.height = 260;
  app.window.visualViewport.offsetTop = 0;
  preview.clientHeight = 420;

  editor.focus();
  editor.dispatchEvent({ type: 'focus', target: editor });

  assert.equal(app.document.body.classList.contains('mobile-keyboard-open'), true);
  assert.equal(app.document.body.style['--mobile-preview-lock-height'], '164px');
});

test('mobile viewport shift re-pins top even after initial focus lock expires', () => {
  const app = loadBackend({ mobile: true });
  const editor = app.elements.get('editor');

  app.window.innerHeight = 900;
  app.window.visualViewport.height = 700;
  app.window.visualViewport.offsetTop = 0;

  editor.focus();
  editor.dispatchEvent({ type: 'focus', target: editor });
  app.window.scrollY = 180;

  app.window.visualViewport.dispatchEvent({ type: 'resize', target: app.window.visualViewport });

  assert.equal(app.window.scrollY, 0);
});

test('matrix and table size grids cap at 10x10 on mobile', () => {
  const app = loadBackend({ mobile: true });
  const openMatrixGen = app.elements.get('openMatrixGen');
  const openTableGen = app.elements.get('openTableGen');
  const mRows = app.elements.get('mRows');
  const mCols = app.elements.get('mCols');
  const tRows = app.elements.get('tRows');
  const tCols = app.elements.get('tCols');
  const mSizeGrid = app.elements.get('mSizeGrid');
  const tSizeGrid = app.elements.get('tSizeGrid');

  mRows.value = '18';
  mCols.value = '17';
  tRows.value = '14';
  tCols.value = '16';

  openMatrixGen.dispatchEvent({ type: 'click', target: openMatrixGen });
  openTableGen.dispatchEvent({ type: 'click', target: openTableGen });

  assert.equal(mRows.value, '10');
  assert.equal(mCols.value, '10');
  assert.equal(tRows.value, '10');
  assert.equal(tCols.value, '10');
  assert.equal(mSizeGrid.childNodes.length, 100);
  assert.equal(tSizeGrid.childNodes.length, 100);
});

test('matrix drag keeps last selected size when pointer target is grid container', () => {
  const app = loadBackend({ mobile: false });
  const openMatrixGen = app.elements.get('openMatrixGen');
  const mSizeGrid = app.elements.get('mSizeGrid');
  const mRows = app.elements.get('mRows');
  const mCols = app.elements.get('mCols');

  openMatrixGen.dispatchEvent({ type: 'click', target: openMatrixGen });

  const matrixCell = Array.from(mSizeGrid.childNodes).find((cell) => {
    return cell && cell.dataset && cell.dataset.rows === '6' && cell.dataset.cols === '7';
  });
  assert.ok(matrixCell);

  mSizeGrid.dispatchEvent({
    type: 'pointerdown',
    target: matrixCell,
    pointerId: 1,
    clientX: 120,
    clientY: 120
  });
  assert.equal(mRows.value, '6');
  assert.equal(mCols.value, '7');

  mSizeGrid.dispatchEvent({
    type: 'pointermove',
    target: mSizeGrid,
    pointerId: 1,
    clientX: 121,
    clientY: 121
  });
  assert.equal(mRows.value, '6');
  assert.equal(mCols.value, '7');
});

test('matrix hover keeps last highlighted size while pointer moves over grid gaps', () => {
  const app = loadBackend({ mobile: false });
  const openMatrixGen = app.elements.get('openMatrixGen');
  const mSizeGrid = app.elements.get('mSizeGrid');
  const mRows = app.elements.get('mRows');
  const mCols = app.elements.get('mCols');
  const mSizeValue = app.elements.get('mSizeValue');

  openMatrixGen.dispatchEvent({ type: 'click', target: openMatrixGen });

  const matrixCell = Array.from(mSizeGrid.childNodes).find((cell) => {
    return cell && cell.dataset && cell.dataset.rows === '4' && cell.dataset.cols === '6';
  });
  assert.ok(matrixCell);

  mSizeGrid.dispatchEvent({
    type: 'pointermove',
    target: matrixCell,
    clientX: 90,
    clientY: 90
  });
  assert.equal(mSizeValue.textContent, '4 × 6');
  assert.equal(mRows.value, '3');
  assert.equal(mCols.value, '3');

  mSizeGrid.dispatchEvent({
    type: 'pointermove',
    target: mSizeGrid,
    clientX: 91,
    clientY: 91
  });
  assert.equal(mSizeValue.textContent, '4 × 6');
  assert.equal(mRows.value, '3');
  assert.equal(mCols.value, '3');
});

test('matrix pointerleave keeps the most recent hovered size selected on desktop', () => {
  const app = loadBackend({ mobile: false });
  const openMatrixGen = app.elements.get('openMatrixGen');
  const mSizeGrid = app.elements.get('mSizeGrid');
  const mRows = app.elements.get('mRows');
  const mCols = app.elements.get('mCols');
  const mSizeValue = app.elements.get('mSizeValue');

  openMatrixGen.dispatchEvent({ type: 'click', target: openMatrixGen });

  const matrixCell = Array.from(mSizeGrid.childNodes).find((cell) => {
    return cell && cell.dataset && cell.dataset.rows === '5' && cell.dataset.cols === '8';
  });
  assert.ok(matrixCell);

  mSizeGrid.dispatchEvent({
    type: 'pointermove',
    target: matrixCell,
    clientX: 112,
    clientY: 112
  });
  assert.equal(mSizeValue.textContent, '5 × 8');
  assert.equal(mRows.value, '3');
  assert.equal(mCols.value, '3');

  mSizeGrid.dispatchEvent({ type: 'pointerleave', target: mSizeGrid });
  assert.equal(mRows.value, '5');
  assert.equal(mCols.value, '8');
  assert.equal(mSizeValue.textContent, '5 × 8');
});

test('table pointerleave keeps the most recent hovered size selected on desktop', () => {
  const app = loadBackend({ mobile: false });
  const openTableGen = app.elements.get('openTableGen');
  const tSizeGrid = app.elements.get('tSizeGrid');
  const tRows = app.elements.get('tRows');
  const tCols = app.elements.get('tCols');
  const tSizeValue = app.elements.get('tSizeValue');

  openTableGen.dispatchEvent({ type: 'click', target: openTableGen });

  const tableCell = Array.from(tSizeGrid.childNodes).find((cell) => {
    return cell && cell.dataset && cell.dataset.rows === '6' && cell.dataset.cols === '9';
  });
  assert.ok(tableCell);

  tSizeGrid.dispatchEvent({
    type: 'pointermove',
    target: tableCell,
    clientX: 118,
    clientY: 118
  });
  assert.equal(tSizeValue.textContent, '6 × 9');
  assert.equal(tRows.value, '3');
  assert.equal(tCols.value, '3');

  tSizeGrid.dispatchEvent({ type: 'pointerleave', target: tSizeGrid });
  assert.equal(tRows.value, '6');
  assert.equal(tCols.value, '9');
  assert.equal(tSizeValue.textContent, '6 × 9');
});

test('collab ignores stale clock payloads from the same peer', async () => {
  const rig = createFakeJoinRoom();
  const app = loadBackend({
    collab: true,
    shareStateLink: false,
    testJoinRoom: rig.joinRoom
  });
  await app.hooks.collabJoin('room-a');
  const room = rig.rooms[0];

  room.emitState(
    { kind: 'cursor', from: 'peer-a', clock: 2, name: 'Alpha', cursor: { start: 1, end: 1 } },
    'peer-a'
  );
  const namesAfterFresh = getPresenceNames(app);
  assert.ok(namesAfterFresh.includes('Alpha'));

  room.emitState(
    { kind: 'cursor', from: 'peer-a', clock: 1, name: 'Beta', cursor: { start: 2, end: 2 } },
    'peer-a'
  );
  const namesAfterStale = getPresenceNames(app);
  assert.ok(namesAfterStale.includes('Alpha'));
  assert.ok(!namesAfterStale.includes('Beta'));
});

test('collab requests sync when incoming delta base length mismatches local text', async () => {
  const rig = createFakeJoinRoom();
  const app = loadBackend({
    collab: true,
    shareStateLink: false,
    testJoinRoom: rig.joinRoom
  });
  app.hooks.setEditorValue('abcdef');
  await app.hooks.collabJoin('room-a');
  const room = rig.rooms[0];
  room.sent.length = 0;

  room.emitState(
    {
      kind: 'delta',
      from: 'peer-a',
      clock: 10,
      delta: { index: 0, remove: 1, insert: 'Z' },
      baseLength: 999,
      resultLength: 999
    },
    'peer-a'
  );

  assert.ok(room.sent.some((payload) => payload.kind === 'request'));
});

test('collab macros updates merge by default and replace on save/reset reasons', async () => {
  const rig = createFakeJoinRoom();
  const app = loadBackend({
    collab: true,
    shareStateLink: false,
    testJoinRoom: rig.joinRoom
  });
  await app.hooks.collabJoin('room-a');
  const room = rig.rooms[0];

  room.emitState(
    {
      kind: 'macros',
      from: 'peer-a',
      owner: 0,
      reason: 'update',
      macros: {
        '\\RR': '\\mathbb{R}',
        '\\FBF': '\\mathrm{override}'
      }
    },
    'peer-a'
  );
  const merged = toPlain(app.hooks.getMACROS());
  assert.equal(merged['\\RR'], '\\mathbb{R}');
  assert.equal(merged['\\FBF'], '\\mathrm{FBF}');

  room.emitState(
    {
      kind: 'macros',
      from: 'peer-a',
      owner: 0,
      reason: 'save',
      macros: {
        '\\X': 'x'
      }
    },
    'peer-a'
  );
  assert.deepEqual(toPlain(app.hooks.getMACROS()), { '\\X': 'x' });
});

test('collab host election uses earliest join time and lexical peer id tie-breaker', async () => {
  const rig = createFakeJoinRoom();
  const app = loadBackend({
    collab: true,
    shareStateLink: false,
    testJoinRoom: rig.joinRoom
  });
  await app.hooks.collabJoin('room-a');
  const room = rig.rooms[0];
  const localInfo = toPlain(app.hooks.collabHostInfo());
  const localTs = localInfo.joinTimestamp;
  const firstHello = room.sent.find((payload) => payload.kind === 'hello');
  const localId = firstHello?.from;
  assert.ok(localId);

  room.emitJoin('peer-z');
  room.emitState(
    { kind: 'hello', from: 'peer-z', joinedAt: localTs + 10, name: 'Peer Z' },
    'peer-z'
  );
  let hostInfo = toPlain(app.hooks.collabHostInfo());
  assert.equal(hostInfo.hostId, localId);
  assert.equal(hostInfo.isRoomOwner, true);

  room.emitJoin('!peer-a');
  room.emitState(
    { kind: 'hello', from: '!peer-a', joinedAt: localTs, name: 'Peer A' },
    '!peer-a'
  );
  hostInfo = toPlain(app.hooks.collabHostInfo());
  assert.equal(hostInfo.hostId, '!peer-a');
  assert.equal(hostInfo.isRoomOwner, false);
});

test('join warning modal gates connect and can persist "dont show again"', async () => {
  const rig = createFakeJoinRoom();
  const app = loadBackend({
    collab: true,
    shareStateLink: false,
    testJoinRoom: rig.joinRoom
  });
  const roomInput = app.elements.get('roomNameInput');
  const roomJoinBtn = app.elements.get('roomJoinBtn');
  const joinPop = app.elements.get('joinPop');
  const joinPopCancel = app.elements.get('joinPopCancel');
  const joinPopDismiss = app.elements.get('joinPopDismiss');
  const joinPopDontShow = app.elements.get('joinPopDontShow');
  const joinWarningKey = app.hooks.getStorageKey('joinwarning.v2');

  roomInput.value = 'room-one';
  roomJoinBtn.click();
  assert.equal(joinPop.style.display, 'block');
  assert.equal(rig.calls.length, 0);

  joinPopCancel.click();
  assert.equal(joinPop.style.display, 'none');
  assert.equal(roomInput.value, '');
  assert.equal(rig.calls.length, 0);

  roomInput.value = 'room-two';
  roomJoinBtn.click();
  joinPopDontShow.checked = true;
  joinPopDismiss.click();
  await Promise.resolve();
  assert.equal(app.storage.get(joinWarningKey), '1');
  assert.equal(rig.calls.length, 1);
  assert.equal(rig.calls[0], 'room-two');

  app.hooks.collabLeave();
  roomInput.value = 'room-three';
  roomJoinBtn.click();
  await Promise.resolve();
  assert.equal(rig.calls.length, 2);
  assert.equal(joinPop.style.display, 'none');
});

test('Tab and Shift+Tab indent/outdent multiline selections with expected cursor updates', () => {
  const app = loadBackend();
  const editor = app.elements.get('editor');
  editor.value = 'aa\nbb';
  editor.selectionStart = 0;
  editor.selectionEnd = editor.value.length;

  dispatchKeydown(editor, 'Tab');
  assert.equal(editor.value, '  aa\n  bb');
  assert.equal(editor.selectionStart, 2);
  assert.equal(editor.selectionEnd, 9);

  dispatchKeydown(editor, 'Tab', { shiftKey: true });
  assert.equal(editor.value, 'aa\nbb');
  assert.equal(editor.selectionStart, 0);
  assert.equal(editor.selectionEnd, 5);
});

test('dollar pairing handles plain insert, multiline wrap, and closer-skip', () => {
  const app = loadBackend();
  const editor = app.elements.get('editor');

  editor.value = 'ab';
  editor.selectionStart = 1;
  editor.selectionEnd = 1;
  dispatchKeydown(editor, '$');
  assert.equal(editor.value, 'a$$b');
  assert.equal(editor.selectionStart, 2);
  assert.equal(editor.selectionEnd, 2);

  editor.value = 'x\ny';
  editor.selectionStart = 0;
  editor.selectionEnd = editor.value.length;
  dispatchKeydown(editor, '$');
  assert.equal(editor.value, '$$x\ny$$');
  assert.equal(editor.selectionStart, 2);
  assert.equal(editor.selectionEnd, 5);

  editor.value = '$$';
  editor.selectionStart = 1;
  editor.selectionEnd = 1;
  dispatchKeydown(editor, '$');
  assert.equal(editor.value, '$$');
  assert.equal(editor.selectionStart, 2);
  assert.equal(editor.selectionEnd, 2);
});

test('bracket pairing wraps selections and closer keys skip existing closers', () => {
  const app = loadBackend();
  const editor = app.elements.get('editor');

  editor.value = 'abc';
  editor.selectionStart = 1;
  editor.selectionEnd = 2;
  dispatchKeydown(editor, '(');
  assert.equal(editor.value, 'a(b)c');
  assert.equal(editor.selectionStart, 2);
  assert.equal(editor.selectionEnd, 3);

  editor.value = '()';
  editor.selectionStart = 1;
  editor.selectionEnd = 1;
  dispatchKeydown(editor, ')');
  assert.equal(editor.value, '()');
  assert.equal(editor.selectionStart, 2);
  assert.equal(editor.selectionEnd, 2);
});

test('Backspace removes paired delimiters as a unit', () => {
  const app = loadBackend();
  const editor = app.elements.get('editor');
  const pairs = [['$$', '$$'], ['$', '$'], ['(', ')'], ['[', ']'], ['{', '}']];

  for (const [open, close] of pairs) {
    editor.value = open + close;
    editor.selectionStart = open.length;
    editor.selectionEnd = open.length;
    dispatchKeydown(editor, 'Backspace');
    assert.equal(editor.value, '', `pair ${open}${close} should be deleted`);
    assert.equal(editor.selectionStart, 0);
    assert.equal(editor.selectionEnd, 0);
  }
});

test('cursor and scroll persistence writes on keyup, input, and click', () => {
  const app = loadBackend();
  const editor = app.elements.get('editor');
  const cursorKey = app.hooks.getStorageKey('cursor.v1');
  const scrollKey = app.hooks.getStorageKey('scroll.v1');

  editor.value = 'abcdef';
  editor.selectionStart = 3;
  editor.selectionEnd = 3;
  editor.scrollTop = 42;
  editor.dispatchEvent({ type: 'keyup', key: 'ArrowRight' });
  assert.equal(app.storage.get(cursorKey), '3');
  assert.equal(app.storage.get(scrollKey), '42');

  editor.selectionStart = 5;
  editor.selectionEnd = 5;
  editor.scrollTop = 70;
  editor.dispatchEvent({ type: 'input' });
  assert.equal(app.storage.get(cursorKey), '5');
  assert.equal(app.storage.get(scrollKey), '70');

  editor.selectionStart = 1;
  editor.selectionEnd = 1;
  editor.scrollTop = 9;
  editor.dispatchEvent({ type: 'click' });
  assert.equal(app.storage.get(cursorKey), '1');
  assert.equal(app.storage.get(scrollKey), '9');
});
