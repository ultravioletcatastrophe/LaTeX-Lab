import { initLatexLabBackend } from './katex_backend.js';

const LZString = (function(){
      // Adapted from pieroxy/lz-string (MIT) for URL-safe compression.
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

const { compressToEncodedURIComponent, decompressFromEncodedURIComponent } = LZString;

function compressState(state) {
  try {
    return compressToEncodedURIComponent(JSON.stringify(state));
  } catch (err) {
    console.error('[latexlab] compressState failed', err);
    return '';
  }
}

function decompressState(token) {
  if (!token) return null;
  try {
    const raw = decompressFromEncodedURIComponent(token);
    if (raw) return JSON.parse(raw);
  } catch (err) {
    console.warn('[latexlab] decompressState failed', err);
  }
  return null;
}

function b64encode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin);
}

function b64decode(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function readStateFromHash() {
  const match = location.hash.match(/state=([^&]+)/);
  if (!match) return null;
  const token = match[1];
  let state = decompressState(token);
  if (!state) {
    try {
      state = JSON.parse(b64decode(token));
    } catch (err) {
      console.warn('[latexlab] failed to parse legacy state token', err);
      return null;
    }
  }
  if (!state || typeof state !== 'object') return null;
  return state;
}

function buildShareState(snapshot) {
  return {
    t: snapshot.text,
    m: snapshot.mode === 'classic' ? 1 : 0,
    d: snapshot.dark ? 1 : 0,
    s: snapshot.split,
    x: snapshot.macros,
  };
}

function encodeStateToUrl(backend) {
  const snapshot = backend.getStateSnapshot({ includeCursor: false, includeScroll: false });
  const state = buildShareState(snapshot);
  const compressed = compressState(state);
  const payload = compressed || b64encode(JSON.stringify(state));
  const shareUrl = new URL(location.href);
  shareUrl.hash = 'state=' + payload;
  if (history.replaceState) {
    history.replaceState(null, '', shareUrl.toString());
  } else {
    location.hash = 'state=' + payload;
  }
  return shareUrl.toString();
}

const backend = initLatexLabBackend({
  requestInitialState() {
    const state = readStateFromHash();
    return state || null;
  },
});

const shareBtn = document.getElementById('shareBtn');
if (shareBtn) {
  shareBtn.addEventListener('click', async () => {
    const url = encodeStateToUrl(backend);
    try {
      await navigator.clipboard.writeText(url);
      const previous = shareBtn.textContent;
      shareBtn.textContent = '✅ Copied!';
      setTimeout(() => { shareBtn.textContent = previous || '🔗 Share link'; }, 1200);
    } catch (err) {
      console.warn('[latexlab] clipboard write failed', err);
      prompt('Copy this link:', url);
    }
  });
}

export { backend, encodeStateToUrl, readStateFromHash };
