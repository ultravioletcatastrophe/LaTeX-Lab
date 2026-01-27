const config = window.LATEX_LAB_CONFIG || {};
const ENABLE_COLLAB = !!config.collab;
const SHARE_STATE_LINK = config.shareStateLink !== false;
const STORAGE_PREFIX = config.storagePrefix || (ENABLE_COLLAB ? 'latexlab.trystero' : 'latexlab');
const key = (suffix) => `${STORAGE_PREFIX}.${suffix}`;

const LS_CONTENT = key('content.v6');
const LS_DARK = key('dark.v6');
const LS_SPLITPX = key('splitpx.v6');
const LS_MODE = key('mode.v2');
const LS_MACROS = key('macros.v2');
const LS_CURSOR = key('cursor.v1');
const LS_SCROLL = key('scroll.v1');
const LS_WELCOME = key('welcome.v1');

const editor = document.getElementById('editor');
const gutter = document.getElementById('gutter');
const overlay = document.getElementById('overlay');
const preview = document.getElementById('preview');
const divider = document.getElementById('divider');
const leftPane = document.getElementById('leftPane');
const editorWrap = document.getElementById('editorWrap');
const measure = document.getElementById('measure');

const modeToggle = document.getElementById('modeToggle');
const modeLabel = document.getElementById('modeLabel');
const modeDesc = document.getElementById('modeDesc');
const darkToggle = document.getElementById('darkToggle');

const pngBtn = document.getElementById('pngBtn');
const clearBtn = document.getElementById('clearBtn');
const shareBtn = document.getElementById('shareBtn');

const snippetsMenu = document.getElementById('snippetsMenu');
const snippetsBtn = document.getElementById('snippetsBtn');

const matrixModal = document.getElementById('matrixModal');
const mRows = document.getElementById('mRows');
const mCols = document.getElementById('mCols');
const mType = document.getElementById('mType');
const matrixPrev = document.getElementById('matrixPrev');

const tableModal = document.getElementById('tableModal');
const tRows = document.getElementById('tRows');
const tCols = document.getElementById('tCols');
const tAlign = document.getElementById('tAlign');
const tBorders = document.getElementById('tBorders');
const tablePrev = document.getElementById('tablePrev');

const macrosBtn = document.getElementById('macrosBtn');
const macrosModal = document.getElementById('macrosModal');
const macrosText = document.getElementById('macrosText');
const macrosSave = document.getElementById('macrosSave');
const macrosCancel = document.getElementById('macrosCancel');
const macrosReset = document.getElementById('macrosReset');

if (snippetsBtn) {
  snippetsBtn.addEventListener('click', () => snippetsMenu?.classList.toggle('open'));
}
if (snippetsMenu) {
  document.addEventListener('click', (e) => {
    if (!snippetsMenu.contains(e.target)) snippetsMenu.classList.remove('open');
  });
}

if (document.getElementById('openMatrixGen')) {
  document.getElementById('openMatrixGen').addEventListener('click', () => {
    snippetsMenu?.classList.remove('open');
    openMatrix();
  });
}
if (document.getElementById('openTableGen')) {
  document.getElementById('openTableGen').addEventListener('click', () => {
    snippetsMenu?.classList.remove('open');
    openTable();
  });
}
if (document.getElementById('insertCases')) {
  document.getElementById('insertCases').addEventListener('click', insertCases);
}

function serializeMacros(macros){
  const lines = [];
  for (const [name, body] of Object.entries(macros)){
    const n = maxArgCount(body);
    const arity = n > 0 ? `[${n}]` : '';
    lines.push(`\\newcommand{${name}}${arity}{${body}}`);
  }
  return lines.join('\n');
}
function normalizeMacros(obj){
  const out = {};
  for (const [k, v] of Object.entries(obj || {})){
    out[k] = Array.isArray(v) ? String(v[0]) : String(v);
  }
  return out;
}
function maxArgCount(s){
  let m = 0, r = /#([1-9])/g, a;
  while ((a = r.exec(s)) !== null) m = Math.max(m, parseInt(a[1], 10));
  return m;
}
function stripLatexComments(s){
  return s.replace(/(^|[^\\])%.*$/gm, '$1');
}
function indexToLineNumber(source, index){
  let line = 1;
  for (let i = 0; i < index; i++){
    if (source.charCodeAt(i) === 10) line++;
  }
  return line;
}
function extractMacros(source){
  const macros = {};
  const matchedPositions = new Set();
  const errors = [];
  const head = /(\\(?:re)?newcommand)\s*\{\s*(\\[A-Za-z@]+)\s*\}\s*(?:\[\s*(\d+)\s*\])?\s*\{/g;
  let lastBodyEnd = 0;
  let match;
  while ((match = head.exec(source)) !== null){
    const name = match[2];
    const bodyStart = head.lastIndex;
    let depth = 1;
    let i = bodyStart;
    while (i < source.length && depth > 0){
      const ch = source[i++];
      if (ch === '\\'){ i++; continue; }
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
    }
    if (depth !== 0){
      errors.push({ index: match.index, reason: 'Unmatched braces' });
      matchedPositions.add(match.index);
      lastBodyEnd = bodyStart;
      break;
    }
    const body = source.slice(bodyStart, i - 1).trim();
    macros[name] = body;
    matchedPositions.add(match.index);
    head.lastIndex = i;
    lastBodyEnd = i;
  }

  const commandRegex = /\\(?:re)?newcommand/g;
  let cmd;
  while ((cmd = commandRegex.exec(source)) !== null){
    if (!matchedPositions.has(cmd.index)){
      errors.push({ index: cmd.index, reason: 'Could not parse command' });
    }
  }

  if (lastBodyEnd > 0){
    const trailing = source.slice(lastBodyEnd);
    const nonWsIndex = trailing.search(/\S/);
    if (nonWsIndex !== -1){
      const absoluteIndex = lastBodyEnd + nonWsIndex;
      const ch = trailing[nonWsIndex];
      const reason = (ch === '}') ? 'Unmatched closing brace' : 'Unexpected trailing characters';
      errors.push({ index: absoluteIndex, reason });
    }
  }

  return { macros: Object.keys(macros).length ? macros : null, errors };
}
function parseMacrosInput(raw){
  const sanitized = stripLatexComments(raw);
  const { macros, errors } = extractMacros(sanitized);
  const annotated = errors
    .filter((err, idx, arr) => arr.findIndex(e => e.index === err.index && e.reason === err.reason) === idx)
    .map(err => ({ ...err, line: indexToLineNumber(sanitized, err.index) }));
  return { macros, errors: annotated };
}

let mode = 'mixed';
const DEFAULT_MACROS = { "\\abs": "\\left|#1\\right|", "\\norm": "\\left\\lVert#1\\right\\rVert" };
let MACROS = { ...DEFAULT_MACROS };
let lastBroadcastMacrosJSON = JSON.stringify(normalizeMacros(MACROS));

const Guides = (() => {
  const lineHeightCache = new Map();
  const entries = [];
  let rebuildRAF = null;
  let lastMeasureWidth = 0;

  function invalidateCache(){
    lineHeightCache.clear();
    entries.forEach(entry => { entry.cacheKey = null; });
  }

  function syncOverlayAndMirror(){
    const cs = getComputedStyle(editor);
    overlay.style.paddingTop = cs.paddingTop;
    overlay.style.paddingBottom = cs.paddingBottom;
    overlay.style.paddingLeft = '0';
    overlay.style.paddingRight = '0';
    measure.style.fontFamily = cs.fontFamily;
    measure.style.fontSize = cs.fontSize;
    measure.style.lineHeight = cs.lineHeight;
    measure.style.letterSpacing = cs.letterSpacing;
    const innerW = editor.clientWidth - parseFloat(cs.paddingLeft || '0') - parseFloat(cs.paddingRight || '0');
    if (Number.isFinite(innerW) && innerW > 0){
      if (innerW !== lastMeasureWidth){
        lastMeasureWidth = innerW;
        invalidateCache();
      }
      measure.style.width = innerW + 'px';
    }
  }

  function visualLineHeightPx(){
    measure.textContent = 'M';
    let h = measure.getBoundingClientRect().height;
    measure.textContent = '';
    if (!h || h < 1) h = parseFloat(getComputedStyle(editor).lineHeight) || 20;
    return h;
  }

  function ensureEntry(index){
    let entry = entries[index];
    if (entry) return entry;
    const gutterLine = document.createElement('div');
    gutterLine.className = 'ln';
    gutter.appendChild(gutterLine);
    const overlayLine = document.createElement('div');
    overlayLine.className = 'overlay-line';
    overlay.appendChild(overlayLine);
    entry = { gutterLine, overlayLine, rows: 0, height: 0, cacheKey: null, stripe: 'transparent' };
    entries[index] = entry;
    return entry;
  }

  function rebuildOverlayEntry(entry, rows, height, baseLineHeight, stripeColor){
    const fragment = document.createDocumentFragment();
    const base = baseLineHeight;
    const lastRowHeight = Math.max(1, height - base * (rows - 1));
    for (let r = 0; r < rows; r++){
      const row = document.createElement('div');
      row.className = 'wrap-row';
      const stripeHeight = (r === rows - 1) ? lastRowHeight : base;
      row.style.height = `${stripeHeight}px`;
      row.style.backgroundColor = stripeColor;
      fragment.appendChild(row);
    }
    entry.overlayLine.replaceChildren(fragment);
  }

  function rebuildGuides({ force = false } = {}){
    const keep = editor.scrollTop;
    syncOverlayAndMirror();
    const lines = editor.value.split('\n');
    const baseLineHeight = visualLineHeightPx();
    const stripeBG = getComputedStyle(document.body).getPropertyValue('--stripe-light') || 'transparent';
    const innerWidth = lastMeasureWidth || editor.clientWidth;

    for (let i = 0; i < lines.length; i++){
      const text = lines[i];
      const cacheKey = `${text}|${innerWidth}|${baseLineHeight}`;
      let metrics = lineHeightCache.get(cacheKey);
      if (!metrics || force){
        measure.textContent = text || ' ';
        const measured = measure.getBoundingClientRect().height || baseLineHeight;
        const height = Math.max(baseLineHeight, measured);
        const rows = Math.max(1, Math.ceil(height / baseLineHeight));
        metrics = { height, rows };
        lineHeightCache.set(cacheKey, metrics);
      }

      const entry = ensureEntry(i);
      const stripeColor = (i % 2) ? stripeBG : 'transparent';
      entry.gutterLine.textContent = i + 1;
      const needsUpdate = force || entry.cacheKey !== cacheKey || entry.height !== metrics.height || entry.rows !== metrics.rows || entry.stripe !== stripeColor;
      if (needsUpdate){
        entry.gutterLine.style.height = `${metrics.height}px`;
        entry.gutterLine.style.lineHeight = `${metrics.height}px`;
        entry.overlayLine.style.height = `${metrics.height}px`;
        rebuildOverlayEntry(entry, metrics.rows, metrics.height, baseLineHeight, stripeColor);
        entry.cacheKey = cacheKey;
        entry.height = metrics.height;
        entry.rows = metrics.rows;
        entry.stripe = stripeColor;
      }
    }

    while (entries.length > lines.length){
      const entry = entries.pop();
      if (entry){
        gutter.removeChild(entry.gutterLine);
        overlay.removeChild(entry.overlayLine);
      }
    }

    measure.textContent = '';
    gutter.scrollTop = keep;
    overlay.scrollTop = keep;
  }

  function scheduleRebuild(options = {}){
    if (options.force){
      rebuildGuides({ force: true });
      return;
    }
    if (rebuildRAF) return;
    rebuildRAF = requestAnimationFrame(() => {
      rebuildRAF = null;
      rebuildGuides();
    });
  }

  return { syncOverlayAndMirror, scheduleRebuild, forceRebuild: () => rebuildGuides({ force: true }), invalidateCache };
})();

function isAtBottom(el, pad = 2){
  return (el.scrollHeight - el.scrollTop - el.clientHeight) <= pad;
}

let updateAllRemoteCarets = () => {};
let updateSelfCaretCursor = () => {};
let hideSelfCaret = () => {};
let renderPresenceList = () => {};
let broadcastCursorPosition = () => {};
let notifyNameChange = () => {};

let Collab = {
  join: async () => {},
  leave: () => {},
  sendDelta: () => {},
  sendCursor: () => {},
  sendMacros: () => {},
  isConnected: () => false,
  isApplying: () => false,
  cleanup: () => {},
  updateStatus: () => {},
  requestSync: () => {}
};

let displayName = '';
let joinWarningDismissed = false;

function render(){
  const stickToBottom = isAtBottom(preview);
  preview.innerHTML = '';
  const lines = editor.value.split('\n');
  if (mode === 'classic'){
    for (const line of lines){
      if (line.trim() === '') { preview.appendChild(document.createElement('br')); continue; }
      const div = document.createElement('div');
      try { katex.render(line, div, { throwOnError: false, displayMode: true, macros: MACROS }); }
      catch (e){ div.textContent = e.message; }
      preview.appendChild(div);
    }
  } else {
    for (const line of lines){
      if (line.trim() === '') { preview.appendChild(document.createElement('br')); continue; }
      const wrap = document.createElement('div');
      wrap.textContent = line;
      renderMathInElement(wrap, { delimiters: [ {left:"$$", right:"$$", display:true}, {left:"$", right:"$", display:false} ], throwOnError:false, macros: MACROS });
      preview.appendChild(wrap);
    }
  }
  Guides.scheduleRebuild();
  updateAllRemoteCarets();
  if (stickToBottom){
    requestAnimationFrame(() => {
      preview.scrollTop = Math.max(0, preview.scrollHeight - preview.clientHeight);
    });
  }
}

/* =====================
   Collab-only features
   ===================== */
if (ENABLE_COLLAB) {
  const presenceList = document.getElementById('presenceList');
  let selfPresencePill = null;

  const remoteLayer = document.createElement('div');
  remoteLayer.id = 'remoteLayer';
  editorWrap.appendChild(remoteLayer);

  const selfCaretEl = document.createElement('div');
  selfCaretEl.className = 'remote-caret self-caret';
  const selfCaretLabel = document.createElement('div');
  selfCaretLabel.className = 'remote-caret-label';
  const selfCaretBar = document.createElement('div');
  selfCaretBar.className = 'remote-caret-bar';
  selfCaretEl.appendChild(selfCaretLabel);
  selfCaretEl.appendChild(selfCaretBar);
  remoteLayer.appendChild(selfCaretEl);
  selfCaretEl.style.display = 'none';
  const selfCaretEntry = { el: selfCaretEl, bar: selfCaretBar, label: selfCaretLabel, cursor: null, color: '', name: '', hover: false };

  const selfColorPicker = document.createElement('input');
  selfColorPicker.type = 'color';
  selfColorPicker.id = 'selfColorPicker';
  document.body.appendChild(selfColorPicker);
  Object.assign(selfColorPicker.style, {
    position: 'fixed',
    left: '-9999px',
    top: '-9999px',
    width: '24px',
    height: '24px',
    display: 'block',
    backgroundColor: 'transparent',
    opacity: '0',
    border: '0',
    padding: '0',
    margin: '0',
    pointerEvents: 'none',
    zIndex: '99999',
    transform: 'translate(-50%, -50%)'
  });
  selfColorPicker.tabIndex = -1;

  function moveSelfColorPicker(rect){
    if (!rect) return;
    const left = rect.left + rect.width / 2;
    const top = rect.top + rect.height / 2;
    selfColorPicker.style.left = `${left}px`;
    selfColorPicker.style.top = `${top}px`;
    void selfColorPicker.offsetWidth;
  }
  function resetSelfColorPickerPosition(){
    const rect = getSelfPillRect();
    if (rect) moveSelfColorPicker(rect);
  }

  const CLIENT_ID = (() => {
    try {
      const storageKey = 'latexlab.clientId';
      let id = sessionStorage.getItem(storageKey);
      if (!id){
        id = globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
        sessionStorage.setItem(storageKey, id);
      }
      return id;
    } catch (e){
      return Math.random().toString(36).slice(2);
    }
  })();

  const remotePeers = new Map();
  const peerMeta = new Map();
  const peerAliases = new Map();
  const peerJoinTimes = new Map();
  const colorOverrides = new Map();
  const LS_COLORS = key('colors.v1');

  const CARET_STYLE_PROPS = [
    'direction','boxSizing','width','height','overflowX','overflowY',
    'borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth',
    'paddingTop','paddingRight','paddingBottom','paddingLeft',
    'fontStyle','fontVariant','fontWeight','fontStretch','fontSize','fontSizeAdjust','lineHeight','fontFamily',
    'textAlign','textTransform','textIndent','textDecoration','letterSpacing','wordSpacing','tabSize','MozTabSize'
  ];

  let caretMirror = null;

  const LS_NAME = key('name.v1');
  const LS_ROOM = key('collab.room.v1');
  const LS_JOIN_WARNING = key('joinwarning.v2');

  function resolvePeerKey(id){
    if (!id) return id;
    let current = id;
    const seen = new Set();
    while (peerAliases.has(current) && !seen.has(current)){
      seen.add(current);
      current = peerAliases.get(current);
    }
    return current;
  }

  function linkPeerAlias(alias, canonical){
    if (!alias || !canonical || alias === canonical) return resolvePeerKey(canonical || alias);
    const target = resolvePeerKey(canonical);
    peerAliases.set(alias, target);

    const aliasEntry = remotePeers.get(alias);
    if (aliasEntry && !remotePeers.has(target)){
      remotePeers.set(target, aliasEntry);
    }
    if (aliasEntry && alias !== target){
      remotePeers.delete(alias);
    }

    const aliasMeta = peerMeta.get(alias);
    if (aliasMeta && !peerMeta.has(target)){
      peerMeta.set(target, aliasMeta);
    }
    if (aliasMeta && alias !== target){
      peerMeta.delete(alias);
    }

    const aliasTime = peerJoinTimes.get(alias);
    if (aliasTime !== undefined && !peerJoinTimes.has(target)){
      peerJoinTimes.set(target, aliasTime);
    }
    if (alias !== target && aliasTime !== undefined){
      peerJoinTimes.delete(alias);
    }

    return target;
  }

  function hashString(input=''){
    let hash = 0;
    for (let i = 0; i < input.length; i++){
      hash = ((hash << 5) - hash) + input.charCodeAt(i);
      hash |= 0;
    }
    return hash;
  }

  function withAlpha(hex, alpha){
    if (!hex) return `rgba(0,0,0,${alpha})`;
    let normalized = hex.replace('#','');
    if (normalized.length === 3){ normalized = normalized.split('').map(ch => ch + ch).join(''); }
    if (normalized.length !== 6){ return `rgba(0,0,0,${alpha})`; }
    const num = parseInt(normalized, 16);
    const r = (num >> 16) & 255;
    const g = (num >> 8) & 255;
    const b = num & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  function normalizeHex(input){
    if (typeof input !== 'string') return null;
    let hex = input.trim();
    if (!hex) return null;
    if (!hex.startsWith('#')) hex = `#${hex}`;
    if (hex.length === 4){
      hex = `#${hex.slice(1).split('').map(ch => ch + ch).join('')}`;
    }
    return /^#[0-9a-fA-F]{6}$/.test(hex) ? hex.toUpperCase() : null;
  }

  function hslToHex(h, s, l){
    const sat = Math.max(0, Math.min(100, s)) / 100;
    const light = Math.max(0, Math.min(100, l)) / 100;
    const chroma = (1 - Math.abs(2 * light - 1)) * sat;
    const hueSegment = (h % 360) / 60;
    const x = chroma * (1 - Math.abs((hueSegment % 2) - 1));
    let r = 0, g = 0, b = 0;
    if (0 <= hueSegment && hueSegment < 1){ r = chroma; g = x; }
    else if (1 <= hueSegment && hueSegment < 2){ r = x; g = chroma; }
    else if (2 <= hueSegment && hueSegment < 3){ g = chroma; b = x; }
    else if (3 <= hueSegment && hueSegment < 4){ g = x; b = chroma; }
    else if (4 <= hueSegment && hueSegment < 5){ r = x; b = chroma; }
    else if (5 <= hueSegment && hueSegment < 6){ r = chroma; b = x; }
    const m = light - chroma / 2;
    const toHex = (v) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }

  const namedColorByHex = new Map();
  let nearestColorMatcher = null;

  function registerNamedColor(name, hex){
    const normalized = normalizeHex(hex);
    if (!normalized || typeof name !== 'string') return null;
    const trimmed = name.trim();
    if (!trimmed) return normalized;
    if (!namedColorByHex.has(normalized)) namedColorByHex.set(normalized, trimmed);
    return normalized;
  }

  function nameForHex(hex){
    const normalized = normalizeHex(hex);
    if (!normalized) return 'Color';
    const direct = namedColorByHex.get(normalized);
    if (direct) return direct;
    if (nearestColorMatcher) {
      try {
        const match = nearestColorMatcher(normalized);
        if (match && typeof match.name === 'string' && match.name) return match.name;
        if (match && match.value) {
          const fallback = namedColorByHex.get(normalizeHex(match.value));
          if (fallback) return fallback;
        }
      } catch (err) {
        console.warn('nearestColor lookup failed', err);
      }
    }
    return normalized;
  }

  function baseColorInfoForPeer(peerId){
    const key = peerId || 'peer';
    const hash = Math.abs(hashString(key));
    const hue = hash % 360;
    const hex = hslToHex(hue, 78, 62);
    return { hex, name: nameForHex(hex) };
  }

  function colorInfoForPeer(peerId){
    const key = resolvePeerKey(peerId) || peerId || CLIENT_ID;
    const override = colorOverrides.get(key);
    if (override) return { hex: override, name: nameForHex(override) };
    return baseColorInfoForPeer(key);
  }

  function colorForPeer(peerId){ return colorInfoForPeer(peerId).hex; }
  function colorNameForPeer(peerId){ return colorInfoForPeer(peerId).name; }
  function fallbackNameForPeer(peerId){ return peerId ? `Peer ${peerId.slice(0,4)}` : 'Peer'; }

  function getSelfColorHex(){
    const info = colorInfoForPeer(CLIENT_ID);
    return normalizeHex(info.hex) || '#1EA7FD';
  }

  function defaultColorHexForPeer(peerId){
    const key = resolvePeerKey(peerId) || peerId || CLIENT_ID;
    const info = baseColorInfoForPeer(key);
    return normalizeHex(info.hex) || info.hex;
  }

  function loadNamedColorPalette(){
    try {
      fetch('./ntc.json')
        .then(response => {
          if (!response.ok) throw new Error(`Failed to load colors (${response.status})`);
          return response.json();
        })
        .then(payload => {
          const palette = Object.create(null);
          if (payload && Array.isArray(payload.colors)) {
            payload.colors.forEach(entry => {
              const normalized = registerNamedColor(entry?.name, entry?.hex);
              if (normalized && entry?.name) {
                palette[entry.name] = normalized;
              }
            });
          }
          if (Object.keys(palette).length && typeof nearestColor === 'function') {
            nearestColorMatcher = nearestColor.from(palette);
            peerMeta.forEach((meta, key) => {
              if (!meta) return;
              const info = colorInfoForPeer(key);
              meta.color = info.hex;
              meta.colorName = info.name;
            });
            updateSelfCaretAppearance();
            renderPresenceList();
            updateAllRemoteCarets();
          }
        })
        .catch(err => console.error('Color palette load failed:', err));
    } catch (err) {
      console.error('Color palette setup error:', err);
    }
  }

  function saveColorOverrides(){
    try {
      const data = {};
      if (colorOverrides.has(CLIENT_ID)) {
        data[CLIENT_ID] = colorOverrides.get(CLIENT_ID);
      }
      localStorage.setItem(LS_COLORS, JSON.stringify(data));
    } catch(e) {}
  }

  (function loadColorOverrides(){
    try {
      const raw = localStorage.getItem(LS_COLORS);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        Object.entries(parsed).forEach(([key, value]) => {
          if (typeof value === 'string') {
            const normalized = normalizeHex(value);
            if (normalized) colorOverrides.set(key, normalized);
          }
        });
      }
    } catch(e) {}
  })();

  function updateSelfCaretAppearance(info = null){
    const palette = info || colorInfoForPeer(CLIENT_ID);
    const color = palette?.hex || colorForPeer(CLIENT_ID);
    const label = (displayName || '').trim() || 'You';
    selfCaretEntry.color = color;
    selfCaretEntry.name = label;
    selfCaretEntry.bar.style.backgroundColor = color;
    selfCaretEntry.label.style.backgroundColor = withAlpha(color, 1);
    selfCaretEntry.label.style.border = `1px solid ${withAlpha(color, 1)}`;
    selfCaretEntry.label.textContent = label;
    if (editor) {
      editor.style.caretColor = 'transparent';
    }
  }

  hideSelfCaret = () => {
    if (!selfCaretEntry) return;
    selfCaretEntry.el.style.display = 'none';
    selfCaretEntry.cursor = null;
  };

  function getCurrentCursor(){
    return { start: editor.selectionStart || 0, end: editor.selectionEnd || 0 };
  }

  updateSelfCaretCursor = () => {
    if (!selfCaretEntry || !editor) return;
    if (document.activeElement !== editor) {
      hideSelfCaret();
      return;
    }
    updateSelfCaretAppearance();
    const cursor = getCurrentCursor();
    const caretPos = typeof cursor.end === 'number' ? cursor.end : cursor.start || 0;
    selfCaretEntry.cursor = { start: caretPos, end: caretPos };
    positionRemoteCaret(CLIENT_ID, selfCaretEntry);
  };

  function ensurePeerMeta(peerId){
    const key = resolvePeerKey(peerId);
    if (!key) return { color: '#888', colorName: 'Gray', name: '', display: 'Peer' };
    let meta = peerMeta.get(key);
    if (!meta){
      meta = { color: '', colorName: '', name: '', display: fallbackNameForPeer(key) };
      peerMeta.set(key, meta);
    }
    meta.color = colorForPeer(key);
    meta.colorName = colorNameForPeer(key);
    if (!meta.display) meta.display = fallbackNameForPeer(key);
    if (peerId && peerId !== key) peerAliases.set(peerId, key);
    return meta;
  }

  function ensureRemotePeerEntry(peerId){
    const key = resolvePeerKey(peerId);
    if (!key) return null;
    const meta = ensurePeerMeta(key);
    let entry = remotePeers.get(key);
    if (!entry){
      const el = document.createElement('div');
      el.className = 'remote-caret';
      const label = document.createElement('div');
      label.className = 'remote-caret-label';
      const bar = document.createElement('div');
      bar.className = 'remote-caret-bar';
      el.appendChild(label);
      el.appendChild(bar);
      remoteLayer.appendChild(el);
      entry = { el, bar, label, cursor: null, color: meta.color, name: meta.display, overlayHover: false, presenceHover: false };
      remotePeers.set(key, entry);
    } else {
      if (typeof entry.overlayHover !== 'boolean') entry.overlayHover = false;
      if (typeof entry.presenceHover !== 'boolean') entry.presenceHover = false;
    }
    entry.color = meta.color;
    entry.name = meta.display;
    entry.label.textContent = entry.name;
    entry.bar.style.backgroundColor = entry.color;
    entry.label.style.backgroundColor = withAlpha(entry.color, 1);
    entry.label.style.border = `1px solid ${withAlpha(entry.color, 1)}`;
    if (peerId && peerId !== key) peerAliases.set(peerId, key);
    return entry;
  }

  function updatePeerName(peerId, rawName){
    const key = resolvePeerKey(peerId);
    if (!key) return;
    const meta = ensurePeerMeta(key);
    const normalized = (rawName || '').trim();
    meta.name = normalized;
    meta.display = normalized || fallbackNameForPeer(key);
    const entry = remotePeers.get(key);
    if (entry){
      entry.name = meta.display;
      entry.label.textContent = meta.display;
      entry.bar.style.backgroundColor = meta.color;
      entry.label.style.backgroundColor = withAlpha(meta.color, 1);
      entry.label.style.border = `1px solid ${withAlpha(meta.color, 1)}`;
      positionRemoteCaret(key, entry);
    }
    renderPresenceList();
  }

  function removeRemotePeer(peerId){
    if (!peerId) return;
    const key = resolvePeerKey(peerId);
    if (!key) return;
    const entry = remotePeers.get(key);
    if (entry){ entry.el.remove(); remotePeers.delete(key); }
    peerMeta.delete(key);
    if (key !== CLIENT_ID) colorOverrides.delete(key);
    const aliasesToRemove = [];
    peerAliases.forEach((target, alias) => {
      if (alias === key || target === key) aliasesToRemove.push(alias);
    });
    for (const alias of aliasesToRemove){
      peerAliases.delete(alias);
      if (alias !== key){
        remotePeers.delete(alias);
        peerMeta.delete(alias);
        colorOverrides.delete(alias);
      }
    }
    renderPresenceList();
  }

  function updateRemoteCursor(peerId, cursor){
    const key = resolvePeerKey(peerId);
    if (!key) return;
    const entry = ensureRemotePeerEntry(key);
    if (!entry) return;
    if (!cursor || typeof cursor.start !== 'number' || typeof cursor.end !== 'number'){
      entry.cursor = null;
      entry.el.style.display = 'none';
      return;
    }
    entry.cursor = { start: cursor.start, end: cursor.end };
    positionRemoteCaret(key, entry);
  }

  function applyCaretHoverState(entry){
    if (!entry) return;
    const active = !!entry.overlayHover || !!entry.presenceHover;
    entry.el.classList.toggle('show-label', active);
  }

  function updatePeerColor(peerId, color, persist = false){
    if (!color || typeof color !== 'string') return;
    const normalized = normalizeHex(color);
    if (!normalized) return;
    const key = resolvePeerKey(peerId) || peerId;
    if (!key) return;
    const previous = colorOverrides.get(key);
    const defaultHex = defaultColorHexForPeer(key);
    const isDefault = normalized === defaultHex;
    if (!previous && isDefault) return;
    if (previous && previous === normalized) return;
    if (isDefault) {
      colorOverrides.delete(key);
    } else {
      colorOverrides.set(key, normalized);
    }
    if (persist && key === CLIENT_ID) {
      saveColorOverrides();
      if (typeof Collab !== 'undefined' && Collab.isConnected?.() && !Collab.isApplying?.()) {
        Collab.sendCursor(true);
      }
    }

    const info = colorInfoForPeer(key);
    const meta = ensurePeerMeta(key);
    if (meta){
      meta.color = info.hex;
      meta.colorName = info.name;
    }

    const entry = remotePeers.get(key);
    if (entry){
      entry.color = info.hex;
      entry.bar.style.backgroundColor = info.hex;
      entry.label.style.backgroundColor = withAlpha(info.hex, 1);
      entry.label.style.border = `1px solid ${withAlpha(info.hex, 1)}`;
      applyCaretHoverState(entry);
    }

    if (key === CLIENT_ID) {
      updateSelfCaretAppearance(info);
    }

    if (presenceList) renderPresenceList();
    updateAllRemoteCarets();
  }

  function positionRemoteCaret(peerId, entry){
    const key = resolvePeerKey(peerId);
    const target = entry || remotePeers.get(key);
    if (!target) return;
    if (!target.cursor){ target.el.style.display = 'none'; return; }
    const textLength = editor.value.length;
    const safeIndex = Math.max(0, Math.min(target.cursor.end ?? target.cursor.start ?? 0, textLength));
    const coords = getCaretCoordinates(safeIndex);
    if (!coords){ target.el.style.display = 'none'; return; }
    const { x, y, height } = coords;
    if (y < -height || y > editor.clientHeight + height){
      target.el.style.display = 'none';
      return;
    }
    if (x < -32 || x > editor.clientWidth + 32){
      target.el.style.display = 'none';
      return;
    }
    const showBelow = y < 18;
    target.el.style.display = 'block';
    target.el.style.transform = '';
    target.el.style.top = `${Math.round(y)}px`;
    target.el.style.left = `${Math.round(x)}px`;
    const barHeight = Math.max(height * .8, 1);
    target.el.style.height = `${barHeight}px`;
    target.el.style.width = '2px';
    target.bar.style.position = 'absolute';
    target.bar.style.top = '0';
    target.bar.style.left = '0';
    target.bar.style.width = '2px';
    target.bar.style.height = `${barHeight}px`;
    target.bar.style.backgroundColor = target.color;
    target.label.style.backgroundColor = withAlpha(target.color, 1);
    target.label.style.border = `1px solid ${withAlpha(target.color, 1)}`;
    target.label.textContent = target.name;
    target.el.classList.toggle('label-below', showBelow);
    applyCaretHoverState(target);
  }

  updateAllRemoteCarets = () => {
    remotePeers.forEach((entry, peerId) => positionRemoteCaret(peerId, entry));
    updateSelfCaretCursor();
  };

  function ensureCaretMirror(){
    if (caretMirror) return caretMirror;
    const mirror = document.createElement('div');
    mirror.id = 'caretMirror';
    mirror.style.position = 'absolute';
    mirror.style.top = '0';
    mirror.style.left = '-9999px';
    mirror.style.visibility = 'hidden';
    mirror.style.pointerEvents = 'none';
    mirror.style.whiteSpace = 'pre-wrap';
    mirror.style.wordBreak = 'break-word';
    mirror.style.wordWrap = 'break-word';
    mirror.style.overflow = 'hidden';
    document.body.appendChild(mirror);
    caretMirror = mirror;
    return mirror;
  }

  function getCaretCoordinates(index){
    const textarea = editor;
    const text = textarea.value || '';
    const clamped = Math.max(0, Math.min(index, text.length));
    const mirror = ensureCaretMirror();
    const style = getComputedStyle(textarea);

    CARET_STYLE_PROPS.forEach(prop => { mirror.style[prop] = style[prop]; });

    const pl = parseFloat(style.paddingLeft)  || 0;
    const bt = parseFloat(style.borderTopWidth)  || 0;
    const bl = parseFloat(style.borderLeftWidth) || 0;

    const boxSizing = (style.boxSizing || '').toLowerCase();
    const baseWidth = textarea.clientWidth;
    const contentWidth = boxSizing === 'border-box' ? baseWidth : baseWidth - pl - (parseFloat(style.paddingRight) || 0);
    mirror.style.width = Math.max(0, contentWidth) + 'px';
    mirror.style.whiteSpace = 'pre-wrap';
    mirror.style.wordBreak  = 'break-word';
    mirror.style.wordWrap   = 'break-word';

    mirror.textContent = '';
    mirror.appendChild(document.createTextNode(text.slice(0, clamped)));

    const marker = document.createElement('span');
    marker.textContent = '\u200b';
    mirror.appendChild(marker);

    const left = marker.offsetLeft + bl - textarea.scrollLeft - 1;
    const top  = marker.offsetTop  + bt - textarea.scrollTop - 1;

    const lh = parseFloat(style.lineHeight);
    const fs = parseFloat(style.fontSize) || 16;
    const lineHeight = Number.isFinite(lh) ? lh : Math.round(fs * 1.2);

    mirror.textContent = '';

    return { x: left, y: top, height: lineHeight };
  }

  function shiftRemoteCarets(delta) {
    if (!delta) return;
    const { index = 0, remove = 0, insert = '' } = delta;
    const insertLen = (typeof insert === 'string') ? insert.length : 0;
    const diff = insertLen - remove;
    if (diff === 0 && remove === 0) return;

    remotePeers.forEach((entry, peerId) => {
      if (!entry || !entry.cursor) return;
      const adjust = (pos) => {
        if (typeof pos !== 'number') return pos;
        if (pos <= index) return pos;
        if (pos <= index + remove) return index + insertLen;
        return pos + diff;
      };
      const nextStart = adjust(entry.cursor.start);
      const nextEnd = adjust(entry.cursor.end);
      if (nextStart !== entry.cursor.start || nextEnd !== entry.cursor.end) {
        entry.cursor = {
          start: typeof nextStart === 'number' ? nextStart : entry.cursor.start,
          end: typeof nextEnd === 'number' ? nextEnd : entry.cursor.end
        };
        positionRemoteCaret(peerId, entry);
      }
    });
  }

  renderPresenceList = () => {
    if (!presenceList) return;

    const isConnected = (typeof Collab !== 'undefined' && Collab.isConnected?.()) === true;

    updateSelfCaretAppearance();

    const remoteItems = [];
    const seen = new Set();
    peerMeta.forEach((meta, rawId) => {
      const key = resolvePeerKey(rawId);
      if (!key || key === CLIENT_ID || seen.has(key)) return;
      seen.add(key);
      const entry = meta || {};
      const name = entry.display || fallbackNameForPeer(key);
      const colorInfo = entry.color && entry.colorName ? { hex: entry.color, name: entry.colorName } : colorInfoForPeer(key);
      remoteItems.push({ id: key, text: name, title: `${name} · ${colorInfo.name}`, color: colorInfo.hex, colorName: colorInfo.name });
    });

    const hasRemotes = remoteItems.length > 0;

    if (!isConnected || !hasRemotes){
      selfPresencePill = null;
      presenceList.textContent = '';
      presenceList.style.display = 'none';
      return;
    }

    presenceList.style.display = '';
    const fragment = document.createDocumentFragment();
    const trimmedSelf = (displayName || '').trim();
    const baseSelfName = trimmedSelf || 'You';
    const selfColorInfo = colorInfoForPeer(CLIENT_ID);
    const selfEntry = {
      id: CLIENT_ID,
      text: `You · ${baseSelfName}`,
      title: `${baseSelfName} · ${selfColorInfo.name}`,
      color: selfColorInfo.hex,
      colorName: selfColorInfo.name,
      self: true
    };

    const ordered = remoteItems
      .slice()
      .sort((a, b) => a.text.localeCompare(b.text, undefined, { sensitivity: 'base' }));
    ordered.unshift(selfEntry);

    presenceList.textContent = '';
    selfPresencePill = null;

    ordered.forEach(item => {
      const pill = document.createElement('div');
      pill.className = 'presence-item' + (item.self ? ' self' : '');
      pill.title = item.title || `${item.text} · ${item.colorName}`;

      const dot = document.createElement('span');
      dot.className = 'presence-color';
      dot.style.backgroundColor = item.color;
      dot.setAttribute('aria-hidden', 'true');

      const main = document.createElement('span');
      main.className = 'presence-main';

      const nameSpan = document.createElement('span');
      nameSpan.className = 'presence-name';
      nameSpan.textContent = item.text;

      const toneSpan = document.createElement('span');
      toneSpan.className = 'presence-tone';
      toneSpan.textContent = item.colorName || '';

      main.appendChild(nameSpan);
      if (toneSpan.textContent) main.appendChild(toneSpan);

      pill.appendChild(dot);
      pill.appendChild(main);
      if (item.self) {
        pill.setAttribute('role', 'button');
        pill.setAttribute('tabindex', '0');
        pill.setAttribute('aria-haspopup', 'dialog');
        pill.setAttribute('aria-expanded', 'false');
        pill.addEventListener('click', handleSelfPresenceClick);
        pill.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
            event.preventDefault();
            handleSelfPresenceClick(event);
          }
        });
        selfPresencePill = pill;
      } else {
        const peerId = item.id;
        pill.dataset.peerId = peerId;
        pill.addEventListener('mouseenter', () => togglePresenceHover(peerId, true));
        pill.addEventListener('mouseleave', () => togglePresenceHover(peerId, false));
      }
      fragment.appendChild(pill);
    });

    presenceList.appendChild(fragment);
    resetSelfColorPickerPosition();
  };

  function getSelfPillRect(){
    const selfPill = presenceList.querySelector('.presence-item.self');
    if (!selfPill) return null;
    return selfPill.getBoundingClientRect();
  }

  function togglePresenceHover(peerId, hovering){
    const key = resolvePeerKey(peerId) || peerId;
    if (!key) return;
    const entry = ensureRemotePeerEntry(key);
    if (!entry) return;
    entry.presenceHover = hovering;
    if (hovering && entry.cursor && entry.el.style.display === 'none') {
      positionRemoteCaret(key, entry);
    }
    applyCaretHoverState(entry);
  }

  function handleSelfPresenceClick(event){
    event.preventDefault();
    event.stopPropagation();
    if (event.currentTarget) selfPresencePill = event.currentTarget;
    if (selfPresencePill) selfPresencePill.setAttribute('aria-expanded', 'true');
    const info = colorInfoForPeer(CLIENT_ID);
    const normalized = normalizeHex(info.hex) || '#1EA7FD';
    try { selfColorPicker.value = normalized; } catch(e) {}

    const rect = event.currentTarget?.getBoundingClientRect?.();
    if (rect) moveSelfColorPicker(rect);
    else resetSelfColorPickerPosition();

    let opened = false;
    try {
      if (typeof selfColorPicker.showPicker === 'function') {
        selfColorPicker.showPicker();
        opened = true;
      }
    } catch(_) {}
    if (!opened) {
      try { selfColorPicker.focus({ preventScroll: true }); } catch(_) { try { selfColorPicker.focus(); } catch(_) {} }
      try { selfColorPicker.click(); opened = true; } catch(_) {}
    }
    if (!opened) {
      requestAnimationFrame(() => {
        try {
          if (typeof selfColorPicker.showPicker === 'function') {
            selfColorPicker.showPicker();
            return;
          }
        } catch(_) {}
        try { selfColorPicker.click(); } catch(_) {}
      });
    }
  }

  function clearRemoteCaretHover(){
    remotePeers.forEach(entry => {
      if (!entry) return;
      if (entry.overlayHover) {
        entry.overlayHover = false;
        applyCaretHoverState(entry);
      }
    });
  }

  function handleRemoteCaretHover(clientX, clientY){
    remotePeers.forEach(entry => {
      if (!entry) return;
      if (entry.el.style.display === 'none') {
        if (entry.overlayHover) {
          entry.overlayHover = false;
          applyCaretHoverState(entry);
        }
        return;
      }
      const rect = entry.el.getBoundingClientRect();
      const isHover = clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
      if (entry.overlayHover !== isHover){
        entry.overlayHover = isHover;
        applyCaretHoverState(entry);
      }
    });
  }

  editorWrap.addEventListener('mousemove', (event) => handleRemoteCaretHover(event.clientX, event.clientY));
  editorWrap.addEventListener('mouseleave', clearRemoteCaretHover);

  selfColorPicker.addEventListener('input', (event) => {
    const value = event.target?.value;
    if (typeof value === 'string' && value) {
      updatePeerColor(CLIENT_ID, value, true);
    }
    resetSelfColorPickerPosition();
    if (selfPresencePill) selfPresencePill.setAttribute('aria-expanded', 'false');
    requestAnimationFrame(() => {
      try { editor.focus({ preventScroll: true }); }
      catch(e) { try { editor.focus(); } catch(_) {} }
      updateSelfCaretCursor();
    });
  });

  selfColorPicker.addEventListener('blur', () => {
    resetSelfColorPickerPosition();
    if (selfPresencePill) selfPresencePill.setAttribute('aria-expanded', 'false');
    requestAnimationFrame(() => {
      try { editor.focus({ preventScroll: true }); }
      catch(e) { try { editor.focus(); } catch(_) {} }
      updateSelfCaretCursor();
    });
  });

  window.addEventListener('resize', resetSelfColorPickerPosition, { passive: true });
  window.addEventListener('scroll', resetSelfColorPickerPosition, { passive: true });

  loadNamedColorPalette();

  function mergeMacrosFromPeer(source){
    if (!source || typeof source !== 'object') return false;
    const incoming = normalizeMacros(source);
    let changed = false;
    for (const [name, body] of Object.entries(incoming)){
      if (typeof body !== 'string') continue;
      if (!(name in MACROS)){
        MACROS[name] = body;
        changed = true;
      }
    }
    if (changed){
      try { localStorage.setItem(LS_MACROS, JSON.stringify(MACROS)); }
      catch(e){}
      render();
      if (macrosModal?.classList.contains('show')){
        macrosText.value = serializeMacros(MACROS);
      }
    }
    return changed;
  }

  function replaceMacrosFromPeer(source){
    if (!source || typeof source !== 'object') return false;
    const incoming = normalizeMacros(source);
    const nextJSON = JSON.stringify(incoming);
    const currentJSON = JSON.stringify(normalizeMacros(MACROS));
    if (nextJSON === currentJSON) return false;
    MACROS = incoming;
    try { localStorage.setItem(LS_MACROS, JSON.stringify(MACROS)); }
    catch(e){}
    render();
    if (macrosModal?.classList.contains('show')){
      macrosText.value = serializeMacros(MACROS);
    }
    return true;
  }

  const roomInput = document.getElementById('roomNameInput');
  const roomJoinBtn = document.getElementById('roomJoinBtn');
  const collabStatus = document.getElementById('collabStatus');
  const displayNameInput = document.getElementById('displayNameInput');
  const joinPop = document.getElementById('joinPop');
  const joinPopDismiss = document.getElementById('joinPopDismiss');
  const joinPopCancel = document.getElementById('joinPopCancel');
  const joinPopDontShow = document.getElementById('joinPopDontShow');
  let pendingJoinRoom = null;

  function shouldSuppressJoinWarning(){
    try { return localStorage.getItem(LS_JOIN_WARNING) === '1'; }
    catch(e){ return false; }
  }

  function showJoinWarning(){
    if (!joinPop) return;
    joinWarningDismissed = false;
    if (joinPopDontShow) joinPopDontShow.checked = false;
    joinPop.style.display = 'block';
    joinPop.setAttribute('aria-modal', 'true');
    joinPop.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => {
      joinPop.classList.add('show');
      joinPopDismiss?.focus();
    });
  }

  function hideJoinWarning(){
    if (!joinPop) return;
    joinPop.classList.remove('show');
    joinPop.style.display = 'none';
    joinPop.setAttribute('aria-modal', 'false');
    joinPop.setAttribute('aria-hidden', 'true');
  }

  if (joinPopDismiss){
    joinPopDismiss.addEventListener('click', () => {
      if (joinPopDontShow && joinPopDontShow.checked){
        try { localStorage.setItem(LS_JOIN_WARNING, '1'); }
        catch(e){}
        joinWarningDismissed = true;
      } else {
        joinWarningDismissed = false;
      }
      hideJoinWarning();
      if (pendingJoinRoom) {
        const target = pendingJoinRoom;
        pendingJoinRoom = null;
        Promise.resolve(Collab.join(target)).catch(err => console.error('Join failed:', err));
      }
    });
  }

  if (joinPopCancel) {
    joinPopCancel.addEventListener('click', () => {
      pendingJoinRoom = null;
      hideJoinWarning();
      if (roomInput) {
        roomInput.value = '';
        roomInput.focus();
      }
    });
  }

  function maybeShowJoinWarning(){
    if (!joinPop || joinWarningDismissed) return;
    try { if (localStorage.getItem(LS_JOIN_WARNING) === '1') return; }
    catch(e){}
    if (joinPopDontShow) joinPopDontShow.checked = false;
    joinPop.style.display = 'block';
  }

  notifyNameChange = () => {
    renderPresenceList();
    Collab.updateStatus();
    if (Collab.isConnected() && !Collab.isApplying()){
      Collab.sendCursor(true);
    }
  };

  displayNameInput?.addEventListener('input', () => {
    const raw = displayNameInput.value || '';
    displayName = raw.trim();
    try { localStorage.setItem(LS_NAME, raw); } catch(e){}
    notifyNameChange();
  });

  broadcastCursorPosition = () => {
    updateSelfCaretCursor();
    if (Collab.isConnected() && !Collab.isApplying()){
      Collab.sendCursor();
    }
  };

  editor.addEventListener('select', broadcastCursorPosition);
  editor.addEventListener('keyup', broadcastCursorPosition);
  editor.addEventListener('mouseup', broadcastCursorPosition);
  editor.addEventListener('focus', () => {
    broadcastCursorPosition();
  });
  editor.addEventListener('blur', () => {
    hideSelfCaret();
  });

  const CollabModule = (() => {
    const config = { appId: 'latex-lab-trystero-v1' };
    let room = null;
    let roomName = '';
    let sendState = null;
    let unsubscribeState = null;
    let offJoin = null;
    let offLeave = null;
    const peers = new Set();
    const remoteClocks = new Map();
    let localClock = 0;
    let lastRemoteClock = 0;
    let applying = false;
    let joinRoomImpl = null;
    let loadPromise = null;
    const debuggedPeers = new Set();
    let isRoomOwner = false;
    let pendingInitialSync = false;
    let currentOwner = null;
    let hostId = null;

    let lastBroadcastText = editor.value || '';
    let lastBroadcastMode = mode;
    let lastBroadcastCursor = getCurrentCursor();
    let lastBroadcastName = '';
    let lastBroadcastColor = getSelfColorHex();

    let joinTimestamp = null;
    let hasReceivedInitialSync = false;
    let syncRequestCount = 0;
    const MAX_SYNC_REQUESTS = 3;
    let fullSyncPending = false;

    function resetBroadcastCache() {
      lastBroadcastText = editor.value || '';
      lastBroadcastMode = mode;
      lastBroadcastCursor = getCurrentCursor();
      lastBroadcastName = displayName.trim();
      lastBroadcastColor = getSelfColorHex();
      lastBroadcastMacrosJSON = JSON.stringify(normalizeMacros(MACROS));
    }

    function notifyHostAssigned(id) {
      hostId = id || null;
      isRoomOwner = hostId === CLIENT_ID;
      currentOwner = hostId;

      if (isRoomOwner) {
        pendingInitialSync = false;
        joinWarningDismissed = true;
        if (joinPop) joinPop.style.display = 'none';
        resetBroadcastCache();
      }

      updateStatus();
    }

    const capability = {
      secureContext: typeof isSecureContext !== 'undefined'
        ? (isSecureContext || ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname))
        : false,
      hasWebRTC: typeof RTCPeerConnection === 'function',
      hasCrypto: !!(globalThis.crypto && globalThis.crypto.subtle)
    };

    function preflightChecks() {
      const missing = [];
      if (!capability.secureContext) missing.push('secure origin');
      if (!capability.hasWebRTC) missing.push('WebRTC');
      if (!capability.hasCrypto) missing.push('WebCrypto');
      if (!missing.length) return true;
      setStatus('Unavailable: ' + missing.join(', '));
      setButton('disconnected');
      console.warn('[Collab] Collaboration disabled, missing:', missing);
      return false;
    }

    function setStatus(text) {
      if (collabStatus) collabStatus.textContent = text;
    }

    function setButton(state) {
      if (!roomJoinBtn) return;
      if (state === 'connected') {
        roomJoinBtn.textContent = 'Disconnect';
        roomJoinBtn.disabled = false;
      } else if (state === 'connecting') {
        roomJoinBtn.textContent = 'Connecting…';
        roomJoinBtn.disabled = true;
      } else {
        roomJoinBtn.textContent = 'Connect';
        roomJoinBtn.disabled = false;
      }
    }

    function updateStatus() {
      if (!room) {
        setStatus('Offline');
        return;
      }
      const count = peers.size;
      const peerLabel = count ? `${count} peer${count === 1 ? '' : 's'}` : 'solo';
      const hostLabel = isRoomOwner ? ' (host)' : '';
      setStatus(`Room ${roomName} · ${peerLabel}${hostLabel}`);
    }

    function emitInternal(kind, extra = {}) {
      if (!sendState) return;
      try {
        sendState({
          kind,
          clock: ++localClock,
          ts: Date.now(),
          from: CLIENT_ID,
          ...extra
        });
      } catch (err) {
        console.warn('[Collab] Failed to emit control message', kind, err);
      }
    }

    function updatePeerJoinTime(peerId, timestamp) {
      if (!peerId || typeof timestamp !== 'number' || !Number.isFinite(timestamp)) return;
      const normalized = Math.floor(timestamp);
      const key = resolvePeerKey(peerId) || peerId;
      const current = peerJoinTimes.get(key);
      if (current === normalized) return;
      peerJoinTimes.set(key, normalized);
      if (key === CLIENT_ID) joinTimestamp = normalized;
      evaluateHostElection('timestamp-update');
    }

    function clearPeerJoinTime(peerId) {
      if (!peerId) return;
      const key = resolvePeerKey(peerId) || peerId;
      let removed = peerJoinTimes.delete(key);
      if (peerId !== key && peerJoinTimes.delete(peerId)) removed = true;
      if (removed) {
        evaluateHostElection('timestamp-remove');
      }
    }

    function broadcastJoinInfo(requestReply = false) {
      if (typeof joinTimestamp !== 'number') return;
      const payload = {
        joinedAt: joinTimestamp,
        name: displayName.trim(),
        color: getSelfColorHex(),
        macros: normalizeMacros(MACROS)
      };
      if (requestReply) payload.requestReply = 1;
      emitInternal('hello', payload);
    }

    function scheduleFullSync(reason) {
      if (!room) return;
      fullSyncPending = true;
      maybeSendFullSync(reason);
    }

    function maybeSendFullSync(reason) {
      if (!fullSyncPending || !isRoomOwner) return;
      announceHost();
      sendFullState();
      fullSyncPending = false;
    }

    function evaluateHostElection(reason = 'update') {
      if (!room) return;
      if (!peers.size) {
        if (hostId !== null) {
          notifyHostAssigned(null);
          fullSyncPending = false;
        }
        return;
      }

      const localTs = typeof joinTimestamp === 'number' ? joinTimestamp : null;
      if (localTs === null) return;

      const candidates = [{ id: CLIENT_ID, ts: localTs }];
      for (const peerId of peers) {
        const key = resolvePeerKey(peerId) || peerId;
        const ts = peerJoinTimes.get(key);
        if (typeof ts !== 'number') {
          return;
        }
        candidates.push({ id: key, ts });
      }

      if (candidates.length < 2) {
        if (hostId !== null) {
          notifyHostAssigned(null);
          fullSyncPending = false;
        }
        return;
      }

      candidates.sort((a, b) => {
        if (a.ts !== b.ts) return a.ts - b.ts;
        if (a.id === b.id) return 0;
        return a.id < b.id ? -1 : 1;
      });

      const winner = candidates[0];
      if (!winner || !winner.id) return;

      if (hostId !== winner.id) {
        notifyHostAssigned(winner.id);
        if (isRoomOwner) {
          fullSyncPending = true;
        }
      }

      if (isRoomOwner) {
        maybeSendFullSync(reason);
      }
    }

    async function ensureTrystero() {
      if (joinRoomImpl) return joinRoomImpl;
      if (!loadPromise) {
        const sources = ['./trystero-mqtt.min.js'];
        loadPromise = (async () => {
          for (const url of sources) {
            try {
              const mod = await import(url);
              if (typeof window !== 'undefined') {
                window.__TrysteroModule = mod;
              }
              const candidate = mod?.joinRoom || mod?.default;
              if (typeof candidate === 'function') return candidate;
              console.warn('Trystero import missing joinRoom from', url);
            } catch (err) {
              console.warn('Trystero import failed from', url, err);
            }
          }
          return null;
        })();
      }
      const fn = await loadPromise;
      if (!fn) throw new Error('Trystero import failed');
      joinRoomImpl = fn;
      return joinRoomImpl;
    }

    function cleanup() {
      if (unsubscribeState) {
        try { unsubscribeState(); } catch(e) {}
        unsubscribeState = null;
      }
      if (offJoin) {
        try { offJoin(); } catch(e) {}
        offJoin = null;
      }
      if (offLeave) {
        try { offLeave(); } catch(e) {}
        offLeave = null;
      }
      if (room) {
        try { room.leave(); } catch(e) {}
        room = null;
      }
      sendState = null;
      roomName = '';
      peers.clear();
      remoteClocks.clear();
      debuggedPeers.clear();
      localClock = 0;
      lastRemoteClock = 0;
      applying = false;
      isRoomOwner = false;
      pendingInitialSync = false;
      currentOwner = null;
      hostId = null;
      joinWarningDismissed = false;
      joinTimestamp = null;
      peerJoinTimes.clear();
      fullSyncPending = false;
      hasReceivedInitialSync = false;
      syncRequestCount = 0;
      Array.from(remotePeers.keys()).forEach(removeRemotePeer);
      peerMeta.clear();
      peerAliases.clear();
      resetBroadcastCache();
      if (joinPop) joinPop.style.display = 'none';
      setButton('disconnected');
      updateStatus();
      renderPresenceList();
    }

    function replaceTextPreserveCaret(newText, delta = null) {
      if (editor.value === newText) return false;
      const wasFocused = (document.activeElement === editor);
      const prevStart = editor.selectionStart;
      const prevEnd = editor.selectionEnd;

      const adjust = (pos) => {
        if (!delta || typeof pos !== 'number') return pos;
        const { index = 0, remove = 0, insert = '' } = delta;
        const insertLen = (typeof insert === 'string') ? insert.length : 0;
        if (pos <= index) return pos;
        if (pos <= index + remove) return index + insertLen;
        return pos + insertLen - remove;
      };

      editor.value = newText;
      if (wasFocused) {
        const len = newText.length;
        const nextStart = Math.min(adjust(prevStart), len);
        const nextEnd = Math.min(adjust(prevEnd), len);
        editor.selectionStart = nextStart;
        editor.selectionEnd = nextEnd;
      }
      try { localStorage.setItem(LS_CONTENT, newText); } catch(e) {}
      return true;
    }

    function computeDelta(prev, next) {
      if (prev === next) return null;
      const prevLen = prev.length;
      const nextLen = next.length;
      let start = 0;
      while (start < prevLen && start < nextLen && prev.charCodeAt(start) === next.charCodeAt(start)) start++;
      let endPrev = prevLen;
      let endNext = nextLen;
      while (endPrev > start && endNext > start && prev.charCodeAt(endPrev - 1) === next.charCodeAt(endNext - 1)) {
        endPrev--;
        endNext--;
      }
      const remove = endPrev - start;
      const insert = next.slice(start, endNext);
      return {
        delta: { index: start, remove, insert },
        baseLength: prevLen,
        resultLength: nextLen
      };
    }

    function applyDelta(base, delta) {
      const { index, remove, insert } = delta || {};
      if (typeof index !== 'number' || typeof remove !== 'number' || index < 0 || remove < 0 || index > base.length) {
        throw new Error('Invalid delta');
      }
      const prefix = base.slice(0, index);
      const toRemove = base.slice(index, index + remove);
      if (toRemove.length !== remove) {
        throw new Error('Delta remove range out of bounds');
      }
      const suffix = base.slice(index + remove);
      return prefix + (insert || '') + suffix;
    }

    function requestSync() {
      if (!sendState || syncRequestCount >= MAX_SYNC_REQUESTS) return;
      syncRequestCount++;
      try {
        sendState({
          kind: 'request',
          clock: ++localClock,
          ts: Date.now(),
          from: CLIENT_ID,
          cursor: getCurrentCursor(),
          name: displayName.trim()
        });
      } catch(e) {
        console.error('[Collab] Failed to send sync request', e);
      }
    }

    function handleState(payload = {}, peerId) {
      if (!payload) return;
      const source = peerId || payload.sender || 'remote';
      const senderId = payload.from || null;

      let aliasTarget = null;
      if (peerId && senderId && peerId !== senderId) {
        aliasTarget = linkPeerAlias(peerId, senderId);
      }

      const keyCandidate = senderId || peerId || source;
      const targetKey = resolvePeerKey(keyCandidate);
      const safeKey = targetKey || keyCandidate || source;

      if (aliasTarget) evaluateHostElection('alias-link');

      if (senderId && senderId === CLIENT_ID) return;

      if (typeof payload.color === 'string') {
        updatePeerColor(safeKey, payload.color);
      }

      if (payload.kind === 'macros') {
        const reason = payload.reason || '';
        const fromHost = payload.owner === 1;
        const replaceReasons = new Set(['save','reset','save-empty','union','hello-union']);
        let changed = false;
        if (fromHost || replaceReasons.has(reason)) {
          changed = replaceMacrosFromPeer(payload.macros);
        } else {
          changed = mergeMacrosFromPeer(payload.macros);
        }
        if (changed) {
          lastBroadcastMacrosJSON = JSON.stringify(normalizeMacros(MACROS));
          resetBroadcastCache();
          if (isRoomOwner && !fromHost && !replaceReasons.has(reason)) {
            sendMacros('union');
          }
        }
        return;
      }

      if (payload.kind === 'request') {
        if (typeof payload.name === 'string') updatePeerName(safeKey, payload.name);
        if (payload.cursor) updateRemoteCursor(safeKey, payload.cursor);

        if (isRoomOwner && !pendingInitialSync) {
          sendFullState();
        }
        sendCursorState(true);
        return;
      }

      if (payload.kind === 'hello') {
        if (typeof payload.name === 'string') updatePeerName(safeKey, payload.name);
        if (typeof payload.joinedAt === 'number') updatePeerJoinTime(senderId || safeKey, payload.joinedAt);
        if (payload.macros && mergeMacrosFromPeer(payload.macros) && isRoomOwner) {
          sendMacros('hello-union');
        }
        if (payload.requestReply && senderId) {
          broadcastJoinInfo(false);
        }
        evaluateHostElection('hello');
        return;
      }

      if (payload.kind === 'host_announce') {
        if (typeof payload.host === 'string' && typeof payload.joinedAt === 'number') {
          updatePeerJoinTime(payload.host, payload.joinedAt);
        }
        evaluateHostElection('announce');
        return;
      }

      const prev = remoteClocks.get(safeKey) || 0;
      if (typeof payload.clock === 'number') {
        if (payload.clock <= prev) return;
        remoteClocks.set(safeKey, payload.clock);
        if (payload.clock > lastRemoteClock) lastRemoteClock = payload.clock;
      }

      if (payload.kind === 'full' && payload.owner === 1) {
        if (typeof payload.host === 'string' && typeof payload.joinedAt === 'number') {
          updatePeerJoinTime(payload.host, payload.joinedAt);
        }
        notifyHostAssigned(payload.host);
        hasReceivedInitialSync = true;
        pendingInitialSync = false;
        syncRequestCount = 0;
        evaluateHostElection('full');

        applying = true;
        try {
          applyRemoteState(payload, safeKey);
        } finally {
          applying = false;
        }
        if (!isRoomOwner) {
          sendCursorState(true);
        }
        return;
      }

      if (payload.kind === 'cursor') {
        if (typeof payload.name === 'string') updatePeerName(safeKey, payload.name);
        if (payload.cursor) updateRemoteCursor(safeKey, payload.cursor);
        return;
      }

      if (payload.kind === 'delta') {
        if (typeof payload.host === 'string' && typeof payload.joinedAt === 'number') {
          updatePeerJoinTime(payload.host, payload.joinedAt);
        }
        if (hasReceivedInitialSync) {
          applying = true;
          try {
            applyRemoteState(payload, safeKey);
          } finally {
            applying = false;
          }
        }
        return;
      }

      if (pendingInitialSync && !joinWarningDismissed) {
        maybeShowJoinWarning();
      }
    }

    function announceHost() {
      if (!sendState || !isRoomOwner) return;
      emitInternal('host_announce', {
        host: CLIENT_ID,
        joinedAt: joinTimestamp
      });
    }

    function attachPeerDebug(peerId) {
      if (!room || debuggedPeers.has(peerId)) return;
      const peersMap = room.getPeers?.();
      const entry = peersMap ? peersMap[peerId] : null;
      if (!entry || !entry.connection) return;
      const pc = entry.connection;
      debuggedPeers.add(peerId);
      const idLabel = peerId ? peerId.slice(0, 6) : 'unknown';
      const prefix = `[Collab ${idLabel}]`;
      const logConn = () => console.log(prefix, 'connectionstate', pc.connectionState);
      const logIce = () => console.log(prefix, 'iceconnectionstate', pc.iceConnectionState);
      const logGather = () => console.log(prefix, 'icegatheringstate', pc.iceGatheringState);
      pc.addEventListener('connectionstatechange', logConn);
      pc.addEventListener('iceconnectionstatechange', logIce);
      pc.addEventListener('icegatheringstatechange', logGather);
      logConn();
      logIce();
      logGather();
    }

    function applyRemoteState(data, peerId) {
      let needsRender = false;
      let textChanged = false;
      let stateChanged = false;

      if (typeof data.owner === 'number' && data.owner === 1) {
        const hostCandidate = data.host || peerId || null;
        notifyHostAssigned(hostCandidate);
        pendingInitialSync = false;
        joinWarningDismissed = true;
        if (joinPop) joinPop.style.display = 'none';
      }

      if (typeof data.text === 'string') {
        if (replaceTextPreserveCaret(data.text)) {
          needsRender = true;
          textChanged = true;
        }
      } else if (data.delta) {
        const base = editor.value;
        if (typeof data.baseLength === 'number' && data.baseLength !== base.length) {
          requestSync();
          return;
        }
        try {
          const applied = applyDelta(base, data.delta);
          if (typeof data.resultLength === 'number' && data.resultLength !== applied.length) {
            throw new Error('result length mismatch');
          }
          if (replaceTextPreserveCaret(applied, data.delta)) {
            needsRender = true;
            textChanged = true;
          }
        } catch(err) {
          requestSync();
          return;
        }
      }

      if (data.macros && typeof data.macros === 'object') {
        mergeMacrosFromPeer(data.macros);
      }

      if (data.mode === 'classic' || data.mode === 'mixed') {
        if (mode !== data.mode) {
          mode = data.mode;
          modeToggle.checked = (mode === 'classic');
          document.body.classList.toggle('mixed', mode === 'mixed');
          document.body.classList.toggle('classic', mode === 'classic');
          modeLabel.textContent = (mode === 'classic') ? 'Classic' : 'Mixed';
          modeDesc.textContent  = (mode === 'classic') ?
            'Classic: each new line is rendered as display math.' :
            'Mixed: type text with $inline$ and $$display$$ math.';
          editor.placeholder = (mode === 'classic') ?
            'Type lines of pure TeX; each line renders as display math' :
            'Type text with $inline$ and $$display$$ math';
          try { localStorage.setItem(LS_MODE, mode); } catch(e) {}
          needsRender = true;
          stateChanged = true;
        }
      }

      if (typeof data.name === 'string') updatePeerName(peerId, data.name);
      else if (peerId) ensurePeerMeta(peerId);
      if (data.cursor) updateRemoteCursor(peerId, data.cursor);

      if (textChanged || stateChanged) {
        pendingInitialSync = false;
        joinWarningDismissed = true;
        if (joinPop) joinPop.style.display = 'none';
        resetBroadcastCache();
      }

      if (needsRender) {
        render();
        updateAllRemoteCarets();
      } else if (textChanged) {
        updateAllRemoteCarets();
      }
    }

    function buildFullPayload() {
      return {
        kind: 'full',
        text: editor.value,
        mode,
        cursor: getCurrentCursor(),
        name: displayName.trim(),
        color: getSelfColorHex(),
        owner: isRoomOwner ? 1 : 0,
        host: isRoomOwner ? CLIENT_ID : (hostId || null),
        joinedAt: joinTimestamp,
        from: CLIENT_ID,
        macros: normalizeMacros(MACROS)
      };
    }

    function buildDeltaPayload() {
      const current = editor.value;
      const payload = {
        kind: 'delta',
        owner: isRoomOwner ? 1 : 0,
        host: isRoomOwner ? CLIENT_ID : (hostId || null)
      };
      if (isRoomOwner && typeof joinTimestamp === 'number') {
        payload.joinedAt = joinTimestamp;
      }
      let include = false;

      const selfColor = getSelfColorHex();
      if (selfColor !== lastBroadcastColor) {
        payload.color = selfColor;
        include = true;
      }

      const deltaInfo = computeDelta(lastBroadcastText, current);
      if (deltaInfo) {
        payload.delta = deltaInfo.delta;
        payload.baseLength = deltaInfo.baseLength;
        payload.resultLength = deltaInfo.resultLength;
        include = true;
      }

      if (mode !== lastBroadcastMode) {
        payload.mode = mode;
        include = true;
      }

      const trimmedName = displayName.trim();
      if (trimmedName !== lastBroadcastName) {
        payload.name = trimmedName;
        include = true;
      }

      const cursor = getCurrentCursor();
      if (cursor.start !== lastBroadcastCursor.start || cursor.end !== lastBroadcastCursor.end) {
        payload.cursor = cursor;
        include = true;
      }

      return include ? payload : null;
    }

    function buildCursorPayload(force = false) {
      const cursor = getCurrentCursor();
      const trimmedName = displayName.trim();
      const cursorChanged = cursor.start !== lastBroadcastCursor.start || cursor.end !== lastBroadcastCursor.end;
      const nameChanged = trimmedName !== lastBroadcastName;
      const selfColor = getSelfColorHex();
      const colorChanged = selfColor !== lastBroadcastColor;
      if (!force && !cursorChanged && !nameChanged && !colorChanged) return null;
      const payload = { kind: 'cursor', cursor, name: trimmedName };
      if (colorChanged || force) payload.color = selfColor;
      return payload;
    }

    function sendPayload(payload) {
      if (!payload || !sendState || applying) return;
      if (applying && payload.kind !== 'cursor') return;
      try {
        payload.from = CLIENT_ID;
        payload.clock = ++localClock;
        payload.ts = Date.now();
        sendState(payload);

        const trimmedName = displayName.trim();
        if (payload.cursor) {
          lastBroadcastCursor = {
            start: payload.cursor.start || 0,
            end: payload.cursor.end || 0
          };
        }
        if (typeof payload.name === 'string') {
          lastBroadcastName = payload.name;
        } else if (payload.kind === 'full' || payload.kind === 'delta') {
          lastBroadcastName = trimmedName;
        }
        if (typeof payload.color === 'string') {
          const normalizedColor = normalizeHex(payload.color);
          lastBroadcastColor = normalizedColor || payload.color;
        } else if (payload.kind === 'full' || payload.kind === 'delta') {
          lastBroadcastColor = getSelfColorHex();
        }
        if (payload.kind === 'full' || payload.kind === 'delta') {
          lastBroadcastText = editor.value;
          lastBroadcastMode = mode;
        }
        if (payload.macros && typeof payload.macros === 'object') {
          lastBroadcastMacrosJSON = JSON.stringify(normalizeMacros(payload.macros));
        }
      } catch (err) {
        console.warn('Collab send failed', err);
      }
    }

    function sendFullState() {
      if (!sendState || !isRoomOwner) return;
      const payload = buildFullPayload();
      sendPayload(payload);
    }

    function sendDeltaState() {
      if (pendingInitialSync) return;
      const payload = buildDeltaPayload();
      if (payload) {
        if (payload.delta) shiftRemoteCarets(payload.delta);
        sendPayload(payload);
      }
    }

    function sendCursorState(force = false) {
      const payload = buildCursorPayload(force);
      if (payload) sendPayload(payload);
    }

    function sendMacros(reason = 'update') {
      const normalized = normalizeMacros(MACROS);
      const json = JSON.stringify(normalized);
      if (json === lastBroadcastMacrosJSON && reason === 'update') return;
      const payload = {
        kind: 'macros',
        macros: normalized,
        owner: isRoomOwner ? 1 : 0,
        reason
      };
      sendPayload(payload);
      lastBroadcastMacrosJSON = json;
    }

    async function join(name) {
      const trimmed = (name || '').trim();
      if (!trimmed) {
        alert('Enter a room code to connect.');
        return;
      }

      if (room && trimmed === roomName) {
        updateStatus();
        return;
      }

      if (!preflightChecks()) return;

      cleanup();
      roomName = trimmed;
      if (roomInput) roomInput.value = trimmed;
      setButton('connecting');
      setStatus('Connecting…');

      try {
        const joinRoomFn = await ensureTrystero();
        room = await joinRoomFn(config, trimmed);
        joinTimestamp = Date.now();
        peerJoinTimes.clear();
        peerJoinTimes.set(CLIENT_ID, joinTimestamp);
        fullSyncPending = false;
      } catch (err) {
        room = null;
        roomName = '';
        joinTimestamp = null;
        const msg = err && err.message === 'Trystero import failed'
          ? 'Trystero unavailable'
          : 'Connection failed';
        setStatus(msg);
        setButton('disconnected');
        return;
      }

      if (!room || typeof room.makeAction !== 'function') {
        room = null;
        roomName = '';
        joinTimestamp = null;
        setStatus('Trystero unavailable');
        setButton('disconnected');
        return;
      }

      peers.clear();
      const existingPeers = room.getPeers?.() || {};
      const existingIds = Object.keys(existingPeers);
      existingIds.forEach(id => {
        peers.add(id);
        ensurePeerMeta(id);
      });

      notifyHostAssigned(null);
      if (existingIds.length === 0) {
        hasReceivedInitialSync = true;
        pendingInitialSync = false;
      } else {
        hasReceivedInitialSync = false;
        pendingInitialSync = true;
      }

      updateStatus();
      evaluateHostElection('post-join');

      const [send, onState] = room.makeAction('state');
      sendState = (payload) => send(payload);
      unsubscribeState = onState((payload, peerId) => handleState(payload, peerId));
      broadcastJoinInfo(true);
      setTimeout(() => broadcastJoinInfo(true), 250);

      offJoin = room.onPeerJoin((peerId) => {
        peers.add(peerId);
        ensurePeerMeta(peerId);
        renderPresenceList();
        updateStatus();
        attachPeerDebug(peerId);
        evaluateHostElection('peer-join-event');
        scheduleFullSync('peer-join');
        setTimeout(() => broadcastJoinInfo(true), 100);
      });

      offLeave = room.onPeerLeave((peerId) => {
        peers.delete(peerId);
        const canonical = resolvePeerKey(peerId);
        const aliasKeys = [];
        peerAliases.forEach((target, alias) => {
          if (alias === canonical || target === canonical) aliasKeys.push(alias);
        });
        clearPeerJoinTime(peerId);
        removeRemotePeer(peerId);
        remoteClocks.delete(peerId);
        if (canonical) remoteClocks.delete(canonical);
        aliasKeys.forEach(alias => remoteClocks.delete(alias));
        if (!peers.size) {
          notifyHostAssigned(null);
          fullSyncPending = false;
          hasReceivedInitialSync = true;
          pendingInitialSync = false;
        } else {
          evaluateHostElection('peer-leave-event');
        }
        updateStatus();
      });

      setButton('connected');
      updateStatus();
      resetBroadcastCache();

      if (peers.size) {
        setTimeout(() => {
          requestSync();
        }, 300);
      }

      sendCursorState(true);
      sendMacros('join');

      try {
        localStorage.setItem(LS_ROOM, roomName);
      } catch(e) {}
    }

    const debugApi = {
      getModule: () => joinRoomImpl,
      getRelaySockets: () => joinRoomImpl?.getRelaySockets?.(),
      getPeers: () => room?.getPeers?.(),
      printPeerStates: () => {
        const map = room?.getPeers?.() || {};
        Object.entries(map).forEach(([id, peer]) => {
          const pc = peer.connection;
          if (!pc) return;
          console.log(`[Collab ${id.slice(0,6)}]`, {
            connectionState: pc.connectionState,
            iceConnectionState: pc.iceConnectionState,
            iceGatheringState: pc.iceGatheringState,
            signalingState: pc.signalingState
          });
        });
      },
      capabilities: { ...capability },
      getHostInfo: () => ({
        hostId,
        isRoomOwner,
        hasReceivedInitialSync,
        pendingInitialSync,
        joinTimestamp,
        peers: [...peers]
      })
    };

    if (typeof window !== 'undefined') {
      window.CollabDebug = debugApi;
    }

    return {
      join,
      leave: () => {
        cleanup();
        try { localStorage.removeItem(LS_ROOM); } catch(e){}
      },
      sendDelta: () => sendDeltaState(),
      sendFull: () => sendFullState(),
      sendCursor: (force = false) => sendCursorState(force),
      sendMacros: (reason) => sendMacros(reason ?? 'manual'),
      isConnected: () => !!room,
      isApplying: () => applying,
      cleanup,
      updateStatus,
      debug: debugApi,
      requestSync
    };
  })();

  Collab = CollabModule;

  const shareRoomBtn = document.getElementById('shareRoomBtn');

  (function setupUrlRoomParser() {
    const urlParams = new URLSearchParams(window.location.search);
    const roomFromUrl = urlParams.get('room');

    if (roomFromUrl && roomFromUrl.trim()) {
      window.addEventListener('load', () => {
        setTimeout(() => {
          if (!Collab.isConnected()) {
            roomInput.value = roomFromUrl;
            roomJoinBtn.click();
          }
        }, 500);
      });
    }

    function updateShareButton() {
      if (shareRoomBtn) {
        shareRoomBtn.style.display = Collab.isConnected() ? 'inline-block' : 'none';
      }
    }

    if (shareRoomBtn) {
      shareRoomBtn.addEventListener('click', () => {
        const roomName = roomInput.value.trim();
        if (!roomName) return;

        const url = new URL(window.location.href);
        url.searchParams.set('room', roomName);
        const shareUrl = url.toString();

        if (navigator.clipboard && window.isSecureContext) {
          navigator.clipboard.writeText(shareUrl).then(() => {
            const original = shareRoomBtn.textContent;
            shareRoomBtn.textContent = '✓ Copied!';
            setTimeout(() => {
              shareRoomBtn.textContent = original;
            }, 2000);
          }).catch(() => {
            prompt('Copy this link to share the room:', shareUrl);
          });
        } else {
          prompt('Copy this link to share the room:', shareUrl);
        }
      });
    }

    const originalUpdateStatus = Collab.updateStatus;
    Collab.updateStatus = function() {
      originalUpdateStatus.call(this);
      updateShareButton();
    };

    const originalJoin = Collab.join;
    Collab.join = async function(...args) {
      const result = await originalJoin.call(this, ...args);
      updateShareButton();
      return result;
    };

    const originalLeave = Collab.leave;
    Collab.leave = function() {
      originalLeave.call(this);
      updateShareButton();
    };
  })();

  roomInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') roomJoinBtn.click(); });
  roomJoinBtn?.addEventListener('click', async () => {
    if (Collab.isConnected()) {
      Collab.leave();
      return;
    }
    const target = roomInput.value.trim();
    if (shouldSuppressJoinWarning()) {
      await Collab.join(target);
      return;
    }
    if (!target) {
      await Collab.join(target);
      return;
    }
    if (joinPop && joinPop.style.display === 'block') return;
    pendingJoinRoom = target;
    showJoinWarning();
  });

  window.addEventListener('beforeunload', () => {
    if (Collab.isConnected()) Collab.cleanup();
  });

  if (shouldSuppressJoinWarning()) joinWarningDismissed = true;

  Collab.updateStatus();
}

/* =====================
   Snippets (matrix / table / cases)
   ===================== */
function openMatrix(){ updateMatrixPreview(); matrixModal.classList.add('show'); }
function openTable(){ updateTablePreview(); tableModal.classList.add('show'); }

function matrixPreviewText(r, c, type){
  const rows = Array.from({ length: r }, () => Array.from({ length: c }, () => '◻').join(' & ')).join(' \\\\ ');
  return `\\begin{${type}} ${rows} \\end{${type}}`;
}
function matrixInsertText(r, c, type){
  const rows = Array.from({ length: r }, () => Array.from({ length: c }, () => '').join(' & ')).join(' \\\\ ');
  return `\\begin{${type}} ${rows} \\end{${type}}`;
}
function updateMatrixPreview(){
  const r = clampInt(mRows.value, 1, 20), c = clampInt(mCols.value, 1, 20);
  matrixPrev.textContent = matrixPreviewText(r, c, mType.value);
}
function insertMatrix(){
  const r = clampInt(mRows.value, 1, 20), c = clampInt(mCols.value, 1, 20);
  const core = matrixInsertText(r, c, mType.value);
  const inMixed = document.body.classList.contains('mixed');
  const snippet = inMixed ? `$$${core}$$` : core;
  insertAtCursor(snippet);
  matrixModal.classList.remove('show');
}

function insertCases(){
  const core = '\\begin{cases}  &  \\\\  &  \\end{cases}';
  const inMixed = document.body.classList.contains('mixed');
  const snippet = inMixed ? `$$${core}$$` : core;
  insertAtCursor(snippet);
  snippetsMenu?.classList.remove('open');
}

mRows?.addEventListener('input', updateMatrixPreview);
mCols?.addEventListener('input', updateMatrixPreview);
mType?.addEventListener('change', updateMatrixPreview);

function arrayColSpec(align, cols, borders){
  let spec = align.repeat(cols);
  if (borders === 'all') spec = '|' + spec.split('').join('|') + '|';
  else if (borders === 'outer') spec = '|' + spec + '|';
  return spec;
}
function buildTableString(r, c, align, borders, cellFill){
  const spec = arrayColSpec(align, c, borders);
  const rowCells = Array.from({ length: c }, () => cellFill).join(' & ');

  const drawOuter = borders !== 'none';
  const drawInner = borders === 'all';

  const parts = [];
  if (drawOuter) parts.push('\\hline');

  for (let i = 0; i < r; i++){
    const last = (i === r - 1);
    parts.push(rowCells);

    if (!last){
      parts.push(drawInner ? '\\\\ \\hline' : '\\\\');
    } else if (drawOuter){
      parts.push('\\\\ \\hline');
    }
  }

  return `\\begin{array}{${spec}} ${parts.join(' ')} \\end{array}`;
}

function tablePreviewText(r, c, align, borders){
  return buildTableString(r, c, align, borders, '◻');
}

function tableInsertText(r, c, align, borders){
  return buildTableString(r, c, align, borders, '');
}

function updateTablePreview(){
  const r = clampInt(tRows.value, 1, 40), c = clampInt(tCols.value, 1, 20);
  tablePrev.textContent = tablePreviewText(r, c, tAlign.value, tBorders.value);
}

function insertTable(){
  const r = clampInt(tRows.value, 1, 40), c = clampInt(tCols.value, 1, 20);
  const core = tableInsertText(r, c, tAlign.value, tBorders.value);
  const inMixed = document.body.classList.contains('mixed');
  const snippet = inMixed ? `$$${core}$$` : core;
  insertAtCursor(snippet);
  tableModal.classList.remove('show');
}

tRows?.addEventListener('input', updateTablePreview);
tCols?.addEventListener('input', updateTablePreview);
tAlign?.addEventListener('change', updateTablePreview);
tBorders?.addEventListener('change', updateTablePreview);

function clampInt(v, min, max){
  v = parseInt(v || min, 10);
  return Math.max(min, Math.min(max, isNaN(v) ? min : v));
}

function insertAtCursor(text){
  const el = editor;
  const start = el.selectionStart, end = el.selectionEnd;
  el.value = el.value.slice(0, start) + text + el.value.slice(end);
  el.selectionStart = el.selectionEnd = start + text.length;
  el.focus();
  render();
  updateAllRemoteCarets();
  try { localStorage.setItem(LS_CONTENT, el.value); } catch(e){}
  if (!Collab.isApplying()) Collab.sendDelta();
  broadcastCursorPosition();
}

/* =====================
   Exporter
   ===================== */
const Exporter = (() => {
  const EXPORT_SCALE = 8;
  const PADDING = { top: 100, bottom: 100, sides: 100 };
  const raf = () => new Promise(r => requestAnimationFrame(r));

  class FontLoadError extends Error {
    constructor(message){ super(message); this.name = 'FontLoadError'; }
  }

  function triggerDownload(url, filename){
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function ff(family, file, weight=400, style='normal'){
    return `@font-face{font-family:${family};src:url(https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/fonts/${file}.woff2) format("woff2");font-weight:${weight};font-style:${style};font-display:swap;}`;
  }

  function buildFontFaceStyleEl(){
    const css = [
      ff('KaTeX_Main','KaTeX_Main-Regular',400,'normal'),
      ff('KaTeX_Main','KaTeX_Main-Italic', 400,'italic'),
      ff('KaTeX_Main','KaTeX_Main-Bold',   700,'normal'),
      ff('KaTeX_Main','KaTeX_Main-BoldItalic',700,'italic'),
      ff('KaTeX_Math','KaTeX_Math-Italic', 400,'italic'),
      ff('KaTeX_Math','KaTeX_Math-BoldItalic',700,'italic'),
      ff('KaTeX_AMS','KaTeX_AMS-Regular'),
      ff('KaTeX_Caligraphic','KaTeX_Caligraphic-Regular'),
      ff('KaTeX_Caligraphic','KaTeX_Caligraphic-Bold',700),
      ff('KaTeX_Fraktur','KaTeX_Fraktur-Regular'),
      ff('KaTeX_SansSerif','KaTeX_SansSerif-Regular'),
      ff('KaTeX_SansSerif','KaTeX_SansSerif-Bold',700),
      ff('KaTeX_SansSerif','KaTeX_SansSerif-Italic',400,'italic'),
      ff('KaTeX_Script','KaTeX_Script-Regular'),
      ff('KaTeX_Typewriter','KaTeX_Typewriter-Regular'),
      ff('KaTeX_Size1','KaTeX_Size1-Regular'),
      ff('KaTeX_Size2','KaTeX_Size2-Regular'),
      ff('KaTeX_Size3','KaTeX_Size3-Regular'),
      ff('KaTeX_Size4','KaTeX_Size4-Regular'),
      '@font-face{font-family:"CMU Serif"; src:url(https://cdn.jsdelivr.net/npm/computer-modern@0.1.3/fonts/cmu-serif-500-roman.woff2) format("woff2"); font-weight:500; font-style:normal; font-display:swap;}',
      '@font-face{font-family:"CMU Serif"; src:url(https://cdn.jsdelivr.net/npm/computer-modern@0.1.3/fonts/cmu-serif-500-italic.woff2) format("woff2"); font-weight:500; font-style:italic; font-display:swap;}',
      '@font-face{font-family:"CMU Serif"; src:url(https://cdn.jsdelivr.net/npm/computer-modern@0.1.3/fonts/cmu-serif-700-roman.woff2) format("woff2"); font-weight:700; font-style:normal; font-display:swap;}',
      '@font-face{font-family:"CMU Serif"; src:url(https://cdn.jsdelivr.net/npm/computer-modern@0.1.3/fonts/cmu-serif-700-italic.woff2) format("woff2"); font-weight:700; font-style:italic; font-display:swap;}'
    ].join('\n');
    const el = document.createElement('style');
    el.type = 'text/css';
    el.appendChild(document.createTextNode(css));
    return el;
  }

  function createSandbox(bg){
    const sandbox = document.createElement('div');
    Object.assign(sandbox.style, { position:'fixed', left:'0', top:'0', opacity:'0', pointerEvents:'none', display:'inline-block', background:bg });
    sandbox.appendChild(buildFontFaceStyleEl());
    const webkitFillFix = document.createElement('style');
    webkitFillFix.textContent = `.export-scope, .export-scope * { -webkit-text-fill-color: currentColor !important; }`;
    sandbox.appendChild(webkitFillFix);
    const wrapper = document.createElement('div');
    wrapper.className = 'export-scope';
    wrapper.style.display = 'inline-block';
    wrapper.style.whiteSpace = 'pre-wrap';
    wrapper.style.tabSize = '4';
    sandbox.appendChild(wrapper);
    return { sandbox, wrapper };
  }

  function applyPreviewStyles(wrapper, scale){
    const cps = getComputedStyle(preview);
    const baseSizePx = parseFloat(cps.fontSize) || 16;
    const baseLHpx = cps.lineHeight.endsWith('px') ? parseFloat(cps.lineHeight) : baseSizePx * 1.5;
    const textColor = cps.color || '#111';

    wrapper.style.fontFamily = cps.fontFamily;
    wrapper.style.color = textColor;
    wrapper.style.webkitTextFillColor = textColor;
    wrapper.style.backgroundColor = cps.backgroundColor;
    wrapper.style.fontKerning = 'normal';
    wrapper.style.fontFeatureSettings = '"kern" 1';
    wrapper.style.textRendering = 'optimizeLegibility';
    wrapper.style.whiteSpace = 'pre-wrap';
    wrapper.style.tabSize = '4';
    wrapper.style.fontSize = (baseSizePx * scale) + 'px';
    wrapper.style.lineHeight = (baseLHpx * scale) + 'px';
    wrapper.style.padding = `${PADDING.top}px ${PADDING.sides}px ${PADDING.bottom}px ${PADDING.sides}px`;

    const editorRect = (typeof editor.getBoundingClientRect === 'function') ? editor.getBoundingClientRect() : null;
    const editorWidth = (editorRect && typeof editorRect.width === 'number') ? editorRect.width : (editor.clientWidth || 0);
    if (editorWidth > 0){
      const contentWidth = Math.max(1, Math.round(editorWidth * scale) - (PADDING.sides * 2));
      wrapper.style.width = `${contentWidth}px`;
    } else {
      wrapper.style.removeProperty('width');
    }
  }

  function isMeaningfulNode(el){
    if (!el) return false;
    if (el.querySelector && el.querySelector('.katex')) return true;
    return (el.textContent || '').trim().length > 0;
  }

  function trimLeadingTrailingBlanks(container){
    const children = Array.from(container.children);
    let start = 0;
    let end = children.length - 1;
    while (start <= end && !isMeaningfulNode(children[start])) start++;
    while (end >= start && !isMeaningfulNode(children[end])) end--;
    for (let i = 0; i < start; i++) container.removeChild(children[i]);
    for (let i = children.length - 1; i > end; i--) container.removeChild(children[i]);
  }

  function populateWrapper(wrapper){
    const clone = preview.cloneNode(true);
    while (clone.firstChild) wrapper.appendChild(clone.firstChild);
    wrapper.querySelectorAll('.katex-display').forEach(el => {
      el.style.marginTop = '0';
      el.style.marginBottom = '0';
    });
    wrapper.querySelectorAll('img, canvas').forEach(el => {
      el.style.display = 'inline-block';
      el.style.verticalAlign = 'baseline';
    });
    trimLeadingTrailingBlanks(wrapper);
  }

  async function ensureFontsReady(timeout = 1200){
    const probe = document.createElement('div');
    Object.assign(probe.style, { position:'fixed', left:'-9999px', top:'0', opacity:'0', pointerEvents:'none' });
    const families = [ '"CMU Serif"', 'KaTeX_Main','KaTeX_Math','KaTeX_AMS','KaTeX_SansSerif','KaTeX_Script','KaTeX_Fraktur','KaTeX_Typewriter','KaTeX_Caligraphic' ];
    probe.innerHTML = families.map(f => `<span style="font-family:${f};font-weight:400">A1</span>`).join('');
    document.body.appendChild(probe);
    let timeoutId;
    try {
      if (document.fonts && document.fonts.ready){
        await Promise.race([
          document.fonts.ready,
          new Promise((_, reject) => { timeoutId = setTimeout(() => reject(new FontLoadError('Timed out waiting for fonts')), timeout); })
        ]);
      } else {
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      probe.remove();
    }
  }

  async function settleLayout(){
    await raf();
    await raf();
    if (document.fonts && document.fonts.ready){
      try { await Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 500))]); } catch {}
    }
  }

  function dataUrlToBlob(dataUrl){
    const [meta, b64] = dataUrl.split(',');
    const mime = (meta.match(/data:([^;]+)/) || [, 'image/png'])[1];
    const bin = atob(b64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return new Blob([u8], { type: mime });
  }

  async function canvasToBlobUrl(canvas){
    return new Promise((resolve, reject) => {
      if (canvas.toBlob){
        canvas.toBlob(blob => {
          if (!blob){ reject(new Error('Canvas export returned empty blob.')); return; }
          resolve(URL.createObjectURL(blob));
        }, 'image/png');
      } else {
        try {
          const dataUrl = canvas.toDataURL('image/png');
          resolve(URL.createObjectURL(dataUrlToBlob(dataUrl)));
        } catch (err) {
          reject(err);
        }
      }
    });
  }

  function stampName(ext){
    const d = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `latex-lab-${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}-${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}.${ext}`;
  }

  async function renderToObjectUrl(wrapper, dims, bg, sandbox){
    if (window.htmlToImage?.toPng){
      try {
        const dataUrl = await window.htmlToImage.toPng(wrapper, { pixelRatio: 1, backgroundColor: bg, cacheBust: true, width: dims.width, height: dims.height, fetchRequestInit: { mode: 'cors', credentials: 'omit' }, style: { transform: 'none' } });
        return URL.createObjectURL(dataUrlToBlob(dataUrl));
      } catch (err) {
        console.warn('html-to-image export failed, falling back to canvas render:', err);
      }
    }

    try {
      const canvas = await html2canvas(wrapper, { backgroundColor: bg, scale: 1, width: dims.width, height: dims.height, useCORS: true, foreignObjectRendering: false });
      return await canvasToBlobUrl(canvas);
    } catch (err) {
      const canvas = await html2canvas(sandbox, { backgroundColor: bg, scale: 1, useCORS: true, foreignObjectRendering: false });
      return await canvasToBlobUrl(canvas);
    }
  }

  async function exportPNG(){
    const bg = getComputedStyle(preview).backgroundColor || getComputedStyle(document.body).backgroundColor;
    const { sandbox, wrapper } = createSandbox(bg);
    document.body.appendChild(sandbox);
    try {
      applyPreviewStyles(wrapper, Math.max(1, EXPORT_SCALE | 0));
      populateWrapper(wrapper);
      if (!Array.from(wrapper.children).some(isMeaningfulNode)){
        alert('Nothing to export yet — add some text or math first.');
        return;
      }
      await ensureFontsReady();
      await settleLayout();
      const rect = wrapper.getBoundingClientRect();
      const dims = { width: Math.ceil(rect.width), height: Math.ceil(rect.height) };
      if (dims.width <= 0 || dims.height <= 0) throw new Error('Preview is empty after layout.');
      const blobUrl = await renderToObjectUrl(wrapper, dims, bg, sandbox);
      triggerDownload(blobUrl, stampName('png'));
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1500);
    } catch (err) {
      if (err instanceof FontLoadError){
        alert('PNG export is waiting for fonts to finish loading. Give it a moment and try again.');
      } else {
        console.error('PNG export failed:', err);
        alert('PNG export failed. Check the console for details.');
      }
    } finally {
      sandbox.remove();
    }
  }

  return { exportPNG };
})();

pngBtn?.addEventListener('click', () => Exporter.exportPNG());

clearBtn?.addEventListener('click', () => {
  if (!confirm('Clear editor and saved text?')) return;
  editor.value = '';
  try { localStorage.removeItem(LS_CONTENT); } catch(e){}
  try { history.replaceState(null, '', location.pathname + location.search); } catch(e){}
  render();
  updateAllRemoteCarets();
  if (!Collab.isApplying()) Collab.sendDelta();
  broadcastCursorPosition();
});

/* =====================
   Resizable split (persisted)
   ===================== */
(function makeResizable(){
  const container = document.querySelector('.container');
  const minWidth = 240;
  let pointerId = null;
  let startX = 0;
  let startLeft = 0;
  let pendingWidth = null;

  divider.style.touchAction = 'none';

  function clampWidth(raw){
    const max = container.clientWidth - minWidth;
    return Math.max(minWidth, Math.min(max, raw));
  }

  function applyWidth(px){
    leftPane.style.flex = `0 0 ${px}px`;
    preview.style.flex = '1 1 auto';
    Guides.syncOverlayAndMirror();
    Guides.scheduleRebuild();
    updateAllRemoteCarets();
  }

  function persistWidth(px){
    try { localStorage.setItem(LS_SPLITPX, String(px)); } catch(e){}
  }

  function releasePointer(e){
    if (pointerId === null || (e && e.pointerId !== pointerId)) return;
    try { divider.releasePointerCapture(pointerId); } catch {}
    pointerId = null;
    document.body.style.cursor = '';
    if (pendingWidth !== null){
      persistWidth(pendingWidth);
      pendingWidth = null;
    }
  }

  divider.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    pointerId = e.pointerId;
    startX = e.clientX;
    startLeft = leftPane.getBoundingClientRect().width;
    pendingWidth = startLeft;
    divider.setPointerCapture(pointerId);
    document.body.style.cursor = 'col-resize';
    e.preventDefault();
  });

  divider.addEventListener('pointermove', (e) => {
    if (pointerId === null || e.pointerId !== pointerId) return;
    const proposed = clampWidth(startLeft + (e.clientX - startX));
    if (!Number.isFinite(proposed)) return;
    pendingWidth = proposed;
    applyWidth(proposed);
  });

  divider.addEventListener('pointerup', releasePointer);
  divider.addEventListener('pointercancel', releasePointer);

  divider.addEventListener('dblclick', () => {
    const cw = container.clientWidth;
    const mid = Math.max(minWidth, Math.min(cw - minWidth, cw / 2));
    applyWidth(mid);
    persistWidth(mid);
  });

  function restoreSaved(){
    try {
      const savedPx = parseFloat(localStorage.getItem(LS_SPLITPX));
      if (!Number.isNaN(savedPx)){
        applyWidth(clampWidth(savedPx));
      }
    } catch(e){}
  }

  restoreSaved();
})();

/* =====================
   Scroll sync (editor -> preview)
   ===================== */
editor.addEventListener('scroll', () => {
  const maxE = Math.max(1, editor.scrollHeight - editor.clientHeight);
  const ratio = editor.scrollTop / maxE;
  gutter.scrollTop  = editor.scrollTop;
  overlay.scrollTop = editor.scrollTop;
  const maxP = Math.max(0, preview.scrollHeight - preview.clientHeight);
  preview.scrollTop = isAtBottom(editor) ? maxP : ratio * maxP;
  updateAllRemoteCarets();
});

/* =====================
   Mode / Theme toggles
   ===================== */
editor.addEventListener('input', () => {
  render();
  updateAllRemoteCarets();
  try { localStorage.setItem(LS_CONTENT, editor.value); } catch(e){}
  if (!Collab.isApplying()) Collab.sendDelta();
  broadcastCursorPosition();
});

modeToggle?.addEventListener('change', () => {
  mode = modeToggle.checked ? 'classic' : 'mixed';
  modeLabel.textContent = (mode === 'classic') ? 'Classic' : 'Mixed';
  modeDesc.textContent  = (mode === 'classic') ? 'Classic: each new line is rendered as display math.' : 'Mixed: type text with $inline$ and $$display$$ math.';
  editor.placeholder = (mode === 'classic') ? 'Type lines of pure TeX; each line renders as display math' : 'Type text with $inline$ and $$display$$ math';
  document.body.classList.toggle('mixed',   mode === 'mixed');
  document.body.classList.toggle('classic', mode === 'classic');
  try { localStorage.setItem(LS_MODE, mode); } catch(e) {}
  render();
  if (!Collab.isApplying()) Collab.sendDelta();
});

if (darkToggle) {
  darkToggle.addEventListener('change', () => {
    const isDark = darkToggle.checked;
    document.body.classList.toggle('dark', isDark);
    try { localStorage.setItem(LS_DARK, isDark ? '1' : '0'); } catch(e) {}
    render();
    requestAnimationFrame(() => {
      try { editor.focus({ preventScroll: true }); }
      catch(e) { try { editor.focus(); } catch(_) {} }
      updateSelfCaretCursor();
    });
  });
}

/* =====================
   Tab indent/outdent
   ===================== */
editor.addEventListener('keydown', () => {
  requestAnimationFrame(updateSelfCaretCursor);
});
editor.addEventListener('keydown', (e) => {
  if (e.key !== 'Tab') return;
  e.preventDefault();
  const start = editor.selectionStart, end = editor.selectionEnd;
  const val = editor.value; const lineStart = val.lastIndexOf('\n', start - 1) + 1;
  if (!e.shiftKey) {
    if (start === end) { editor.setRangeText('  ', start, end, 'end'); editor.selectionStart = editor.selectionEnd = start + 2; }
    else { const block = val.slice(lineStart, end).replace(/^/gm, '  '); editor.setRangeText(block, lineStart, end, 'end'); const delta = block.length - (end - lineStart); editor.selectionStart = start + 2; editor.selectionEnd = end + delta; }
  } else {
    const re = /^ {1,2}/gm; const before = val.slice(lineStart, end); const block = before.replace(re, ''); const removed = (before.match(re) || []).reduce((a,s)=>a+s.length,0);
    editor.setRangeText(block, lineStart, end, 'end'); editor.selectionStart = Math.max(lineStart, start - Math.min(2, removed)); editor.selectionEnd = Math.max(lineStart, end - removed);
  }
  render();
  updateAllRemoteCarets();
  try { localStorage.setItem(LS_CONTENT, editor.value); } catch(e){}
  broadcastCursorPosition();
  if (!Collab.isApplying()) Collab.sendDelta();
});

/* =====================
   IDE-like pairing
   ===================== */
editor.addEventListener('keydown', (e) => {
  const OPEN_TO_CLOSE = { '(': ')', '{': '}', '[': ']' };
  const CLOSERS = new Set(Object.values(OPEN_TO_CLOSE));
  const start = editor.selectionStart; const end = editor.selectionEnd; const hasSel = start !== end; const nextChar = editor.value[end] || '';

  if (e.key === 'Backspace' && !hasSel) {
    const pairs = [['$$','$$'], ['$', '$'], ['(', ')'], ['[', ']'], ['{', '}']];
    const val = editor.value;
    for (const [open, close] of pairs) {
      const left = start - open.length;
      const right = start + close.length;
      if (left < 0 || right > val.length) continue;
      if (val.slice(left, start) === open && val.slice(start, right) === close) {
        e.preventDefault();
        editor.value = val.slice(0, left) + val.slice(right);
        editor.selectionStart = editor.selectionEnd = left;
        render();
        updateAllRemoteCarets();
        try { localStorage.setItem(LS_CONTENT, editor.value); } catch {}
        if (!Collab.isApplying()) Collab.sendDelta();
        broadcastCursorPosition();
        return;
      }
    }
  }

  if (CLOSERS.has(e.key) && !hasSel && nextChar === e.key) {
    e.preventDefault();
    editor.selectionStart = editor.selectionEnd = end + 1;
    broadcastCursorPosition();
    return;
  }

  if (e.key === '$') {
    e.preventDefault();

    const start = editor.selectionStart, end = editor.selectionEnd;
    const hasSel = start !== end;
    const sel = editor.value.slice(start, end);
    const next = editor.value[end] || '';

    if (!hasSel && next === '$') {
      editor.selectionStart = editor.selectionEnd = end + 1;
      return;
    }

    const pair = (hasSel && sel.includes('\n')) ? '$$' : '$';

    const before = editor.value.slice(0, start);
    const after  = editor.value.slice(end);
    editor.value = before + pair + sel + pair + after;

    if (hasSel) {
      editor.selectionStart = start + pair.length;
      editor.selectionEnd   = end   + pair.length;
    } else {
      editor.selectionStart = editor.selectionEnd = start + pair.length;
    }

    render();
    updateAllRemoteCarets();
    try { localStorage.setItem(LS_CONTENT, editor.value); } catch {}
    if (!Collab.isApplying()) Collab.sendDelta();
    broadcastCursorPosition();
    return;
  }

  if (e.key in OPEN_TO_CLOSE && e.key !== '$') {
    e.preventDefault();
    const open = e.key; const close = OPEN_TO_CLOSE[open];
    const before = editor.value.slice(0, start); const selected = editor.value.slice(start, end); const after = editor.value.slice(end);
    editor.value = before + open + selected + close + after;
    if (hasSel) { editor.selectionStart = start + 1; editor.selectionEnd = end + 1; }
    else { editor.selectionStart = editor.selectionEnd = start + 1; }
    render();
    updateAllRemoteCarets();
    try { localStorage.setItem(LS_CONTENT, editor.value); } catch {}
    if (!Collab.isApplying()) Collab.sendDelta();
    broadcastCursorPosition();
    return;
  }
});

editor.addEventListener('keyup', saveCursorAndScroll);
editor.addEventListener('click', saveCursorAndScroll);
editor.addEventListener('input', saveCursorAndScroll);

function saveCursorAndScroll() {
  try {
    localStorage.setItem(LS_CURSOR, String(editor.selectionStart));
    localStorage.setItem(LS_SCROLL, String(editor.scrollTop));
  } catch(e) {}
}

/* =====================
   Share (URL hash) for single page
   ===================== */
const LZString = (function(){
  const keyStrUriSafe = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-$';
  const baseReverseDic = {};
  function getBaseValue(alphabet, character){
    if (!baseReverseDic[alphabet]){
      baseReverseDic[alphabet] = {};
      for (let i = 0; i < alphabet.length; i++){
        baseReverseDic[alphabet][alphabet.charAt(i)] = i;
      }
    }
    return baseReverseDic[alphabet][character];
  }
  function compressToEncodedURIComponent(input){
    if (input == null) return '';
    return _compress(input, 6, (a) => keyStrUriSafe.charAt(a));
  }
  function decompressFromEncodedURIComponent(input){
    if (input == null) return '';
    if (input === '') return null;
    const safe = input.replace(/ /g, '+');
    return _decompress(safe.length, 32, (index) => getBaseValue(keyStrUriSafe, safe.charAt(index)));
  }
  function _compress(uncompressed, bitsPerChar, getCharFromInt){
    if (uncompressed == null) return '';
    let i, value;
    const context_dictionary = Object.create(null);
    const context_dictionaryToCreate = Object.create(null);
    let context_c = '';
    let context_wc = '';
    let context_w = '';
    let context_enlargeIn = 2;
    let context_dictSize = 3;
    let context_numBits = 2;
    const context_data = [];
    let context_data_val = 0;
    let context_data_position = 0;
    for (let ii = 0; ii < uncompressed.length; ii++){
      context_c = uncompressed.charAt(ii);
      if (!(context_c in context_dictionary)){
        context_dictionary[context_c] = context_dictSize++;
        context_dictionaryToCreate[context_c] = true;
      }
      context_wc = context_w + context_c;
      if (context_wc in context_dictionary){
        context_w = context_wc;
        continue;
      }
      if (context_w in context_dictionaryToCreate){
        if (context_w.charCodeAt(0) < 256){
          for (i = 0; i < context_numBits; i++){
            context_data_val <<= 1;
            if (context_data_position === bitsPerChar - 1){
              context_data_position = 0;
              context_data.push(getCharFromInt(context_data_val));
              context_data_val = 0;
            } else {
              context_data_position++;
            }
          }
          value = context_w.charCodeAt(0);
          for (i = 0; i < 8; i++){
            context_data_val = (context_data_val << 1) | (value & 1);
            if (context_data_position === bitsPerChar - 1){
              context_data_position = 0;
              context_data.push(getCharFromInt(context_data_val));
              context_data_val = 0;
            } else {
              context_data_position++;
            }
            value >>= 1;
          }
        } else {
          value = 1;
          for (i = 0; i < context_numBits; i++){
            context_data_val = (context_data_val << 1) | value;
            if (context_data_position === bitsPerChar - 1){
              context_data_position = 0;
              context_data.push(getCharFromInt(context_data_val));
              context_data_val = 0;
            } else {
              context_data_position++;
            }
            value = 0;
          }
          value = context_w.charCodeAt(0);
          for (i = 0; i < 16; i++){
            context_data_val = (context_data_val << 1) | (value & 1);
            if (context_data_position === bitsPerChar - 1){
              context_data_position = 0;
              context_data.push(getCharFromInt(context_data_val));
              context_data_val = 0;
            } else {
              context_data_position++;
            }
            value >>= 1;
          }
        }
        context_enlargeIn--;
        if (context_enlargeIn === 0){
          context_enlargeIn = Math.pow(2, context_numBits);
          context_numBits++;
        }
        delete context_dictionaryToCreate[context_w];
      } else {
        value = context_dictionary[context_w];
        for (i = 0; i < context_numBits; i++){
          context_data_val = (context_data_val << 1) | (value & 1);
          if (context_data_position === bitsPerChar - 1){
            context_data_position = 0;
            context_data.push(getCharFromInt(context_data_val));
            context_data_val = 0;
          } else {
            context_data_position++;
          }
          value >>= 1;
        }
      }
      context_enlargeIn--;
      if (context_enlargeIn === 0){
        context_enlargeIn = Math.pow(2, context_numBits);
        context_numBits++;
      }
      context_dictionary[context_wc] = context_dictSize++;
      context_w = String(context_c);
    }
    if (context_w !== ''){
      if (context_w in context_dictionaryToCreate){
        if (context_w.charCodeAt(0) < 256){
          for (i = 0; i < context_numBits; i++){
            context_data_val <<= 1;
            if (context_data_position === bitsPerChar - 1){
              context_data_position = 0;
              context_data.push(getCharFromInt(context_data_val));
              context_data_val = 0;
            } else {
              context_data_position++;
            }
          }
          value = context_w.charCodeAt(0);
          for (i = 0; i < 8; i++){
            context_data_val = (context_data_val << 1) | (value & 1);
            if (context_data_position === bitsPerChar - 1){
              context_data_position = 0;
              context_data.push(getCharFromInt(context_data_val));
              context_data_val = 0;
            } else {
              context_data_position++;
            }
            value >>= 1;
          }
        } else {
          value = 1;
          for (i = 0; i < context_numBits; i++){
            context_data_val = (context_data_val << 1) | value;
            if (context_data_position === bitsPerChar - 1){
              context_data_position = 0;
              context_data.push(getCharFromInt(context_data_val));
              context_data_val = 0;
            } else {
              context_data_position++;
            }
            value = 0;
          }
          value = context_w.charCodeAt(0);
          for (i = 0; i < 16; i++){
            context_data_val = (context_data_val << 1) | (value & 1);
            if (context_data_position === bitsPerChar - 1){
              context_data_position = 0;
              context_data.push(getCharFromInt(context_data_val));
              context_data_val = 0;
            } else {
              context_data_position++;
            }
            value >>= 1;
          }
        }
        context_enlargeIn--;
        if (context_enlargeIn === 0){
          context_enlargeIn = Math.pow(2, context_numBits);
          context_numBits++;
        }
        delete context_dictionaryToCreate[context_w];
      } else {
        value = context_dictionary[context_w];
        for (i = 0; i < context_numBits; i++){
          context_data_val = (context_data_val << 1) | (value & 1);
          if (context_data_position === bitsPerChar - 1){
            context_data_position = 0;
            context_data.push(getCharFromInt(context_data_val));
            context_data_val = 0;
          } else {
            context_data_position++;
          }
          value >>= 1;
        }
      }
      context_enlargeIn--;
      if (context_enlargeIn === 0){
        context_enlargeIn = Math.pow(2, context_numBits);
        context_numBits++;
      }
    }
    value = 2;
    for (i = 0; i < context_numBits; i++){
      context_data_val = (context_data_val << 1) | (value & 1);
      if (context_data_position === bitsPerChar - 1){
        context_data_position = 0;
        context_data.push(getCharFromInt(context_data_val));
        context_data_val = 0;
      } else {
        context_data_position++;
      }
      value >>= 1;
    }
    while (true){
      context_data_val <<= 1;
      if (context_data_position === bitsPerChar - 1){
        context_data.push(getCharFromInt(context_data_val));
        break;
      }
      context_data_position++;
    }
    return context_data.join('');
  }
  function _decompress(length, resetValue, getNextValue){
    const dictionary = [];
    let next;
    let enlargeIn = 4;
    let dictSize = 4;
    let numBits = 3;
    let entry = '';
    const result = [];
    let w;
    let bits;
    let resb;
    let maxpower;
    let power;
    let c;
    const data = { val: getNextValue(0), position: resetValue, index: 1 };
    for (let i = 0; i < 3; i++) dictionary[i] = i;
    maxpower = Math.pow(2, 2);
    power = 1;
    bits = 0;
    while (power !== maxpower){
      resb = data.val & data.position;
      data.position >>= 1;
      if (data.position === 0){
        data.position = resetValue;
        data.val = getNextValue(data.index++);
      }
      bits |= (resb > 0 ? 1 : 0) * power;
      power <<= 1;
    }
    switch (next = bits){
      case 0:
        maxpower = Math.pow(2, 8);
        power = 1;
        bits = 0;
        while (power !== maxpower){
          resb = data.val & data.position;
          data.position >>= 1;
          if (data.position === 0){
            data.position = resetValue;
            data.val = getNextValue(data.index++);
          }
          bits |= (resb > 0 ? 1 : 0) * power;
          power <<= 1;
        }
        dictionary[3] = String.fromCharCode(bits);
        next = 3;
        break;
      case 1:
        maxpower = Math.pow(2, 16);
        power = 1;
        bits = 0;
        while (power !== maxpower){
          resb = data.val & data.position;
          data.position >>= 1;
          if (data.position === 0){
            data.position = resetValue;
            data.val = getNextValue(data.index++);
          }
          bits |= (resb > 0 ? 1 : 0) * power;
          power <<= 1;
        }
        dictionary[3] = String.fromCharCode(bits);
        next = 3;
        break;
      case 2:
        return '';
    }
    w = dictionary[next];
    result.push(w);
    while (true){
      if (data.index > length) return '';
      maxpower = Math.pow(2, numBits);
      power = 1;
      bits = 0;
      while (power !== maxpower){
        resb = data.val & data.position;
        data.position >>= 1;
        if (data.position === 0){
          data.position = resetValue;
          data.val = getNextValue(data.index++);
        }
        bits |= (resb > 0 ? 1 : 0) * power;
        power <<= 1;
      }
      switch (c = bits){
        case 0:
          maxpower = Math.pow(2, 8);
          power = 1;
          bits = 0;
          while (power !== maxpower){
            resb = data.val & data.position;
            data.position >>= 1;
            if (data.position === 0){
              data.position = resetValue;
              data.val = getNextValue(data.index++);
            }
            bits |= (resb > 0 ? 1 : 0) * power;
            power <<= 1;
          }
          dictionary[dictSize++] = String.fromCharCode(bits);
          c = dictSize - 1;
          enlargeIn--;
          break;
        case 1:
          maxpower = Math.pow(2, 16);
          power = 1;
          bits = 0;
          while (power !== maxpower){
            resb = data.val & data.position;
            data.position >>= 1;
            if (data.position === 0){
              data.position = resetValue;
              data.val = getNextValue(data.index++);
            }
            bits |= (resb > 0 ? 1 : 0) * power;
            power <<= 1;
          }
          dictionary[dictSize++] = String.fromCharCode(bits);
          c = dictSize - 1;
          enlargeIn--;
          break;
        case 2:
          return result.join('');
      }
      if (enlargeIn === 0){
        enlargeIn = Math.pow(2, numBits);
        numBits++;
      }
      if (dictionary[c]){
        entry = dictionary[c];
      } else {
        if (c === dictSize){ entry = w + w.charAt(0); }
        else { return null; }
      }
      result.push(entry);
      dictionary[dictSize++] = w + entry.charAt(0);
      enlargeIn--;
      w = entry;
      if (enlargeIn === 0){
        enlargeIn = Math.pow(2, numBits);
        numBits++;
      }
    }
  }
  return { compressToEncodedURIComponent, decompressFromEncodedURIComponent };
})();

function compressState(state){ try { return LZString.compressToEncodedURIComponent(JSON.stringify(state)); } catch(e){ return ''; } }
function decompressState(token){
  if (!token) return null;
  try {
    const raw = LZString.decompressFromEncodedURIComponent(token);
    if (raw) return JSON.parse(raw);
  } catch(e) {}
  return null;
}

function b64encode(str){ const bytes = new TextEncoder().encode(str); let bin=''; bytes.forEach(b => bin += String.fromCharCode(b)); return btoa(bin); }
function b64decode(b64){ const bin=atob(b64); const bytes=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i); return new TextDecoder().decode(bytes); }

function encodeStateToUrl(){
  const leftWidth = leftPane.getBoundingClientRect().width;
  const state = { t: editor.value, m: (mode === 'classic') ? 1 : 0, d: darkToggle?.checked ? 1 : 0, s: leftWidth, x: MACROS };
  const compressed = compressState(state);
  const payload = compressed || b64encode(JSON.stringify(state));
  const shareUrl = new URL(location.href);
  shareUrl.hash = 'state=' + payload;
  if (history.replaceState){
    history.replaceState(null, '', shareUrl.toString());
  } else {
    location.hash = 'state=' + payload;
  }
  return shareUrl.toString();
}

function tryLoadStateFromHash(){
  const m = location.hash.match(/state=([^&]+)/);
  if (!m) return false;
  const token = m[1];
  let st = decompressState(token);
  if (!st){
    try { st = JSON.parse(b64decode(token)); } catch(e){ return false; }
  }
  if (typeof st.t === 'string') editor.value = st.t;
  if (modeToggle) modeToggle.checked = (st.m === 1);
  mode = modeToggle?.checked ? 'classic' : 'mixed';
  document.body.classList.toggle('dark', st.d === 1);
  if (darkToggle) darkToggle.checked = (st.d === 1);
  if (typeof st.s === 'number' && !Number.isNaN(st.s)){
    leftPane.style.flex = `0 0 ${st.s}px`;
    preview.style.flex = '1 1 auto';
    try { localStorage.setItem(LS_SPLITPX, String(st.s)); } catch(e){}
  }
  if (st.x && typeof st.x === 'object') {
    MACROS = normalizeMacros(st.x);
    try { localStorage.setItem(LS_MACROS, JSON.stringify(MACROS)); } catch(e){}
  }
  modeLabel.textContent = (mode === 'classic') ? 'Classic' : 'Mixed';
  modeDesc.textContent  = (mode === 'classic') ? 'Classic: each new line is rendered as display math.' : 'Mixed: type text with $inline$ and $$display$$ math.';
  editor.placeholder = (mode === 'classic') ? 'Type lines of pure TeX; each line renders as display math' : 'Type text with $inline$ and $$display$$ math';
  return true;
}

if (SHARE_STATE_LINK && shareBtn) {
  shareBtn.addEventListener('click', async () => {
    const url = encodeStateToUrl();
    try {
      await navigator.clipboard.writeText(url);
      shareBtn.textContent = '✅ Copied!';
      setTimeout(() => shareBtn.textContent = '🔗 Share link', 1200);
    } catch(e){
      prompt('Copy this link:', url);
    }
  });
}

/* =====================
   Welcome pop (first-time)
   ===================== */
(function setupWelcomePop() {
  const pop = document.getElementById('welcomePop');
  const closeBtn = document.getElementById('welcomeClose');
  const backdrop = document.getElementById('welcomeBackdrop');
  let editorWasDisabled = false;
  function getQueryParam(name){ return new URLSearchParams(window.location.search).get(name); }
  function hashHasWelcome(){ return /(^|[#&])welcome(=1|$)/i.test(location.hash); }
  function shouldForceShow(){
    const q = (getQueryParam('welcome') || '').toLowerCase();
    if (q === '1' || q === 'true' || q === 'show') return true;
    if (hashHasWelcome()) return true;
    return false;
  }
  function shouldResetFlag(){ const q = (getQueryParam('welcome') || '').toLowerCase(); return q === 'reset' || q === 'clear'; }
  function safeGetItem(k){ try { return localStorage.getItem(k); } catch(e) { return null; } }
  function safeSetItem(k, v){ try { localStorage.setItem(k, v); } catch(e){} }
  function safeRemoveItem(k){ try { localStorage.removeItem(k); } catch(e){} }
  const isModalWelcome = document.body.dataset.welcome === 'modal';
  function lockWorkspace(locking){
    if (!isModalWelcome) return;
    if (locking){
      if (backdrop){ backdrop.hidden = false; backdrop.style.display = 'block'; }
      if (pop){ pop.setAttribute('aria-modal','true'); }
      if (editor){
        editorWasDisabled = editor.disabled;
        editor.blur();
        editor.disabled = true;
      }
    } else {
      if (backdrop){ backdrop.style.display = 'none'; backdrop.hidden = true; }
      if (pop){ pop.setAttribute('aria-modal','false'); }
      if (editor){
        if (!editorWasDisabled) editor.disabled = false;
        editorWasDisabled = false;
        requestAnimationFrame(() => {
          try { editor.focus({ preventScroll: true }); }
          catch(e) { try { editor.focus(); } catch(_){} }
          updateSelfCaretCursor();
        });
      }
    }
  }
  function dismissWelcome(setFlag){
    if (!pop) return;
    pop.style.display = 'none';
    lockWorkspace(false);
    if (setFlag) safeSetItem(LS_WELCOME, '1');
  }
  function showWelcome(){
    if (!pop || !closeBtn) return;
    lockWorkspace(true);
    pop.style.display = 'block';
    setTimeout(() => { try { closeBtn.focus(); } catch(e){} }, 0);
    closeBtn.addEventListener('click', () => dismissWelcome(true), { once: true });
  }
  function init(){
    if (shouldResetFlag()) safeRemoveItem(LS_WELCOME);
    const forced = shouldForceShow();
    const seen = !!safeGetItem(LS_WELCOME);
    if (forced || !seen) { showWelcome(); if (forced) return; }
  }
  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', init, { once:true }); } else { init(); }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { if (pop && pop.style.display === 'block') { dismissWelcome(true); } } });
})();

/* =====================
   Modal close behaviors
   ===================== */
function attachModalDismiss(backdrop, close){
  let pointerDownOnBackdrop = false;
  backdrop.addEventListener('pointerdown', (e) => {
    pointerDownOnBackdrop = (e.target === backdrop);
  });
  backdrop.addEventListener('click', (e) => {
    if (pointerDownOnBackdrop && e.target === backdrop) close();
    pointerDownOnBackdrop = false;
  });
}

if (matrixModal) attachModalDismiss(matrixModal, () => matrixModal.classList.remove('show'));
if (tableModal) attachModalDismiss(tableModal,  () => tableModal.classList.remove('show'));
if (macrosModal) attachModalDismiss(macrosModal, () => macrosModal.classList.remove('show'));

window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (matrixModal?.classList.contains('show')) { matrixModal.classList.remove('show'); return; }
  if (tableModal?.classList.contains('show')) { tableModal.classList.remove('show'); return; }
  if (macrosModal?.classList.contains('show')) { macrosModal.classList.remove('show'); return; }
});

/* =====================
   Macros modal actions
   ===================== */
macrosBtn?.addEventListener('click', () => { macrosText.value = serializeMacros(MACROS); macrosModal.classList.add('show'); });
macrosCancel?.addEventListener('click', () => macrosModal.classList.remove('show'));
macrosReset?.addEventListener('click', () => {
  MACROS = { ...DEFAULT_MACROS };
  try { localStorage.setItem(LS_MACROS, JSON.stringify(MACROS)); } catch(e){}
  macrosText.value = serializeMacros(MACROS);
  render();
  if (Collab.isConnected()) Collab.sendMacros('reset');
});

function focusMacroLine(line){
  if (!line || line < 1) return;
  const lines = macrosText.value.split('\n');
  let start = 0;
  for (let i = 0; i < line - 1 && i < lines.length; i++) start += lines[i].length + 1;
  const target = lines[line - 1] || '';
  const end = start + target.length;
  macrosText.focus();
  macrosText.setSelectionRange(start, end);
  const ratio = (line - 1) / Math.max(1, lines.length - 1);
  macrosText.scrollTop = ratio * (macrosText.scrollHeight - macrosText.clientHeight);
}

macrosSave?.addEventListener('click', (e) => {
  e.preventDefault();
  try {
    const raw = macrosText.value;
    if (raw === "") {
      MACROS = {};
      try { localStorage.setItem(LS_MACROS, JSON.stringify(MACROS)); } catch(e){}
      macrosText.value = "";
      render();
      requestAnimationFrame(() => macrosModal.classList.remove('show'));
      if (Collab.isConnected()) Collab.sendMacros('save-empty');
      return;
    }
    const { macros: parsed, errors } = parseMacrosInput(raw);
    if (errors.length){
      const first = errors[0];
      focusMacroLine(first.line);
      alert(`Could not parse \\newcommand on line ${first.line}: ${first.reason}.`);
      return;
    }
    MACROS = parsed;
    try { localStorage.setItem(LS_MACROS, JSON.stringify(MACROS)); } catch (storageErr) {}
    try { macrosText.value = serializeMacros(MACROS); } catch (serr) {}
    render();
    requestAnimationFrame(() => macrosModal.classList.remove('show'));
    if (Collab.isConnected()) Collab.sendMacros('save');
  } catch (err) {
    console.error('Save handler error:', err);
    alert('Unexpected error while saving shortcuts. Check console for details.');
  }
});

/* =====================
   Init sequence
   ===================== */
window.addEventListener('load', () => {
  let loadedFromHash = false;
  if (SHARE_STATE_LINK) {
    loadedFromHash = tryLoadStateFromHash();
  }

  if (!loadedFromHash){
    if (ENABLE_COLLAB) {
      try { const savedRoom = localStorage.getItem(key('collab.room.v1')); if (savedRoom) document.getElementById('roomNameInput').value = savedRoom; } catch(e){}
      try {
        const rawName = localStorage.getItem(key('name.v1')) || '';
        const input = document.getElementById('displayNameInput');
        if (input) input.value = rawName;
        displayName = rawName.trim();
        notifyNameChange();
      } catch(e){}
      try { if (localStorage.getItem(key('joinwarning.v2')) === '1') joinWarningDismissed = true; } catch(e){}
    }
    try { const saved = localStorage.getItem(LS_CONTENT); if (saved != null) editor.value = saved; } catch(e){}
    try { const dark = localStorage.getItem(LS_DARK) === '1'; if (darkToggle) darkToggle.checked = dark; document.body.classList.toggle('dark', dark); } catch(e){}
    try { const savedPx = parseFloat(localStorage.getItem(LS_SPLITPX)); if (!Number.isNaN(savedPx)) { leftPane.style.flex = `0 0 ${savedPx}px`; preview.style.flex = '1 1 auto'; } } catch(e){}
    try { const savedMode = localStorage.getItem(LS_MODE); if (savedMode === 'classic' || savedMode === 'mixed') modeToggle.checked = (savedMode === 'classic'); } catch(e){}
    try {
      const raw = localStorage.getItem(LS_MACROS);
      if (raw) {
        const obj = JSON.parse(raw);
        MACROS = normalizeMacros(obj);
        lastBroadcastMacrosJSON = JSON.stringify(MACROS);
      }
    } catch(e){}
    try {
      const cursor = parseInt(localStorage.getItem(LS_CURSOR), 10);
      if (!isNaN(cursor)) {
        editor.selectionStart = editor.selectionEnd = cursor;
      }

      const scroll = parseInt(localStorage.getItem(LS_SCROLL), 10);
      if (!isNaN(scroll)) {
        requestAnimationFrame(() => {
          editor.scrollTop = scroll;
          gutter.scrollTop = scroll;
          overlay.scrollTop = scroll;
        });
      }
    } catch(e) {}
  }

  mode = modeToggle.checked ? 'classic' : 'mixed';
  document.body.classList.toggle('mixed',   mode === 'mixed');
  document.body.classList.toggle('classic', mode === 'classic');
  modeLabel.textContent = (mode === 'classic') ? 'Classic' : 'Mixed';
  modeDesc.textContent  = (mode === 'classic') ? 'Classic: each new line is rendered as display math.' : 'Mixed: type text with $inline$ and $$display$$ math.';
  editor.placeholder    = (mode === 'classic') ? 'Type lines of pure TeX; each line renders as display math' : 'Type text with $inline$ and $$display$$ math';
  Guides.syncOverlayAndMirror();
  render();
  renderPresenceList();
  requestAnimationFrame(() => {
    Guides.scheduleRebuild();
    requestAnimationFrame(() => {
      try {
        const saved = parseInt(localStorage.getItem(LS_SCROLL), 10);
        if (!isNaN(saved)) {
          editor.scrollTop  = saved;
          gutter.scrollTop  = saved;
          overlay.scrollTop = saved;
        }
      } catch {}
    });
  });
  editor.focus();
});

window.addEventListener('resize', () => { Guides.syncOverlayAndMirror(); Guides.scheduleRebuild({ force: true }); });

if (matrixModal) {
  document.getElementById('mCancel').addEventListener('click', () => matrixModal.classList.remove('show'));
  document.getElementById('mInsert').addEventListener('click', insertMatrix);
}
if (tableModal) {
  document.getElementById('tCancel').addEventListener('click', () => tableModal.classList.remove('show'));
  document.getElementById('tInsert').addEventListener('click', insertTable);
}
