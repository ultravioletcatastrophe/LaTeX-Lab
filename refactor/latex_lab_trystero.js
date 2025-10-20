import { initLatexLabBackend } from './katex_backend.js';

const roomInput = document.getElementById('roomNameInput');
const joinButton = document.getElementById('roomJoinBtn');
const shareRoomButton = document.getElementById('shareRoomBtn');
const statusLabel = document.getElementById('collabStatus');
const displayNameInput = document.getElementById('displayNameInput');
const presenceList = document.getElementById('presenceList');
const editorWrap = document.getElementById('editorWrap');

const backend = initLatexLabBackend({
  onContentChange: (text) => {
    collab?.handleContentChange(text);
    updateAllRemoteCarets();
  },
  onModeChange: (mode) => collab?.handleModeChange(mode),
  onDarkModeChange: (dark) => collab?.handleDarkModeChange(dark),
  onMacrosChange: (macros) => collab?.handleMacrosChange(macros),
  onSelectionChange: (cursor) => {
    if (collab) collab.handleCursor(cursor);
    else updateSelfCursorState(cursor);
  },
  onScrollChange: (scrollTop) => {
    if (collab) collab.handleCursor({ scrollTop });
    updateSelfCaretCursor();
  },
  onRender: () => updateAllRemoteCarets(),
  onReady: () => updateAllRemoteCarets(),
});

const { editor, gutter, overlay, preview, leftPane, Guides, getStateSnapshot, applyState, render: rerender } = backend;

const CLIENT_ID = createClientId();
const LS_DISPLAY_NAME = 'latexlab.collab.displayName';
const LS_COLORS = 'latexlab.trystero.colors.v1';

let displayName = loadDisplayName();
let collab = null;
let selfCursorState = {
  start: editor?.selectionStart ?? 0,
  end: editor?.selectionEnd ?? 0,
  scrollTop: editor?.scrollTop ?? 0,
};

/* =====================
   Presence overlays & color picker
   ===================== */
const remoteLayer = document.createElement('div');
remoteLayer.id = 'remoteLayer';
remoteLayer.style.position = 'absolute';
remoteLayer.style.inset = '0';
remoteLayer.style.pointerEvents = 'none';
remoteLayer.style.zIndex = '3';
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
const selfCaretEntry = { el: selfCaretEl, bar: selfCaretBar, label: selfCaretLabel, cursor: null, color: '', name: '', overlayHover: false };

const selfColorPicker = document.createElement('input');
selfColorPicker.type = 'color';
function setSelfColorImmediate(color) {
  const normalized = normalizeColor(color, getSelfColorHex());
  colorOverrides.set(CLIENT_ID, normalized);
  updatePeerColor(CLIENT_ID, normalized, true);
  renderPresenceList();
}

selfColorPicker.id = 'selfColorPicker';
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
  transform: 'translate(-50%, -50%)',
});
selfColorPicker.tabIndex = -1;
document.body.appendChild(selfColorPicker);

function moveSelfColorPicker(rect) {
  if (!rect) return;
  selfColorPicker.style.left = `${rect.left + rect.width / 2}px`;
  selfColorPicker.style.top = `${rect.top + rect.height / 2}px`;
  void selfColorPicker.offsetWidth;
}

function getSelfPillRect() {
  const pill = presenceList?.querySelector('.presence-item.self');
  return pill?.getBoundingClientRect() || null;
}

function resetSelfColorPickerPosition() {
  const rect = getSelfPillRect();
  if (rect) moveSelfColorPicker(rect);
}

selfColorPicker.addEventListener('input', (event) => {
  const value = event.target?.value;
  if (value) {
    if (collab) collab.setSelfColor(value);
    else setSelfColorImmediate(value);
  }
  requestAnimationFrame(() => {
    editor?.focus({ preventScroll: true });
    updateSelfCaretCursor();
  });
});
selfColorPicker.addEventListener('blur', () => {
  requestAnimationFrame(() => {
    editor?.focus({ preventScroll: true });
    updateSelfCaretCursor();
  });
});
window.addEventListener('resize', resetSelfColorPickerPosition, { passive: true });
window.addEventListener('scroll', resetSelfColorPickerPosition, { passive: true });

/* =====================
   Collaboration shared state
   ===================== */
const remotePeers = new Map();
const peerMeta = new Map();
const peerAliases = new Map();
const colorOverrides = new Map();
const CARET_STYLE_PROPS = [
  'direction','boxSizing','width','height','overflowX','overflowY',
  'borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth',
  'paddingTop','paddingRight','paddingBottom','paddingLeft',
  'fontStyle','fontVariant','fontWeight','fontStretch','fontSize','fontSizeAdjust','lineHeight','fontFamily',
  'textAlign','textTransform','textIndent','textDecoration','letterSpacing','wordSpacing','tabSize','MozTabSize'
];
let caretMirror = null;
let selfPresencePill = null;
let namedColorByHex = new Map();
let nearestColorMatcher = null;

function createClientId() {
  try {
    const key = 'latexlab.clientId';
    let id = sessionStorage.getItem(key);
    if (!id) {
      id = crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
      sessionStorage.setItem(key, id);
    }
    return id;
  } catch (err) {
    return Math.random().toString(36).slice(2);
  }
}

function loadDisplayName() {
  try {
    const saved = localStorage.getItem(LS_DISPLAY_NAME);
    if (saved && saved.trim()) return saved.trim();
  } catch (err) {}
  return '';
}

function saveDisplayName(name) {
  try {
    localStorage.setItem(LS_DISPLAY_NAME, name);
  } catch (err) {}
}

function hashString(input = '') {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) - hash) + input.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

function withAlpha(hex, alpha) {
  const normalized = normalizeHex(hex);
  if (!normalized) return `rgba(66,133,244,${alpha})`;
  const num = parseInt(normalized.slice(1), 16);
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function normalizeHex(input) {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  const match = trimmed.match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!match) return null;
  let hex = match[1];
  if (hex.length === 3) hex = hex.split('').map(ch => ch + ch).join('');
  return `#${hex.toLowerCase()}`;
}

function normalizeColor(input, fallback = '#1ea7fd') {
  const normalized = normalizeHex(input);
  if (normalized) return normalized;
  return normalizeHex(fallback) || '#1ea7fd';
}

function hslToHex(h, s, l) {
  const sat = Math.max(0, Math.min(100, s)) / 100;
  const light = Math.max(0, Math.min(100, l)) / 100;
  const chroma = (1 - Math.abs(2 * light - 1)) * sat;
  const hueSegment = (h % 360) / 60;
  const x = chroma * (1 - Math.abs((hueSegment % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (0 <= hueSegment && hueSegment < 1) { r = chroma; g = x; }
  else if (1 <= hueSegment && hueSegment < 2) { r = x; g = chroma; }
  else if (2 <= hueSegment && hueSegment < 3) { g = chroma; b = x; }
  else if (3 <= hueSegment && hueSegment < 4) { g = x; b = chroma; }
  else if (4 <= hueSegment && hueSegment < 5) { r = x; b = chroma; }
  else if (5 <= hueSegment && hueSegment < 6) { r = chroma; b = x; }
  const m = light - chroma / 2;
  const toHex = (v) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function registerNamedColor(name, hex) {
  const normalized = normalizeHex(hex);
  if (!normalized || typeof name !== 'string') return normalized;
  const trimmed = name.trim();
  if (!trimmed) return normalized;
  if (!namedColorByHex.has(normalized)) namedColorByHex.set(normalized, trimmed);
  return normalized;
}

function nameForHex(hex) {
  const normalized = normalizeHex(hex);
  if (!normalized) return 'Color';
  const direct = namedColorByHex.get(normalized);
  if (direct) return direct;
  if (nearestColorMatcher) {
    try {
      const match = nearestColorMatcher(normalized);
      if (match?.name) return match.name;
      if (match?.value) {
        const upstream = namedColorByHex.get(normalizeHex(match.value));
        if (upstream) return upstream;
      }
    } catch (err) {
      console.warn('[collab] nearestColor lookup failed', err);
    }
  }
  return normalized;
}

function baseColorInfoForPeer(peerId) {
  const key = peerId || 'peer';
  const hash = Math.abs(hashString(key));
  const hue = hash % 360;
  const hex = hslToHex(hue, 78, 62);
  return { hex, name: nameForHex(hex) };
}

function resolvePeerKey(id) {
  if (!id) return id;
  let current = id;
  const seen = new Set();
  while (peerAliases.has(current) && !seen.has(current)) {
    seen.add(current);
    current = peerAliases.get(current);
  }
  return current;
}

function linkPeerAlias(alias, canonical) {
  if (!alias || !canonical || alias === canonical) return resolvePeerKey(canonical || alias);
  const target = resolvePeerKey(canonical);
  peerAliases.set(alias, target);
  const aliasEntry = remotePeers.get(alias);
  if (aliasEntry && !remotePeers.has(target)) remotePeers.set(target, aliasEntry);
  if (aliasEntry && alias !== target) remotePeers.delete(alias);
  const aliasMeta = peerMeta.get(alias);
  if (aliasMeta && !peerMeta.has(target)) peerMeta.set(target, aliasMeta);
  if (aliasMeta && alias !== target) peerMeta.delete(alias);
  if (alias !== target && colorOverrides.has(alias)) {
    const color = colorOverrides.get(alias);
    colorOverrides.set(target, color);
    colorOverrides.delete(alias);
  }
  return target;
}

function colorInfoForPeer(peerId) {
  const key = resolvePeerKey(peerId) || peerId || CLIENT_ID;
  const override = colorOverrides.get(key);
  if (override) return { hex: override, name: nameForHex(override) };
  return baseColorInfoForPeer(key);
}

function colorForPeer(peerId) {
  return colorInfoForPeer(peerId).hex;
}

function fallbackNameForPeer(peerId) {
  return peerId ? `Peer ${peerId.slice(0, 4)}` : 'Peer';
}

function getSelfColorHex() {
  return normalizeHex(colorInfoForPeer(CLIENT_ID).hex) || '#1ea7fd';
}

(function loadColorOverrides() {
  try {
    const raw = localStorage.getItem(LS_COLORS);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      Object.entries(parsed).forEach(([key, value]) => {
        const normalized = normalizeHex(value);
        if (normalized) colorOverrides.set(key, normalized);
      });
    }
  } catch (err) {}
})();

function saveColorOverrides() {
  try {
    const data = {};
    if (colorOverrides.has(CLIENT_ID)) {
      data[CLIENT_ID] = colorOverrides.get(CLIENT_ID);
    }
    localStorage.setItem(LS_COLORS, JSON.stringify(data));
  } catch (err) {}
}

function ensurePeerMeta(peerId) {
  const key = resolvePeerKey(peerId) || peerId;
  if (!key) return null;
  let meta = peerMeta.get(key);
  if (!meta) {
    meta = { color: '', colorName: '', name: '', display: fallbackNameForPeer(key) };
    peerMeta.set(key, meta);
  }
  const info = colorInfoForPeer(key);
  meta.color = info.hex;
  meta.colorName = info.name;
  if (!meta.display) meta.display = fallbackNameForPeer(key);
  if (peerId && peerId !== key) peerAliases.set(peerId, key);
  return meta;
}

function ensureRemotePeerEntry(peerId) {
  const key = resolvePeerKey(peerId);
  if (!key) return null;
  const meta = ensurePeerMeta(key);
  let entry = remotePeers.get(key);
  if (!entry) {
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
  }
  entry.color = meta.color;
  entry.name = meta.display;
  entry.label.textContent = entry.name;
  entry.bar.style.backgroundColor = entry.color;
  entry.label.style.backgroundColor = withAlpha(entry.color, 1);
  entry.label.style.border = `1px solid ${withAlpha(entry.color, 1)}`;
  return entry;
}

function updatePeerName(peerId, rawName) {
  const key = resolvePeerKey(peerId) || peerId;
  if (!key) return;
  const meta = ensurePeerMeta(key);
  const normalized = (rawName || '').trim();
  meta.name = normalized;
  meta.display = normalized || fallbackNameForPeer(key);
  const entry = remotePeers.get(key);
  if (entry) {
    entry.name = meta.display;
    entry.label.textContent = meta.display;
  }
  renderPresenceList();
}

function updatePeerColor(peerId, color, persist = false) {
  const key = resolvePeerKey(peerId) || peerId;
  if (!key) return;
  const normalized = normalizeColor(color, colorForPeer(key));
  const defaultHex = normalizeHex(baseColorInfoForPeer(key).hex);
  if (normalized === defaultHex) {
    colorOverrides.delete(key);
  } else {
    colorOverrides.set(key, normalized);
  }
  if (persist && key === CLIENT_ID) saveColorOverrides();
  const info = colorInfoForPeer(key);
  const meta = ensurePeerMeta(key);
  if (meta) {
    meta.color = info.hex;
    meta.colorName = info.name;
  }
  if (info.name && info.name !== info.hex) registerNamedColor(info.name, info.hex);
  const entry = remotePeers.get(key);
  if (entry) {
    entry.color = info.hex;
    entry.bar.style.backgroundColor = info.hex;
    entry.label.style.backgroundColor = withAlpha(info.hex, 1);
    entry.label.style.border = `1px solid ${withAlpha(info.hex, 1)}`;
  }
  if (key === CLIENT_ID) updateSelfCaretAppearance(info);
  renderPresenceList();
  updateAllRemoteCarets();
}

function removeRemotePeer(peerId) {
  const key = resolvePeerKey(peerId) || peerId;
  if (!key) return;
  const entry = remotePeers.get(key);
  if (entry) {
    entry.el.remove();
    remotePeers.delete(key);
  }
  peerMeta.delete(key);
  colorOverrides.delete(key);
  const aliases = [];
  peerAliases.forEach((target, alias) => {
    if (alias === key || target === key) aliases.push(alias);
  });
  aliases.forEach(alias => peerAliases.delete(alias));
  renderPresenceList();
}

function updateSelfCaretAppearance(info = null) {
  const palette = info || colorInfoForPeer(CLIENT_ID);
  const color = palette?.hex || colorForPeer(CLIENT_ID);
  const label = (displayName || '').trim() || 'You';
  selfCaretEntry.color = color;
  selfCaretEntry.name = label;
  selfCaretEntry.bar.style.backgroundColor = color;
  selfCaretEntry.label.style.backgroundColor = withAlpha(color, 1);
  selfCaretEntry.label.style.border = `1px solid ${withAlpha(color, 1)}`;
  selfCaretEntry.label.textContent = label;
  if (editor) editor.style.caretColor = 'transparent';
}

function hideSelfCaret() {
  selfCaretEntry.el.style.display = 'none';
  selfCaretEntry.cursor = null;
}

function updateSelfCaretCursor() {
  if (!editor) return;
  if (document.activeElement !== editor) {
    hideSelfCaret();
    return;
  }
  updateSelfCaretAppearance();
  const caretPos = typeof selfCursorState.end === 'number' ? selfCursorState.end : selfCursorState.start || 0;
  selfCaretEntry.cursor = { start: caretPos, end: caretPos };
  positionRemoteCaret(CLIENT_ID, selfCaretEntry);
}

function ensureCaretMirror() {
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

function getCaretCoordinates(index) {
  if (!editor) return null;
  const text = editor.value || '';
  const clamped = Math.max(0, Math.min(index, text.length));
  const mirror = ensureCaretMirror();
  const style = getComputedStyle(editor);
  CARET_STYLE_PROPS.forEach((prop) => {
    mirror.style[prop] = style[prop];
  });
  const contentWidth = editor.clientWidth;
  mirror.style.width = `${Math.max(0, contentWidth)}px`;
  mirror.textContent = '';
  mirror.appendChild(document.createTextNode(text.slice(0, clamped)));
  const marker = document.createElement('span');
  marker.textContent = '\u200b';
  mirror.appendChild(marker);
  const box = marker.getBoundingClientRect();
  const base = mirror.getBoundingClientRect();
  if (!box || !base) return null;
  const left = box.left - base.left - editor.scrollLeft - 1;
  const top = box.top - base.top - editor.scrollTop - 1;
  const lh = parseFloat(style.lineHeight);
  const fs = parseFloat(style.fontSize) || 16;
  const height = Number.isFinite(lh) ? lh : Math.round(fs * 1.2);
  mirror.textContent = '';
  return { x: left, y: top, height };
}

function positionRemoteCaret(peerId, entry) {
  const key = resolvePeerKey(peerId) || peerId;
  const target = entry || remotePeers.get(key);
  if (!target) return;
  if (!target.cursor) {
    target.el.style.display = 'none';
    return;
  }
  const textLength = editor.value.length;
  const safeIndex = Math.max(0, Math.min(target.cursor.end ?? target.cursor.start ?? 0, textLength));
  const coords = getCaretCoordinates(safeIndex);
  if (!coords) {
    target.el.style.display = 'none';
    return;
  }
  const { x, y, height } = coords;
  if (y < -height || y > editor.clientHeight + height || x < -32 || x > editor.clientWidth + 32) {
    target.el.style.display = 'none';
    return;
  }
  const showBelow = y < 18;
  target.el.style.display = 'block';
  target.el.style.transform = '';
  target.el.style.top = `${Math.round(y)}px`;
  target.el.style.left = `${Math.round(x)}px`;
  const barHeight = Math.max(height * 0.8, 1);
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

function updateRemoteCursor(peerId, cursor) {
  const key = resolvePeerKey(peerId) || peerId;
  const entry = ensureRemotePeerEntry(key);
  if (!entry) return;
  if (!cursor || typeof cursor.start !== 'number' || typeof cursor.end !== 'number') {
    entry.cursor = null;
    entry.el.style.display = 'none';
    return;
  }
  entry.cursor = { start: cursor.start, end: cursor.end };
  positionRemoteCaret(key, entry);
}

function applyCaretHoverState(entry) {
  if (!entry) return;
  const active = !!entry.overlayHover || !!entry.presenceHover;
  entry.el.classList.toggle('show-label', active);
}

function updateAllRemoteCarets() {
  remotePeers.forEach((entry, peerId) => positionRemoteCaret(peerId, entry));
  updateSelfCaretCursor();
}

function clearRemoteCaretHover() {
  remotePeers.forEach((entry) => {
    if (!entry) return;
    if (entry.overlayHover) {
      entry.overlayHover = false;
      applyCaretHoverState(entry);
    }
  });
}

function handleRemoteCaretHover(clientX, clientY) {
  remotePeers.forEach((entry) => {
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
    if (entry.overlayHover !== isHover) {
      entry.overlayHover = isHover;
      applyCaretHoverState(entry);
    }
  });
}

editorWrap.addEventListener('mousemove', (event) => handleRemoteCaretHover(event.clientX, event.clientY));
editorWrap.addEventListener('mouseleave', clearRemoteCaretHover);

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
        end: typeof nextEnd === 'number' ? nextEnd : entry.cursor.end,
      };
      positionRemoteCaret(peerId, entry);
    }
  });
}

function renderPresenceList() {
  if (!presenceList) return;
  const connected = !!collab?.connected;
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
  if (!connected || remoteItems.length === 0) {
    presenceList.textContent = '';
    presenceList.style.display = 'none';
    selfPresencePill = null;
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
    self: true,
  };
  const ordered = remoteItems.slice().sort((a, b) => a.text.localeCompare(b.text, undefined, { sensitivity: 'base' }));
  ordered.unshift(selfEntry);
  presenceList.textContent = '';
  selfPresencePill = null;
  ordered.forEach((item) => {
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
}

function togglePresenceHover(peerId, hovering) {
  const key = resolvePeerKey(peerId) || peerId;
  if (!key) return;
  const entry = ensureRemotePeerEntry(key);
  if (!entry) return;
  entry.presenceHover = hovering;
  if (hovering && entry.cursor && entry.el.style.display === 'none') positionRemoteCaret(key, entry);
  applyCaretHoverState(entry);
}

function handleSelfPresenceClick(event) {
  event.preventDefault();
  event.stopPropagation();
  if (event.currentTarget) {
    selfPresencePill = event.currentTarget;
    selfPresencePill.setAttribute('aria-expanded', 'true');
  }
  const info = colorInfoForPeer(CLIENT_ID);
  const normalized = normalizeColor(info.hex);
  try { selfColorPicker.value = normalized; } catch (err) {}
  const rect = event.currentTarget?.getBoundingClientRect?.();
  if (rect) moveSelfColorPicker(rect); else resetSelfColorPickerPosition();
  let opened = false;
  try {
    if (typeof selfColorPicker.showPicker === 'function') {
      selfColorPicker.showPicker();
      opened = true;
    }
  } catch (err) {}
  if (!opened) {
    try { selfColorPicker.focus({ preventScroll: true }); } catch (err) { try { selfColorPicker.focus(); } catch (err2) {} }
    try { selfColorPicker.click(); opened = true; } catch (err) {}
  }
  if (!opened) {
    requestAnimationFrame(() => {
      try {
        if (typeof selfColorPicker.showPicker === 'function') selfColorPicker.showPicker();
        else selfColorPicker.click();
      } catch (err) {}
    });
  }
}

function loadNamedColorPalette() {
  try {
    fetch('./ntc.json')
      .then((response) => {
        if (!response.ok) throw new Error(`Failed to load colors (${response.status})`);
        return response.json();
      })
      .then((payload) => {
        const palette = Object.create(null);
        if (payload && Array.isArray(payload.colors)) {
          payload.colors.forEach((entry) => {
            const normalized = registerNamedColor(entry?.name, entry?.hex);
            if (normalized && entry?.name) palette[entry.name] = normalized;
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
      .catch((err) => console.error('Color palette load failed:', err));
  } catch (err) {
    console.error('Color palette setup error:', err);
  }
}

loadNamedColorPalette();
if (editor) {
  editor.addEventListener('focus', updateSelfCaretCursor);
  editor.addEventListener('blur', hideSelfCaret);
  editor.addEventListener('input', () => { updateSelfCaretCursor(); collab?.queueCursor(); });
  editor.addEventListener('keydown', () => requestAnimationFrame(() => updateSelfCaretCursor()));
  editor.addEventListener('mouseup', () => requestAnimationFrame(() => updateSelfCaretCursor()));
}

function updateSelfCursorState(partial = {}) {
  if (typeof partial.start === 'number') selfCursorState.start = partial.start;
  if (typeof partial.end === 'number') selfCursorState.end = partial.end;
  if (typeof partial.scrollTop === 'number') selfCursorState.scrollTop = partial.scrollTop;
  updateSelfCaretCursor();
}

function clearRemoteState() {
  remotePeers.forEach((entry) => entry?.el?.remove());
  remotePeers.clear();
  peerMeta.clear();
  peerAliases.clear();
  colorOverrides.forEach((_, key) => { if (key !== CLIENT_ID) colorOverrides.delete(key); });
  renderPresenceList();
  updateAllRemoteCarets();
}

/* =====================
   Collaboration session
   ===================== */
class CollabSession {
  constructor() {
    this.connected = false;
    this.room = null;
    this.send = null;
    this.unsubscribe = null;
    this.offJoin = null;
    this.offLeave = null;
    this.pendingUpdate = null;
    this.updateTimer = null;
    this.cursorTimer = null;
    this.suppress = false;
    this.applying = false;
    this.roomName = '';
  }

  async connect(roomName) {
    const trimmed = (roomName || '').trim();
    if (!trimmed) {
      alert('Enter a room code to connect.');
      return;
    }
    if (this.connected && this.roomName === trimmed) return;
    if (this.connected) await this.disconnect();

    this.roomName = trimmed;
    this.setJoinState('connecting');
    this.setStatus('Connecting…');

    try {
      const joinRoom = await this.ensureTrystero();
      this.room = await joinRoom({ appId: 'latex-lab-trystero-v2' }, trimmed);
    } catch (err) {
      console.error('[collab] failed to join room', err);
      this.setJoinState('disconnected');
      this.setStatus('Connection failed');
      this.room = null;
      this.roomName = '';
      return;
    }

    const [send, onMessage] = this.room.makeAction('state');
    this.send = (payload) => send({ ...payload, from: CLIENT_ID });
    this.unsubscribe = onMessage((payload, peerId) => this.handleMessage(payload, peerId));
    this.offJoin = this.room.onPeerJoin?.((peerId) => this.handlePeerJoin(peerId));
    this.offLeave = this.room.onPeerLeave?.((peerId) => this.handlePeerLeave(peerId));

    const existing = this.room.getPeers?.() || {};
    Object.keys(existing).forEach((peerId) => {
      ensurePeerMeta(peerId);
      ensureRemotePeerEntry(peerId);
    });

    this.connected = true;
    this.setJoinState('connected');
    this.updateStatus();
    if (shareRoomButton) shareRoomButton.style.display = 'inline-block';
    renderPresenceList();
    updateSelfCaretCursor();

    this.sendPresence();
    this.broadcastFullState('join');
    this.queueCursor();
  }

  async disconnect() {
    if (!this.connected) return;
    this.connected = false;
    this.setJoinState('disconnected');
    this.setStatus('Offline');
    if (shareRoomButton) shareRoomButton.style.display = 'none';
    try {
      const url = new URL(location.href);
      url.searchParams.delete('room');
      history.replaceState(null, '', url.toString());
    } catch (err) {}
    try { this.unsubscribe?.(); } catch (err) {}
    try { this.offJoin?.(); } catch (err) {}
    try { this.offLeave?.(); } catch (err) {}
    try { this.room?.leave?.(); } catch (err) {}
    this.room = null;
    this.send = null;
    this.unsubscribe = null;
    this.offJoin = null;
    this.offLeave = null;
    if (this.updateTimer) clearTimeout(this.updateTimer);
    if (this.cursorTimer) clearTimeout(this.cursorTimer);
    this.updateTimer = null;
    this.cursorTimer = null;
    this.pendingUpdate = null;
    clearRemoteState();
    renderPresenceList();
  }

  setJoinState(state) {
    if (!joinButton) return;
    if (state === 'connecting') {
      joinButton.textContent = 'Connecting…';
      joinButton.disabled = true;
    } else if (state === 'connected') {
      joinButton.textContent = 'Disconnect';
      joinButton.disabled = false;
    } else {
      joinButton.textContent = 'Connect';
      joinButton.disabled = false;
    }
  }

  setStatus(text) {
    if (statusLabel) statusLabel.textContent = text;
  }

  updateStatus() {
    if (!this.connected || !this.roomName) {
      this.setStatus('Offline');
      return;
    }
    const peers = remotePeers.size;
    const label = peers ? `${peers + 1} peers` : 'solo';
    this.setStatus(`Room ${this.roomName} · ${label}`);
  }

  setSelfName(name) {
    displayName = (name || '').trim();
    saveDisplayName(displayName);
    updatePeerName(CLIENT_ID, displayName);
    renderPresenceList();
    this.sendPresence();
  }

  setSelfColor(color) {
    const normalized = normalizeColor(color, getSelfColorHex());
    updatePeerColor(CLIENT_ID, normalized, true);
    renderPresenceList();
    this.sendPresence();
  }

  sendPresence() {
    if (!this.connected) return;
    this.sendMessage({ type: 'presence', name: displayName, color: getSelfColorHex() });
  }

  queueUpdate(patch) {
    if (!this.connected || this.suppress) return;
    this.pendingUpdate = { ...(this.pendingUpdate || {}), ...patch };
    if (this.updateTimer) return;
    this.updateTimer = setTimeout(() => {
      const payload = this.pendingUpdate;
      this.pendingUpdate = null;
      this.updateTimer = null;
      this.sendMessage({ type: 'update', patch: payload });
    }, patch.text != null ? 80 : 0);
  }

  queueCursor(force = false) {
    if (!this.connected) return;
    const snapshot = { ...selfCursorState };
    if (this.cursorTimer) {
      clearTimeout(this.cursorTimer);
      this.cursorTimer = null;
    }
    if (force) {
      this.sendMessage({ type: 'cursor', cursor: snapshot, name: displayName, color: getSelfColorHex() });
      return;
    }
    this.cursorTimer = setTimeout(() => {
      this.cursorTimer = null;
      this.sendMessage({ type: 'cursor', cursor: snapshot, name: displayName, color: getSelfColorHex() });
    }, 80);
  }

  handleContentChange(text) {
    this.queueUpdate({ text });
  }

  handleModeChange(mode) {
    this.queueUpdate({ mode });
  }

  handleDarkModeChange(dark) {
    this.queueUpdate({ dark });
  }

  handleMacrosChange(macros) {
    this.queueUpdate({ macros });
  }

  handleCursor(cursor) {
    updateSelfCursorState(cursor);
    this.queueCursor();
  }

  sendMessage(message) {
    if (!this.connected || !this.send) return;
    try {
      this.send(message);
    } catch (err) {
      console.error('[collab] failed to send message', err, message);
    }
  }

  broadcastFullState(reason = 'manual') {
    if (!this.connected) return;
    const snapshot = getStateSnapshot({ includeCursor: false, includeScroll: false });
    this.sendMessage({ type: 'full-state', snapshot, reason });
  }

  applyRemoteSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return;
    this.suppress = true;
    this.applying = true;
    try {
      applyState(snapshot, { emit: false, persist: true });
    } finally {
      this.applying = false;
      this.suppress = false;
      updateAllRemoteCarets();
      renderPresenceList();
    }
  }

  handleMessage(message, peerId) {
    if (!message || message.from === CLIENT_ID) return;
    const canonical = linkPeerAlias(peerId, message.from || peerId);
    const key = canonical || peerId;
    switch (message.type) {
      case 'presence':
        if (message.name) updatePeerName(key, message.name);
        if (message.color) updatePeerColor(key, message.color);
        this.updateStatus();
        break;
      case 'full-state':
        if (message.snapshot) this.applyRemoteSnapshot(message.snapshot);
        if (message.snapshot?.cursor) updateRemoteCursor(key, message.snapshot.cursor);
        break;
      case 'update':
        if (message.patch) {
          if (message.patch.delta) shiftRemoteCarets(message.patch.delta);
          this.applyRemoteSnapshot(message.patch);
        }
        break;
      case 'cursor':
        if (message.name) updatePeerName(key, message.name);
        if (message.color) updatePeerColor(key, message.color);
        if (message.cursor) updateRemoteCursor(key, message.cursor);
        break;
      default:
        console.warn('[collab] Unknown message type', message.type);
    }
    renderPresenceList();
  }

  handlePeerJoin(peerId) {
    ensurePeerMeta(peerId);
    ensureRemotePeerEntry(peerId);
    this.updateStatus();
    renderPresenceList();
    this.broadcastFullState('peer-join');
    this.sendPresence();
  }

  handlePeerLeave(peerId) {
    removeRemotePeer(peerId);
    this.updateStatus();
  }

  async ensureTrystero() {
    if (window.__TrysteroModule?.joinRoom) return window.__TrysteroModule.joinRoom;
    const sources = [
      './trystero-mqtt.min.js',
      './trystero-torrent.min.js',
      './trystero-firebase.min.js',
      './trystero-ipfs.min.js',
    ];
    for (const url of sources) {
      try {
        const mod = await import(url);
        const candidate = mod?.joinRoom || mod?.default;
        if (typeof candidate === 'function') {
          window.__TrysteroModule = mod;
          return candidate;
        }
      } catch (err) {
        console.warn('[collab] failed to import', url, err);
      }
    }
    throw new Error('Trystero import failed');
  }
}

collab = new CollabSession();

/* =====================
   UI wiring
   ===================== */
if (displayNameInput) {
  displayNameInput.value = displayName;
  displayNameInput.addEventListener('input', () => {
    collab.setSelfName(displayNameInput.value || '');
  });
}

if (joinButton) {
  joinButton.addEventListener('click', async () => {
    if (collab.connected) {
      await collab.disconnect();
    } else {
      const name = (roomInput?.value || '').trim();
      if (name) {
        const url = new URL(location.href);
        url.searchParams.set('room', name);
        history.replaceState(null, '', url.toString());
      }
      collab.connect(name);
    }
  });
}

if (shareRoomButton) {
  shareRoomButton.addEventListener('click', () => {
    if (!collab.connected || !collab.roomName) return;
    const shareUrl = new URL(location.href);
    shareUrl.searchParams.set('room', collab.roomName);
    shareUrl.hash = '';
    ensureClipboard(shareUrl.toString())
      .then(() => {
        const original = shareRoomButton.textContent;
        shareRoomButton.textContent = '✓ Copied!';
        setTimeout(() => { shareRoomButton.textContent = original || '📋 Share Room'; }, 1200);
      })
      .catch(() => {
        prompt('Copy this room link:', shareUrl.toString());
      });
  });
}

function ensureClipboard(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  return Promise.reject(new Error('Clipboard API unavailable'));
}

function parseRoomFromUrl() {
  const params = new URLSearchParams(location.search);
  const hashParams = new URLSearchParams(location.hash.replace(/^#/, ''));
  return params.get('room') || hashParams.get('room') || '';
}

const initialRoom = parseRoomFromUrl();
if (roomInput && initialRoom) {
  roomInput.value = initialRoom;
  collab.connect(initialRoom);
}

ensurePeerMeta(CLIENT_ID);
updatePeerColor(CLIENT_ID, getSelfColorHex());
updatePeerName(CLIENT_ID, displayName);

updateSelfCaretAppearance();
renderPresenceList();
updateAllRemoteCarets();

export { collab };
