const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const BACKEND_PATH = path.resolve(__dirname, '..', '..', 'assets', 'katex_backend.js');

const ELEMENT_IDS = [
  'editor', 'gutter', 'overlay', 'preview', 'divider', 'leftPane', 'editorWrap', 'measure',
  'modeToggle', 'modeLabel', 'modeDesc', 'darkToggle',
  'pngBtn', 'clearBtn', 'shareBtn',
  'snippetsMenu', 'snippetsBtn', 'openMatrixGen', 'openTableGen', 'insertCases',
  'matrixModal', 'mRows', 'mCols', 'mType', 'matrixPrev', 'mCancel', 'mInsert',
  'tableModal', 'tRows', 'tCols', 'tAlign', 'tBorders', 'tablePrev', 'tCancel', 'tInsert',
  'macrosBtn', 'macrosModal', 'macrosText', 'macrosSave', 'macrosCancel', 'macrosReset',
  'presenceList', 'shareRoomBtn', 'displayNameInput', 'roomNameInput', 'roomJoinBtn', 'collabStatus',
  'joinPop', 'joinPopDismiss', 'joinPopCancel', 'joinPopDontShow',
  'welcomePop', 'welcomeClose', 'welcomeBackdrop'
];

function attachEventTarget(target) {
  const listeners = new Map();

  target.addEventListener = (type, handler, options = {}) => {
    if (typeof handler !== 'function') return;
    const once = !!(typeof options === 'object' && options && options.once);
    const list = listeners.get(type) || [];
    list.push({ handler, once });
    listeners.set(type, list);
  };

  target.removeEventListener = (type, handler) => {
    const list = listeners.get(type);
    if (!list) return;
    listeners.set(type, list.filter(item => item.handler !== handler));
  };

  target.dispatchEvent = (eventOrType) => {
    const event = (typeof eventOrType === 'string') ? { type: eventOrType } : { ...eventOrType };
    if (!event || typeof event.type !== 'string') {
      throw new TypeError('Event must include a string "type".');
    }
    if (typeof event.preventDefault !== 'function') {
      event.defaultPrevented = false;
      event.preventDefault = () => { event.defaultPrevented = true; };
    }
    if (typeof event.stopPropagation !== 'function') event.stopPropagation = () => {};
    if (typeof event.stopImmediatePropagation !== 'function') event.stopImmediatePropagation = () => {};
    if (!('target' in event)) event.target = target;
    event.currentTarget = target;

    const list = (listeners.get(event.type) || []).slice();
    for (const item of list) {
      item.handler.call(target, event);
      if (item.once) {
        target.removeEventListener(event.type, item.handler);
      }
    }
    return !event.defaultPrevented;
  };

  return target;
}

class FakeClassList {
  constructor() {
    this._set = new Set();
  }

  add(...names) {
    names.forEach(name => this._set.add(String(name)));
  }

  remove(...names) {
    names.forEach(name => this._set.delete(String(name)));
  }

  contains(name) {
    return this._set.has(String(name));
  }

  toggle(name, force) {
    const key = String(name);
    if (force === true) {
      this._set.add(key);
      return true;
    }
    if (force === false) {
      this._set.delete(key);
      return false;
    }
    if (this._set.has(key)) {
      this._set.delete(key);
      return false;
    }
    this._set.add(key);
    return true;
  }
}

class FakeStyle {
  setProperty(name, value) {
    this[name] = String(value);
  }

  removeProperty(name) {
    delete this[name];
  }
}

class FakeElement {
  constructor(id = '', ownerDocument = null) {
    attachEventTarget(this);
    this.id = id;
    this.ownerDocument = ownerDocument;
    this.parentElement = null;
    this.children = [];
    this.style = new FakeStyle();
    this.classList = new FakeClassList();
    this.dataset = {};
    this.value = '';
    this.checked = false;
    this.selectionStart = 0;
    this.selectionEnd = 0;
    this.scrollTop = 0;
    this.scrollLeft = 0;
    this.scrollHeight = 1000;
    this.clientHeight = 400;
    this.clientWidth = 600;
    this.textContent = '';
    this.innerHTML = '';
    this.disabled = false;
    this.hidden = false;
    this.nodeType = 1;
  }

  get childNodes() {
    return this.children;
  }

  appendChild(node) {
    if (node && typeof node === 'object') {
      node.parentElement = this;
    }
    this.children.push(node);
    return node;
  }

  removeChild(node) {
    const index = this.children.indexOf(node);
    if (index >= 0) this.children.splice(index, 1);
    if (node && typeof node === 'object') node.parentElement = null;
    return node;
  }

  replaceChildren(...nodes) {
    this.children = [];
    nodes.forEach(node => this.appendChild(node));
  }

  remove() {
    if (this.parentElement) {
      this.parentElement.removeChild(this);
    }
  }

  setAttribute(name, value) {
    this[name] = String(value);
  }

  getAttribute(name) {
    return (name in this) ? String(this[name]) : null;
  }

  contains(target) {
    if (!target || typeof target !== 'object') return false;
    if (target === this) return true;
    return this.children.some(child => child && typeof child.contains === 'function' && child.contains(target));
  }

  closest(selector) {
    if (typeof selector !== 'string') return null;
    const options = selector.split(',').map(item => item.trim()).filter(Boolean);
    let node = this;
    while (node) {
      for (const option of options) {
        if (option.startsWith('#') && node.id === option.slice(1)) return node;
        if (option.startsWith('.') && node.classList && node.classList.contains(option.slice(1))) return node;
      }
      node = node.parentElement;
    }
    return null;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    if (typeof selector !== 'string' || !selector) return [];
    const classes = selector
      .split('.')
      .map(part => part.trim())
      .filter(Boolean)
      .filter(part => !part.startsWith('#'));
    if (!selector.startsWith('.')) return [];

    const result = [];
    const visit = (node) => {
      if (!node || typeof node !== 'object') return;
      const matches = classes.every(cls => node.classList && node.classList.contains(cls));
      if (matches) result.push(node);
      (node.children || []).forEach(visit);
    };
    this.children.forEach(visit);
    return result;
  }

  getBoundingClientRect() {
    const width = Number(this.clientWidth) || 0;
    const height = Number(this.clientHeight) || 0;
    return { width, height, left: 0, top: 0, right: width, bottom: height };
  }

  focus() {
    if (this.ownerDocument) this.ownerDocument.activeElement = this;
  }

  blur() {
    if (this.ownerDocument && this.ownerDocument.activeElement === this) {
      this.ownerDocument.activeElement = null;
    }
  }

  click() {
    this.dispatchEvent({
      type: 'click',
      target: this
    });
  }

  setSelectionRange(start, end) {
    this.selectionStart = Number(start) || 0;
    this.selectionEnd = Number(end) || 0;
  }

  setPointerCapture() {}

  releasePointerCapture() {}

  setRangeText(text, start, end, mode) {
    const begin = Number(start) || 0;
    const finish = Number(end) || 0;
    const before = this.value.slice(0, begin);
    const after = this.value.slice(finish);
    this.value = before + String(text) + after;
    if (mode === 'end') {
      const cursor = begin + String(text).length;
      this.selectionStart = cursor;
      this.selectionEnd = cursor;
    }
  }
}

function createComputedStyle(element) {
  const defaults = {
    direction: 'ltr',
    boxSizing: 'border-box',
    width: '600px',
    height: '400px',
    overflowX: 'auto',
    overflowY: 'auto',
    borderTopWidth: '0px',
    borderRightWidth: '0px',
    borderBottomWidth: '0px',
    borderLeftWidth: '0px',
    paddingTop: '0px',
    paddingRight: '0px',
    paddingBottom: '0px',
    paddingLeft: '0px',
    fontStyle: 'normal',
    fontVariant: 'normal',
    fontWeight: '400',
    fontStretch: 'normal',
    fontSize: '16px',
    fontSizeAdjust: 'none',
    lineHeight: '20px',
    fontFamily: 'monospace',
    textAlign: 'start',
    textTransform: 'none',
    textIndent: '0px',
    textDecoration: 'none',
    letterSpacing: '0px',
    wordSpacing: '0px',
    tabSize: '4',
    MozTabSize: '4',
    color: '#111111',
    backgroundColor: '#ffffff'
  };
  const styleValues = { ...defaults };
  if (element && element.style) {
    Object.entries(element.style).forEach(([key, value]) => {
      if (typeof value === 'string') styleValues[key] = value;
    });
  }
  styleValues.getPropertyValue = (name) => styleValues[name] || '';
  return styleValues;
}

function loadBackend(options = {}) {
  const {
    collab = false,
    shareStateLink = !collab,
    storagePrefix = collab ? 'latexlab.trystero' : 'latexlab',
    search = '',
    hash = '',
    href = 'https://example.test/latex_lab.html',
    localStorageData = {},
    mobile = false,
    confirmResult = true
  } = options;

  const parsedHref = new URL(href);
  const location = {
    search: search ? (search.startsWith('?') ? search : `?${search}`) : '',
    hash: hash ? (hash.startsWith('#') ? hash : `#${hash}`) : '',
    href: parsedHref.toString(),
    pathname: parsedHref.pathname,
    protocol: parsedHref.protocol,
    hostname: parsedHref.hostname
  };

  const storage = new Map();
  Object.entries(localStorageData).forEach(([key, value]) => {
    storage.set(String(key), String(value));
  });

  const localStorage = {
    getItem(key) {
      return storage.has(String(key)) ? storage.get(String(key)) : null;
    },
    setItem(key, value) {
      storage.set(String(key), String(value));
    },
    removeItem(key) {
      storage.delete(String(key));
    }
  };

  const alerts = [];
  const confirms = [];
  const prompts = [];

  const document = attachEventTarget({
    readyState: 'complete',
    activeElement: null
  });

  const body = new FakeElement('body', document);
  body.dataset = {
    collab: collab ? 'true' : 'false',
    welcome: collab ? 'modal' : 'corner'
  };
  body.classList.add('mixed');
  document.body = body;

  const container = new FakeElement('container', document);
  container.clientWidth = 1200;

  const elements = new Map();
  const ensureElement = (id) => {
    if (!elements.has(id)) {
      elements.set(id, new FakeElement(id, document));
    }
    return elements.get(id);
  };

  ELEMENT_IDS.forEach(ensureElement);

  ensureElement('mRows').value = '3';
  ensureElement('mCols').value = '3';
  ensureElement('mType').value = 'pmatrix';
  ensureElement('tRows').value = '3';
  ensureElement('tCols').value = '3';
  ensureElement('tAlign').value = 'c';
  ensureElement('tBorders').value = 'none';
  ensureElement('modeToggle').checked = false;
  ensureElement('darkToggle').checked = false;

  document.getElementById = (id) => elements.get(String(id)) || null;
  document.createElement = (tagName) => new FakeElement(String(tagName), document);
  document.createTextNode = (value) => ({ nodeType: 3, textContent: String(value) });
  document.createDocumentFragment = () => new FakeElement('fragment', document);
  document.querySelector = (selector) => {
    if (selector === '.container') return container;
    if (selector && selector.startsWith('#')) return document.getElementById(selector.slice(1));
    return null;
  };
  document.querySelectorAll = () => [];

  const visualViewport = attachEventTarget({
    height: 700,
    offsetTop: 0
  });

  const mql = attachEventTarget({
    matches: !!mobile
  });
  mql.addListener = (handler) => mql.addEventListener('change', handler);
  mql.removeListener = (handler) => mql.removeEventListener('change', handler);

  let rafTick = 0;

  const context = attachEventTarget({
    document,
    localStorage,
    sessionStorage: localStorage,
    location,
    history: { replaceState() {} },
    navigator: { clipboard: { writeText: async () => {} } },
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    Blob,
    atob: (value) => Buffer.from(String(value), 'base64').toString('binary'),
    btoa: (value) => Buffer.from(String(value), 'binary').toString('base64'),
    performance: { now: () => Date.now() + (rafTick * 16) },
    requestAnimationFrame: (callback) => {
      rafTick += 1;
      callback(Date.now() + (rafTick * 16));
      return rafTick;
    },
    cancelAnimationFrame: () => {},
    setTimeout: (fn) => {
      if (typeof fn === 'function') fn();
      return 1;
    },
    clearTimeout: () => {},
    setInterval: () => 1,
    clearInterval: () => {},
    matchMedia: () => mql,
    getComputedStyle: (element) => createComputedStyle(element),
    katex: { render() {} },
    renderMathInElement: () => {},
    html2canvas: async () => ({
      toBlob(callback) {
        callback(new Blob([Buffer.from('png')], { type: 'image/png' }));
      },
      toDataURL() {
        return 'data:image/png;base64,AA==';
      }
    }),
    fetch: async () => ({ ok: true, json: async () => ({ colors: [] }) }),
    nearestColor: { from: () => () => ({ name: 'Color', value: '#000000' }) },
    isSecureContext: true,
    RTCPeerConnection: function RTCPeerConnection() {},
    crypto: {
      randomUUID: () => '00000000-0000-4000-8000-000000000000',
      subtle: {}
    },
    alert: (message) => { alerts.push(String(message)); },
    confirm: (message) => { confirms.push(String(message)); return !!confirmResult; },
    prompt: (message, value = '') => {
      prompts.push({ message: String(message), value: String(value) });
      return value;
    },
    visualViewport,
    scrollY: 0,
    scrollTo: (_x, y) => { context.scrollY = Number(y) || 0; },
    LATEX_LAB_CONFIG: {
      collab,
      shareStateLink,
      storagePrefix
    },
    Element: FakeElement,
    Node: { TEXT_NODE: 3 }
  });

  context.window = context;
  context.globalThis = context;

  const source = fs.readFileSync(BACKEND_PATH, 'utf8');
  const hookSource = `
;globalThis.__TEST_HOOKS__ = {
  DEFAULT_MACROS,
  extractMacros,
  parseMacrosInput,
  normalizeMacros,
  maxArgCount,
  stripLatexComments,
  indexToLineNumber,
  modeDescriptionText,
  modePlaceholderText,
  matrixPreviewText,
  matrixInsertText,
  arrayColSpec,
  buildTableString,
  tablePreviewText,
  tableInsertText,
  clampInt,
  isAtBottom,
  clampSplitWidth,
  applySplitWidth,
  compressState,
  decompressState,
  b64encode,
  b64decode,
  normalizeStateToken,
  getStateTokenFromHash,
  setStateTokenOnUrl,
  getStorageKey: (suffix) => key(suffix),
  getMACROS: () => MACROS,
  setMacrosText: (value) => { if (macrosText) macrosText.value = String(value); },
  triggerMacrosSave: () => { if (macrosSave && typeof macrosSave.click === 'function') macrosSave.click(); },
  getRoomInputValue: () => {
    const input = document.getElementById('roomNameInput');
    return input ? input.value : null;
  }
};
`;

  vm.createContext(context);
  vm.runInContext(source + hookSource, context, { timeout: 5000 });

  return {
    hooks: context.__TEST_HOOKS__,
    context,
    document,
    window: context,
    elements,
    alerts,
    confirms,
    prompts,
    storage,
    runWindowEvent(type, event = {}) {
      return context.dispatchEvent({ ...event, type });
    },
    runDocumentEvent(type, event = {}) {
      return document.dispatchEvent({ ...event, type });
    }
  };
}

module.exports = {
  BACKEND_PATH,
  loadBackend
};
