const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { PLAYWRIGHT_ENABLED, PLAYWRIGHT_HINT } = require('./helpers/playwright_flags.cjs');
const { startStaticServer, closeServer } = require('./helpers/playwright_static_server.cjs');

const ROOT_DIR = path.resolve(__dirname, '..');

let playwright = null;
try {
  playwright = require('playwright');
} catch (err) {
  playwright = null;
}

async function withPage(viewport, run) {
  const { server, origin } = await startStaticServer(ROOT_DIR);
  const browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport });
  await context.addInitScript(() => {
    try {
      localStorage.setItem('latexlab.welcome.v1', '1');
    } catch (err) {}
  });
  const page = await context.newPage();

  try {
    await page.goto(`${origin}/latex_lab.html`, { waitUntil: 'networkidle' });
    await run(page);
  } finally {
    await context.close();
    await browser.close();
    await closeServer(server);
  }
}

test(
  'mobile export menu toggles modal and aria state',
  {
    skip: !PLAYWRIGHT_ENABLED || !playwright,
    timeout: 90000
  },
  async (t) => {
    if (!PLAYWRIGHT_ENABLED) {
      t.diagnostic(PLAYWRIGHT_HINT);
      return;
    }
    if (!playwright) {
      t.diagnostic('Playwright is not installed; skipping browser smoke tests.');
      return;
    }

    await withPage({ width: 390, height: 844 }, async (page) => {
      const initial = await page.evaluate(() => {
        return {
          exportBtnDisplay: getComputedStyle(document.getElementById('exportBtn')).display,
          pngBtnDisplay: getComputedStyle(document.getElementById('pngBtn')).display,
          pdfBtnDisplay: getComputedStyle(document.getElementById('pdfBtn')).display,
          modalOpen: document.getElementById('exportModal').classList.contains('show')
        };
      });

      assert.equal(initial.exportBtnDisplay === 'none', false);
      assert.equal(initial.pngBtnDisplay, 'none');
      assert.equal(initial.pdfBtnDisplay, 'none');
      assert.equal(initial.modalOpen, false);

      await page.click('#exportBtn');
      await page.waitForFunction(() => {
        return document.getElementById('exportModal')?.classList.contains('show');
      });

      const opened = await page.evaluate(() => {
        return {
          modalOpen: document.getElementById('exportModal').classList.contains('show'),
          ariaHidden: document.getElementById('exportModal').getAttribute('aria-hidden'),
          ariaExpanded: document.getElementById('exportBtn').getAttribute('aria-expanded')
        };
      });

      assert.equal(opened.modalOpen, true);
      assert.equal(opened.ariaHidden, 'false');
      assert.equal(opened.ariaExpanded, 'true');

      await page.keyboard.press('Escape');
      await page.waitForFunction(() => {
        return !document.getElementById('exportModal')?.classList.contains('show');
      });

      const closed = await page.evaluate(() => {
        return {
          modalOpen: document.getElementById('exportModal').classList.contains('show'),
          ariaHidden: document.getElementById('exportModal').getAttribute('aria-hidden'),
          ariaExpanded: document.getElementById('exportBtn').getAttribute('aria-expanded')
        };
      });

      assert.equal(closed.modalOpen, false);
      assert.equal(closed.ariaHidden, 'true');
      assert.equal(closed.ariaExpanded, 'false');
    });
  }
);

test(
  'escaped dollars remain literal text outside math delimiters in real browser render',
  {
    skip: !PLAYWRIGHT_ENABLED || !playwright,
    timeout: 90000
  },
  async (t) => {
    if (!PLAYWRIGHT_ENABLED) {
      t.diagnostic(PLAYWRIGHT_HINT);
      return;
    }
    if (!playwright) {
      t.diagnostic('Playwright is not installed; skipping browser smoke tests.');
      return;
    }

    await withPage({ width: 1280, height: 900 }, async (page) => {
      await page.evaluate(() => {
        const modeToggle = document.getElementById('modeToggle');
        if (modeToggle.checked) {
          modeToggle.checked = false;
          modeToggle.dispatchEvent(new Event('change', { bubbles: true }));
        }

        const editor = document.getElementById('editor');
        editor.value = 'Cost: \\$5 and \\$x\\$ plus $a+\\$b$';
        editor.selectionStart = 0;
        editor.selectionEnd = 0;
        editor.dispatchEvent(new Event('input', { bubbles: true }));
      });

      await page.waitForFunction(() => {
        const wrap = document.querySelector('#preview > div');
        return !!wrap;
      });

      const state = await page.evaluate(() => {
        const wrap = document.querySelector('#preview > div');
        const textNodes = Array.from(wrap.childNodes || [])
          .filter((node) => node && node.nodeType === 3)
          .map((node) => String(node.nodeValue || ''))
          .join('');
        return {
          hasKaTeX: !!wrap.querySelector('.katex'),
          textNodes,
          hasPlaceholder: wrap.textContent.includes('LATEXLAB_ESCAPED_DOLLAR')
        };
      });

      assert.equal(state.hasKaTeX, true);
      assert.equal(state.hasPlaceholder, false);
      assert.equal(state.textNodes.includes('$5 and $x$ plus '), true);
      assert.equal(state.textNodes.includes('\\$'), false);
    });
  }
);
