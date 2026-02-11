const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const GENERATED_ENTRY_FILES = ['latex_lab.html', 'latex_lab_trystero.html'];

test('generate-entry-pages output matches checked-in entry pages', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'latex-lab-entry-pages-'));
  try {
    fs.mkdirSync(path.join(tempRoot, 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(tempRoot, 'templates'), { recursive: true });
    fs.copyFileSync(
      path.join(ROOT_DIR, 'scripts', 'generate-entry-pages.mjs'),
      path.join(tempRoot, 'scripts', 'generate-entry-pages.mjs')
    );
    fs.copyFileSync(
      path.join(ROOT_DIR, 'templates', 'entry-page.template.html'),
      path.join(tempRoot, 'templates', 'entry-page.template.html')
    );

    execFileSync(process.execPath, ['scripts/generate-entry-pages.mjs'], {
      cwd: tempRoot,
      stdio: 'pipe'
    });

    for (const fileName of GENERATED_ENTRY_FILES){
      const generated = fs.readFileSync(path.join(tempRoot, fileName), 'utf8');
      const checkedIn = fs.readFileSync(path.join(ROOT_DIR, fileName), 'utf8');
      assert.equal(
        generated,
        checkedIn,
        `${fileName} does not match generated output. Run: node scripts/generate-entry-pages.mjs`
      );
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
