const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EXPORT_GOLDEN_ENABLED, EXPORT_GOLDEN_HINT } = require('./helpers/playwright_flags.cjs');
const { startStaticServer, closeServer } = require('./helpers/playwright_static_server.cjs');

const ROOT_DIR = path.resolve(__dirname, '..');
const IMAGES_DIR = path.join(ROOT_DIR, 'assets', 'images');
const FIXTURES_DIR = path.join(__dirname, 'fixtures', 'export');
const SHOULD_RUN = EXPORT_GOLDEN_ENABLED;
const DOWNLOAD_TIMEOUT_MS = Number(
  process.env.LATEX_LAB_EXPORT_TIMEOUT_MS ||
  process.env.LATEXLAB_EXPORT_TIMEOUT_MS ||
  120000
);

let playwright = null;
try {
  // Optional dependency; this test is skipped unless explicitly enabled.
  playwright = require('playwright');
} catch (err) {
  playwright = null;
}

const SCENARIOS = [
  { id: 'mixed-light', mode: 'mixed', dark: false },
  { id: 'mixed-dark', mode: 'mixed', dark: true },
  { id: 'classic-light', mode: 'classic', dark: false },
  { id: 'classic-dark', mode: 'classic', dark: true }
];

const FORMATS = ['png', 'pdf'];

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function normalizePdfBytes(buffer) {
  const text = buffer.toString('latin1');
  return Buffer.from(
    text
      // jsPDF embeds timestamp metadata.
      .replace(/\/CreationDate\s*\(D:[^)]+\)/g, '/CreationDate(D:00000000000000+00\'00\')')
      .replace(/\/ModDate\s*\(D:[^)]+\)/g, '/ModDate(D:00000000000000+00\'00\')')
      // jsPDF also emits document IDs that can vary between runs.
      .replace(/\/ID\s*\[\s*<[A-Fa-f0-9]+>\s*<[A-Fa-f0-9]+>\s*\]/g, '/ID [ <0> <0> ]'),
    'latin1'
  );
}

function assertGoldenMatch(format, actualBytes, expectedBytes, label) {
  if (format === 'pdf') {
    actualBytes = normalizePdfBytes(actualBytes);
    expectedBytes = normalizePdfBytes(expectedBytes);
  }
  const isEqual = actualBytes.equals(expectedBytes);
  assert.equal(
    isEqual,
    true,
    `${label} mismatch\nexpected sha256=${sha256(expectedBytes)}\nactual   sha256=${sha256(actualBytes)}`
  );
}

async function applyScenarioState(page, scenario, content) {
  await page.evaluate(({ mode, dark, content }) => {
    const modeToggle = document.getElementById('modeToggle');
    const darkToggle = document.getElementById('darkToggle');
    const editor = document.getElementById('editor');
    if (!modeToggle || !darkToggle || !editor) {
      throw new Error('Editor controls are not available');
    }

    const nextClassic = mode === 'classic';
    if (modeToggle.checked !== nextClassic) {
      modeToggle.checked = nextClassic;
      modeToggle.dispatchEvent(new Event('change', { bubbles: true }));
    }

    if (darkToggle.checked !== dark) {
      darkToggle.checked = dark;
      darkToggle.dispatchEvent(new Event('change', { bubbles: true }));
    }

    editor.value = content;
    editor.selectionStart = 0;
    editor.selectionEnd = 0;
    editor.scrollTop = 0;
    editor.dispatchEvent(new Event('input', { bubbles: true }));
  }, {
    mode: scenario.mode,
    dark: scenario.dark,
    content
  });

  await page.waitForTimeout(250);
}

async function exportAndCompare(page, scenario, format, tmpDir) {
  const baselinePath = path.join(IMAGES_DIR, `${scenario.id}.${format}`);
  const targetPath = path.join(tmpDir, `${scenario.id}.${format}`);
  const buttonSelector = format === 'png' ? '#pngBtn' : '#pdfBtn';
  const label = `${scenario.id}.${format}`;
  await page.waitForFunction(() => {
    const png = document.getElementById('pngBtn');
    const pdf = document.getElementById('pdfBtn');
    return !png?.disabled && !pdf?.disabled;
  }, { timeout: DOWNLOAD_TIMEOUT_MS });

  let dialogHandler = null;
  const dialogPromise = new Promise((_, reject) => {
    dialogHandler = async (dialog) => {
      const message = dialog.message();
      try { await dialog.dismiss(); } catch (err) {}
      reject(new Error(`Export dialog for ${label}: ${message}`));
    };
    page.on('dialog', dialogHandler);
  });

  let download = null;
  try {
    try {
      await page.click(buttonSelector, { timeout: 15000 });
    } catch (err) {
      const state = await page.evaluate((selector) => {
        const el = document.querySelector(selector);
        if (!el) return { exists: false };
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        const welcome = document.getElementById('welcomePop');
        const welcomeStyle = welcome ? getComputedStyle(welcome) : null;
        return {
          exists: true,
          disabled: !!el.disabled,
          display: style.display,
          visibility: style.visibility,
          opacity: style.opacity,
          rect: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height)
          },
          welcomeVisible: !!(welcome && (welcome.style.display === 'block' || welcomeStyle?.display !== 'none'))
        };
      }, buttonSelector);
      throw new Error(
        `Failed to click ${buttonSelector} for ${label}: ${err && err.message ? err.message : String(err)}\n` +
        `buttonState=${JSON.stringify(state)}`
      );
    }
    download = await Promise.race([
      page.waitForEvent('download', { timeout: DOWNLOAD_TIMEOUT_MS }),
      dialogPromise
    ]);
  } catch (err) {
    if (err && err.name === 'TimeoutError') {
      throw new Error(
        `Timed out waiting for download for ${label} after ${DOWNLOAD_TIMEOUT_MS}ms. ` +
        `Try increasing LATEX_LAB_EXPORT_TIMEOUT_MS.`
      );
    }
    throw err;
  } finally {
    if (dialogHandler) page.off('dialog', dialogHandler);
  }

  try {
    await download.saveAs(targetPath);
    const actualBytes = fs.readFileSync(targetPath);
    const expectedBytes = fs.readFileSync(baselinePath);
    assertGoldenMatch(format, actualBytes, expectedBytes, label);
  } finally {
    if (fs.existsSync(targetPath)) {
      fs.unlinkSync(targetPath);
    }
  }
}

test(
  'golden export outputs (png/pdf light/dark mixed/classic) match baseline files',
  {
    skip: !SHOULD_RUN || !playwright,
    timeout: 240000
  },
  async (t) => {
    if (!SHOULD_RUN) {
      t.diagnostic(EXPORT_GOLDEN_HINT);
      return;
    }
    if (!playwright) {
      t.diagnostic('Playwright is not installed; skipping export golden tests.');
      return;
    }

    const fixtureCache = {
      mixed: fs.readFileSync(path.join(FIXTURES_DIR, 'mixed-content.txt'), 'utf8'),
      classic: fs.readFileSync(path.join(FIXTURES_DIR, 'classic-content.txt'), 'utf8')
    };

    const { server, origin } = await startStaticServer(ROOT_DIR);
    const browser = await playwright.chromium.launch({ headless: true });
    const context = await browser.newContext({
      acceptDownloads: true,
      viewport: { width: 1440, height: 2200 }
    });
    await context.addInitScript(() => {
      try {
        localStorage.setItem('latexlab.welcome.v1', '1');
      } catch (err) {}
    });
    const page = await context.newPage();
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'latexlab-export-golden-'));
    const failures = [];

    try {
      await page.goto(`${origin}/latex_lab.html`, { waitUntil: 'networkidle' });

      const depsReady = await page.evaluate(() => {
        return !!(window.katex && window.renderMathInElement && window.jspdf && window.jspdf.jsPDF);
      });
      if (!depsReady) {
        assert.fail('Runtime dependencies were not available in page context.');
      }

      for (const scenario of SCENARIOS) {
        const content = fixtureCache[scenario.mode];
        await applyScenarioState(page, scenario, content);
        for (const format of FORMATS) {
          const label = `${scenario.id}.${format}`;
          try {
            await exportAndCompare(page, scenario, format, tmpDir);
            t.diagnostic(`PASS ${label}`);
          } catch (err) {
            const message = (err && err.message) ? err.message : String(err);
            failures.push({ label, message });
            t.diagnostic(`FAIL ${label}: ${message}`);
          }
        }
      }

      if (failures.length > 0) {
        const details = failures
          .map((item, idx) => `${idx + 1}. ${item.label}\n${item.message}`)
          .join('\n\n');
        assert.fail(`Export golden mismatches (${failures.length}/${SCENARIOS.length * FORMATS.length}):\n\n${details}`);
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      await context.close();
      await browser.close();
      await closeServer(server);
    }
  }
);
