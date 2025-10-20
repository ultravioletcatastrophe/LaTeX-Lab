export function initLatexLabBackend(hooks = {}) {
  const noop = () => {};
  const {
    requestInitialState = null,
    onReady = noop,
    onRender = noop,
    onContentChange = noop,
    onSelectionChange = noop,
    onScrollChange = noop,
    onModeChange = noop,
    onDarkModeChange = noop,
    onMacrosChange = noop,
  } = hooks ?? {};

  
      /* =====================
         Element refs
         ===================== */
      const editor   = document.getElementById('editor');
      const gutter   = document.getElementById('gutter');
      const overlay  = document.getElementById('overlay');
      const preview  = document.getElementById('preview');
      const divider  = document.getElementById('divider');
      const leftPane = document.getElementById('leftPane');
  
  
      const modeToggle = document.getElementById('modeToggle');
      const modeLabel  = document.getElementById('modeLabel');
      const modeDesc   = document.getElementById('modeDesc');
      const darkToggle = document.getElementById('darkToggle');
  
  
      const pngBtn     = document.getElementById('pngBtn');
      const clearBtn   = document.getElementById('clearBtn');
  
  
      const measure  = document.getElementById('measure');
  
  
      const snippetsMenu = document.getElementById('snippetsMenu');
      const snippetsBtn  = document.getElementById('snippetsBtn');
      document.getElementById('openMatrixGen').addEventListener('click', ()=>{ snippetsMenu.classList.remove('open'); openMatrix(); });
      document.getElementById('openTableGen').addEventListener('click', ()=>{ snippetsMenu.classList.remove('open'); openTable(); });
  
  
      /* =====================
         Modals wiring
         ===================== */
      const matrixModal = document.getElementById('matrixModal');
      const mRows=document.getElementById('mRows'), mCols=document.getElementById('mCols'), mType=document.getElementById('mType');
      const matrixPrev=document.getElementById('matrixPrev');
      document.getElementById('mCancel').addEventListener('click', ()=>matrixModal.classList.remove('show'));
      document.getElementById('mInsert').addEventListener('click', insertMatrix);
  
  
      const tableModal = document.getElementById('tableModal');
      const tRows=document.getElementById('tRows'), tCols=document.getElementById('tCols'), tAlign=document.getElementById('tAlign'), tBorders=document.getElementById('tBorders');
      const tablePrev=document.getElementById('tablePrev');
      document.getElementById('tCancel').addEventListener('click', ()=>tableModal.classList.remove('show'));
      document.getElementById('tInsert').addEventListener('click', insertTable);
  
  
      const macrosBtn   = document.getElementById('macrosBtn');
      const macrosModal = document.getElementById('macrosModal');
      const macrosText  = document.getElementById('macrosText');
      const macrosSave  = document.getElementById('macrosSave');
      const macrosCancel= document.getElementById('macrosCancel');
      const macrosReset = document.getElementById('macrosReset');
  
  
      /* =====================
         Macros model
         ===================== */
      function serializeMacros(macros){
        const lines = [];
        for (const [name, body] of Object.entries(macros)){
          const n = maxArgCount(body);
          const arity = n>0 ? `[${n}]` : '';
          lines.push(`\\newcommand{${name}}${arity}{${body}}`);
        }
        return lines.join('\n');
      }
      function normalizeMacros(obj){
        const out = {}; for (const [k,v] of Object.entries(obj || {})){ out[k] = Array.isArray(v) ? String(v[0]) : String(v); } return out;
      }
      function maxArgCount(s){ let m=0, r=/#([1-9])/g, a; while ((a=r.exec(s))!==null) m=Math.max(m,parseInt(a[1],10)); return m; }
      function stripLatexComments(s){ return s.replace(/(^|[^\\])%.*$/gm, '$1'); }
      function indexToLineNumber(source, index){ let line=1; for (let i=0; i<index; i++){ if (source.charCodeAt(i) === 10) line++; } return line; }
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
  
  
      /* =====================
         State + storage keys
         ===================== */
      let mode = 'mixed';
      const LS_CONTENT = 'latexlab.content.v6';
      const LS_DARK    = 'latexlab.dark.v6';
      const LS_SPLITPX = 'latexlab.splitpx.v6';
      const LS_MODE    = 'latexlab.mode.v2';
      const LS_MACROS  = 'latexlab.macros.v2';
      const LS_CURSOR  = 'latexlab.cursor.v1';
      const LS_SCROLL  = 'latexlab.scroll.v1';
  
  
      const DEFAULT_MACROS = { "\\abs":  "\\left|#1\\right|", "\\norm": "\\left\\lVert#1\\right\\rVert" };
      let MACROS = {...DEFAULT_MACROS};
  
  
      /* =====================
         Guides (gutter + overlay)
         ===================== */
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
      /* =====================
         Render pipeline
         ===================== */
      function render(){
        preview.innerHTML = '';
        const lines = editor.value.split('\n');
        if (mode === 'classic'){
          for (const line of lines){
            if (line.trim() === '') { preview.appendChild(document.createElement('br')); continue; }
            const div = document.createElement('div');
            try { katex.render(line, div, {throwOnError:false, displayMode:true, macros: MACROS}); }
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
        try { onRender({ editor, preview, getStateSnapshot }); } catch (err) { console.error('[latexlab] onRender hook failed', err); }
      }
  
  
      /* =====================
         Scroll sync (editor → preview)
         ===================== */
      editor.addEventListener('scroll', () => {
        const maxE = Math.max(1, editor.scrollHeight - editor.clientHeight);
        const ratio = editor.scrollTop / maxE;
        gutter.scrollTop  = editor.scrollTop;
        overlay.scrollTop = editor.scrollTop;
        preview.scrollTop = ratio * Math.max(0, (preview.scrollHeight - preview.clientHeight));
        try { onScrollChange(editor.scrollTop); } catch (err) { console.error('[latexlab] onScrollChange hook failed', err); }
      });
  
  
      function syncModeUI({ persist = true, emit = true } = {}) {
        mode = modeToggle.checked ? 'classic' : 'mixed';
        modeLabel.textContent = (mode === 'classic') ? 'Classic' : 'Mixed';
        modeDesc.textContent  = (mode === 'classic') ? 'Classic: each new line is rendered as display math.' : 'Mixed: type text with $inline$ and $$display$$ math.';
        editor.placeholder    = (mode === 'classic') ? 'Type lines of pure TeX; each line renders as display math' : 'Type text with $inline$ and $$display$$ math';
        document.body.classList.toggle('mixed',   mode === 'mixed');
        document.body.classList.toggle('classic', mode === 'classic');
        if (persist) {
          try { localStorage.setItem(LS_MODE, mode); } catch(e) {}
        }
        if (emit) {
          try { onModeChange(mode); } catch(err) { console.error('[latexlab] onModeChange hook failed', err); }
        }
      }

      function syncDarkMode({ persist = true, emit = true } = {}) {
        const isDark = darkToggle.checked;
        document.body.classList.toggle('dark', isDark);
        if (persist) {
          try { localStorage.setItem(LS_DARK, isDark ? '1' : '0'); } catch(e) {}
        }
        if (emit) {
          try { onDarkModeChange(isDark); } catch(err) { console.error('[latexlab] onDarkModeChange hook failed', err); }
        }
      }

      /* =====================
         Mode / Theme toggles
         ===================== */
      editor.addEventListener('input', () => {
        render();
        try { localStorage.setItem(LS_CONTENT, editor.value); } catch(e){}
        try { onContentChange(editor.value); } catch (err) { console.error('[latexlab] onContentChange hook failed', err); }
      });
  
  
      modeToggle.addEventListener('change', () => {
        syncModeUI();
        render();
      });
  
  
      darkToggle.addEventListener('change', () => {
        syncDarkMode();
        render();
      });
  
  
      /* =====================
         Tab indent/outdent
         ===================== */
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
        render(); try { localStorage.setItem(LS_CONTENT, editor.value); } catch(e){}
      });
  
  
      /* =====================
         Exporter
         ===================== */
      const Exporter = (() => {
        const EXPORT_SCALE = 8;
        const PADDING = { top: 20, bottom: 20, sides: 20 };
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
            '@font-face{font-family:"CMU Serif"; src:url(https://cdn.jsdelivr.net/npm/computer-modern@0.1.3/fonts/cmu-serif-700-italic.woff2) format("woff2"); font-weight:700; font-style:italic; font-display:swap;}',
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
            console.warn('Direct canvas export failed, attempting sandbox render:', err);
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
  
  
      /* =====================
         Export button
         ===================== */
      pngBtn.addEventListener('click', () => Exporter.exportPNG());
  
  
      /* =====================
         Clear
         ===================== */
      clearBtn.addEventListener('click', () => {
        if (!confirm('Clear editor and saved text?')) return;
        editor.value = '';
        try { localStorage.removeItem(LS_CONTENT); } catch(e) {}
        try { history.replaceState(null, '', location.pathname + location.search); } catch(e) {}
        render();
        try { onContentChange(''); } catch (err) { console.error('[latexlab] onContentChange hook failed', err); }
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
         Snippets (matrix / table / cases)
         ===================== */
      function openMatrix(){ updateMatrixPreview(); matrixModal.classList.add('show'); }
      function openTable(){ updateTablePreview(); tableModal.classList.add('show'); }
  
  
      function matrixPreviewText(r,c,type){ const rows=Array.from({length:r},()=> Array.from({length:c},()=> '◻').join(' & ')).join(' \\\\ '); return `\\begin{${type}} ${rows} \\end{${type}}`; }
      function matrixInsertText(r,c,type){ const rows=Array.from({length:r},()=> Array.from({length:c},()=> '').join(' & ')).join(' \\\\ '); return `\\begin{${type}} ${rows} \\end{${type}}`; }
      function updateMatrixPreview(){ const r=clampInt(mRows.value,1,20), c=clampInt(mCols.value,1,20); matrixPrev.textContent = matrixPreviewText(r,c,mType.value); }
      function insertMatrix(){ const r=clampInt(mRows.value,1,20), c=clampInt(mCols.value,1,20); const core = matrixInsertText(r,c,mType.value); const inMixed = document.body.classList.contains('mixed'); const snippet = inMixed ? `$$${core}$$` : core; insertAtCursor(snippet); matrixModal.classList.remove('show'); }
  
  
      document.getElementById('insertCases').addEventListener('click', insertCases);
      function insertCases(){ const core='\\begin{cases}  &  \\\\  &  \\end{cases}'; const inMixed=document.body.classList.contains('mixed'); const snippet=inMixed?`$$${core}$$`:core; insertAtCursor(snippet); snippetsMenu.classList.remove('open'); }
      mRows.addEventListener('input', updateMatrixPreview); mCols.addEventListener('input', updateMatrixPreview); mType.addEventListener('change', updateMatrixPreview);
  
  
      function arrayColSpec(align, cols, borders){ let spec=align.repeat(cols); if (borders==='all') spec='|'+spec.split('').join('|')+'|'; else if (borders==='outer') spec='|'+spec+'|'; return spec; }
      // function tablePreviewText(r,c,align,borders){ const spec=arrayColSpec(align,c,borders); const cells=Array.from({length:c},()=> '◻').join(' & '); const rows=Array.from({length:r},()=> cells); const joiner = borders==='all' ? ' \\\\ \\hline ' : ' \\\\ '; const top=(borders==='none')?'':'\\hline '; const bottom=(borders==='none')?'':'\\hline '; return `\\begin{array}{${spec}} ${top}${rows.join(joiner)}${bottom}\\end{array}`; }
      // function tableInsertText(r,c,align,borders){ const spec=arrayColSpec(align,c,borders); const cells=Array.from({length:c},()=> '').join(' & '); const rows=Array.from({length:r},()=> cells); const joiner = borders==='all' ? ' \\\\ \\hline ' : ' \\\\ '; const top=(borders==='none')?'':'\\hline '; const bottom=(borders==='none')?'':'\\hline '; return `\\begin{array}{${spec}} ${top}${rows.join(joiner)}${bottom}\\end{array}`; }
      function tablePreviewText(r, c, align, borders){
        return buildTableString(r, c, align, borders, '◻');
      }
  
      function tableInsertText(r, c, align, borders){
        return buildTableString(r, c, align, borders, '');
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
            parts.push(drawInner ? '\\\\ \\hline' : '\\\\');   // between rows
          } else if (drawOuter){
            parts.push('\\\\ \\hline');                         // bottom border
          }
        }
  
        return `\\begin{array}{${spec}} ${parts.join(' ')} \\end{array}`;
      }
  
      function updateTablePreview(){ const r=clampInt(tRows.value,1,40), c=clampInt(tCols.value,1,20); tablePrev.textContent = tablePreviewText(r,c,tAlign.value,tBorders.value); }
      function insertTable(){ const r=clampInt(tRows.value,1,40), c=clampInt(tCols.value,1,20); const core = tableInsertText(r,c,tAlign.value,tBorders.value); const inMixed=document.body.classList.contains('mixed'); const snippet=inMixed?`$$${core}$$`:core; insertAtCursor(snippet); tableModal.classList.remove('show'); }
      tRows.addEventListener('input', updateTablePreview); tCols.addEventListener('input', updateTablePreview); tAlign.addEventListener('change', updateTablePreview); tBorders.addEventListener('change', updateTablePreview);
  
  
      function clampInt(v,min,max){ v=parseInt(v||min,10); return Math.max(min,Math.min(max,isNaN(v)?min:v)); }
      function insertAtCursor(text){
        const el = editor;
        const start = el.selectionStart;
        const end = el.selectionEnd;
        el.value = el.value.slice(0,start) + text + el.value.slice(end);
        el.selectionStart = el.selectionEnd = start + text.length;
        el.focus();
        render();
        try { localStorage.setItem(LS_CONTENT, el.value); } catch(e){}
        try { onContentChange(el.value); } catch (err) { console.error('[latexlab] onContentChange hook failed', err); }
      }
        /* Close Insert menu on outside click */
      snippetsBtn.addEventListener('click', () => snippetsMenu.classList.toggle('open'));
      document.addEventListener('click', (e) => { if (!snippetsMenu.contains(e.target)) snippetsMenu.classList.remove('open'); });
  
  
      /* =====================
         Welcome pop (first-time)
         ===================== */
      (function setupWelcomePop() {
        const LS_WELCOME='latexlab.welcome.v1';
        function getQueryParam(name){ return new URLSearchParams(window.location.search).get(name); }
        function hashHasWelcome(){ return /(^|[#&])welcome(=1|$)/i.test(location.hash); }
        function shouldForceShow(){ const q=(getQueryParam('welcome')||'').toLowerCase(); if (q==='1'||q==='true'||q==='show') return true; if (hashHasWelcome()) return true; return false; }
        function shouldResetFlag(){ const q=(getQueryParam('welcome')||'').toLowerCase(); return q==='reset'||q==='clear'; }
        function safeGetItem(k){ try { return localStorage.getItem(k); } catch(e) { return null; } }
        function safeSetItem(k,v){ try { localStorage.setItem(k,v); } catch(e){} }
        function safeRemoveItem(k){ try { localStorage.removeItem(k); } catch(e){} }
        function showWelcome(){ const el=document.getElementById('welcomePop'); const btn=document.getElementById('welcomeClose'); if(!el||!btn) return; el.style.display='block'; setTimeout(()=>{ try { btn.focus(); } catch(e){} },0); btn.addEventListener('click', () => { el.style.display='none'; safeSetItem(LS_WELCOME,'1'); }, { once:true }); }
        function init(){ if(shouldResetFlag()) safeRemoveItem(LS_WELCOME); const forced=shouldForceShow(); const seen=!!safeGetItem(LS_WELCOME); if (forced || !seen) { showWelcome(); if(forced) return; } }
        if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', init, { once:true }); } else { init(); }
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { const el=document.getElementById('welcomePop'); if (el && el.style.display==='block') { el.style.display='none'; try { localStorage.setItem(LS_WELCOME,'1'); } catch(e){} } } });
      })();
  
  
      /* =====================
         IDE-like pairing (improved $ logic)
         ===================== */
      editor.addEventListener('keydown', (e) => {
        const OPEN_TO_CLOSE = { '(': ')', '{': '}', '[': ']'};
        const CLOSERS = new Set(Object.values(OPEN_TO_CLOSE));
        const start = editor.selectionStart; const end = editor.selectionEnd; const hasSel = start !== end; const nextChar = editor.value[end] || '';
  
  
        // Skip over existing closer when appropriate (not for openers—we rely on explicit logic below)
        if (CLOSERS.has(e.key) && !hasSel && nextChar === e.key) {
          e.preventDefault(); editor.selectionStart = editor.selectionEnd = end + 1; return;
        }
  
  
        // Dollar handling (single vs double) — more predictable typing for $ and $$
        if (e.key === '$') {
          e.preventDefault();
  
  
          const start = editor.selectionStart, end = editor.selectionEnd;
          const hasSel = start !== end;
          const sel = editor.value.slice(start, end);
          const next = editor.value[end] || '';
  
  
          // If caret is just before a $, skip over it (no selection)
          if (!hasSel && next === '$') {
            editor.selectionStart = editor.selectionEnd = end + 1;
            return;
          }
  
  
          // With a selection: default to single-$ wrap (use $$ only for multi-line)
          const pair = (hasSel && sel.includes('\n')) ? '$$' : '$';
  
  
          const before = editor.value.slice(0, start);
          const after  = editor.value.slice(end);
          editor.value = before + pair + sel + pair + after;
  
  
          if (hasSel) {
            // ✅ Keep the original inner text selected after wrapping
            editor.selectionStart = start + pair.length;
            editor.selectionEnd   = end   + pair.length;
          } else {
            // No selection: place caret between the inserted pair
            editor.selectionStart = editor.selectionEnd = start + pair.length;
          }
  
  
          render();
          try { localStorage.setItem(LS_CONTENT, editor.value); } catch {}
          return;
        }
  
  
        // Generic openers ( (), {}, [] )
        if (e.key in OPEN_TO_CLOSE && e.key !== '$') {
          e.preventDefault();
          const open = e.key; const close = OPEN_TO_CLOSE[open];
          const before = editor.value.slice(0, start); const selected = editor.value.slice(start, end); const after = editor.value.slice(end);
          editor.value = before + open + selected + close + after;
          if (hasSel) { editor.selectionStart = start + 1; editor.selectionEnd = end + 1; } else { editor.selectionStart = editor.selectionEnd = start + 1; }
          render(); try { localStorage.setItem(LS_CONTENT, editor.value); } catch {}
          return;
        }
      });
      // Save caret position when selection changes
      editor.addEventListener('keyup', saveCursorAndScroll);
      editor.addEventListener('click', saveCursorAndScroll);
      editor.addEventListener('input', saveCursorAndScroll);
  
  
      function saveCursorAndScroll() {
        try {
          localStorage.setItem(LS_CURSOR, String(editor.selectionStart));
          localStorage.setItem(LS_SCROLL, String(editor.scrollTop));
        } catch (e) {}
        try { onSelectionChange({ start: editor.selectionStart ?? 0, end: editor.selectionEnd ?? 0 }); }
        catch (err) { console.error('[latexlab] onSelectionChange hook failed', err); }
        try { onScrollChange(editor.scrollTop); }
        catch (err) { console.error('[latexlab] onScrollChange hook failed', err); }
      }
  
  
  
  
      function getStateSnapshot({ includeCursor = true, includeScroll = true, legacy = false } = {}) {
        const splitWidth = (() => {
          const rect = leftPane.getBoundingClientRect();
          if (rect && rect.width) return rect.width;
          const flex = leftPane.style.flex || '';
          const match = flex.match(/0 0 (.+)px/);
          return match ? parseFloat(match[1]) || 0 : 0;
        })();
        const snapshot = {
          text: editor.value,
          mode,
          dark: document.body.classList.contains('dark'),
          split: splitWidth,
          macros: { ...MACROS },
        };
        if (includeCursor) {
          snapshot.cursor = { start: editor.selectionStart || 0, end: editor.selectionEnd || 0 };
        }
        if (includeScroll) {
          snapshot.scrollTop = editor.scrollTop;
        }
        if (legacy) {
          snapshot.t = snapshot.text;
          snapshot.m = (snapshot.mode === 'classic') ? 1 : 0;
          snapshot.d = snapshot.dark ? 1 : 0;
          snapshot.s = snapshot.split;
          snapshot.x = snapshot.macros;
        }
        return snapshot;
      }

      function applyState(state, options = {}) {
        if (!state || typeof state !== 'object') return false;
        const { emit = true, persist = true, deferRender = false } = options;
        let changed = false;
        let needsRender = false;

        if (Object.prototype.hasOwnProperty.call(state, 'text') || Object.prototype.hasOwnProperty.call(state, 't')) {
          const text = state.text ?? state.t;
          if (typeof text === 'string' && editor.value !== text) {
            editor.value = text;
            changed = true;
            needsRender = true;
            if (persist) {
              try { localStorage.setItem(LS_CONTENT, text); } catch(e) {}
            }
            if (emit) {
              try { onContentChange(text); } catch(err) { console.error('[latexlab] onContentChange hook failed', err); }
            }
          }
        }

        const newMode = state.mode ?? (state.m === 1 ? 'classic' : state.m === 0 ? 'mixed' : undefined);
        if (newMode === 'classic' || newMode === 'mixed') {
          const shouldCheck = (newMode === 'classic');
          if (modeToggle.checked !== shouldCheck || mode !== newMode) {
            modeToggle.checked = shouldCheck;
            syncModeUI({ persist, emit });
            changed = true;
            needsRender = true;
          }
        }

        if (Object.prototype.hasOwnProperty.call(state, 'dark') || Object.prototype.hasOwnProperty.call(state, 'd')) {
          const isDark = typeof state.dark === 'boolean' ? state.dark : state.d === 1;
          if (darkToggle.checked !== isDark) {
            darkToggle.checked = isDark;
            syncDarkMode({ persist, emit });
            changed = true;
            needsRender = true;
          }
        }

        if (Object.prototype.hasOwnProperty.call(state, 'split') || Object.prototype.hasOwnProperty.call(state, 's')) {
          const split = state.split ?? state.s;
          if (typeof split === 'number' && !Number.isNaN(split)) {
            leftPane.style.flex = `0 0 ${split}px`;
            preview.style.flex = '1 1 auto';
            if (persist) {
              try { localStorage.setItem(LS_SPLITPX, String(split)); } catch(e) {}
            }
            changed = true;
          }
        }

        if (Object.prototype.hasOwnProperty.call(state, 'macros') || Object.prototype.hasOwnProperty.call(state, 'x')) {
          const macros = state.macros ?? state.x;
          if (macros && typeof macros === 'object') {
            MACROS = normalizeMacros(macros);
            if (persist) {
              try { localStorage.setItem(LS_MACROS, JSON.stringify(MACROS)); } catch(e) {}
            }
            if (emit) {
              try { onMacrosChange({ ...MACROS }); } catch(err) { console.error('[latexlab] onMacrosChange hook failed', err); }
            }
            changed = true;
            needsRender = true;
          }
        }

        if (Object.prototype.hasOwnProperty.call(state, 'cursor') || Object.prototype.hasOwnProperty.call(state, 'cursorStart')) {
          const cursor = state.cursor ?? { start: state.cursorStart, end: state.cursorEnd ?? state.cursorStart };
          if (cursor && typeof cursor.start === 'number') {
            const start = Math.max(0, cursor.start);
            const end = typeof cursor.end === 'number' ? Math.max(0, cursor.end) : start;
            editor.selectionStart = start;
            editor.selectionEnd = end;
            if (persist) {
              try { localStorage.setItem(LS_CURSOR, String(start)); } catch(e) {}
            }
          }
        }

        if (Object.prototype.hasOwnProperty.call(state, 'scrollTop') || Object.prototype.hasOwnProperty.call(state, 'scroll') || Object.prototype.hasOwnProperty.call(state, 'scrollY')) {
          const scroll = state.scrollTop ?? state.scroll ?? state.scrollY;
          if (typeof scroll === 'number' && !Number.isNaN(scroll)) {
            requestAnimationFrame(() => {
              editor.scrollTop = scroll;
              gutter.scrollTop = scroll;
              overlay.scrollTop = scroll;
            });
            if (persist) {
              try { localStorage.setItem(LS_SCROLL, String(scroll)); } catch(e) {}
            }
            changed = true;
          }
        }

        if (needsRender && !deferRender) {
          render();
        }
        return changed;
      }

      function restoreFromLocalStorage() {
        let restored = false;
        try {
          const saved = localStorage.getItem(LS_CONTENT);
          if (saved != null) {
            editor.value = saved;
            restored = true;
          }
        } catch(e) {}
        try {
          const savedMode = localStorage.getItem(LS_MODE);
          if (savedMode === 'classic' || savedMode === 'mixed') {
            modeToggle.checked = (savedMode === 'classic');
          }
        } catch(e) {}
        syncModeUI({ persist: false, emit: false });
        try {
          const dark = localStorage.getItem(LS_DARK) === '1';
          darkToggle.checked = dark;
        } catch(e) {}
        syncDarkMode({ persist: false, emit: false });
        try {
          const raw = localStorage.getItem(LS_MACROS);
          if (raw) {
            MACROS = normalizeMacros(JSON.parse(raw));
            restored = true;
          }
        } catch(e) {}
        try {
          const savedPx = parseFloat(localStorage.getItem(LS_SPLITPX));
          if (!Number.isNaN(savedPx)) {
            leftPane.style.flex = `0 0 ${savedPx}px`;
            preview.style.flex = '1 1 auto';
          }
        } catch(e) {}
        try {
          const cursor = parseInt(localStorage.getItem(LS_CURSOR), 10);
          if (!Number.isNaN(cursor)) {
            editor.selectionStart = editor.selectionEnd = cursor;
          }
          const scroll = parseInt(localStorage.getItem(LS_SCROLL), 10);
          if (!Number.isNaN(scroll)) {
            requestAnimationFrame(() => {
              editor.scrollTop = scroll;
              gutter.scrollTop = scroll;
              overlay.scrollTop = scroll;
            });
          }
        } catch(e) {}
        return restored;
      }

      /* =====================
         Init sequence
         ===================== */
      window.addEventListener('load', () => {
        let loadedExternally = false;
        if (typeof requestInitialState === 'function') {
          try {
            const maybeState = requestInitialState({ applyState, getStateSnapshot, editor });
            if (maybeState) {
              loadedExternally = applyState(maybeState, { emit: false });
            }
          } catch (err) {
            console.error('[latexlab] requestInitialState hook failed', err);
          }
        }
        if (!loadedExternally) {
          restoreFromLocalStorage();
        }
        syncModeUI({ persist: false, emit: false });
        syncDarkMode({ persist: false, emit: false });
        Guides.syncOverlayAndMirror();
        render();
        requestAnimationFrame(() => {
          Guides.scheduleRebuild();
          requestAnimationFrame(() => {
            try {
              const saved = parseInt(localStorage.getItem(LS_SCROLL), 10);
              if (!Number.isNaN(saved)) {
                editor.scrollTop  = saved;
                gutter.scrollTop  = saved;
                overlay.scrollTop = saved;
              }
            } catch {}
          });
        });
        editor.focus();
        try {
          onReady({ editor, getStateSnapshot, applyState, render });
        } catch (err) {
          console.error('[latexlab] onReady hook failed', err);
        }
      });
      window.addEventListener('resize', () => { Guides.syncOverlayAndMirror(); Guides.scheduleRebuild({ force: true }); });
  
  
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
  
      attachModalDismiss(matrixModal, () => matrixModal.classList.remove('show'));
      attachModalDismiss(tableModal,  () => tableModal.classList.remove('show'));
      attachModalDismiss(macrosModal, () => macrosModal.classList.remove('show'));
  
  
      window.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if (matrixModal.classList.contains('show')) { matrixModal.classList.remove('show'); return; }
        if (tableModal .classList.contains('show')) { tableModal .classList.remove('show'); return; }
        if (macrosModal.classList.contains('show')) { macrosModal.classList.remove('show'); return; }
      });
  
  
      /* =====================
         Macros modal actions
         ===================== */
      macrosBtn.addEventListener('click', () => { macrosText.value = serializeMacros(MACROS); macrosModal.classList.add('show'); });
      macrosCancel.addEventListener('click', ()=> macrosModal.classList.remove('show'));
      macrosReset.addEventListener('click', () => {
        MACROS = { ...DEFAULT_MACROS };
        try { localStorage.setItem(LS_MACROS, JSON.stringify(MACROS)); } catch(e) {}
        macrosText.value = serializeMacros(MACROS);
        try { onMacrosChange({ ...MACROS }); } catch (err) { console.error('[latexlab] onMacrosChange hook failed', err); }
        render();
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
  
      macrosSave.addEventListener('click', (e) => {
        e.preventDefault();
        try {
          const raw = macrosText.value;
          // allow empty input
          if (raw === "") {
            MACROS = {};
            try { localStorage.setItem(LS_MACROS, JSON.stringify(MACROS)); } catch (storageErr) {}
            macrosText.value = ""; // clear textarea
            try { onMacrosChange({ ...MACROS }); } catch (err) { console.error('[latexlab] onMacrosChange hook failed', err); }
            render();
            requestAnimationFrame(() => macrosModal.classList.remove('show'));
            return; // don’t try to parse
          }
          const { macros: parsed, errors } = parseMacrosInput(raw);
          if (errors.length){
            const first = errors[0];
            focusMacroLine(first.line);
            alert(`Could not parse \\newcommand on line ${first.line}: ${first.reason}.`);
            return;
          }
          // if (!parsed || Object.keys(parsed).length === 0) { alert('Nothing to save. Add lines like \\newcommand{\\SO}{\\operatorname{SO}}'); return; }
          MACROS = parsed;
          try { localStorage.setItem(LS_MACROS, JSON.stringify(MACROS)); } catch (storageErr) {}
          try { macrosText.value = serializeMacros(MACROS); } catch (serr) {}
          try { onMacrosChange({ ...MACROS }); } catch (err) { console.error('[latexlab] onMacrosChange hook failed', err); }
          render(); requestAnimationFrame(() => macrosModal.classList.remove('show'));
        } catch (err) { console.error('Save handler error:', err); alert('Unexpected error while saving shortcuts. Check console for details.'); }
      });
  
  const backend = {
    editor,
    gutter,
    overlay,
    preview,
    divider,
    leftPane,
    modeToggle,
    darkToggle,
    render,
    Guides,
    getStateSnapshot,
    applyState,
    restoreFromLocalStorage,
    focusEditor: (options) => editor.focus(options),
    setMode(newMode, options = {}) {
      if (newMode !== 'classic' && newMode !== 'mixed') return false;
      modeToggle.checked = (newMode === 'classic');
      syncModeUI({ persist: options.persist !== false, emit: options.emit !== false });
      if (options.deferRender !== true) render();
      return true;
    },
    setDarkMode(isDark, options = {}) {
      const flag = !!isDark;
      if (darkToggle.checked !== flag) {
        darkToggle.checked = flag;
      }
      syncDarkMode({ persist: options.persist !== false, emit: options.emit !== false });
      if (options.deferRender !== true) render();
      return true;
    },
    setMacros(macros, options = {}) {
      return applyState({ macros }, options);
    },
    setContent(text, options = {}) {
      return applyState({ text }, options);
    },
  };

  return backend;

}
